/**
 * Graphics settings, adaptive resolution and the GPU readout.
 *
 * The game has always rendered on the GPU — three.js talks to WebGL2, which is
 * hardware-accelerated in every current browser. What was missing was any way
 * to SEE that, or to spend the headroom a real GPU gives you. This module owns
 * both: a quality preset that scales the expensive settings together, and a
 * diagnostics panel that names the adapter actually doing the work.
 */

import * as THREE from 'three';
import { CONFIG } from '../config.js';

const STORAGE_KEY = 'xm30.quality';

/**
 * Tidies an adapter string for display.
 *
 * Chrome reports these wrapped as `ANGLE (vendor, device, driver)`, and device
 * names carry their own nested brackets and PCI ids. Peeling off the wrapper
 * leaves its closing bracket behind, so unmatched brackets get dropped too.
 */
function shortenAdapter(text) {
  const trimmed = text
    .replace(/^ANGLE \(([^,]+), /, '$1 ')
    .replace(/\s*\(0x[0-9A-Fa-f]+\)/g, '')
    .trim();

  let depth = 0;
  let out = '';
  for (const ch of trimmed) {
    if (ch === '(') depth++;
    else if (ch === ')') {
      if (depth === 0) continue;   // orphaned by the wrapper strip
      depth--;
    }
    out += ch;
  }
  out = out.replace(/[,\s]+$/, '').trim();

  // Vendors habitually repeat themselves ("NVIDIA NVIDIA GeForce ...").
  const norm = (w) => w.replace(/\(R\)|\(TM\)|®|™/gi, '').toLowerCase();
  const parts = out.split(' ');
  if (parts.length > 1 && norm(parts[0]) && norm(parts[0]) === norm(parts[1])) parts.shift();
  return parts.join(' ');
}

export class Graphics {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.DirectionalLight} sun   key light, whose shadow map is the
   *                                       single most expensive setting here
   */
  constructor(renderer, sun) {
    this.renderer = renderer;
    this.sun = sun;

    this.presetName = this._loadPreset();
    /** Multiplier the adaptive scaler applies on top of the preset. */
    this.resScale = 1;
    this.adaptive = CONFIG.quality.adaptive;

    // Rolling frame-time statistics.
    this._frameMs = 16.7;
    this._worstMs = 0;
    this._samples = 0;
    this._sinceAdjust = 0;

    this.gpu = this._probeGpu();
    this.apply(this.presetName, { silent: true });
  }

  get preset() { return CONFIG.quality.presets[this.presetName]; }

  /* ------------------------------- adapter -------------------------------- */

  /**
   * Names the GPU actually rendering. WEBGL_debug_renderer_info is the only
   * way to get the real adapter string; some privacy modes mask it, so this
   * degrades to the generic vendor rather than failing.
   */
  _probeGpu() {
    const gl = this.renderer.getContext();
    let vendor = 'unavailable';
    let device = 'unavailable';
    try {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      vendor = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
      device = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    } catch { /* masked — leave the defaults */ }

    const text = String(device);
    // SwiftShader, llvmpipe and Mesa's softpipe are the common CPU fallbacks.
    const software = /swiftshader|llvmpipe|softpipe|software/i.test(text);

    return {
      vendor: String(vendor),
      device: text,
      api: String(gl.getParameter(gl.VERSION)),
      shading: String(gl.getParameter(gl.SHADING_LANGUAGE_VERSION)),
      maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      maxAnisotropy: this.renderer.capabilities.getMaxAnisotropy(),
      software,
      /** Short label for the HUD: the adapter name without the ANGLE wrapper. */
      short: shortenAdapter(text),
    };
  }

  /* -------------------------------- presets ------------------------------- */

  _loadPreset() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && CONFIG.quality.presets[saved]) return saved;
    } catch { /* private mode, blocked storage — fall through */ }
    return CONFIG.quality.default;
  }

  _savePreset() {
    try { localStorage.setItem(STORAGE_KEY, this.presetName); } catch { /* ignore */ }
  }

  /** Cycles to the next preset and returns its label. */
  cycle() {
    const names = Object.keys(CONFIG.quality.presets);
    const i = names.indexOf(this.presetName);
    return this.apply(names[(i + 1) % names.length]);
  }

  /**
   * Applies a preset to the renderer, the shadow camera and the streaming
   * distance. Returns the preset's label.
   */
  apply(name, { silent = false } = {}) {
    const preset = CONFIG.quality.presets[name];
    if (!preset) return this.preset.label;
    this.presetName = name;
    this.resScale = 1;
    this._savePreset();

    /* ------------------------------ resolution ---------------------------- */
    this._applyResolution();

    /* -------------------------------- shadows ----------------------------- */
    const r = this.renderer;
    const wasEnabled = r.shadowMap.enabled;
    r.shadowMap.enabled = preset.shadows;
    r.shadowMap.type = preset.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    if (wasEnabled !== preset.shadows) r.shadowMap.needsUpdate = true;

    const shadow = this.sun.shadow;
    if (shadow.mapSize.x !== preset.shadowMap) {
      shadow.mapSize.set(preset.shadowMap, preset.shadowMap);
      // The map is allocated on first use; drop it so it is rebuilt at size.
      if (shadow.map) { shadow.map.dispose(); shadow.map = null; }
    }
    const half = preset.shadowDistance / 2;
    const cam = shadow.camera;
    cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
    cam.updateProjectionMatrix();
    this.sun.castShadow = preset.shadows;

    /* ------------------------------- streaming ---------------------------- */
    CONFIG.world.streamAhead = preset.streamAhead;

    /* ------------------------------ anisotropy ---------------------------- */
    this._applyAnisotropy(preset.anisotropy);

    /* ---------------------------- shader recompile ------------------------ */
    // Toggling shadows changes the shader permutation, so the materials that
    // already exist have to be told to rebuild.
    if (wasEnabled !== preset.shadows && this.materials) {
      for (const m of this.materials) m.needsUpdate = true;
    }

    if (!silent && this.onChange) this.onChange(preset);
    return preset.label;
  }

  _applyResolution() {
    const target = this.preset.renderScale * this.resScale;
    const clamped = Math.max(0.5, Math.min(CONFIG.quality.maxRenderScale, target));
    this.renderer.setPixelRatio(clamped);
    if (this.onResize) this.onResize();
  }

  /**
   * Anisotropic filtering is baked into each texture, so changing it means
   * walking every texture the material set holds.
   */
  _applyAnisotropy(level) {
    if (!this.materials) return;
    const capped = Math.min(level, this.gpu.maxAnisotropy || 1);
    const seen = new Set();
    for (const m of this.materials) {
      for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']) {
        const tex = m[key];
        if (!tex || seen.has(tex)) continue;
        seen.add(tex);
        if (tex.anisotropy !== capped) {
          tex.anisotropy = capped;
          tex.needsUpdate = true;
        }
      }
    }
  }

  /** Registers the material set so preset changes can reach the textures. */
  useMaterials(materialSet) {
    this.materials = Object.values(materialSet).filter((m) => m && m.isMaterial);
    this._applyAnisotropy(this.preset.anisotropy);
  }

  /* --------------------------- adaptive resolution ------------------------ */

  /**
   * Trims render resolution when frames run long and gives it back when they
   * do not. This is what keeps a laptop iGPU playable without forcing someone
   * on a discrete card down to the same picture.
   *
   * @param {number} dt seconds since the last frame
   */
  sample(dt) {
    const ms = dt * 1000;
    // Exponential average, plus the worst frame in the current window.
    this._frameMs += (ms - this._frameMs) * 0.06;
    this._worstMs = Math.max(this._worstMs, ms);
    this._samples++;

    if (!this.adaptive) return;
    this._sinceAdjust += dt;
    if (this._sinceAdjust < CONFIG.quality.adjustInterval) return;
    this._sinceAdjust = 0;

    const q = CONFIG.quality;
    const before = this.resScale;
    if (this._frameMs > q.slowFrameMs && this.resScale > q.minResScale) {
      this.resScale = Math.max(q.minResScale, this.resScale - q.resStep);
    } else if (this._frameMs < q.fastFrameMs && this.resScale < 1) {
      this.resScale = Math.min(1, this.resScale + q.resStep);
    }
    if (before !== this.resScale) this._applyResolution();
  }

  get fps() { return this._frameMs > 0 ? 1000 / this._frameMs : 0; }
  get frameMs() { return this._frameMs; }

  /** Resets the worst-frame tracker; the readout calls this each refresh. */
  takeWorst() {
    const w = this._worstMs;
    this._worstMs = 0;
    return w;
  }

  /** Everything the diagnostics panel needs, in one object. */
  report() {
    const info = this.renderer.info;
    const size = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(size);
    return {
      gpu: this.gpu,
      preset: this.preset,
      presetName: this.presetName,
      renderScale: this.renderer.getPixelRatio(),
      displayRatio: devicePixelRatio || 1,
      resScale: this.resScale,
      adaptive: this.adaptive,
      buffer: `${Math.round(size.x)}x${Math.round(size.y)}`,
      fps: this.fps,
      frameMs: this._frameMs,
      calls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs ? info.programs.length : 0,
    };
  }
}

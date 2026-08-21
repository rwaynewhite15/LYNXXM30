/**
 * Procedural texture + material library.
 *
 * Everything here is generated on a <canvas> at load time. No external image
 * assets, which keeps the whole game offline-capable and the repository small.
 */

import * as THREE from 'three';

/* ============================== noise helpers ============================= */

function hash2(x, y, seed) {
  let h = x * 374761393 + y * 668265263 + seed * 2246822519;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Wraps lattice coordinates so a texture tiles without a visible seam. */
function wrap(i, period) {
  return period ? ((i % period) + period) % period : i;
}

function smooth(t) { return t * t * (3 - 2 * t); }

function valueNoise(x, y, seed, period = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = smooth(xf), v = smooth(yf);
  const x0 = wrap(xi, period), x1 = wrap(xi + 1, period);
  const y0 = wrap(yi, period), y1 = wrap(yi + 1, period);
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** Fractal brownian motion — the workhorse for every surface here. */
function fbm(x, y, octaves, seed, lacunarity = 2, gain = 0.5, period = 0) {
  let sum = 0, amp = 1, norm = 0, fx = x, fy = y, p = period;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(fx, fy, seed + i * 71, p) * amp;
    norm += amp;
    amp *= gain;
    fx *= lacunarity;
    fy *= lacunarity;
    p *= lacunarity;
  }
  return sum / norm;
}

/* =============================== canvas util ============================== */

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function finish(cv, { repeat = 1, srgb = true, aniso = 8 } = {}) {
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = aniso;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Paints per-pixel with a callback that returns [r,g,b] in 0..255.
 * Slower than drawing primitives but gives us real surface variation.
 */
function paint(size, fn) {
  const cv = canvas(size);
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const c = fn(x, y, size);
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c.length > 3 ? c[3] : 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { cv, ctx };
}

/** Derives a cheap tangent-space-ish normal map from a height callback. */
function normalFromHeight(size, heightFn, strength = 2.2) {
  const { cv } = paint(size, (x, y) => {
    const s = 1;
    const hL = heightFn((x - s + size) % size, y);
    const hR = heightFn((x + s) % size, y);
    const hD = heightFn(x, (y - s + size) % size);
    const hU = heightFn(x, (y + s) % size);
    const nx = (hL - hR) * strength;
    const ny = (hD - hU) * strength;
    const nz = 1;
    const len = Math.hypot(nx, ny, nz);
    return [
      Math.round((nx / len * 0.5 + 0.5) * 255),
      Math.round((ny / len * 0.5 + 0.5) * 255),
      Math.round((nz / len * 0.5 + 0.5) * 255),
    ];
  });
  return cv;
}

/* ============================== the textures ============================== */

/**
 * Armour plate.
 *
 * Painted in the NATO three-tone scheme (green base, brown and black blobs),
 * then knocked back with mottling, sun-fade and edge scuffing. The lattice
 * noise is periodic so the sheet tiles seamlessly across the hull.
 */
const NATO = {
  green: [78, 88, 68],
  brown: [88, 72, 55],
  black: [45, 48, 44],
};

function armourTexture({ base = NATO.green, seed = 7, camo = true, size = 512, cells = 8 } = {}) {
  const S = size;
  // Two independent blob fields decide where the brown and black go.
  const brownField = (x, y) => fbm(x / S * cells, y / S * cells, 3, seed + 101, 2, 0.5, cells);
  const blackField = (x, y) => fbm(x / S * cells * 1.5, y / S * cells * 1.5, 3, seed + 211, 2, 0.5, Math.round(cells * 1.5));

  const height = (x, y) =>
    fbm(x / S * 16, y / S * 16, 4, seed, 2, 0.5, 16) * 0.7 +
    fbm(x / S * 90, y / S * 90, 2, seed + 3, 2, 0.5, 90) * 0.3;

  const { cv } = paint(S, (x, y) => {
    let col = base;
    if (camo) {
      // Hard-edged blobs, the way sprayed camo actually looks at 20 m.
      if (brownField(x, y) > 0.575) col = NATO.brown;
      if (blackField(x, y) > 0.635) col = NATO.black;
    }
    const n = fbm(x / S * 20, y / S * 20, 5, seed + 5, 2, 0.5, 20);
    const grain = fbm(x / S * 140, y / S * 140, 2, seed + 11, 2, 0.5, 140);
    // Sun-bleaching in broad patches, dirt film low down.
    const fade = Math.max(0, fbm(x / S * 5, y / S * 5, 3, seed + 21, 2, 0.5, 5) - 0.55) * 0.34;
    const k = 0.88 + n * 0.16 + grain * 0.06 + fade;
    return [
      Math.min(255, col[0] * k),
      Math.min(255, col[1] * k),
      Math.min(255, col[2] * k),
    ];
  });

  return {
    map: finish(cv, { repeat: 1 }),
    normal: finish(normalFromHeight(S, height, 1.0), { repeat: 1, srgb: false }),
  };
}

/** Rubber-bushed track pad: dark, dusty, with a chevron tread. */
function trackTexture() {
  const S = 128;
  const { cv, ctx } = paint(S, (x, y) => {
    const n = fbm(x / 12, y / 12, 3, 41);
    const v = 34 + n * 26;
    return [v, v * 0.98, v * 0.94];
  });
  ctx.strokeStyle = 'rgba(20,20,18,.85)';
  ctx.lineWidth = 7;
  for (let i = -1; i < 5; i++) {
    const y = i * 32 + 16;
    ctx.beginPath();
    ctx.moveTo(0, y - 9);
    ctx.lineTo(S / 2, y + 9);
    ctx.lineTo(S, y - 9);
    ctx.stroke();
  }
  // Dust film picked up from the road.
  ctx.fillStyle = 'rgba(150,132,100,.16)';
  ctx.fillRect(0, 0, S, S);
  return finish(cv, { repeat: 1 });
}

/** Asphalt with aggregate, patch repairs and tyre polish down the lanes. */
function asphaltTexture() {
  const S = 512;
  const { cv, ctx } = paint(S, (x, y) => {
    const agg = fbm(x / 2.2, y / 2.2, 2, 5);
    const patch = fbm(x / 60, y / 60, 4, 9);
    let v = 44 + agg * 30 + patch * 18;
    // Two polished wheel tracks running along the texture's V axis.
    const lane = Math.min(Math.abs(x - S * 0.3), Math.abs(x - S * 0.7));
    if (lane < 46) v *= 0.86 + (lane / 46) * 0.14;
    return [v, v * 1.01, v * 1.04];
  });
  // Cracks.
  ctx.strokeStyle = 'rgba(18,18,20,.7)';
  for (let i = 0; i < 22; i++) {
    ctx.lineWidth = 0.6 + Math.random() * 1.4;
    ctx.beginPath();
    let x = Math.random() * S, y = Math.random() * S;
    ctx.moveTo(x, y);
    for (let s = 0; s < 9; s++) {
      x += (Math.random() - 0.5) * 60;
      y += (Math.random() - 0.5) * 60;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return finish(cv, { repeat: 1 });
}

/**
 * Road surface with its markings baked in.
 *
 * The tile covers ROAD_TILE_W x ROAD_TILE_L metres of carriageway, so the road
 * can be one long strip with no marking geometry at all.
 */
export const ROAD_TILE_W = 8.4;
export const ROAD_TILE_L = 12.0;

function roadSurfaceTexture() {
  const S = 512;
  const px = S / ROAD_TILE_W;          // pixels per metre across
  const pz = S / ROAD_TILE_L;          // pixels per metre along
  const { cv, ctx } = paint(S, (x, y) => {
    const agg = fbm(x / S * 200, y / S * 200, 2, 5, 2, 0.5, 200);
    const patch = fbm(x / S * 7, y / S * 7, 4, 9, 2, 0.5, 7);
    let v = 76 + agg * 26 + patch * 20;
    // Polished wheel tracks where traffic has run.
    const lane = Math.min(Math.abs(x - S * 0.28), Math.abs(x - S * 0.72));
    if (lane < 44) v *= 0.88 + (lane / 44) * 0.12;
    // Weathered asphalt goes grey-brown; without warming it the sky's blue
    // ambient turns a dark rough surface distinctly violet.
    return [v * 1.07, v * 1.02, v * 0.90];
  });

  ctx.strokeStyle = 'rgba(16,16,18,.65)';
  for (let i = 0; i < 16; i++) {
    ctx.lineWidth = 0.6 + Math.random() * 1.5;
    ctx.beginPath();
    let x = Math.random() * S, y = Math.random() * S;
    ctx.moveTo(x, y);
    for (let k = 0; k < 7; k++) {
      x += (Math.random() - 0.5) * 70;
      y += (Math.random() - 0.5) * 70;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Markings: a worn centre dash and two solid edge lines.
  ctx.globalAlpha = 0.72;
  ctx.fillStyle = '#d8d2b4';
  ctx.fillRect(S / 2 - 0.075 * px, 0, 0.15 * px, 3.0 * pz);          // centre dash
  ctx.fillStyle = '#cfcabb';
  ctx.fillRect(0.55 * px, 0, 0.12 * px, S);                           // left edge
  ctx.fillRect(S - 0.67 * px, 0, 0.12 * px, S);                       // right edge
  ctx.globalAlpha = 1;

  // Scuff the paint back so it isn't showroom-fresh.
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const wear = fbm(x / S * 60, y / S * 60, 3, 77, 2, 0.5, 60);
      if (wear < 0.42) {
        const k = 0.55 + wear;
        d[i] *= k; d[i + 1] *= k; d[i + 2] *= k;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return finish(cv, { repeat: 1 });
}

/** Cast concrete for kerbs and pavements. */
function pavementTexture() {
  const S = 256;
  const { cv, ctx } = paint(S, (x, y) => {
    const n = fbm(x / S * 18, y / S * 18, 4, 91, 2, 0.5, 18);
    const g = fbm(x / S * 120, y / S * 120, 2, 95, 2, 0.5, 120);
    const k = 0.76 + n * 0.3 + g * 0.09;
    return [140 * k, 138 * k, 132 * k];
  });
  ctx.strokeStyle = 'rgba(70,68,64,.4)';
  ctx.lineWidth = 1.6;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath(); ctx.moveTo(0, i * 64); ctx.lineTo(S, i * 64); ctx.stroke();
  }
  return finish(cv, { repeat: 1 });
}

/** Weathered concrete for building facades and barriers. */
function concreteTexture(tint = [150, 146, 138], seed = 13) {
  const S = 256;
  const { cv, ctx } = paint(S, (x, y) => {
    const n = fbm(x / 40, y / 40, 5, seed);
    const g = fbm(x / 4, y / 4, 2, seed + 6);
    // Vertical rain streaking below the top edge.
    const streak = Math.max(0, fbm(x / 6, y / 130, 3, seed + 31) - 0.5) * (y / S) * 0.55;
    const k = 0.78 + n * 0.3 + g * 0.08 - streak;
    return [tint[0] * k, tint[1] * k, tint[2] * k];
  });
  // Form-tie holes and panel joints.
  ctx.strokeStyle = 'rgba(90,88,84,.35)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath(); ctx.moveTo(0, i * 64); ctx.lineTo(S, i * 64); ctx.stroke();
  }
  return finish(cv, { repeat: 1 });
}

/** Brick coursing, for facade variety. */
function brickTexture(tint = [138, 88, 72], seed = 23) {
  const S = 256;
  const bh = 16, bw = 42, mortar = 3;
  const { cv } = paint(S, (x, y) => {
    const row = Math.floor(y / bh);
    const off = (row % 2) * (bw / 2);
    const bx = (x + off) % bw;
    const by = y % bh;
    const isMortar = bx < mortar || by < mortar;
    const jitter = hash2(Math.floor((x + off) / bw), row, seed);
    if (isMortar) {
      const v = 150 + fbm(x / 5, y / 5, 2, seed + 4) * 30;
      return [v, v * 0.99, v * 0.95];
    }
    const k = 0.7 + jitter * 0.42 + fbm(x / 6, y / 6, 3, seed + 9) * 0.22;
    return [tint[0] * k, tint[1] * k, tint[2] * k];
  });
  return finish(cv, { repeat: 1 });
}

/** Dry roadside dirt with sparse scrub. */
function dirtTexture() {
  const S = 256;
  const { cv } = paint(S, (x, y) => {
    const n = fbm(x / 30, y / 30, 5, 61);
    const g = fbm(x / 6, y / 6, 3, 67);
    const scrub = Math.max(0, fbm(x / 14, y / 14, 4, 71) - 0.62) * 2.4;
    const base = [122 + n * 42, 112 + n * 38, 84 + n * 30];
    // Blend toward a dry olive where the scrub mask is high.
    return [
      base[0] * (1 - scrub) + 84 * scrub + g * 8,
      base[1] * (1 - scrub) + 92 * scrub + g * 8,
      base[2] * (1 - scrub) + 56 * scrub + g * 6,
    ];
  });
  return finish(cv, { repeat: 1 });
}

/* ============================= sky environment ============================ */

/**
 * A hazy daylight sky as an equirectangular canvas, run through PMREM so the
 * metals have something to reflect. Cheaper and more controllable than
 * shipping an HDR.
 */
export function buildEnvironment(renderer) {
  const W = 256, H = 128;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');

  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0.00, '#4d78ad');
  g.addColorStop(0.42, '#9db6cd');
  g.addColorStop(0.52, '#cfd2c8');   // horizon haze
  g.addColorStop(0.56, '#8d8a76');
  g.addColorStop(1.00, '#3c3a30');   // ground bounce
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // A soft sun blob so specular highlights have a direction.
  const sun = ctx.createRadialGradient(W * 0.72, H * 0.24, 0, W * 0.72, H * 0.24, 26);
  sun.addColorStop(0, 'rgba(255,250,232,1)');
  sun.addColorStop(1, 'rgba(255,250,232,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, W, H);

  const tex = new THREE.CanvasTexture(cv);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const rt = pmrem.fromEquirectangular(tex);
  pmrem.dispose();
  // The same canvas doubles as the scene background, so the horizon has a
  // gradient rather than the flat wash of a solid fog colour.
  return { envMap: rt.texture, background: tex };
}

/* ============================== material set ============================== */

let cache = null;

/**
 * Builds (once) and returns every material the game uses.
 * Call after the renderer exists so textures land on the right context.
 */
export function materials() {
  if (cache) return cache;

  const armour = armourTexture({ seed: 7, cells: 7 });
  const armourDark = armourTexture({ base: [58, 66, 52], seed: 17, camo: true, cells: 9 });
  const armourPlain = armourTexture({ base: [70, 79, 60], seed: 31, camo: false, size: 256 });
  const trackTex = trackTexture();
  const asphalt = asphaltTexture();
  const roadSurface = roadSurfaceTexture();
  const pavement = pavementTexture();
  const concreteA = concreteTexture([132, 129, 121], 13);
  const concreteB = concreteTexture([110, 103, 92], 29);
  const brick = brickTexture([140, 88, 70], 23);
  const dirt = dirtTexture();

  const tile = (t, r) => { const c = t.clone(); c.repeat.set(r[0], r[1]); c.needsUpdate = true; return c; };

  cache = {
    textures: { armour, armourDark, armourPlain, trackTex, asphalt, roadSurface, pavement, concreteA, concreteB, brick, dirt },
    tile,

    /* ---- vehicle ---- */
    // Main painted armour. Low roughness variation, no metalness — vehicle
    // paint is a matte coat, not bare steel.
    hull: new THREE.MeshStandardMaterial({
      map: armour.map, normalMap: armour.normal,
      normalScale: new THREE.Vector2(0.55, 0.55),
      color: 0xffffff, roughness: 0.88, metalness: 0.06,
    }),
    // Plain paint for the small fittings — hatches, boxes, brackets. Camo
    // blobs on a 30 cm part just read as noise, so these stay single-tone.
    hullPlain: new THREE.MeshStandardMaterial({
      map: armourPlain.map, normalMap: armourPlain.normal,
      normalScale: new THREE.Vector2(0.45, 0.45),
      roughness: 0.88, metalness: 0.06,
    }),
    hullDark: new THREE.MeshStandardMaterial({
      map: armourDark.map, normalMap: armourDark.normal,
      normalScale: new THREE.Vector2(0.6, 0.6),
      roughness: 0.9, metalness: 0.08,
    }),
    // Applique / spall liner edges read slightly cooler.
    // Bolt-on modules are a slightly different batch of paint — a touch
    // greyer, a touch glossier, which is what makes them read as separate.
    applique: new THREE.MeshStandardMaterial({
      map: armour.map, normalMap: armour.normal,
      normalScale: new THREE.Vector2(0.5, 0.5),
      color: 0xd6dccb, roughness: 0.8, metalness: 0.12,
    }),
    // Skirts wear the same camo but carry the road dust, so they read a shade
    // lighter and much flatter than the plate above them.
    skirt: new THREE.MeshStandardMaterial({
      map: armour.map, normalMap: armour.normal,
      normalScale: new THREE.Vector2(0.45, 0.45),
      color: 0xcac2ac, roughness: 0.97, metalness: 0.03,
    }),
    steel: new THREE.MeshStandardMaterial({ color: 0x6b6f70, roughness: 0.48, metalness: 0.85 }),
    steelDark: new THREE.MeshStandardMaterial({ color: 0x3a3d3e, roughness: 0.55, metalness: 0.8 }),
    gunSteel: new THREE.MeshStandardMaterial({ color: 0x4a4d4b, roughness: 0.42, metalness: 0.9 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x2a2a28, roughness: 0.95, metalness: 0.0 }),
    trackPad: new THREE.MeshStandardMaterial({
      map: trackTex, roughness: 0.93, metalness: 0.1, color: 0xb9b4a8,
    }),
    optic: new THREE.MeshPhysicalMaterial({
      color: 0x0d1a20, roughness: 0.08, metalness: 0.2,
      clearcoat: 1, clearcoatRoughness: 0.05,
      envMapIntensity: 2.2,
    }),
    opticGold: new THREE.MeshStandardMaterial({
      color: 0x8a7a3c, roughness: 0.12, metalness: 1.0, envMapIntensity: 2.0,
    }),
    lamp: new THREE.MeshStandardMaterial({
      color: 0xd8d2bc, roughness: 0.25, metalness: 0.2,
      emissive: 0x33301f, emissiveIntensity: 0.5,
    }),
    canvasStow: new THREE.MeshStandardMaterial({ color: 0x5d5b48, roughness: 1.0 }),

    /* ---- world ---- */
    road: new THREE.MeshStandardMaterial({ map: roadSurface, roughness: 0.93, metalness: 0.02 }),
    apron: new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.95, metalness: 0.02 }),
    pavement: new THREE.MeshStandardMaterial({ map: pavement, roughness: 0.96, metalness: 0.0 }),
    roadLine: new THREE.MeshStandardMaterial({ color: 0xc9c2a4, roughness: 0.85 }),
    ground: new THREE.MeshStandardMaterial({ map: dirt, roughness: 0.99, metalness: 0 }),
    concreteA: new THREE.MeshStandardMaterial({ map: concreteA, roughness: 0.95 }),
    concreteB: new THREE.MeshStandardMaterial({ map: concreteB, roughness: 0.95 }),
    brick: new THREE.MeshStandardMaterial({ map: brick, roughness: 0.95 }),
    // Interiors seen through window openings: near-black so the openings read
    // as holes, which is what makes a figure standing in one legible.
    interior: new THREE.MeshStandardMaterial({ color: 0x131313, roughness: 1.0, metalness: 0 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x93aab4, roughness: 0.12, metalness: 0.0,
      transparent: true, opacity: 0.28, envMapIntensity: 1.6,
    }),
    rust: new THREE.MeshStandardMaterial({ color: 0x6b4a35, roughness: 0.96, metalness: 0.15 }),
    wreck: new THREE.MeshStandardMaterial({ color: 0x4a4640, roughness: 0.88, metalness: 0.3 }),
    sandbag: new THREE.MeshStandardMaterial({ color: 0x8d8258, roughness: 1.0 }),

    /* ---- figures ---- */
    uniform: new THREE.MeshStandardMaterial({ color: 0x4b4634, roughness: 0.95 }),
    uniformAlt: new THREE.MeshStandardMaterial({ color: 0x3b3f33, roughness: 0.95 }),
    skin: new THREE.MeshStandardMaterial({ color: 0x8a6a4e, roughness: 0.85 }),
    weapon: new THREE.MeshStandardMaterial({ color: 0x24241f, roughness: 0.7, metalness: 0.5 }),

    /* ---- effects ---- */
    tracer: new THREE.MeshBasicMaterial({ color: 0xffd08a, toneMapped: false }),
    tracerRed: new THREE.MeshBasicMaterial({ color: 0xff6a3a, toneMapped: false }),
    muzzle: new THREE.MeshBasicMaterial({
      color: 0xfff0c0, toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  };

  return cache;
}

/** Applies the environment map to every material that benefits from one. */
export function applyEnvironment(envMap) {
  const m = materials();
  for (const key of Object.keys(m)) {
    const mat = m[key];
    if (mat && mat.isMeshStandardMaterial) mat.envMap = envMap;
  }
}

export { fbm, valueNoise, hash2 };

/**
 * HUD: sight symbology, contact markers and the crew-station panels.
 *
 * The reticle is generated rather than drawn as art, because its graduations
 * have to mean something: one mil on the reticle really is one milliradian of
 * the current field of view, so the player can range a target by bracketing it
 * against the stadia and running the mil-relation.
 */

import { CONFIG } from '../config.js';
import { XM30 } from '../spec/xm30.js';
import { LEVEL, LEVEL_CLASS, LEVEL_NAME } from './perception.js';
import { ViewSystem } from './views.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Largest a contact marker is allowed to grow, in pixels. */
const MARKER_MAX = 760;
/** The reticle SVG's viewBox spans this many units across the sight picture. */
const RETICLE_UNITS = 1000;
/** ...rendered at this fraction of the viewport's smaller dimension. */
const RETICLE_SPAN = 0.78;

function el(id) { return document.getElementById(id); }

function svg(tag, attrs) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const k of Object.keys(attrs)) n.setAttribute(k, attrs[k]);
  return n;
}

export class Hud {
  constructor() {
    this.root = el('hud');
    this.sight = el('sight');
    this.markersRoot = el('markers');

    this.reticleUse = el('reticle-use');
    this.milH = el('mil-h');
    this.milV = el('mil-v');
    this.dropMarks = el('drop-marks');
    this.rangeGate = el('range-gate');

    this.azTape = el('az-tape');
    this.azHull = el('az-hull');
    this.trTurret = el('tr-turret');
    this.trCmd = el('tr-cmd');

    this.seatName = el('seat-name');
    this.viewName = el('view-name');
    this.score = el('score');
    this.distance = el('distance');

    this.contactList = el('contact-list');
    this.contactCount = el('contact-count');

    this.rngValue = el('rng-value');
    this.rngMils = el('rng-mils');
    this.rngSource = el('rng-source');
    this.rngFov = el('rng-fov');
    this.rangingPanel = el('ranging-panel');

    this.speed = el('speed');
    this.gear = el('gear');
    this.barHull = el('bar-hull');
    this.barMob = el('bar-mob');
    this.ammoRows = {
      ap: el('ammo-ap'),
      abm: el('ammo-he'),
      coax: el('ammo-coax'),
    };

    this.ticker = el('ticker');
    this.hintBar = el('hint-bar');

    this.diagPanel = el('diagnostics');
    this.diag = {
      api: el('diag-api'), gpu: el('diag-gpu'), warn: el('diag-warn'),
      frame: el('diag-frame'), worst: el('diag-worst'), preset: el('diag-preset'),
      buffer: el('diag-buffer'), scale: el('diag-scale'), calls: el('diag-calls'),
      tris: el('diag-tris'), tex: el('diag-tex'), prog: el('diag-prog'),
      graph: el('diag-graph'),
    };
    this._diagAccum = 0;
    this._frameHistory = [];
    this._diagIdentified = false;

    this._markerPool = [];
    this._markersInUse = [];
    this._contactRows = [];
    this._reticleKey = '';
    this._azTicks = null;
    this._hitFlashTimer = 0;
    this._lastAz = 0;

    this._buildAzTape();
  }

  show() { this.root.classList.add('visible'); }
  hide() { this.root.classList.remove('visible'); }

  /* ------------------------------ azimuth tape ------------------------------ */

  _buildAzTape() {
    // 10° graduations across a 720° strip so it can scroll without a seam.
    this.azTape.textContent = '';
    this._azPixelsPerDeg = 3.2;
    for (let deg = -360; deg <= 360; deg += 10) {
      const major = ((deg % 30) + 360) % 360 === 0;
      const tick = document.createElement('div');
      tick.className = 'tick' + (major ? ' major' : '');
      tick.style.left = `${deg * this._azPixelsPerDeg}px`;
      this.azTape.appendChild(tick);
      if (major) {
        const lbl = document.createElement('div');
        lbl.className = 'lbl';
        const norm = ((deg % 360) + 360) % 360;
        lbl.textContent = String(norm).padStart(3, '0');
        lbl.style.left = `${deg * this._azPixelsPerDeg}px`;
        this.azTape.appendChild(lbl);
      }
    }
  }

  _updateAzTape(azRad, hullRad, width) {
    const deg = azRad * 180 / Math.PI;
    // Keep the tape near the middle of its 720° span as the turret goes round.
    let shown = deg % 360;
    if (shown > 180) shown -= 360;
    if (shown < -180) shown += 360;
    this.azTape.style.transform = `translateX(${width / 2 - shown * this._azPixelsPerDeg}px)`;

    let rel = (hullRad - azRad) * 180 / Math.PI;
    rel = ((rel + 180) % 360 + 360) % 360 - 180;
    this.azHull.style.left = `${width / 2 + rel * this._azPixelsPerDeg}px`;
    this.azHull.style.opacity = Math.abs(rel) < 100 ? '1' : '0.15';
  }

  /* -------------------------------- reticle -------------------------------- */

  /**
   * Rebuilds the mil graduations for the current field of view.
   * @param {number} fovDeg  vertical field of view
   * @param {{w:number,h:number}} viewport
   */
  _buildReticle(fovDeg, viewport, seat, ammoKey, rangeSolution) {
    const span = RETICLE_SPAN * Math.min(viewport.w, viewport.h);
    const fovRad = fovDeg * Math.PI / 180;
    // Reticle units per milliradian at this field of view.
    const upm = (0.001 / fovRad) * viewport.h * (RETICLE_UNITS / span);

    const key = `${seat}|${fovDeg}|${Math.round(viewport.w)}x${Math.round(viewport.h)}|${ammoKey}|${Math.round(rangeSolution / 50)}`;
    if (key === this._reticleKey) return upm;
    this._reticleKey = key;
    this.unitsPerMil = upm;

    // Choose a graduation the scale can actually show inside the sight.
    const reach = 420;
    const maxMils = reach / upm;
    const step = [1, 2, 5, 10, 20, 50].find((s) => maxMils / s <= 11) || 100;

    /* ------------------------- horizontal lead scale ------------------------ */
    this.milH.textContent = '';
    for (let m = step; m * upm <= reach; m += step) {
      const x = m * upm;
      const major = (m / step) % 5 === 0;
      const len = major ? 26 : 14;
      for (const s of [-1, 1]) {
        this.milH.appendChild(svg('line', {
          x1: s * x, y1: -len / 2, x2: s * x, y2: len / 2,
        }));
      }
      if (major) {
        for (const s of [-1, 1]) {
          const t = svg('text', { x: s * x, y: 34, 'text-anchor': 'middle' });
          t.textContent = String(m);
          this.milH.appendChild(t);
        }
      }
    }

    /* ---------------------- vertical stadia, for ranging -------------------- */
    // Numbered downward: bracket a standing figure between the cross and a
    // graduation and read the mils straight off.
    this.milV.textContent = '';
    for (let m = step; m * upm <= reach; m += step) {
      const y = m * upm;
      const major = (m / step) % 5 === 0;
      const len = major ? 22 : 12;
      for (const s of [-1, 1]) {
        this.milV.appendChild(svg('line', {
          x1: -len / 2, y1: s * y, x2: len / 2, y2: s * y,
        }));
      }
      if (major) {
        const t = svg('text', { x: 30, y: y + 5, 'text-anchor': 'start' });
        t.textContent = String(m);
        this.milV.appendChild(t);
      }
    }

    /* -------------------------- ballistic drop marks ------------------------ */
    // With the gun laid for `rangeSolution`, a target at range R needs an
    // aim-off of (g / 2v^2) * (R - R0) radians — independent of R itself.
    this.dropMarks.textContent = '';
    if (seat === 'gunner') {
      const v = XM30.mainGun.ammo[ammoKey].vel;
      const k = CONFIG.gunnery.gravity / (2 * v * v);
      for (const R of [400, 800, 1200, 1600, 2000, 2400]) {
        const offsetMils = k * (R - rangeSolution) * 1000;
        const y = offsetMils * upm;
        if (Math.abs(y) > reach) continue;
        const w = R % 800 === 0 ? 22 : 14;
        this.dropMarks.appendChild(svg('path', {
          d: `M ${-w} ${y - 6} L 0 ${y} L ${w} ${y - 6}`,
        }));
        const t = svg('text', { x: w + 8, y: y + 4, 'text-anchor': 'start' });
        t.textContent = String(R / 100);
        this.dropMarks.appendChild(t);
      }
    }

    return upm;
  }

  /**
   * Offsets the reticle group to the screen position of the sight line. In
   * first person that is dead centre; in third person it is wherever the gun
   * is looking.
   */
  _placeReticle(game, inSight) {
    const body = this.milH.parentNode;
    if (inSight) {
      body.removeAttribute('transform');
      this.milH.style.display = '';
      this.milV.style.display = '';
      this.dropMarks.style.display = '';
      return;
    }
    // The mil graduations are meaningless off-boresight; drop them.
    this.milH.style.display = 'none';
    this.milV.style.display = 'none';
    this.dropMarks.style.display = 'none';

    const p = game.aimPointScreen();
    if (!p || !p.visible) { body.setAttribute('transform', 'translate(0,-4000)'); return; }
    const { viewport } = game;
    const span = RETICLE_SPAN * Math.min(viewport.w, viewport.h);
    const units = RETICLE_UNITS / span;
    const x = (p.x - viewport.w / 2) * units;
    const y = (p.y - viewport.h / 2) * units;
    body.setAttribute('transform', `translate(${x.toFixed(1)},${y.toFixed(1)}) scale(0.55)`);
  }

  /* -------------------------------- markers -------------------------------- */

  _marker() {
    let m = this._markerPool.pop();
    if (!m) {
      m = document.createElement('div');
      m.className = 'marker';
      m.innerHTML = '<i class="box"></i><span class="tag"></span>';
      this.markersRoot.appendChild(m);
      m._box = m.querySelector('.box');
      m._tag = m.querySelector('.tag');
    }
    m.style.display = '';
    this._markersInUse.push(m);
    return m;
  }

  _releaseMarkers() {
    for (const m of this._markersInUse) {
      m.style.display = 'none';
      this._markerPool.push(m);
    }
    this._markersInUse.length = 0;
  }

  _updateMarkers(perception, showRange, optic) {
    this._releaseMarkers();
    // In a first-person sight the corners of the screen are outside the optic
    // tube, so symbology out there would float in the black surround.
    const cx = optic ? optic.cx : 0;
    const cy = optic ? optic.cy : 0;
    const limit = optic ? optic.radius : Infinity;

    for (const c of perception.contacts.values()) {
      if (!c.enemy.alive || c.level < LEVEL.DETECT) continue;
      const s = c.screen;
      if (!s.visible) continue;
      if (optic && Math.hypot(s.x - cx, s.y - cy) > limit) continue;

      const m = this._marker();
      // The box is sized to the target's real on-screen silhouette, so it
      // shrinks and grows with range exactly as the target does.
      const h = Math.max(7, Math.min(MARKER_MAX, s.h));
      const w = Math.max(5, Math.min(MARKER_MAX * 0.45, s.w));
      m._box.style.width = `${w}px`;
      m._box.style.height = `${h}px`;
      m.style.transform = `translate(${s.x - w / 2}px, ${s.y - h / 2}px)`;
      m.style.left = '0';
      m.style.top = '0';
      m.className = `marker state-${LEVEL_CLASS[c.level]}${c.designated ? ' designated' : ''}`;

      const bits = [c.label];
      if (showRange && c.level >= LEVEL.RECOGNISE) bits.push(`${Math.round(c.range)}m`);
      m._tag.textContent = bits.join('  ');
      // The mil-relation bracket sits on the cued contact; push its tag clear.
      m._tag.style.top = c === perception.cued ? `calc(100% + 12px)` : 'calc(100% + 4px)';
    }
  }

  /* ------------------------------ contact list ------------------------------ */

  _updateContacts(perception) {
    const list = perception.list();
    this.contactCount.textContent = `${list.length} CONTACT${list.length === 1 ? '' : 'S'}`;

    while (this._contactRows.length < list.length) {
      const li = document.createElement('li');
      li.innerHTML = '<i class="pip"></i><span class="who"></span><span class="rng"></span>';
      li._pip = li.querySelector('.pip');
      li._who = li.querySelector('.who');
      li._rng = li.querySelector('.rng');
      this.contactList.appendChild(li);
      this._contactRows.push(li);
    }
    for (let i = 0; i < this._contactRows.length; i++) {
      const li = this._contactRows[i];
      const c = list[i];
      if (!c) { li.style.display = 'none'; continue; }
      li.style.display = '';
      const firing = c.enemy.state === 'firing' || c.enemy.state === 'aiming';
      li.className = `${LEVEL_CLASS[Math.max(c.level, c.best)]}` +
        `${c.designated ? ' designated' : ''}${firing ? ' firing' : ''}${c.lost ? ' lost' : ''}`;
      const bearing = ((c.bearing * 180 / Math.PI) + 360) % 360;
      li._who.textContent = `${c.label} ${String(Math.round(bearing)).padStart(3, '0')}`;
      li._rng.textContent = Math.max(c.level, c.best) >= LEVEL.RECOGNISE
        ? `${Math.round(c.range)}m`
        : `~${Math.round(c.range / 50) * 50}m`;
    }
  }

  /* --------------------------------- ticker -------------------------------- */

  say(text, kind = '') {
    const d = document.createElement('div');
    if (kind) d.className = kind;
    d.textContent = text;
    this.ticker.appendChild(d);
    setTimeout(() => d.remove(), 4600);
    while (this.ticker.children.length > 6) this.ticker.firstChild.remove();
  }

  flashHit() {
    this.root.classList.add('hit');
    this._hitFlashTimer = 0.14;
  }

  /* ------------------------------ diagnostics ------------------------------ */

  /**
   * GPU and frame-time readout. Refreshed a few times a second rather than
   * every frame — a panel that re-renders 120 times a second is itself a
   * measurable share of the frame it claims to be measuring.
   */
  updateDiagnostics(dt, game) {
    const show = !!game.showDiagnostics;
    this.diagPanel.hidden = !show;

    const g = game.graphics;
    if (!g) return;

    // The frame-time history is sampled every frame even while hidden, so the
    // graph is already populated the moment the panel is opened.
    this._frameHistory.push(g.frameMs);
    if (this._frameHistory.length > 160) this._frameHistory.shift();
    if (!show) return;

    this._diagAccum += dt;
    if (this._diagAccum < 0.25) { this._drawFrameGraph(); return; }
    this._diagAccum = 0;

    const r = g.report();
    const d = this.diag;

    if (!this._diagIdentified) {
      this._diagIdentified = true;
      d.api.textContent = r.gpu.api.replace('WebGL ', 'WebGL');
      d.gpu.textContent = r.gpu.short || r.gpu.device;
      if (r.gpu.software) {
        d.warn.hidden = false;
        d.warn.textContent =
          'SOFTWARE RENDERING — the browser is not using a GPU. ' +
          'Enable hardware acceleration in your browser settings.';
      } else if (r.gpu.device === 'unavailable') {
        d.warn.hidden = false;
        d.warn.textContent = 'Adapter name masked by the browser. Rendering is still on the GPU.';
      }
    }

    d.frame.textContent = `${r.frameMs.toFixed(1)} ms · ${Math.round(r.fps)} fps`;
    const worst = g.takeWorst();
    d.worst.textContent = worst > 0 ? `${worst.toFixed(1)} ms` : '—';
    d.preset.textContent = `${r.preset.label}${r.adaptive ? ' · ADAPTIVE' : ''}`;
    d.buffer.textContent = r.buffer;
    d.scale.textContent = `${r.renderScale.toFixed(2)}× render · ${r.displayRatio}× display`;
    d.calls.textContent = String(r.calls);
    d.tris.textContent = r.triangles.toLocaleString();
    d.tex.textContent = String(r.textures);
    d.prog.textContent = String(r.programs);

    this._drawFrameGraph();
  }

  /** Frame times over the last few seconds, with a 60 fps reference line. */
  _drawFrameGraph() {
    const cv = this.diag.graph;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const w = cv.width, h = cv.height;
    ctx.clearRect(0, 0, w, h);

    const CEILING = 40;   // ms; anything worse is pinned to the top
    const y = (ms) => h - Math.min(1, ms / CEILING) * h;

    // 60 fps reference.
    ctx.strokeStyle = 'rgba(125,253,166,.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y(16.7) + 0.5);
    ctx.lineTo(w, y(16.7) + 0.5);
    ctx.stroke();

    const hist = this._frameHistory;
    if (hist.length < 2) return;
    const step = w / (hist.length - 1);
    ctx.strokeStyle = '#7dfda6';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < hist.length; i++) {
      const px = i * step;
      const py = y(hist[i]);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  /* --------------------------------- update -------------------------------- */

  /**
   * @param {number} dt
   * @param {object} game  the running game, for state to display
   */
  update(dt, game) {
    const { views, perception, driving, gunnery, viewport } = game;

    if (this._hitFlashTimer > 0) {
      this._hitFlashTimer -= dt;
      if (this._hitFlashTimer <= 0) this.root.classList.remove('hit');
    }

    /* ------------------------------ sight state ----------------------------- */
    const inSight = views.mode === 'sight';
    this.sight.classList.toggle('visible', true);
    this.sight.dataset.seat = views.seat;
    this.sight.dataset.optic = inSight ? 'tube' : 'none';
    this.sight.dataset.channel = ['day', 'wh', 'bh'][views.channel];
    this.reticleUse.setAttribute('href', inSight ? `#ret-${views.seatDef.reticle}` : '#ret-spotter');

    const fov = inSight ? views.fovDeg : game.camera.fov;
    this._buildReticle(fov, viewport, inSight ? views.seat : 'chase',
                       gunnery.ammoKey, views.rangeSolution);

    // In an external view the camera is not boresighted, so the reticle has to
    // move to wherever the sight line actually crosses the screen — a fixed
    // centre crosshair would be a lie.
    this._placeReticle(game, inSight);

    this.seatName.textContent = views.seatDef.label;
    this.viewName.textContent = inSight
      ? `${views.seat === 'gunner' ? 'PRIMARY SIGHT' : 'PANORAMIC SIGHT'} · ${views.magLabel}`
      : `EXTERNAL · ${views.chasePreset.name}`;

    /* -------------------------------- azimuth ------------------------------- */
    const az = views.activeAim.az;
    this._updateAzTape(az + driving.heading, driving.heading, viewport.w);

    const turretDeg = views.model ? 0 : 0;
    this.trTurret.setAttribute('transform', `rotate(${(game.model.azimuth * 180 / Math.PI).toFixed(1)})`);
    this.trCmd.setAttribute('transform', `rotate(${(views.aim.spotter.az * 180 / Math.PI).toFixed(1)})`);

    /* ------------------------------- perception ----------------------------- */
    // Radius of the clear part of the optic, matching the CSS mask.
    const optic = inSight
      ? { cx: viewport.w / 2, cy: viewport.h / 2, radius: Math.min(viewport.w, viewport.h) * 0.47 }
      : null;
    this._updateMarkers(perception, true, optic);
    this._updateContacts(perception);

    /* -------------------------------- ranging ------------------------------- */
    const est = perception.milRelationEstimate();
    const stale = views.rangeAge > 6;
    this.rangingPanel.classList.toggle('stale', stale);
    this.rngValue.textContent = views.rangeSolution > 0
      ? String(Math.round(views.rangeSolution)).padStart(4, ' ')
      : '- - - -';
    this.rngSource.textContent = stale ? `${views.rangeSource} (STALE)` : views.rangeSource;
    this.rngFov.textContent = `${fov.toFixed(1)}° · ${views.magnification.toFixed(1)}×`;

    if (est) {
      this.rngMils.textContent = `${est.mils.toFixed(1)} mil`;
      // Stadia bracket over the cued contact: the width of the target on the
      // reticle, with what that implies about range.
      // Bracket the cued contact with the same clamp the marker uses, so the
      // two boxes agree instead of disagreeing by the clamp.
      const gh = Math.max(8, Math.min(MARKER_MAX, est.contact.screen.h));
      const gw = Math.max(8, Math.min(MARKER_MAX * 0.45, est.contact.screen.w));
      this.rangeGate.hidden = false;
      this.rangeGate.style.width = `${gw}px`;
      this.rangeGate.style.height = `${gh}px`;
      this.rangeGate.firstElementChild.textContent =
        `${est.mils.toFixed(1)} mil → ${Math.round(est.range)} m`;
      this.rangeGate.style.transform =
        `translate(${est.contact.screen.x - viewport.w / 2 - gw / 2}px, ` +
        `${est.contact.screen.y - viewport.h / 2 - gh / 2}px)`;
    } else {
      this.rngMils.textContent = '--.- mil';
      this.rangeGate.hidden = true;
    }

    /* -------------------------------- status -------------------------------- */
    this.speed.textContent = Math.round(driving.speed * 3.6);
    this.gear.textContent = driving.destroyed ? 'X' : (driving.speed < 0.4 ? 'N' : 'D');
    this.distance.textContent = `${Math.round(driving.distance)} m`;
    this.score.textContent = String(game.score.total);

    const hullPct = Math.max(0, driving.hull) / XM30.protection.hullPoints * 100;
    const mobPct = Math.max(0, driving.mobility) / XM30.protection.mobilityPoints * 100;
    this.barHull.style.width = `${hullPct}%`;
    this.barMob.style.width = `${mobPct}%`;
    this.barHull.className = hullPct < 25 ? 'crit' : hullPct < 55 ? 'warn' : '';
    this.barMob.className = mobPct < 25 ? 'crit' : mobPct < 55 ? 'warn' : '';

    for (const key of Object.keys(this.ammoRows)) {
      const row = this.ammoRows[key];
      const count = gunnery.ammo[key];
      row.querySelector('b').textContent = String(count);
      row.classList.toggle('selected', key === gunnery.ammoKey);
      row.classList.toggle('empty', count <= 0);
    }

    /* ----------------------------- diagnostics ------------------------------ */
    this.updateDiagnostics(dt, game);

    /* -------------------------------- hints --------------------------------- */
    this.hintBar.textContent = game.hint || '';
  }
}

/**
 * LYNX XM30 — crew-station trainer.
 *
 * Drive a straight route, direct the driver around what is in the road, and
 * work the targets in the windows and on the roofs from either the gunner's
 * or the commander/spotter's seat, in first or third person.
 */

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { XM30 } from './spec/xm30.js';
import { materials, buildEnvironment, applyEnvironment } from './model/materials.js';
import { buildVehicle } from './model/vehicle-model.js';
import { World } from './world/world.js';
import { ViewSystem } from './game/views.js';
import { Input } from './game/input.js';
import { Driving } from './game/driving.js';
import { Effects } from './game/effects.js';
import { EnemyManager } from './game/enemies.js';
import { Perception, LEVEL } from './game/perception.js';
import { Gunnery } from './game/gunnery.js';
import { Audio } from './game/audio.js';
import { Hud } from './game/hud.js';

const canvas = document.getElementById('viewport');
const bootOverlay = document.getElementById('boot');
const pauseOverlay = document.getElementById('pause');
const aarOverlay = document.getElementById('after-action');

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

/* ========================================================================== */
/*  Renderer, scene, lighting                                                 */
/* ========================================================================== */

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, CONFIG.render.maxPixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(CONFIG.render.fogColor, CONFIG.render.fogDensity);

const { envMap, background } = buildEnvironment(renderer);
scene.environment = envMap;
scene.background = background;
applyEnvironment(envMap);

const camera = new THREE.PerspectiveCamera(50, 1, CONFIG.render.near, CONFIG.render.far);

// Key light. The shadow camera is small and rides with the vehicle — casting
// shadows over the whole streamed route would be pointless and slow.
const sun = new THREE.DirectionalLight(0xfff0d6, 3.0);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 220;
const sc = sun.shadow.camera;
sc.left = -CONFIG.render.shadowDistance / 2;
sc.right = CONFIG.render.shadowDistance / 2;
sc.top = CONFIG.render.shadowDistance / 2;
sc.bottom = -CONFIG.render.shadowDistance / 2;
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 0.035;
scene.add(sun);
scene.add(sun.target);

scene.add(new THREE.HemisphereLight(0xa9c6e0, 0x50493a, 0.72));
const fill = new THREE.DirectionalLight(0x9fbcdd, 0.34);
fill.position.set(-1, 0.6, -0.6);
scene.add(fill);

/* ========================================================================== */
/*  Game                                                                      */
/* ========================================================================== */

class Game {
  constructor() {
    this.camera = camera;
    this.viewport = { w: 1, h: 1 };
    this.hint = '';
    this.state = 'boot';        // boot | running | paused | over
    this.seatChoice = 'gunner';
    this.difficultyKey = 'standard';

    this.hud = new Hud();
    this.audio = new Audio();
    this.input = new Input(canvas);
    this.input.onLockChange = (locked) => {
      document.body.classList.toggle('playing', locked);
      if (!locked && this.state === 'running') this.pause(true);
    };

    this.score = {
      total: 0, kills: 0, preempted: 0, identified: 0,
      designations: 0, strikes: 0, hitsTaken: 0, roundsFired: 0, roundsHit: 0,
    };
  }

  /* ------------------------------- lifecycle ------------------------------- */

  build() {
    const diff = CONFIG.difficulty[this.difficultyKey];
    this.diff = diff;

    this.model = buildVehicle();
    scene.add(this.model.root);

    // ?seed=12345 reproduces a route exactly, which is what the test
    // harness — and anyone comparing two runs — needs.
    const seedParam = new URLSearchParams(location.search).get('seed');
    this.seed = seedParam !== null ? (Number(seedParam) >>> 0) || 1 : (Math.random() * 0xffffff) >>> 0;
    this.world = new World(scene, this.seed);
    this.world.update(0);

    this.views = new ViewSystem(this.model, camera);
    this.views.seat = this.seatChoice;
    this.driving = new Driving(this.model, this.world, diff);
    this.effects = new Effects(scene, camera);
    this.enemies = new EnemyManager(scene, this.world, this.driving, diff);
    this.perception = new Perception(this.enemies, this.views, this.world);
    this.gunnery = new Gunnery(this.model, this.views, this.effects, this.enemies, this.world, this.audio);

    this._wireCallbacks();
    this.resize();
  }

  _wireCallbacks() {
    const { effects, enemies, driving, perception, hud, audio, world } = this;

    /* --------------------------- projectile hits --------------------------- */
    effects.onHitTest = (round, from, to) => {
      if (round.fromEnemy) {
        // Against the vehicle: closest approach of the segment to the hull.
        const hit = segmentSphere(from, to, this.model.root.position, 2.35, 1.5);
        if (hit) return { vehicle: true, point: hit };
      } else {
        // Airburst rounds function near the target rather than on it.
        const pad = round.kind === 'abm' ? 2.2 : undefined;
        const e = enemies.hitTest(from, to, pad);
        if (e) return e;
      }
      return world.segmentHit(from, to);
    };

    effects.onImpact = (round, point, hit) => {
      if (hit && hit.vehicle) {
        const t = driving.takeHit(round.threatKey || 'smallArms');
        hud.flashHit();
        audio.clang();
        this.score.hitsTaken++;
        this.addScore(CONFIG.scoring.hitTaken);
        if (driving.destroyed) this.finish('DESTROYED');
        effects.impactAt(point, 0.8, 0xffb070);
        return;
      }

      if (hit && hit.enemy) {
        this.gunnery.hits++;
        this.score.roundsHit++;
        const killed = enemies.damage(hit.enemy, round.damage);
        effects.impactAt(point, 0.6, 0xd8c0a0);
        if (round.splash > 0) {
          effects.explodeAt(point, 1.0);
          enemies.splash(point, round.splash, round.damage * 0.8);
          audio.explosion();
        } else if (killed) {
          audio.impact();
        }
        return;
      }

      // Terrain or structure.
      if (round.splash > 0) {
        effects.explodeAt(point, 0.9);
        enemies.splash(point, round.splash, round.damage * 0.7);
        audio.explosion();
      } else {
        effects.impactAt(point, round.kind === 'coax' ? 0.35 : 0.8);
        if (round.kind !== 'coax') audio.impact();
      }
      if (!round.fromEnemy && round.kind !== 'coax') {
        this.addScore(CONFIG.scoring.roundWasted);
      }
    };

    /* ------------------------------ enemy fire ----------------------------- */
    enemies.onEnemyFire = (enemy, origin, dir, spread) => {
      perception.flagMuzzleFlash(enemy);
      const threat = enemy.type.threat;
      const slow = threat === 'rpg' || threat === 'atgm';
      const round = effects.fire(origin, dir, {
        speed: slow ? (threat === 'atgm' ? 180 : 115) : 780,
        damage: 0,
        kind: threat,
        spread,
        fromEnemy: true,
        source: enemy,
        colour: 'red',
        flashSize: slow ? 2.2 : 0.7,
        tracerLength: slow ? 2.5 : 5,
        life: slow ? 9 : 4,
      });
      round.threatKey = threat;
      audio.incoming();

      const c = perception.contacts.get(enemy.id);
      if (c && c.level >= LEVEL.DETECT) {
        hud.say(`${enemy.type.warn} — ${Math.round(c.range)} m, bearing ${bearingText(c.bearing)}`, 'warn');
      } else {
        hud.say(`INCOMING — ${enemy.type.warn}, source unobserved`, 'bad');
      }
    };

    enemies.onEnemyKilled = (enemy, preempted) => {
      const c = perception.contacts.get(enemy.id);
      const range = c ? c.range : 0;
      let points = CONFIG.scoring.kill;
      this.score.kills++;
      if (preempted) { points += CONFIG.scoring.killBeforeFired; this.score.preempted++; }
      if (c && c.level >= LEVEL.IDENTIFY) { points += CONFIG.scoring.identifyBonus; this.score.identified++; }
      points += Math.round(range / 100) * CONFIG.scoring.rangeBonusPerHundred;
      this.addScore(points);
      hud.say(`TARGET DOWN — ${enemy.type.name} at ${Math.round(range)} m  +${points}`, 'good');
      this.effects.explodeAt(enemy.centre, 0.4);
    };

    this.gunnery.onRoundSpent = () => { this.score.roundsFired++; };
  }

  addScore(n) { this.score.total = Math.max(0, this.score.total + n); }

  start() {
    bootOverlay.hidden = true;
    this.state = 'running';
    this.input.enabled = true;
    this.input.requestLock();
    this.audio.start();
    this.audio.resume();
    this.hud.show();
    this.hud.say(CONFIG.route.briefingHint);
    this.hud.say(`SEAT: ${this.views.seatDef.label} — ${this.diff.label}`);
    this._last = performance.now();
  }

  pause(auto = false) {
    if (this.state !== 'running') return;
    this.state = 'paused';
    pauseOverlay.hidden = false;
    this.audio.suspend();
    if (!auto) this.input.releaseLock();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'running';
    pauseOverlay.hidden = true;
    this.audio.resume();
    this.input.requestLock();
    this._last = performance.now();
  }

  finish(reason) {
    if (this.state === 'over') return;
    this.state = 'over';
    this.input.releaseLock();
    this.input.enabled = false;
    this.audio.suspend();

    const s = this.score;
    const accuracy = s.roundsFired ? Math.round((s.roundsHit / s.roundsFired) * 100) : 0;
    const rows = [
      ['OUTCOME', reason],
      ['ROUTE COVERED', `${Math.round(this.driving.distance)} m of ${CONFIG.route.length} m`],
      ['TARGETS DESTROYED', s.kills],
      ['ENGAGED BEFORE THEY FIRED', s.preempted],
      ['IDENTIFIED BEFORE ENGAGING', s.identified],
      ['CONTACTS DESIGNATED', s.designations],
      ['MAIN GUN ACCURACY', `${accuracy}%`],
      ['OBSTACLES STRUCK', s.strikes],
      ['HITS TAKEN', s.hitsTaken],
      ['HULL REMAINING', `${Math.max(0, Math.round(this.driving.hull))}%`],
    ];
    const table = document.getElementById('aar-table');
    table.innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')
      + `<tr class="total"><td>SCORE</td><td>${s.total}</td></tr>`;
    aarOverlay.hidden = false;
  }

  /* --------------------------------- input --------------------------------- */

  _handleInput(dt) {
    const { input, views, gunnery, driving, hud, perception } = this;

    if (input.hit('KeyP')) { this.state === 'paused' ? this.resume() : this.pause(); }
    if (this.state !== 'running') return;

    if (input.hit('Tab')) {
      const seat = views.swapSeat();
      hud.say(`SEAT → ${views.seatDef.label}`);
      this.seatChoice = seat;
    }
    if (input.hit('KeyV')) hud.say(`VIEW → ${views.toggleMode() === 'sight' ? 'SIGHT' : 'EXTERNAL'}`);
    if (input.hit('KeyC') && views.mode === 'chase') hud.say(`CAMERA → ${views.cycleChase()}`);
    if (input.hit('Digit1')) views.setMagnification(0);
    if (input.hit('Digit2')) views.setMagnification(1);
    if (input.hit('Digit3')) views.setMagnification(2);
    if (input.hit('KeyX')) hud.say(`SIGHT CHANNEL → ${views.cycleChannel()}`);
    if (input.hit('KeyR')) hud.say(`AMMUNITION → ${gunnery.toggleAmmo()}`);
    if (input.hit('KeyH')) this.toggleHelp();

    // Speed orders to the driver.
    if (input.hit('KeyW') || input.hit('ArrowUp')) {
      driving.changeSpeed(CONFIG.vehicle.speedStep);
      hud.say(`DRIVER — INCREASE SPEED, ${Math.round(driving.demandSpeed * 3.6)} km/h`);
    }
    if (input.hit('KeyS') || input.hit('ArrowDown')) {
      driving.changeSpeed(-CONFIG.vehicle.speedStep);
      hud.say(`DRIVER — REDUCE SPEED, ${Math.round(driving.demandSpeed * 3.6)} km/h`);
    }

    // Hunter–killer handoff.
    if (input.hit('KeyT') && perception.designated) {
      views.slewTo(perception.designated.enemy.centre);
      if (views.seat === 'spotter') hud.say('GUNNER — SLEWING TO DESIGNATED CONTACT');
    }

    // Range-finder.
    if (input.click(2)) {
      const r = gunnery.lase();
      hud.say(r ? `LASE — ${r.range} m (${r.what})` : 'LASE — NO RETURN');
    }

    // Primary action.
    if (views.seat === 'gunner') {
      if (input.mouse(0)) {
        if (!gunnery.fireMain() && gunnery.ammo[gunnery.ammoKey] <= 0 && input.click(0)) {
          hud.say(`${XM30.mainGun.ammo[gunnery.ammoKey].name} — EMPTY`, 'warn');
        }
      }
    } else if (input.click(0)) {
      const c = perception.designate();
      if (c) {
        this.score.designations++;
        this.addScore(CONFIG.scoring.designateBonus);
        views.slewTo(c.enemy.centre);
        hud.say(`DESIGNATED — ${c.label} at ${Math.round(c.range)} m. Gunner slewing.`, 'good');
      } else {
        hud.say('NOTHING CUED — put the sight on a contact first', 'warn');
      }
    }

    // Coax is available from either seat.
    if (input.down('Space')) gunnery.fireCoax();
  }

  toggleHelp() {
    const showing = !bootOverlay.hidden;
    if (showing) {
      bootOverlay.hidden = true;
      if (this.state === 'paused') this.resume();
    } else {
      this.pause();
      bootOverlay.hidden = false;
      document.getElementById('start-btn').textContent = 'RESUME';
    }
  }

  /* -------------------------------- the loop -------------------------------- */

  resize() {
    const w = canvas.clientWidth || innerWidth;
    const h = canvas.clientHeight || innerHeight;
    this.viewport.w = w;
    this.viewport.h = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  /**
   * One simulation step. Kept separate from rendering so the whole run can be
   * advanced deterministically by the test harness without waiting on frames.
   */
  step(dt) {
    if (this.state !== 'running') return;

    const steer = (this.input.down('KeyD') || this.input.down('ArrowRight') ? 1 : 0)
                - (this.input.down('KeyA') || this.input.down('ArrowLeft') ? 1 : 0);

    const before = this.driving.collisions.length;
    this.driving.update(dt, steer);
    if (this.driving.collisions.length > before) {
      const c = this.driving.lastCollision;
      this.score.strikes++;
      this.addScore(CONFIG.scoring.hazardStrike);
      this.hud.flashHit();
      this.hud.say(`STRUCK ${c.hazard.name.toUpperCase()} — mobility damage`, 'bad');
      this.audio.impact();
      if (this.driving.destroyed) this.finish('IMMOBILISED');
    }

    this.world.update(this.driving.position.z);
    this.views.update(dt, this.input.drainLook(), this.driving);
    this.gunnery.update(dt);
    this.enemies.update(dt, this.driving.position);
    this.effects.update(dt);

    // Perception projects contacts to screen space, so the camera has to be
    // current before it runs.
    camera.updateMatrixWorld(true);
    this.perception.update(dt, camera, this.viewport);

    this.audio.setEngine(this.driving.speed / XM30.mobility.maxSpeed);
    this._updateHint();

    if (this.driving.distance >= CONFIG.route.length) this.finish('ROUTE COMPLETE');
  }

  /** Advances the sim without rendering. Used by tools/shoot.mjs. */
  simulate(seconds, dt = 1 / 60) {
    const steps = Math.floor(seconds / dt);
    for (let i = 0; i < steps; i++) this.step(dt);
  }

  frame(now) {
    // The rAF timestamp is the time the frame BEGAN, which can predate the
    // performance.now() captured on start — so clamp at both ends.
    const dt = Math.max(0, Math.min(0.05, (now - this._last) / 1000));
    this._last = now;

    this._handleInput(dt);
    this.step(dt);

    // Keep the shadow volume over the vehicle.
    const p = this.model.root.position;
    sun.position.set(p.x + 28, 46, p.z + 20);
    sun.target.position.set(p.x, 0, p.z + 12);
    sun.target.updateMatrixWorld();

    this.hud.update(dt, this);
    this.input.endFrame();
    renderer.render(scene, camera);
  }

  _updateHint() {
    const v = this.views;
    const cued = this.perception.cued;
    if (v.seat === 'spotter') {
      this.hint = cued
        ? 'LMB designate · RMB lase · Tab take the gunner’s seat'
        : 'Sweep for contacts · 1/2/3 magnification · Tab swap seat';
    } else if (cued && cued.level >= LEVEL.DETECT) {
      this.hint = v.rangeAge > 6
        ? 'RMB lase before you fire — the lay is only good at the ranged distance'
        : 'LMB fire 50 mm · Space coax · R change ammunition';
    } else {
      this.hint = 'A/D direct the driver · V external view · 1/2/3 magnification';
    }
  }

  /**
   * Screen position where the active sight line crosses the sight picture —
   * the point the reticle belongs on in an external view.
   */
  aimPointScreen() {
    if (!this.views) return null;
    this.views.lineOfSight(_v, _v2);
    _v.addScaledVector(_v2, Math.max(120, this.views.rangeSolution));
    _v.project(camera);
    if (_v.z > 1) return { visible: false };
    return {
      visible: true,
      x: (_v.x * 0.5 + 0.5) * this.viewport.w,
      y: (-_v.y * 0.5 + 0.5) * this.viewport.h,
    };
  }

  /** Histogram of how far every live contact has climbed the ladder. */
  _contactLevels() {
    const out = [0, 0, 0, 0];
    let los = 0, inView = 0;
    if (this.perception) {
      for (const c of this.perception.contacts.values()) {
        if (!c.enemy.alive) continue;
        out[c.level]++;
        if (c.hasLos) los++;
        if (c.inView) inView++;
      }
    }
    return { unknown: out[0], detect: out[1], recog: out[2], ident: out[3], los, inView };
  }

  debugInfo() {
    return {
      state: this.state,
      seed: this.seed,
      seat: this.views?.seat,
      mode: this.views?.mode,
      distance: Math.round(this.driving?.distance ?? 0),
      enemies: this.enemies?.enemies.length ?? 0,
      contacts: this.perception ? this.perception.list().length : 0,
      hazards: this.world?.hazards.length ?? 0,
      buildings: this.world?.boxes.length ?? 0,
      chunks: this.world?.chunks.size ?? 0,
      score: this.score.total,
      kills: this.score.kills,
      strikes: this.score.strikes,
      hitsTaken: this.score.hitsTaken,
      hull: Math.round(this.driving?.hull ?? 0),
      levels: this._contactLevels(),
      triangles: renderer.info.render.triangles,
      calls: renderer.info.render.calls,
      fps: Math.round(1 / Math.max(0.001, this._smoothDt ?? 0.016)),
    };
  }
}

/* -------------------------------- helpers -------------------------------- */

/** Closest approach of a segment to a sphere; returns the point or null. */
function segmentSphere(from, to, centre, radius, heightOffset = 0) {
  _v.copy(to).sub(from);
  const lenSq = _v.lengthSq();
  if (lenSq < 1e-9) return null;
  _v2.copy(centre);
  _v2.y += heightOffset;
  _v2.sub(from);
  let t = _v2.dot(_v) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const px = from.x + _v.x * t, py = from.y + _v.y * t, pz = from.z + _v.z * t;
  const dx = px - centre.x, dy = py - (centre.y + heightOffset), dz = pz - centre.z;
  if (dx * dx + dy * dy + dz * dz > radius * radius) return null;
  return new THREE.Vector3(px, py, pz);
}

function bearingText(rad) {
  const deg = ((rad * 180 / Math.PI) % 360 + 360) % 360;
  return String(Math.round(deg)).padStart(3, '0');
}

/* ========================================================================== */
/*  Boot                                                                      */
/* ========================================================================== */

const game = new Game();

for (const btn of document.querySelectorAll('.seat-btn')) {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.seat-btn').forEach((b) => b.classList.remove('selected'));
    btn.classList.add('selected');
    game.seatChoice = btn.dataset.seat;
    if (game.views) game.views.seat = game.seatChoice;
  });
}
for (const btn of document.querySelectorAll('.diff-btn')) {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.diff-btn').forEach((b) => b.classList.remove('selected'));
    btn.classList.add('selected');
    game.difficultyKey = btn.dataset.diff;
  });
}

document.getElementById('start-btn').addEventListener('click', () => {
  if (game.state === 'paused') {
    bootOverlay.hidden = true;
    game.resume();
    return;
  }
  if (game.state === 'boot') {
    game.build();
    game.start();
  }
});

document.getElementById('restart-btn').addEventListener('click', () => location.reload());

canvas.addEventListener('click', () => {
  if (game.state === 'paused' && pauseOverlay.hidden === false) game.resume();
});

addEventListener('resize', () => game.resize());

/* --------------------------------- loop ---------------------------------- */

let smooth = 0.016;
let lastFrame = performance.now();
function tick(now) {
  requestAnimationFrame(tick);
  const raw = Math.max(0, Math.min(0.1, (now - lastFrame) / 1000));
  lastFrame = now;
  smooth += (raw - smooth) * 0.08;
  game._smoothDt = smooth;
  if (game.state === 'boot') {
    // Nothing to simulate yet; keep the canvas cleared behind the overlay.
    renderer.render(scene, camera);
    return;
  }
  game.frame(now);
}
game.resize();
requestAnimationFrame(tick);

window.__game = game;
window.__ready = true;

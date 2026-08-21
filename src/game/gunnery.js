/**
 * Fire control: ammunition, the 50 mm and the coax, and the laser range-finder.
 *
 * The gun fires bursts at the weapon's cyclic rate, rounds fly with a real
 * time of flight, and the lay is computed from whatever range solution the
 * crew last obtained — so a bad range means a miss, not a hit with a smaller
 * score.
 */

import * as THREE from 'three';
import { XM30 } from '../spec/xm30.js';
import { CONFIG } from '../config.js';

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _tmp = new THREE.Vector3();

export class Gunnery {
  constructor(model, views, effects, enemies, world, audio) {
    this.model = model;
    this.views = views;
    this.effects = effects;
    this.enemies = enemies;
    this.world = world;
    this.audio = audio;

    this.ammo = {
      ap: XM30.mainGun.ammo.ap.rounds,
      abm: XM30.mainGun.ammo.abm.rounds,
      coax: XM30.coax.rounds,
    };
    this.ammoKey = 'ap';

    this.burstRemaining = 0;
    this.mainCooldown = 0;
    this.coaxCooldown = 0;
    this.lrfCooldown = 0;

    this.roundsFired = 0;
    this.hits = 0;

    /** Set by the game for scoring and messages. */
    this.onRoundSpent = null;
  }

  toggleAmmo() {
    this.ammoKey = this.ammoKey === 'ap' ? 'abm' : 'ap';
    return XM30.mainGun.ammo[this.ammoKey].name;
  }

  /* ---------------------------------- LRF ---------------------------------- */

  /**
   * Lases along the gunner's or spotter's line of sight and returns the range
   * to the first thing the beam finds.
   * @returns {{range:number, what:string}|null}
   */
  lase() {
    if (this.lrfCooldown > 0) return null;
    this.lrfCooldown = XM30.sights.lrf.cycleTime;

    this.views.lineOfSight(_o, _d);
    const lrf = XM30.sights.lrf;
    let best = Infinity;
    let what = 'TERRAIN';

    // A target inside the beam gives the cleanest return.
    const beam = lrf.beamDivergence;
    for (const e of this.enemies.enemies) {
      if (!e.alive) continue;
      _p.copy(e.centre).sub(_o);
      const dist = _p.length();
      if (dist < lrf.minRange || dist > lrf.maxRange) continue;
      _p.normalize();
      const off = Math.acos(Math.max(-1, Math.min(1, _p.dot(_d))));
      // The beam spreads with range; at 1 km a 0.3 mrad beam is 0.3 m across.
      if (off < beam + Math.atan2(0.5, dist) * 0.5 && dist < best) {
        best = dist;
        what = 'TARGET';
      }
    }

    // Otherwise the beam lands on a building.
    for (const box of this.world.boxes) {
      const t = rayBox(_o, _d, box);
      if (t !== null && t > lrf.minRange && t < best) { best = t; what = 'STRUCTURE'; }
    }

    // Or the ground.
    if (_d.y < -1e-4) {
      const t = -_o.y / _d.y;
      if (t > lrf.minRange && t < best) { best = t; what = 'TERRAIN'; }
    }

    if (!isFinite(best) || best > lrf.maxRange) {
      this.views.setRange(this.views.rangeSolution, 'NO RETURN');
      return null;
    }

    const range = Math.round(best);
    this.views.setRange(range, what);
    if (this.audio) this.audio.blip();
    return { range, what };
  }

  /* -------------------------------- firing --------------------------------- */

  /** Starts a burst from the 50 mm. */
  fireMain() {
    if (this.burstRemaining > 0) return false;
    if (this.ammo[this.ammoKey] <= 0) return false;
    this.burstRemaining = Math.min(CONFIG.gunnery.burstLength, this.ammo[this.ammoKey]);
    return true;
  }

  update(dt) {
    this.lrfCooldown = Math.max(0, this.lrfCooldown - dt);
    this.mainCooldown = Math.max(0, this.mainCooldown - dt);
    this.coaxCooldown = Math.max(0, this.coaxCooldown - dt);

    if (this.burstRemaining > 0 && this.mainCooldown <= 0) {
      this._shootMain();
      this.burstRemaining--;
      this.mainCooldown = 60 / XM30.mainGun.cyclicRpm;
    }
  }

  _shootMain() {
    const key = this.ammoKey;
    if (this.ammo[key] <= 0) { this.burstRemaining = 0; return; }
    this.ammo[key]--;
    this.roundsFired++;

    const spec = XM30.mainGun.ammo[key];
    this.model.muzzleWorld(_o, _d);
    this.effects.fire(_o, _d, {
      speed: spec.vel,
      damage: spec.damage,
      splash: spec.splash,
      kind: key,
      spread: CONFIG.gunnery.mainSpread,
      flashSize: 2.4,
      tracerLength: 14,
      life: 8,
    });
    this.model.fireRecoil();
    if (this.audio) this.audio.cannon();
    if (this.onRoundSpent) this.onRoundSpent(key);
  }

  fireCoax() {
    if (this.coaxCooldown > 0 || this.ammo.coax <= 0) return false;
    this.coaxCooldown = 60 / XM30.coax.cyclicRpm;
    this.ammo.coax--;
    this.roundsFired++;

    this.model.coaxWorld(_o);
    this.model.muzzleWorld(_tmp, _d);
    this.effects.fire(_o, _d, {
      speed: XM30.coax.muzzleVelocity,
      damage: XM30.coax.damage,
      splash: 0,
      kind: 'coax',
      spread: CONFIG.gunnery.coaxSpread,
      flashSize: 0.8,
      tracerLength: 5,
      life: 3.5,
    });
    if (this.audio) this.audio.coax();
    if (this.onRoundSpent) this.onRoundSpent('coax');
    return true;
  }
}

/** Distance to a ray's first intersection with an AABB, or null. */
function rayBox(o, d, box) {
  let tmin = 0, tmax = Infinity;
  const axes = [
    [o.x, d.x, box.min.x, box.max.x],
    [o.y, d.y, box.min.y, box.max.y],
    [o.z, d.z, box.min.z, box.max.z],
  ];
  for (const [s, dd, lo, hi] of axes) {
    if (Math.abs(dd) < 1e-8) {
      if (s < lo || s > hi) return null;
      continue;
    }
    let t1 = (lo - s) / dd, t2 = (hi - s) / dd;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}

export { rayBox };

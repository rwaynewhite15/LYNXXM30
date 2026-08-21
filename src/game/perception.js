/**
 * Perception: turning "there is a man 600 m away" into "you have seen him".
 *
 * The rule the whole system hangs on is the mil-relation:
 *
 *     subtense (mils) = target height (m) x 1000 / range (m)
 *
 * A 1.78 m figure subtends about 3 mils at 600 m and 18 at 100 m. Multiply by
 * the sight's magnification and you have the apparent size — the single number
 * that decides whether a contact can be detected, recognised or identified.
 *
 * The player can run the same formula in reverse against the reticle's stadia
 * to range a target without lasing, which is what the ranging panel exists to
 * teach.
 */

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { ViewSystem } from './views.js';

const P = CONFIG.perception;

export const LEVEL = {
  UNKNOWN: 0,
  DETECT: 1,
  RECOGNISE: 2,
  IDENTIFY: 3,
};

export const LEVEL_NAME = ['—', 'DETECT', 'RECOG', 'IDENT'];
export const LEVEL_CLASS = ['unknown', 'detect', 'recognize', 'identify'];

const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _to = new THREE.Vector3();
const _top = new THREE.Vector3();
const _bottom = new THREE.Vector3();
const _proj = new THREE.Vector3();

export class Contact {
  constructor(enemy) {
    this.enemy = enemy;
    this.id = enemy.id;
    this.progress = 0;
    /** Live level: what the sight can make out right now. */
    this.level = LEVEL.UNKNOWN;
    /**
     * Best level ever reached. Once a crew has identified something they do
     * not un-know it when it ducks behind a parapet — the live level drives
     * the sight symbology, this drives the contact list.
     */
    this.best = LEVEL.UNKNOWN;
    this.designated = false;
    this.range = 0;
    this.subtense = 0;
    this.apparent = 0;
    this.bearing = 0;          // radians, relative to the hull
    this.offAxis = Math.PI;    // radians from the active sight axis
    this.inView = false;
    this.hasLos = false;
    this.screen = { x: 0, y: 0, w: 0, h: 0, visible: false, depth: 0 };
    this.everSeen = false;
    this.lasedRange = 0;
  }

  get label() {
    const l = Math.max(this.level, this.best);
    if (l >= LEVEL.IDENTIFY) return this.enemy.type.name;
    if (l >= LEVEL.RECOGNISE) return 'PERSONNEL';
    return 'CONTACT';
  }

  /** True when the contact is known but nothing can be seen of it right now. */
  get lost() { return this.level < LEVEL.DETECT && this.best >= LEVEL.DETECT; }
}

export class Perception {
  /**
   * @param {import('./enemies.js').EnemyManager} enemies
   * @param {import('./views.js').ViewSystem} views
   * @param {import('../world/world.js').World} world
   */
  constructor(enemies, views, world) {
    this.enemies = enemies;
    this.views = views;
    this.world = world;
    this.contacts = new Map();       // enemy id -> Contact
    /** Contact nearest the sight axis, if any — the ranging panel's subject. */
    this.cued = null;
    /** Contact the spotter has handed off. */
    this.designated = null;
  }

  /** Dwell time needed to climb to the given level. */
  static dwellFor(level) {
    if (level <= LEVEL.DETECT) return P.dwellDetect;
    if (level === LEVEL.RECOGNISE) return P.dwellRecognise;
    return P.dwellIdentify;
  }

  update(dt, camera, viewport) {
    const views = this.views;
    views.lineOfSight(_origin, _dir);
    const halfFov = (views.fovDeg * Math.PI / 180) / 2;
    const mag = views.magnification;

    let bestOffAxis = Infinity;
    let cued = null;

    for (const enemy of this.enemies.enemies) {
      let c = this.contacts.get(enemy.id);
      if (!c) {
        c = new Contact(enemy);
        this.contacts.set(enemy.id, c);
      }

      if (!enemy.alive) {
        c.level = LEVEL.UNKNOWN;
        c.progress = 0;
        continue;
      }

      // A contact you have worked up does not go all the way back to nothing
      // when it ducks: the ladder floors at DETECT once it has been reached.
      const floor = c.best >= LEVEL.DETECT ? 0.55 : 0;

      /* ------------------------ geometry of the contact ---------------------- */
      const centre = enemy.centre;
      _to.copy(centre).sub(_origin);
      c.range = _to.length();
      c.subtense = ViewSystem.subtenseMils(enemy.height, c.range);
      c.apparent = c.subtense * mag * P.magnificationGain;
      c.bearing = Math.atan2(centre.x - _origin.x, centre.z - _origin.z);

      _to.normalize();
      c.offAxis = Math.acos(Math.max(-1, Math.min(1, _to.dot(_dir))));

      // A figure fully behind cover, or behind a building, cannot be worked
      // on. Partial cover — a balcony rail — hides nothing above the waist,
      // so only tall cover counts as concealment.
      const exposed = enemy.cover < 0.6 || enemy.exposure > 0.35;
      c.hasLos = exposed && !this.world.segmentBlocked(_origin, centre, enemy.slot.box);

      // "In view" means inside the sight picture, with a little margin so a
      // contact at the very edge still counts.
      c.inView = c.hasLos && c.offAxis < halfFov * 1.05;

      /* --------------------------- the ladder itself ------------------------- */
      let ceiling = LEVEL.UNKNOWN;
      if (c.apparent >= P.detectMils) ceiling = LEVEL.DETECT;
      if (c.apparent >= P.recogniseMils) ceiling = LEVEL.RECOGNISE;
      if (c.apparent >= P.identifyMils) ceiling = LEVEL.IDENTIFY;

      const working = c.inView && c.offAxis < Math.max(halfFov, P.dwellAngle);
      if (working && ceiling > c.progress) {
        const next = Math.min(LEVEL.IDENTIFY, Math.floor(c.progress) + 1);
        c.progress = Math.min(ceiling, c.progress + dt / Perception.dwellFor(next));
      } else if (!working) {
        c.progress = Math.max(floor, c.progress - P.decayRate * dt);
      } else if (ceiling < c.progress) {
        // Target has opened the range or you have zoomed out: the ladder slips.
        c.progress = Math.max(ceiling, c.progress - P.decayRate * dt * 1.5);
      }

      c.level = Math.floor(c.progress);
      if (c.level > c.best) c.best = c.level;
      if (c.level >= LEVEL.DETECT) c.everSeen = true;

      /* ------------------------------ cueing -------------------------------- */
      if (c.inView && c.offAxis < bestOffAxis && c.offAxis < halfFov * 0.8) {
        bestOffAxis = c.offAxis;
        cued = c;
      }

      this._project(c, enemy, camera, viewport);
    }

    // Drop contacts whose enemy has been retired.
    for (const [id, c] of this.contacts) {
      if (!this.enemies.enemies.includes(c.enemy)) this.contacts.delete(id);
    }

    this.cued = cued;
    if (this.designated && !this.designated.enemy.alive) this.designated = null;
  }

  /** Screen-space box for the marker overlay. */
  _project(c, enemy, camera, viewport) {
    const s = c.screen;
    _top.copy(enemy.centre); _top.y += enemy.height * 0.5;
    _bottom.copy(enemy.centre); _bottom.y -= enemy.height * 0.5;

    _proj.copy(enemy.centre).project(camera);
    s.depth = _proj.z;
    if (_proj.z > 1 || _proj.z < -1) { s.visible = false; return; }

    s.x = (_proj.x * 0.5 + 0.5) * viewport.w;
    s.y = (-_proj.y * 0.5 + 0.5) * viewport.h;

    _top.project(camera);
    _bottom.project(camera);
    s.h = Math.abs((_top.y - _bottom.y) * 0.5 * viewport.h);
    s.w = Math.max(4, s.h * 0.42);
    s.visible = s.x > -60 && s.x < viewport.w + 60 && s.y > -60 && s.y < viewport.h + 60;
  }

  /**
   * The spotter hands the cued contact to the gunner. Gives the contact a head
   * start up the ladder and returns it so the caller can slew the turret.
   */
  designate() {
    const c = this.cued;
    if (!c || !c.enemy.alive) return null;
    if (this.designated && this.designated !== c) this.designated.designated = false;
    c.designated = true;
    c.progress = Math.max(c.progress, Math.min(LEVEL.IDENTIFY, c.progress + P.designationBonus));
    c.level = Math.floor(c.progress);
    this.designated = c;
    return c;
  }

  /** A shooter's muzzle flash gives them away regardless of dwell. */
  flagMuzzleFlash(enemy) {
    if (!P.muzzleFlashDetect) return;
    const c = this.contacts.get(enemy.id);
    if (!c) return;
    c.progress = Math.max(c.progress, LEVEL.DETECT);
    c.level = Math.floor(c.progress);
    c.everSeen = true;
  }

  /**
   * Contacts worth listing, nearest first, capped so the panel stays readable.
   */
  list() {
    const out = [];
    for (const c of this.contacts.values()) {
      if (!c.enemy.alive) continue;
      if (c.best < LEVEL.DETECT && !c.designated) continue;
      out.push(c);
    }
    out.sort((a, b) => a.range - b.range);
    return out.slice(0, P.maxTrackedContacts);
  }

  /**
   * Mil-relation estimate for the cued contact, as the player would work it
   * out from the reticle. Returns null when there is nothing cued.
   */
  milRelationEstimate() {
    const c = this.cued;
    if (!c || c.subtense < 0.05) return null;
    // The player can only read the reticle to about a fifth of a mil.
    const readable = Math.max(0.2, Math.round(c.subtense * 5) / 5);
    return {
      contact: c,
      mils: readable,
      range: ViewSystem.rangeFromMils(CONFIG.enemies.height, readable),
      trueRange: c.range,
    };
  }
}

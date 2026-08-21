/**
 * Crew stations and cameras.
 *
 * Two seats, each with a first-person sight view and a third-person view:
 *
 *   GUNNER   — primary sight, boresighted to the 50 mm. Narrow fields of view,
 *              high magnification, ballistic reticle.
 *   SPOTTER  — the commander's independent panoramic sight. Traverses on its
 *              own, wider fields of view, and can hand a target off to the
 *              gunner (hunter–killer).
 *
 * Sight lines are stabilised and rate-limited: the mouse sets a DEMANDED
 * angle, and the real sight chases it at the drive's slew rate. That is what
 * makes laying a 44-tonne turret feel like laying a 44-tonne turret.
 *
 * Both sights hang off the body rather than the turret. Physically the heads
 * sit on the turret roof, but a modern sight is stabilised independently and
 * the turret is laid to a computed offset from it — so this is the more
 * faithful arrangement, and it avoids the sight chasing its own tail when the
 * fire-control system corrects for parallax.
 */

import * as THREE from 'three';
import { XM30, DERIVED } from '../spec/xm30.js';
import { CONFIG } from '../config.js';

const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

/** Wraps an angle into (-PI, PI]. */
export function wrapPi(a) {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a <= 0) a += Math.PI * 2;
  return a - Math.PI;
}

/** Moves `cur` toward `target` by at most `rate * dt`, the short way round. */
function slew(cur, target, rate, dt) {
  const delta = wrapPi(target - cur);
  const step = rate * dt;
  if (Math.abs(delta) <= step) return target;
  return cur + Math.sign(delta) * step;
}

export const SEATS = {
  gunner: {
    id: 'gunner',
    label: 'GUNNER',
    spec: XM30.sights.gunner,
    slewRate: XM30.turret.slewRate,
    elevRate: XM30.turret.elevRate,
    elevMin: XM30.turret.elevMin,
    elevMax: XM30.turret.elevMax,
    reticle: 'gunner',
  },
  spotter: {
    id: 'spotter',
    label: 'SPOTTER / CC',
    spec: XM30.sights.commander,
    slewRate: XM30.sights.commander.slewRate,
    elevRate: XM30.sights.commander.slewRate,
    elevMin: -20 * Math.PI / 180,
    elevMax: 60 * Math.PI / 180,
    reticle: 'spotter',
  },
};

/** Third-person camera presets, cycled with C. */
const CHASE_PRESETS = [
  { name: 'CHASE',    back: 11.5, up: 4.6, side: 0.0, look: 6,  fov: 55, followTurret: false },
  { name: 'HIGH',     back: 17.0, up: 9.5, side: 0.0, look: 10, fov: 50, followTurret: false },
  { name: 'TURRET',   back: 7.5,  up: 3.4, side: 0.0, look: 14, fov: 52, followTurret: true },
  { name: 'FLANK',    back: 6.0,  up: 3.2, side: 9.0, look: 4,  fov: 48, followTurret: false },
];

export class ViewSystem {
  /**
   * @param {object} model     the built vehicle (see model/vehicle-model.js)
   * @param {THREE.PerspectiveCamera} camera
   */
  constructor(model, camera) {
    this.model = model;
    this.camera = camera;

    this.seat = 'gunner';
    this.mode = 'sight';           // 'sight' | 'chase'
    this.chaseIndex = 0;
    this.channel = 0;              // 0 day, 1 white-hot, 2 black-hot
    this.mag = { gunner: 1, spotter: 0 };

    /* ------------------------- sight rigs on the body ------------------------- */
    const T = XM30.turret;
    const gs = XM30.sights.gunner.mount;
    const cs = XM30.sights.commander.mount;

    const mkRig = (y, z) => {
      const rig = new THREE.Object3D();
      rig.rotation.order = 'YXZ';    // yaw first, then pitch in the yawed frame
      rig.position.set(0, y, z);
      model.body.add(rig);
      return rig;
    };

    this.gunnerRig = mkRig(DERIVED.ringY + T.basketHeight + T.height + 0.17, T.ringZ + gs.z);
    this.spotterRig = mkRig(DERIVED.ringY + T.basketHeight + cs.y + 0.16, T.ringZ + cs.z);

    /* ------------------------------ sight state ------------------------------ */
    this.aim = {
      gunner:  { az: 0, el: 0, azDemand: 0, elDemand: 0 },
      spotter: { az: 0, el: 0, azDemand: 0, elDemand: 0 },
    };

    /** Range the fire-control solution is currently built on, metres. */
    this.rangeSolution = 1200;
    this.rangeSource = 'DEFAULT';
    this.rangeAge = 99;

    /** Set true while the turret is slewing itself onto a handed-off target. */
    this.slavedTo = null;

    this._chasePos = new THREE.Vector3();
    this._chaseLook = new THREE.Vector3();
    this._chaseReady = false;
  }

  get seatDef() { return SEATS[this.seat]; }
  get chasePreset() { return CHASE_PRESETS[this.chaseIndex % CHASE_PRESETS.length]; }

  /** Vertical field of view of the active sight, in degrees. */
  get fovDeg() {
    const def = this.seatDef;
    return def.spec.fov[this.mag[this.seat]];
  }

  get magnification() {
    return this.seatDef.spec.mag[this.mag[this.seat]];
  }

  get magLabel() {
    return this.seatDef.spec.labels[this.mag[this.seat]];
  }

  get activeAim() { return this.aim[this.seat]; }
  get rig() { return this.seat === 'gunner' ? this.gunnerRig : this.spotterRig; }

  /* ------------------------------- commands -------------------------------- */

  swapSeat() {
    this.seat = this.seat === 'gunner' ? 'spotter' : 'gunner';
    return this.seat;
  }

  toggleMode() {
    this.mode = this.mode === 'sight' ? 'chase' : 'sight';
    this._chaseReady = false;
    return this.mode;
  }

  cycleChase() {
    this.chaseIndex = (this.chaseIndex + 1) % CHASE_PRESETS.length;
    this._chaseReady = false;
    return this.chasePreset.name;
  }

  setMagnification(i) {
    const n = this.seatDef.spec.fov.length;
    this.mag[this.seat] = Math.max(0, Math.min(n - 1, i));
  }

  cycleChannel() {
    this.channel = (this.channel + 1) % 3;
    return ['DAY TV', 'WHITE HOT', 'BLACK HOT'][this.channel];
  }

  /** Points the gunner's sight at a world position (hunter–killer handoff). */
  slewTo(worldPoint) {
    this.slavedTo = worldPoint.clone();
  }

  /**
   * Lays the ACTIVE sight directly onto a world point.
   * @param {THREE.Vector3} worldPoint
   * @param {boolean} snap  true to jump there, false to demand it and let the
   *                        drive slew at its own rate
   */
  aimAt(worldPoint, snap = false) {
    const rig = this.rig;
    _v.copy(worldPoint);
    this.model.body.worldToLocal(_v);
    _v.sub(rig.position);
    const aim = this.activeAim;
    aim.azDemand = Math.atan2(_v.x, _v.z);
    aim.elDemand = Math.atan2(_v.y, Math.hypot(_v.x, _v.z));
    if (snap) { aim.az = aim.azDemand; aim.el = aim.elDemand; }
    return aim;
  }

  /* -------------------------------- update --------------------------------- */

  /**
   * @param {number} dt
   * @param {{dx:number, dy:number}} look   mouse delta this frame, pixels
   * @param {object} vehicle                driving state, for stabiliser jitter
   */
  update(dt, look, vehicle) {
    const def = this.seatDef;
    const aim = this.activeAim;

    // Sensitivity tracks the field of view: the same hand movement always
    // sweeps the same fraction of the sight picture, whatever the zoom.
    const sens = CONFIG.turret.sensitivity * (this.fovDeg / 30);
    const scale = this.mode === 'chase' ? 1.35 : 1.0;

    if (this.slavedTo && this.seat === 'gunner') {
      // Automatic lay onto a handed-off contact; any mouse input breaks it.
      if (Math.abs(look.dx) + Math.abs(look.dy) > 2) {
        this.slavedTo = null;
      } else {
        this.model.root.worldToLocal(_v.copy(this.slavedTo));
        _v.sub(_v2.set(0, this.gunnerRig.position.y, this.gunnerRig.position.z));
        aim.azDemand = Math.atan2(_v.x, _v.z);
        aim.elDemand = Math.atan2(_v.y, Math.hypot(_v.x, _v.z));
        const done = Math.abs(wrapPi(aim.az - aim.azDemand)) < 0.004 &&
                     Math.abs(aim.el - aim.elDemand) < 0.004;
        if (done) this.slavedTo = null;
      }
    }

    if (!this.slavedTo) {
      aim.azDemand += look.dx * sens * scale;
      aim.elDemand -= look.dy * sens * scale;
    }
    aim.elDemand = Math.max(def.elevMin, Math.min(def.elevMax, aim.elDemand));

    // The drive chases the demand at its rate limit.
    aim.az = slew(aim.az, aim.azDemand, def.slewRate, dt);
    aim.el = slew(aim.el, aim.elDemand, def.elevRate, dt);

    // The idle seat keeps its own lay — it does not snap when you swap back.
    for (const key of Object.keys(this.aim)) {
      if (key === this.seat) continue;
      const other = this.aim[key];
      const d = SEATS[key];
      other.az = slew(other.az, other.azDemand, d.slewRate, dt);
      other.el = slew(other.el, other.elDemand, d.elevRate, dt);
    }

    // Residual lay error the stabiliser cannot remove, worse the faster you go.
    const speed = vehicle ? vehicle.speed : 0;
    const jitter = CONFIG.turret.jitterBase + CONFIG.turret.jitterPerMs * speed;
    this._jitterPhase = (this._jitterPhase || 0) + dt * 7.3;
    const jx = Math.sin(this._jitterPhase * 1.7) * jitter;
    const jy = Math.sin(this._jitterPhase * 2.3 + 1.1) * jitter * 0.7;

    this.gunnerRig.rotation.y = this.aim.gunner.az + jx;
    this.gunnerRig.rotation.x = -(this.aim.gunner.el + jy);
    this.spotterRig.rotation.y = this.aim.spotter.az + jx * 0.6;
    this.spotterRig.rotation.x = -(this.aim.spotter.el + jy * 0.6);

    this.rangeAge += dt;

    this._layGun(dt);
    this._placeCamera(dt, vehicle);
  }

  /**
   * Lays the turret so the round crosses the gunner's line of sight at the
   * ranged distance: parallax from the sight offset plus superelevation for
   * the drop over that range.
   */
  _layGun(dt) {
    const aim = this.aim.gunner;
    const R = Math.max(60, this.rangeSolution);

    // The point on the sight line the gun should meet.
    const rig = this.gunnerRig;
    _v.set(0, 0, R).applyEuler(rig.rotation).add(rig.position);

    // Bore origin in body space.
    const T = XM30.turret;
    _v2.set(0, DERIVED.ringY + T.basketHeight + T.trunnionY, T.ringZ + T.trunnionZ);
    _v.sub(_v2);

    const az = Math.atan2(_v.x, _v.z);
    const horiz = Math.hypot(_v.x, _v.z);
    let el = Math.atan2(_v.y, horiz);

    // Superelevation for gravity drop over the ranged distance.
    const v0 = XM30.mainGun.ammo[this.ammoKey || 'ap'].vel;
    const t = R / v0;
    el += Math.atan2(0.5 * CONFIG.gunnery.gravity * t * t, R);

    el = Math.max(XM30.turret.elevMin, Math.min(XM30.turret.elevMax, el));

    // The turret hardware also has to slew — it does not teleport onto the lay.
    this.model.azimuth = slew(this.model.azimuth, az, XM30.turret.slewRate * 1.6, dt);
    this.model.elevation = slew(this.model.elevation, el, XM30.turret.elevRate * 1.6, dt);

    // Commander's head follows its own sight, independent of the turret.
    this.model.commanderAzimuth = this.aim.spotter.az;
    this.model.cmdHead.rotation.order = 'YXZ';
    this.model.cmdHead.rotation.x = -this.aim.spotter.el * 0.6;
  }

  /* ------------------------------ camera placing ---------------------------- */

  _placeCamera(dt, vehicle) {
    const cam = this.camera;

    if (this.mode === 'sight') {
      const rig = this.rig;
      rig.updateWorldMatrix(true, false);
      rig.getWorldPosition(_v);
      rig.getWorldQuaternion(_q);
      cam.position.copy(_v);
      cam.quaternion.copy(_q).multiply(FLIP);
      cam.fov = this.fovDeg;
      cam.near = CONFIG.render.near;
      cam.updateProjectionMatrix();
      return;
    }

    // Third person. The rig hangs off the vehicle's heading (and optionally
    // the turret's, so you can orbit with the gun) and is damped so the
    // suspension doesn't shake the camera to pieces.
    const p = this.chasePreset;
    const root = this.model.root;
    const heading = root.rotation.y + (p.followTurret ? this.aim[this.seat].az : 0);

    const sin = Math.sin(heading), cos = Math.cos(heading);
    const desired = _v.set(
      root.position.x - sin * p.back + cos * p.side,
      root.position.y + p.up,
      root.position.z - cos * p.back - sin * p.side,
    );
    const lookAt = _v2.set(
      root.position.x + sin * p.look,
      root.position.y + 1.9,
      root.position.z + cos * p.look,
    );

    if (!this._chaseReady) {
      this._chasePos.copy(desired);
      this._chaseLook.copy(lookAt);
      this._chaseReady = true;
    } else {
      const k = 1 - Math.exp(-dt * 6.5);
      this._chasePos.lerp(desired, k);
      this._chaseLook.lerp(lookAt, 1 - Math.exp(-dt * 9));
    }

    cam.position.copy(this._chasePos);
    cam.up.set(0, 1, 0);
    cam.lookAt(this._chaseLook);
    cam.fov = p.fov;
    cam.near = 0.3;
    cam.updateProjectionMatrix();
  }

  /* -------------------------------- queries -------------------------------- */

  /**
   * World-space line of sight of the active seat.
   * @param {THREE.Vector3} outOrigin
   * @param {THREE.Vector3} outDir
   */
  lineOfSight(outOrigin, outDir) {
    const rig = this.rig;
    rig.updateWorldMatrix(true, false);
    rig.getWorldPosition(outOrigin);
    rig.getWorldQuaternion(_q);
    outDir.set(0, 0, 1).applyQuaternion(_q).normalize();
    return outOrigin;
  }

  /** World-space line of sight of the gunner's sight, whichever seat is live. */
  gunnerLineOfSight(outOrigin, outDir) {
    const rig = this.gunnerRig;
    rig.updateWorldMatrix(true, false);
    rig.getWorldPosition(outOrigin);
    rig.getWorldQuaternion(_q);
    outDir.set(0, 0, 1).applyQuaternion(_q).normalize();
    return outOrigin;
  }

  /** Records a range solution from the LRF or a mil-relation estimate. */
  setRange(metres, source) {
    this.rangeSolution = metres;
    this.rangeSource = source;
    this.rangeAge = 0;
  }

  /**
   * Angular size, in milliradians, that an object of the given height
   * subtends at the given range. This is the number the whole perception
   * model — and the player's mil-relation ranging — is built on.
   */
  static subtenseMils(height, range) {
    return range > 0.01 ? (height / range) * 1000 : 0;
  }

  /** Inverse: the mil-relation formula gunners actually use. */
  static rangeFromMils(height, mils) {
    return mils > 0.001 ? (height * 1000) / mils : Infinity;
  }

  /** Fraction of the sight picture's height that one milliradian occupies. */
  milsPerScreenHeight() {
    return (this.fovDeg * Math.PI / 180) * 1000;
  }
}

export { CHASE_PRESETS };

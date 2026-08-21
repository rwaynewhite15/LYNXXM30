/**
 * Assembles the complete XM30: hull, both track runs, turret.
 *
 * The returned object exposes the articulated nodes the game drives — nothing
 * here decides behaviour, it just hands out handles.
 *
 *   root                world position + heading
 *    └ body             suspension pitch / roll
 *       ├ hull
 *       ├ gearL, gearR
 *       └ turret        azimuth
 *          ├ gunMount   elevation
 *          └ cmdHead    independent commander azimuth
 */

import * as THREE from 'three';
import { XM30, DERIVED } from '../spec/xm30.js';
import { buildHull } from './hull.js';
import { buildTurret } from './turret.js';
import { buildRunningGear, updateRunningGear, setSuspension } from './running-gear.js';

export function buildVehicle() {
  const root = new THREE.Group();
  root.name = 'XM30';

  const body = new THREE.Group();
  body.name = 'body';
  root.add(body);

  const hull = buildHull();
  body.add(hull);

  const gearL = buildRunningGear(-1);
  const gearR = buildRunningGear(1);
  body.add(gearL, gearR);

  const turret = buildTurret();
  body.add(turret);

  const T = turret.userData;

  /** Where the driver's eye would be — used by the third-person camera rig. */
  const driverEye = new THREE.Object3D();
  driverEye.position.set(XM30.hull.driverHatchX, XM30.hull.heightRoof + 0.12, XM30.hull.driverHatchZ + 0.1);
  body.add(driverEye);

  const model = {
    root, body, hull, gearL, gearR, turret,
    gunMount: T.gunMount,
    gun: T.gun,
    cmdHead: T.cmdHead,
    gunnerEye: T.gunnerEye,
    cmdEye: T.cmdEye,
    driverEye,

    /** Turret azimuth in radians; 0 = over the bow, positive = clockwise. */
    get azimuth() { return turret.rotation.y; },
    set azimuth(v) { turret.rotation.y = v; },

    /** Gun elevation in radians; positive = muzzle up. */
    get elevation() { return -T.gunMount.rotation.x; },
    set elevation(v) { T.gunMount.rotation.x = -v; },

    /** Commander's panoramic sight azimuth, hull-referenced. */
    get commanderAzimuth() { return T.cmdHead.rotation.y + turret.rotation.y; },
    set commanderAzimuth(v) { T.cmdHead.rotation.y = v - turret.rotation.y; },

    /** Track distance travelled, drives wheel spin and band scroll. */
    trackDistance: 0,

    /** Recoil offset currently applied to the tube, metres. */
    recoil: 0,

    /**
     * @param {number} dt        seconds
     * @param {number} distance  metres of ground travel this frame
     * @param {number} yawRate   rad/s, so the tracks counter-rotate in a turn
     */
    update(dt, distance, yawRate = 0) {
      model.trackDistance += distance;
      // In a skid turn the inner track slows and the outer speeds up.
      const half = DERIVED.trackHalfGauge;
      const dL = distance - yawRate * half * dt;
      const dR = distance + yawRate * half * dt;
      model._dL = (model._dL || 0) + dL;
      model._dR = (model._dR || 0) + dR;
      updateRunningGear(gearL, model._dL);
      updateRunningGear(gearR, model._dR);

      // Recoil recovery.
      if (model.recoil > 0) {
        model.recoil = Math.max(0, model.recoil - dt * 1.1);
        T.gun.position.z = -model.recoil;
      }
    },

    /** Kicks the tube back; it recovers over the next second or so. */
    fireRecoil() {
      model.recoil = XM30.mainGun.recoil;
      T.gun.position.z = -model.recoil;
    },

    /** Applies per-station suspension deflection, metres. */
    setSuspension(left, right) {
      setSuspension(gearL, left);
      setSuspension(gearR, right);
    },

    /** World-space muzzle position and direction of the main gun. */
    muzzleWorld(outPos, outDir) {
      outPos.copy(T.muzzleLocal);
      T.gunMount.localToWorld(outPos);
      outDir.set(0, 0, 1);
      T.gunMount.getWorldQuaternion(_q);
      outDir.applyQuaternion(_q).normalize();
      return outPos;
    },

    /** World-space coax muzzle position. */
    coaxWorld(outPos) {
      outPos.copy(T.coaxLocal);
      T.gunMount.localToWorld(outPos);
      return outPos;
    },
  };

  return model;
}

const _q = new THREE.Quaternion();

/**
 * Bounding box of the armoured envelope — antennas and other whip-thin
 * fittings are excluded so the figure is comparable to a published
 * length/width/height.
 */
export function measure(model) {
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  model.root.updateWorldMatrix(true, true);
  model.root.traverse((o) => {
    if (!o.isMesh || o.userData.excludeFromEnvelope) return;
    tmp.setFromObject(o);
    box.union(tmp);
  });
  const size = new THREE.Vector3();
  box.getSize(size);
  return { box, size };
}

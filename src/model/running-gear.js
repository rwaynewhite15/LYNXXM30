/**
 * Running gear: seven road-wheel stations per side, front drive sprocket,
 * rear idler, return rollers and the track band that wraps the lot.
 *
 * The band is generated as the convex hull of the wheel discs, which is what a
 * tensioned track physically is, so the silhouette comes out right at any
 * suspension deflection.
 */

import * as THREE from 'three';
import { XM30, DERIVED } from '../spec/xm30.js';
import { materials } from './materials.js';
import { trackBand, tubeX, solid, mergeGeometries } from './geo.js';

const T = XM30.track;

/** Road wheel: a doubled dished wheel with a rubber tyre and hub detail. */
function roadWheelGeometry() {
  const parts = [];
  const halfGap = T.wheelGap / 2;
  const r = T.wheelDiameter / 2;

  for (const side of [-1, 1]) {
    const cx = side * (halfGap + T.wheelWidth / 2);
    // Tyre
    const tyre = tubeX(r, r, T.wheelWidth, 20);
    tyre.translate(cx, 0, 0);
    parts.push(tyre);
    // Dished rim, slightly inboard
    const rim = tubeX(r * 0.66, r * 0.66, T.wheelWidth * 1.12, 16);
    rim.translate(cx, 0, 0);
    parts.push(rim);
  }
  // Hub spanning the pair
  const hub = tubeX(r * 0.26, r * 0.26, T.wheelGap + T.wheelWidth * 2 + 0.02, 12);
  parts.push(hub);
  return mergeGeometries(parts);
}

/** Toothed drive sprocket — the teeth are what make it read as the drive end. */
function sprocketGeometry() {
  const parts = [];
  const r = T.sprocketRadius;
  const halfGap = T.wheelGap / 2;

  for (const side of [-1, 1]) {
    const cx = side * (halfGap + T.wheelWidth / 2);
    const disc = tubeX(r * 0.82, r * 0.82, T.wheelWidth * 0.7, 18);
    disc.translate(cx, 0, 0);
    parts.push(disc);

    // Sprocket teeth around the rim.
    const teeth = 12;
    for (let i = 0; i < teeth; i++) {
      const a = (i / teeth) * Math.PI * 2;
      const tooth = new THREE.BoxGeometry(T.wheelWidth * 0.55, 0.10, 0.075);
      tooth.translate(0, r * 0.93, 0);
      tooth.rotateX(0);
      const m = new THREE.Matrix4().makeRotationX(a);
      tooth.applyMatrix4(m);
      tooth.translate(cx, 0, 0);
      parts.push(tooth);
    }
    // Lightening holes read as a ring of shadow at distance; a dark inner
    // disc is cheaper and reads the same past 20 m.
    const web = tubeX(r * 0.5, r * 0.5, T.wheelWidth * 0.9, 14);
    web.translate(cx, 0, 0);
    parts.push(web);
  }
  const hub = tubeX(r * 0.3, r * 0.3, T.wheelGap + T.wheelWidth * 2, 12);
  parts.push(hub);
  return mergeGeometries(parts);
}

function idlerGeometry() {
  const parts = [];
  const r = T.idlerRadius;
  const halfGap = T.wheelGap / 2;
  for (const side of [-1, 1]) {
    const cx = side * (halfGap + T.wheelWidth / 2);
    const w = tubeX(r, r, T.wheelWidth, 18);
    w.translate(cx, 0, 0);
    parts.push(w);
    const rim = tubeX(r * 0.6, r * 0.6, T.wheelWidth * 1.15, 14);
    rim.translate(cx, 0, 0);
    parts.push(rim);
  }
  parts.push(tubeX(r * 0.28, r * 0.28, T.wheelGap + T.wheelWidth * 2, 10));
  return mergeGeometries(parts);
}

/**
 * Builds one side's running gear.
 * @param {number} side  -1 for left, +1 for right
 */
export function buildRunningGear(side) {
  const M = materials();
  const group = new THREE.Group();
  group.name = `runningGear${side < 0 ? 'L' : 'R'}`;

  const wheelGeo = roadWheelGeometry();
  const sprocketGeo = sprocketGeometry();
  const idlerGeo = idlerGeometry();
  const rollerGeo = tubeX(T.rollerRadius, T.rollerRadius, T.wheelWidth * 1.1, 12);

  const spinners = [];
  const discs = [];

  /* ------------------------------- road wheels ------------------------------ */
  const wheelMeshes = [];
  for (let i = 0; i < T.roadWheels; i++) {
    const z = T.firstWheelZ - i * T.wheelPitch;
    const mesh = solid(wheelGeo, M.rubber);
    mesh.position.set(0, DERIVED.wheelAxisY, z);
    group.add(mesh);
    spinners.push(mesh);
    wheelMeshes.push(mesh);
    discs.push({ z, y: DERIVED.wheelAxisY, r: T.wheelDiameter / 2 });

    // Torsion-bar swing arm, running forward from the hull side to the hub.
    const arm = solid(new THREE.BoxGeometry(0.06, 0.11, 0.30), M.steelDark);
    arm.position.set(side * -0.05, DERIVED.wheelAxisY + 0.07, z + 0.15);
    arm.rotation.x = 0.22;
    group.add(arm);
  }

  /* --------------------------------- sprocket ------------------------------- */
  const sprocket = solid(sprocketGeo, M.steel);
  sprocket.position.set(0, DERIVED.sprocketY, T.sprocketZ);
  group.add(sprocket);
  spinners.push(sprocket);
  discs.push({ z: T.sprocketZ, y: DERIVED.sprocketY, r: T.sprocketRadius });

  /* ---------------------------------- idler --------------------------------- */
  const idler = solid(idlerGeo, M.steel);
  idler.position.set(0, DERIVED.idlerY, T.idlerZ);
  group.add(idler);
  spinners.push(idler);
  discs.push({ z: T.idlerZ, y: DERIVED.idlerY, r: T.idlerRadius });

  /* ------------------------------ return rollers ---------------------------- */
  const rollerSpan = (T.sprocketZ - T.idlerZ) * 0.72;
  for (let i = 0; i < T.returnRollers; i++) {
    const t = (i + 0.5) / T.returnRollers;
    const z = T.idlerZ + rollerSpan * t + 0.6;
    const roller = solid(rollerGeo, M.rubber);
    roller.position.set(0, DERIVED.rollerY, z);
    group.add(roller);
    spinners.push(roller);
    discs.push({ z, y: DERIVED.rollerY, r: T.rollerRadius });
  }

  /* -------------------------------- track band ------------------------------ */
  const bandGeo = trackBand(discs, T.trackWidth, T.trackThickness);
  const bandMat = M.trackPad.clone();
  bandMat.map = M.trackPad.map.clone();
  bandMat.map.needsUpdate = true;
  // Repeat the pad texture once per track link around the loop.
  const links = Math.max(8, Math.round(bandGeo.userData.arcLength / T.shoeLength));
  bandMat.map.wrapS = bandMat.map.wrapT = THREE.RepeatWrapping;
  bandMat.map.repeat.set(links, 1);

  const band = solid(bandGeo, bandMat);
  band.name = 'trackBand';
  group.add(band);

  group.userData = {
    side,
    spinners,
    wheels: wheelMeshes,
    band,
    bandMap: bandMat.map,
    arcLength: bandGeo.userData.arcLength,
    links,
  };

  group.position.x = side * DERIVED.trackHalfGauge;
  return group;
}

/**
 * Advances the visible track motion.
 * @param {THREE.Group} gear
 * @param {number} distance  metres travelled by that track since start
 */
export function updateRunningGear(gear, distance) {
  const ud = gear.userData;
  // Texture scrolls one full repeat per link length of travel.
  ud.bandMap.offset.x = -(distance / ud.arcLength);
  const wheelCirc = Math.PI * T.wheelDiameter;
  const spin = (distance / wheelCirc) * Math.PI * 2;
  for (const s of ud.spinners) s.rotation.x = spin;
}

/**
 * Applies suspension deflection to the road wheels so the vehicle visibly
 * works over bumps. Deflections are in metres, one per station.
 */
export function setSuspension(gear, deflections) {
  const wheels = gear.userData.wheels;
  for (let i = 0; i < wheels.length; i++) {
    wheels[i].position.y = DERIVED.wheelAxisY + (deflections[i] || 0);
  }
}

/**
 * Enemy figures.
 *
 * Built to a real 1.78 m so the perception model can range them by
 * mil-relation, and kept blocky and high-contrast so the silhouette still
 * reads at 600 m through a wide sight.
 */

import * as THREE from 'three';
import { materials } from './materials.js';
import { chamferBox, tubeZ, tubeX, solid, mergeGeometries, mergeGroupByMaterial } from './geo.js';
import { CONFIG } from '../config.js';

const H = CONFIG.enemies.height;

/** Shoulder-fired rocket launcher — the tube reads clearly at range. */
function launcher(M) {
  const g = new THREE.Group();
  const tube = solid(tubeZ(0.043, 0.043, 1.30, 10), M.weapon);
  g.add(tube);
  const warhead = solid(new THREE.CylinderGeometry(0.048, 0.085, 0.34, 10), M.weapon);
  warhead.rotation.x = Math.PI / 2;
  warhead.position.z = 0.72;
  g.add(warhead);
  const cone = solid(new THREE.ConeGeometry(0.048, 0.16, 10), M.weapon);
  cone.rotation.x = Math.PI / 2;
  cone.position.z = 0.95;
  g.add(cone);
  const grip = solid(chamferBox(0.05, 0.17, 0.07, 0.01), M.weapon);
  grip.position.set(0, -0.12, 0.06);
  g.add(grip);
  const sight = solid(chamferBox(0.03, 0.10, 0.12, 0.01), M.weapon);
  sight.position.set(-0.05, 0.09, 0.10);
  g.add(sight);
  return g;
}

/** Assault rifle. */
function rifle(M) {
  const g = new THREE.Group();
  const body = solid(chamferBox(0.05, 0.10, 0.62, 0.012), M.weapon);
  g.add(body);
  const barrel = solid(tubeZ(0.011, 0.013, 0.42, 8), M.weapon);
  barrel.position.z = 0.50;
  g.add(barrel);
  const mag = solid(chamferBox(0.035, 0.22, 0.08, 0.01), M.weapon);
  mag.position.set(0, -0.15, 0.02);
  mag.rotation.x = -0.2;
  g.add(mag);
  const stock = solid(chamferBox(0.045, 0.10, 0.28, 0.02), M.weapon);
  stock.position.z = -0.42;
  g.add(stock);
  return g;
}

/** Belt-fed machine gun on a bipod — heavier silhouette, longer bursts. */
function machineGun(M) {
  const g = new THREE.Group();
  const body = solid(chamferBox(0.07, 0.13, 0.86, 0.015), M.weapon);
  g.add(body);
  const barrel = solid(tubeZ(0.014, 0.017, 0.60, 8), M.weapon);
  barrel.position.z = 0.70;
  g.add(barrel);
  const box = solid(chamferBox(0.10, 0.16, 0.18, 0.015), M.weapon);
  box.position.set(0, -0.14, -0.10);
  g.add(box);
  for (const s of [-1, 1]) {
    const leg = solid(new THREE.CylinderGeometry(0.008, 0.008, 0.34, 5), M.weapon);
    leg.position.set(s * 0.09, -0.20, 0.55);
    leg.rotation.z = s * 0.32;
    g.add(leg);
  }
  return g;
}

export const WEAPON_TYPES = {
  rpg:   { build: launcher,   name: 'RPG',  threat: 'rpg',       reach: 420, warn: 'ROCKET' },
  rifle: { build: rifle,      name: 'RIFLE', threat: 'smallArms', reach: 340, warn: 'SMALL ARMS' },
  mg:    { build: machineGun, name: 'MG',   threat: 'smallArms', reach: 520, warn: 'MG' },
  atgm:  { build: launcher,   name: 'ATGM', threat: 'atgm',      reach: 900, warn: 'MISSILE' },
};

/**
 * Builds one figure, posed as if shouldering its weapon.
 *
 * @returns {{root:THREE.Group, muzzle:THREE.Object3D, height:number}}
 */
export function buildFigure(weaponKey = 'rifle', variant = 0) {
  const M = materials();
  const root = new THREE.Group();
  root.name = 'figure';

  const uniform = variant % 2 ? M.uniformAlt : M.uniform;

  // Proportions from a 1.78 m standing figure.
  const legH = H * 0.47;
  const torsoH = H * 0.30;
  const headR = H * 0.062;

  for (const s of [-1, 1]) {
    const leg = solid(chamferBox(0.15, legH, 0.18, 0.05), uniform);
    leg.position.set(s * 0.11, legH / 2, 0);
    root.add(leg);
    const boot = solid(chamferBox(0.14, 0.10, 0.27, 0.03), M.weapon);
    boot.position.set(s * 0.11, 0.05, 0.03);
    root.add(boot);
  }

  const torso = solid(chamferBox(0.42, torsoH, 0.24, 0.06), uniform);
  torso.position.y = legH + torsoH / 2;
  root.add(torso);

  // Plate carrier — a distinct block on the chest that catches light and
  // makes the figure read as armed rather than civilian.
  const carrier = solid(chamferBox(0.40, torsoH * 0.66, 0.12, 0.03), M.uniformAlt);
  carrier.position.set(0, legH + torsoH * 0.56, 0.11);
  root.add(carrier);

  const neckY = legH + torsoH;
  const head = solid(new THREE.SphereGeometry(headR, 10, 8), M.skin);
  head.position.y = neckY + headR * 1.15;
  root.add(head);

  // Helmet.
  const helmet = solid(new THREE.SphereGeometry(headR * 1.22, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), uniform);
  helmet.position.y = neckY + headR * 1.22;
  root.add(helmet);

  /* --------------------------------- arms ---------------------------------- */
  // Posed shouldering the weapon: leading arm out and forward, trailing arm in.
  const shoulderY = legH + torsoH * 0.86;
  const armGeo = chamferBox(0.115, 0.115, 0.42, 0.04);

  const lead = solid(armGeo, uniform);
  lead.position.set(-0.20, shoulderY - 0.05, 0.20);
  lead.rotation.x = -0.55;
  root.add(lead);

  const trail = solid(armGeo, uniform);
  trail.position.set(0.20, shoulderY - 0.08, 0.06);
  trail.rotation.x = -0.25;
  root.add(trail);

  /* -------------------------------- weapon --------------------------------- */
  const type = WEAPON_TYPES[weaponKey] || WEAPON_TYPES.rifle;
  const weapon = type.build(M);
  const isTube = weaponKey === 'rpg' || weaponKey === 'atgm';
  weapon.position.set(isTube ? -0.14 : -0.10, shoulderY + (isTube ? 0.06 : -0.02), 0.22);
  root.add(weapon);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(weapon.position.x, weapon.position.y, weapon.position.z + (isTube ? 0.95 : 0.7));
  root.add(muzzle);

  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  muzzle.userData.noMerge = true;
  mergeGroupByMaterial(root);

  root.userData = {
    height: H,
    weapon: weaponKey,
    weaponType: type,
    muzzle,
    /** Centre of mass, for hit tests and marker placement. */
    centreY: legH + torsoH * 0.55,
  };
  return root;
}

/**
 * Prototype set — figures are cloned rather than rebuilt, which keeps spawning
 * a target at 700 m free.
 */
export function makeFigurePrototypes() {
  const out = {};
  for (const key of Object.keys(WEAPON_TYPES)) {
    out[key] = [buildFigure(key, 0), buildFigure(key, 1)];
  }
  return out;
}

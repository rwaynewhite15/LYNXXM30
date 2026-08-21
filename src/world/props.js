/**
 * Roadside and on-road props.
 *
 * Anything the driver has to steer around exposes a collision radius and a
 * severity; anything purely decorative doesn't. Built as prototypes and cloned
 * into chunks.
 */

import * as THREE from 'three';
import { materials } from '../model/materials.js';
import { chamferBox, tubeZ, tubeX, solid, rescaleUV, mergeGroupByMaterial } from '../model/geo.js';

/* ------------------------------ road hazards ------------------------------ */

/** Burnt-out passenger car. Low, wide, and very much in the way. */
function wreckedCar(M) {
  const g = new THREE.Group();
  const bodyGeo = chamferBox(1.75, 0.72, 4.25, 0.14);
  rescaleUV(bodyGeo, 0.3);
  const body = solid(bodyGeo, M.wreck);
  body.position.y = 0.62;
  g.add(body);

  const cabin = solid(chamferBox(1.6, 0.62, 2.1, 0.16), M.wreck);
  cabin.position.set(0, 1.22, -0.25);
  g.add(cabin);

  // Burnt-out glazing reads as dark voids.
  for (const [px, pz, rot] of [[0, 0.78, 0], [0, -1.3, 0]]) {
    const glassPane = solid(new THREE.PlaneGeometry(1.35, 0.5), M.interior, { cast: false });
    glassPane.position.set(px, 1.24, pz);
    glassPane.rotation.y = rot;
    g.add(glassPane);
  }

  // Wheels: two still on, two collapsed.
  const wheel = tubeX(0.33, 0.33, 0.22, 12);
  for (const [wx, wz, up] of [[-0.8, 1.35, 1], [0.8, 1.35, 1], [-0.8, -1.35, 0], [0.8, -1.35, 1]]) {
    const w = solid(wheel, M.rubber);
    w.position.set(wx, up ? 0.33 : 0.14, wz);
    if (!up) w.rotation.z = 1.2;
    g.add(w);
  }

  g.rotation.y = Math.random() * 0.7 - 0.35;
  return { group: g, radius: 2.0, height: 1.6, severity: 1.0, name: 'wreck' };
}

/** Interlocking concrete barrier. */
function jerseyBarrier(M) {
  const g = new THREE.Group();
  // Trapezoidal cross-section, sketched with two stacked slabs.
  const lower = solid(chamferBox(0.62, 0.34, 3.0, 0.03), M.concreteB);
  lower.position.y = 0.17;
  g.add(lower);
  const upper = solid(chamferBox(0.32, 0.62, 3.0, 0.03), M.concreteB);
  upper.position.y = 0.63;
  g.add(upper);
  return { group: g, radius: 1.6, height: 0.95, severity: 0.8, name: 'barrier' };
}

/** Shell crater: a rim of thrown-up spoil around a dark bowl. */
function crater(M) {
  const g = new THREE.Group();
  const r = 2.1;
  const bowl = solid(new THREE.SphereGeometry(r, 20, 8, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45),
                     M.interior, { cast: false });
  bowl.position.y = 0.62;
  bowl.scale.y = 0.42;
  g.add(bowl);

  const rim = solid(new THREE.TorusGeometry(r * 0.92, 0.28, 6, 22), M.ground);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.10;
  rim.scale.y = 0.5;
  g.add(rim);

  // Scattered spoil.
  for (let i = 0; i < 9; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = r * (1.1 + Math.random() * 0.7);
    const chunk = solid(chamferBox(0.3 + Math.random() * 0.4, 0.18, 0.3 + Math.random() * 0.4, 0.04), M.concreteB);
    chunk.position.set(Math.cos(a) * d, 0.09, Math.sin(a) * d);
    chunk.rotation.y = Math.random() * 3;
    g.add(chunk);
  }
  return { group: g, radius: 2.0, height: 0.4, severity: 0.6, name: 'crater' };
}

/** Rubble spill from a collapsed frontage. */
function rubblePile(M) {
  const g = new THREE.Group();
  for (let i = 0; i < 16; i++) {
    const s = 0.35 + Math.random() * 0.85;
    const block = solid(chamferBox(s, s * 0.5, s * (0.6 + Math.random()), 0.03),
                        Math.random() > 0.5 ? M.concreteA : M.concreteB);
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * 2.3;
    block.position.set(Math.cos(a) * d, 0.2 + Math.random() * 0.7 * (1 - d / 3), Math.sin(a) * d);
    block.rotation.set(Math.random(), Math.random() * 3, Math.random() * 0.4);
    g.add(block);
  }
  // Exposed rebar.
  for (let i = 0; i < 5; i++) {
    const bar = solid(new THREE.CylinderGeometry(0.018, 0.018, 1.2, 5), M.rust);
    bar.position.set((Math.random() - 0.5) * 3, 0.7, (Math.random() - 0.5) * 3);
    bar.rotation.set(Math.random() * 0.9, 0, Math.random() * 0.9);
    g.add(bar);
  }
  return { group: g, radius: 2.4, height: 1.1, severity: 0.7, name: 'rubble' };
}

/** Oil drums, sometimes stacked. */
function oilDrums(M) {
  const g = new THREE.Group();
  const n = 2 + Math.floor(Math.random() * 4);
  for (let i = 0; i < n; i++) {
    const drum = solid(new THREE.CylinderGeometry(0.30, 0.30, 0.88, 12), Math.random() > 0.5 ? M.rust : M.wreck);
    const a = (i / n) * Math.PI * 2;
    drum.position.set(Math.cos(a) * 0.62, 0.44, Math.sin(a) * 0.62);
    if (Math.random() > 0.7) { drum.rotation.z = Math.PI / 2; drum.position.y = 0.30; }
    g.add(drum);
  }
  return { group: g, radius: 1.15, height: 0.9, severity: 0.4, name: 'drums' };
}

/** Abandoned bus — big enough to block a whole lane. */
function bus(M) {
  const g = new THREE.Group();
  const bodyGeo = chamferBox(2.5, 2.6, 10.5, 0.18);
  rescaleUV(bodyGeo, 0.22);
  const body = solid(bodyGeo, M.wreck);
  body.position.y = 1.75;
  g.add(body);

  // Window band on both sides.
  for (const s of [-1, 1]) {
    const band = solid(new THREE.PlaneGeometry(8.6, 0.95), M.interior, { cast: false });
    band.position.set(s * 1.26, 2.3, 0);
    band.rotation.y = s * Math.PI / 2;
    g.add(band);
  }
  for (let i = 0; i < 6; i++) {
    const w = solid(tubeX(0.5, 0.5, 0.3, 12), M.rubber);
    w.position.set((i % 2 ? 1 : -1) * 1.2, 0.5, Math.floor(i / 2) * 3.8 - 3.8);
    g.add(w);
  }
  g.rotation.y = (Math.random() - 0.5) * 0.5;
  return { group: g, radius: 3.4, height: 3.0, severity: 1.4, name: 'bus' };
}

/** Sandbagged checkpoint position — cover, and sometimes occupied. */
function sandbagPost(M) {
  const g = new THREE.Group();
  const rows = 4;
  for (let r = 0; r < rows; r++) {
    const y = 0.14 + r * 0.24;
    const count = 7 - r;
    for (let i = 0; i < count; i++) {
      const bag = solid(chamferBox(0.46, 0.22, 0.30, 0.08), M.sandbag);
      const a = -0.9 + (i / (count - 1 || 1)) * 1.8;
      bag.position.set(Math.sin(a) * 1.5, y, Math.cos(a) * 1.5 - 1.1);
      bag.rotation.y = a;
      g.add(bag);
    }
  }
  return { group: g, radius: 1.8, height: 1.1, severity: 0.7, name: 'sandbags', firingPosition: true };
}

/* ----------------------------- roadside scenery ---------------------------- */

function utilityPole(M) {
  const g = new THREE.Group();
  const pole = solid(new THREE.CylinderGeometry(0.13, 0.17, 8.5, 8), M.wreck);
  pole.position.y = 4.25;
  g.add(pole);
  const arm = solid(new THREE.BoxGeometry(1.9, 0.11, 0.11), M.wreck);
  arm.position.y = 7.7;
  g.add(arm);
  for (const s of [-1, 1]) {
    const insulator = solid(new THREE.CylinderGeometry(0.07, 0.07, 0.16, 6), M.concreteA);
    insulator.position.set(s * 0.8, 7.84, 0);
    g.add(insulator);
  }
  return { group: g, radius: 0.4, height: 8.5, severity: 0.5, name: 'pole', decorative: true };
}

function streetLight(M) {
  const g = new THREE.Group();
  const post = solid(new THREE.CylinderGeometry(0.09, 0.13, 7.2, 8), M.steelDark);
  post.position.y = 3.6;
  g.add(post);
  const arm = solid(new THREE.BoxGeometry(0.09, 0.09, 1.5), M.steelDark);
  arm.position.set(0, 7.15, 0.7);
  arm.rotation.x = 0.22;
  g.add(arm);
  const head = solid(chamferBox(0.34, 0.14, 0.8, 0.04), M.steelDark);
  head.position.set(0, 7.0, 1.4);
  g.add(head);
  return { group: g, radius: 0.35, height: 7.2, severity: 0.5, name: 'streetlight', decorative: true };
}

function roadsideWall(M) {
  const g = new THREE.Group();
  const len = 6 + Math.random() * 6;
  const wallGeo = chamferBox(0.28, 2.1, len, 0.03);
  rescaleUV(wallGeo, 0.25);
  const wall = solid(wallGeo, M.concreteB);
  wall.position.y = 1.05;
  g.add(wall);
  // Blown-out section.
  if (Math.random() > 0.5) {
    const gap = solid(chamferBox(0.34, 1.2, 1.8, 0.05), M.interior, { cast: false });
    gap.position.set(0, 1.6, (Math.random() - 0.5) * len * 0.5);
    g.add(gap);
  }
  return { group: g, radius: 0.6, height: 2.1, severity: 0.6, name: 'wall', decorative: true };
}

function deadTree(M) {
  const g = new THREE.Group();
  const trunk = solid(new THREE.CylinderGeometry(0.09, 0.21, 4.4, 7), M.rust);
  trunk.position.y = 2.2;
  g.add(trunk);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.random();
    const branch = solid(new THREE.CylinderGeometry(0.02, 0.055, 1.5, 5), M.rust);
    branch.position.set(Math.cos(a) * 0.45, 3.5 + Math.random() * 0.6, Math.sin(a) * 0.45);
    branch.rotation.set(Math.cos(a) * 0.9, 0, -Math.sin(a) * 0.9);
    g.add(branch);
  }
  return { group: g, radius: 0.5, height: 4.6, severity: 0.5, name: 'tree', decorative: true };
}

/* ------------------------------------------------------------------------- */

/**
 * Builds one prototype of every prop type. Chunks clone from these.
 */
export function makePropPrototypes() {
  const M = materials();
  const hazards = [
    wreckedCar(M), wreckedCar(M), jerseyBarrier(M), crater(M),
    rubblePile(M), oilDrums(M), bus(M), sandbagPost(M),
  ];
  const scenery = [
    utilityPole(M), streetLight(M), roadsideWall(M), deadTree(M),
  ];
  for (const p of [...hazards, ...scenery]) {
    p.group.traverse((o) => { if (o.isMesh) o.castShadow = !o.userData.noShadow; });
    mergeGroupByMaterial(p.group);
  }
  return { hazards, scenery };
}

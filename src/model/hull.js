/**
 * The XM30 hull.
 *
 * Built the way the vehicle is: a side profile derived from the spec's plate
 * angles, extruded across the width in two bands (narrow tub below the sponson
 * line, full width above it), then dressed with the bolt-on armour modules,
 * skirts, deck furniture and lights.
 */

import * as THREE from 'three';
import { XM30, DERIVED, DEG } from '../spec/xm30.js';
import { materials } from './materials.js';
import { extrudeProfile, chamferBox, tubeZ, tubeX, solid, mergeGeometries, rescaleUV, mergeGroupByMaterial } from './geo.js';

const H = XM30.hull;

/**
 * Derives the hull's side-profile key points from the spec angles.
 * All points are [z, y] in vehicle-local metres, +Z forward.
 */
export function hullProfile() {
  const roof = H.heightRoof;
  const floor = H.groundClear;
  const spon = H.sponsonY;

  // Work backwards from the nose. The prow is the frontmost point; the lower
  // glacis drops from it to the floor, the upper glacis climbs to the roof.
  const prowZ = H.length / 2;                  // frontmost point of the hull

  // Split the specified nose run between the two plates so that the upper
  // glacis reaches the roof and the lower one reaches the floor.
  const upperRun = (roof - 1.24) / Math.tan(H.upperGlacisAngle);
  const lowerRise = 1.24 - floor;
  const lowerRun = lowerRise / Math.tan(H.lowerGlacisAngle);

  const prow = [prowZ, 1.24];
  const glacisTop = [prowZ - upperRun, roof];
  const floorFront = [prowZ - lowerRun, floor];

  // Rear plate: top overhangs the bottom by the rake.
  const rearTopZ = prowZ - H.length;
  const rearBottomZ = rearTopZ + (roof - floor) * Math.tan(H.rearRake);

  const zAt = (y) => {
    const t = (y - floor) / (roof - floor);
    return rearBottomZ + t * (rearTopZ - rearBottomZ);
  };

  // Where the front and rear plates cross the sponson line.
  const frontAtSponson = [floorFront[0] + (spon - floor) / Math.tan(H.lowerGlacisAngle), spon];
  const rearAtSponson = [zAt(spon), spon];

  return {
    prow, glacisTop, floorFront,
    rearTop: [rearTopZ, roof],
    rearBottom: [rearBottomZ, floor],
    frontAtSponson, rearAtSponson,
    roof, floor, spon,
    /** Narrow lower tub, CCW. */
    lower: [
      [rearBottomZ, floor],
      floorFront,
      frontAtSponson,
      rearAtSponson,
    ],
    /** Full-width upper hull, CCW. */
    upper: [
      frontAtSponson,
      prow,
      glacisTop,
      [rearTopZ, roof],
      rearAtSponson,
    ],
  };
}

/* ------------------------------------------------------------------------- */

/** Louvred engine intake / exhaust grille, facing +Y. */
function grille(w, d, slats = 7) {
  const parts = [];
  const frame = new THREE.BoxGeometry(w, 0.03, d);
  parts.push(frame);
  const slatGeo = new THREE.BoxGeometry(w * 0.94, 0.05, d / slats * 0.42);
  for (let i = 0; i < slats; i++) {
    const g = slatGeo.clone();
    g.rotateX(-0.5);
    g.translate(0, 0.035, (i - (slats - 1) / 2) * (d / slats));
    parts.push(g);
  }
  return mergeGeometries(parts);
}

/** A bolt-on applique armour panel with a visible fastener pattern. */
function appliquePanel(length, height, thickness, boltRows = 2, boltsPerRow = 6) {
  const parts = [];
  parts.push(chamferBox(thickness, height, length, 0.018));
  const boltGeo = new THREE.CylinderGeometry(0.021, 0.019, thickness * 0.7, 6);
  boltGeo.rotateZ(Math.PI / 2);
  for (let r = 0; r < boltRows; r++) {
    const y = (r - (boltRows - 1) / 2) * (height * 0.62);
    for (let i = 0; i < boltsPerRow; i++) {
      const z = (i - (boltsPerRow - 1) / 2) * (length / boltsPerRow);
      const b = boltGeo.clone();
      b.translate(thickness * 0.62, y, z);
      parts.push(b);
    }
  }
  return mergeGeometries(parts);
}

/** Convoy / blackout light cluster. */
function lightCluster(M, tint) {
  const g = new THREE.Group();
  const housing = solid(chamferBox(0.20, 0.17, 0.10, 0.02), M.hullDark);
  g.add(housing);
  const lens = solid(new THREE.CylinderGeometry(0.055, 0.055, 0.03, 12), tint);
  lens.rotation.x = Math.PI / 2;
  lens.position.set(-0.04, 0.02, 0.055);
  g.add(lens);
  const lens2 = solid(new THREE.CylinderGeometry(0.032, 0.032, 0.03, 10), M.steelDark);
  lens2.rotation.x = Math.PI / 2;
  lens2.position.set(0.05, -0.03, 0.055);
  g.add(lens2);
  // Brush guard.
  const guard = solid(new THREE.TorusGeometry(0.10, 0.008, 5, 10, Math.PI), M.steelDark);
  guard.position.z = 0.06;
  g.add(guard);
  return g;
}

/* ------------------------------------------------------------------------- */

/**
 * World-scale UVs. Every painted panel shares one camo sheet at this scale so
 * the pattern runs continuously across the vehicle instead of restarting on
 * each part.
 */
const UVS = 0.16;

export function buildHull() {
  const M = materials();
  const P = hullProfile();
  const group = new THREE.Group();
  group.name = 'hull';

  const upperWidth = H.widthHull;
  const lowerWidth = H.tubHalfWidth * 2;

  /* ------------------------------- main body ------------------------------- */
  group.add(solid(extrudeProfile(P.lower, lowerWidth, { uvScale: UVS }), M.hullDark));
  group.add(solid(extrudeProfile(P.upper, upperWidth, { uvScale: UVS }), M.hull));

  /* -------------------------------- belly V -------------------------------- */
  // Shallow V under the floor: two canted plates meeting on the centreline,
  // keel down, so a blast under the hull is deflected outboard.
  const bellyLen = P.floorFront[0] - P.rearBottom[0];
  for (const side of [-1, 1]) {
    const plate = solid(new THREE.BoxGeometry(H.tubHalfWidth * 1.02, 0.05, bellyLen), M.hullDark);
    plate.position.set(
      side * H.tubHalfWidth / 2,
      H.groundClear - H.bellyVee / 2,
      (P.floorFront[0] + P.rearBottom[0]) / 2,
    );
    plate.rotation.z = side * Math.atan(H.bellyVee / H.tubHalfWidth);
    group.add(plate);
  }

  /* -------------------- applique armour on the hull sides ------------------- */
  // Three discrete bolt-on modules per side with visible gaps between them —
  // the Lynx's whole protection concept is that these come off and go back on.
  const sideHeight = P.roof - P.spon - 0.16;
  const modules = [[2.30, 1.85], [0.32, 1.95], [-1.86, 1.90]];
  for (const side of [-1, 1]) {
    for (const [cz, len] of modules) {
      const geo = appliquePanel(len, sideHeight, H.sideModuleThickness, 2, Math.round(len * 3.5));
      const px = side * (upperWidth / 2 + H.sideModuleThickness / 2);
      const py = P.spon + sideHeight / 2 + 0.06;
      rescaleUV(geo, UVS, { x: px, y: py, z: cz });
      const panel = solid(geo, M.applique);
      panel.position.set(px, py, cz);
      panel.rotation.z = -side * H.sideModuleFlare;
      panel.scale.x = side;
      group.add(panel);
    }
  }

  /* ------------------------------- side skirts ------------------------------ */
  // Skirts hang from the sponson line down over the top half of the road
  // wheels — without them the running gear looks bare and the vehicle reads
  // far taller than it is.
  const skirtTopY = P.spon + 0.03;
  const skirtBottomY = DERIVED.wheelAxisY + 0.10;
  const skirtHeight = skirtTopY - skirtBottomY;
  const skirtX = DERIVED.trackHalfGauge + XM30.track.trackWidth / 2 + 0.06;
  const segZ = [[3.10, 1.30], [1.72, 1.36], [0.32, 1.36], [-1.10, 1.40], [-2.56, 1.44]];
  for (const side of [-1, 1]) {
    for (const [cz, len] of segZ) {
      const geo = chamferBox(0.075, skirtHeight, len, 0.02);
      const py = (skirtTopY + skirtBottomY) / 2;
      rescaleUV(geo, UVS, { x: side * skirtX, y: py, z: cz });
      const skirt = solid(geo, M.skirt);
      skirt.position.set(side * skirtX, py, cz);
      skirt.rotation.z = -side * 2.5 * DEG;
      group.add(skirt);
    }
    // Rubber mudguards front and rear, hanging off the ends of the skirt line.
    for (const [cz, len, tilt] of [[3.74, 0.52, -0.42], [-3.42, 0.50, 0.34]]) {
      const flap = solid(new THREE.BoxGeometry(0.46, 0.018, len), M.rubber);
      flap.position.set(side * DERIVED.trackHalfGauge, skirtBottomY - 0.12, cz);
      flap.rotation.x = tilt;
      group.add(flap);
    }
  }

  /* ------------------------------- engine deck ------------------------------ */
  // Powerpack sits front-right; the deck over it stands proud of the roof and
  // carries the intake and exhaust grilles.
  const deckZ0 = P.glacisTop[0] - 0.05;
  const deckLen = 1.62;
  const deck = solid(chamferBox(H.engineDeckWidth, H.engineDeckRise, deckLen, 0.03), M.hullPlain);
  // Powerpack is front-right, so the deck sits to starboard (-X).
  deck.position.set(
    -(upperWidth / 2 - H.engineDeckWidth / 2 - 0.04),
    P.roof + H.engineDeckRise / 2,
    deckZ0 - deckLen / 2,
  );
  group.add(deck);

  const intake = solid(grille(H.engineDeckWidth * 0.82, 0.66, 8), M.steelDark);
  intake.position.set(deck.position.x, P.roof + H.engineDeckRise, deckZ0 - 0.48);
  group.add(intake);

  const outlet = solid(grille(H.engineDeckWidth * 0.7, 0.5, 6), M.steelDark);
  outlet.position.set(deck.position.x, P.roof + H.engineDeckRise, deckZ0 - 1.24);
  group.add(outlet);

  // Exhaust outlet on the right side, below the deck.
  const exhaust = solid(tubeZ(0.11, 0.11, 0.34, 12), M.rust);
  exhaust.position.set(-(upperWidth / 2 + 0.04), P.roof - 0.36, deckZ0 - 1.5);
  exhaust.rotation.y = Math.PI / 2;
  group.add(exhaust);

  /* ------------------------------ driver station ---------------------------- */
  const hatchR = 0.31;
  const hatchRing = solid(new THREE.CylinderGeometry(hatchR + 0.04, hatchR + 0.04, 0.05, 20), M.hullDark);
  hatchRing.position.set(H.driverHatchX, P.roof + 0.025, H.driverHatchZ);
  group.add(hatchRing);

  const hatch = solid(new THREE.CylinderGeometry(hatchR, hatchR, 0.06, 20), M.hullPlain);
  hatch.position.set(H.driverHatchX, P.roof + 0.06, H.driverHatchZ);
  group.add(hatch);

  // Three periscopes forward of the hatch.
  for (let i = -1; i <= 1; i++) {
    const peri = solid(chamferBox(0.15, 0.075, 0.09, 0.012), M.steelDark);
    peri.position.set(H.driverHatchX + i * 0.20, P.roof + 0.055, H.driverHatchZ + 0.34);
    peri.rotation.y = i * 0.24;
    group.add(peri);
    const lens = solid(new THREE.BoxGeometry(0.115, 0.05, 0.012), M.optic);
    lens.position.set(
      H.driverHatchX + i * 0.20 + Math.sin(i * 0.24) * 0.045,
      P.roof + 0.055,
      H.driverHatchZ + 0.34 + 0.048,
    );
    lens.rotation.y = i * 0.24;
    group.add(lens);
  }

  /* -------------------------- troop compartment roof ------------------------ */
  // Two dismount hatches aft of the turret, plus a low stowage rack. Without
  // these the rear roof is a blank slab from every elevated view.
  for (const hx of [-0.62, 0.62]) {
    const ring = solid(new THREE.BoxGeometry(0.70, 0.05, 0.80), M.hullDark);
    ring.position.set(hx, P.roof + 0.025, -2.34);
    group.add(ring);
    const lid = solid(chamferBox(0.62, 0.06, 0.72, 0.02), M.hullPlain);
    lid.position.set(hx, P.roof + 0.065, -2.34);
    group.add(lid);
    const grab = solid(tubeX(0.012, 0.012, 0.24, 6), M.steel);
    grab.position.set(hx, P.roof + 0.115, -2.62);
    group.add(grab);
  }

  const rack = new THREE.Group();
  for (const rz of [-3.06, -3.46]) {
    const bar = solid(tubeX(0.016, 0.016, 2.3, 6), M.steel);
    bar.position.set(0, P.roof + 0.10, rz);
    rack.add(bar);
  }
  for (const rx of [-1.0, 0, 1.0]) {
    const post = solid(new THREE.BoxGeometry(0.04, 0.10, 0.46), M.steelDark);
    post.position.set(rx, P.roof + 0.05, -3.26);
    rack.add(post);
  }
  const tarp = solid(chamferBox(1.5, 0.24, 0.36, 0.05), M.canvasStow);
  tarp.position.set(-0.25, P.roof + 0.20, -3.26);
  rack.add(tarp);
  group.add(rack);

  // Spare track links bolted to the glacis — standard practice, and a strong
  // visual cue that this is a tracked vehicle when seen head on.
  for (let i = 0; i < 5; i++) {
    const link = solid(chamferBox(0.44, 0.06, 0.15, 0.012), M.steelDark);
    const t = i * 0.17;
    link.position.set(-0.30 + (i % 2) * 0.62, 1.52 + t * Math.sin(H.upperGlacisAngle) * 1.6, P.prow[0] - 0.30 - t * 0.55);
    link.rotation.x = H.upperGlacisAngle - Math.PI / 2;
    group.add(link);
  }

  /* --------------------------------- rear ramp ------------------------------ */
  const rampZ = P.rearBottom[0] + 0.03;
  const rampTilt = H.rearRake;
  const ramp = solid(chamferBox(H.rampWidth, H.rampHeight, 0.10, 0.02), M.hullDark);
  ramp.position.set(0, H.groundClear + H.rampHeight / 2, rampZ - 0.02);
  ramp.rotation.x = -rampTilt;
  group.add(ramp);

  // Personnel door set into the ramp, plus its handle and vision block.
  const door = solid(chamferBox(0.62, 1.34, 0.06, 0.02), M.hullPlain);
  door.position.set(0.36, H.groundClear + 0.72, rampZ - 0.08);
  door.rotation.x = -rampTilt;
  group.add(door);

  const vision = solid(new THREE.BoxGeometry(0.20, 0.11, 0.02), M.optic);
  vision.position.set(0.36, H.groundClear + 1.16, rampZ - 0.12);
  group.add(vision);

  const handle = solid(tubeX(0.016, 0.016, 0.18, 8), M.steel);
  handle.position.set(0.06, H.groundClear + 0.74, rampZ - 0.13);
  group.add(handle);

  // Tail light clusters.
  for (const side of [-1, 1]) {
    const tl = lightCluster(M, M.steelDark);
    tl.position.set(side * (upperWidth / 2 - 0.22), P.roof - 0.30, rampZ - 0.12);
    tl.rotation.y = Math.PI;
    group.add(tl);
  }

  // Towing shackles.
  for (const side of [-1, 1]) {
    const sh = solid(new THREE.TorusGeometry(0.075, 0.018, 6, 10), M.steel);
    sh.position.set(side * 0.72, H.groundClear + 0.16, rampZ - 0.14);
    sh.rotation.y = Math.PI / 2;
    group.add(sh);
    const shf = sh.clone();
    shf.position.set(side * 0.62, H.groundClear + 0.20, P.floorFront[0] + 0.16);
    group.add(shf);
  }

  /* ------------------------------- front fittings --------------------------- */
  for (const side of [-1, 1]) {
    const hl = lightCluster(M, M.lamp);
    hl.position.set(side * (upperWidth / 2 - 0.30), 1.62, P.prow[0] - 0.24);
    hl.rotation.x = -H.upperGlacisAngle * 0.35;
    group.add(hl);
  }

  // Trim vane / splash guard along the glacis join.
  const splash = solid(new THREE.BoxGeometry(upperWidth * 0.92, 0.04, 0.22), M.hullDark);
  splash.position.set(0, P.prow[1] + 0.02, P.prow[0] - 0.10);
  splash.rotation.x = 0.5;
  group.add(splash);

  /* --------------------------------- stowage -------------------------------- */
  const bin = solid(chamferBox(0.16, 0.44, 1.15, 0.02), M.hullPlain);
  bin.position.set(-(upperWidth / 2 + 0.19), P.spon + 0.38, -2.15);
  group.add(bin);

  const roll = solid(tubeZ(0.15, 0.15, 0.9, 10), M.canvasStow);
  roll.position.set(upperWidth / 2 + 0.20, P.spon + 0.36, -2.3);
  group.add(roll);

  const spare = solid(chamferBox(0.14, 0.36, 0.62, 0.02), M.hullPlain);
  spare.position.set(upperWidth / 2 + 0.19, P.spon + 0.38, -1.0);
  group.add(spare);

  /* ------------------------------- turret collar ---------------------------- */
  const collar = solid(
    new THREE.CylinderGeometry(XM30.turret.ringRadius + 0.05, XM30.turret.ringRadius + 0.09,
                               XM30.turret.basketHeight, 32),
    M.hullDark,
  );
  collar.position.set(0, P.roof + XM30.turret.basketHeight / 2, XM30.turret.ringZ);
  group.add(collar);

  // Grab rails around the turret ring — small, but they sell the scale.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    const rail = solid(tubeX(0.014, 0.014, 0.34, 6), M.steel);
    rail.position.set(
      Math.sin(a) * (XM30.turret.ringRadius + 0.42),
      P.roof + 0.05,
      XM30.turret.ringZ + Math.cos(a) * (XM30.turret.ringRadius + 0.42),
    );
    rail.rotation.y = a;
    group.add(rail);
  }

  // Nothing on the hull articulates, so it batches down to one mesh per paint.
  mergeGroupByMaterial(group);

  group.userData.profile = P;
  return group;
}

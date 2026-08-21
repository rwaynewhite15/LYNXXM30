/**
 * The XM30 turret — a two-man, faceted turret in the Lance 2.0 lineage,
 * re-armed with the 50 mm XM913.
 *
 * Built by lofting a base plan outline to an inset roof outline, which is how
 * a welded faceted turret actually goes together and gives the correct
 * converging cheeks and sloped sides in one pass.
 */

import * as THREE from 'three';
import { XM30, DERIVED, DEG } from '../spec/xm30.js';
import { materials } from './materials.js';
import { chamferBox, tubeZ, tubeX, solid, mergeGeometries, rescaleUV, mergeGroupByMaterial } from './geo.js';

const TU = XM30.turret;
const G = XM30.mainGun;

/**
 * Lofts a plan outline at y0 to a second outline at y1.
 * Both arrays must have the same length and the same winding.
 */
function loftPlan(base, roof, y0, y1, { cap = true } = {}) {
  const n = base.length;
  const pos = [], idx = [];
  const push = (x, y, z) => { pos.push(x, y, z); return pos.length / 3 - 1; };

  // Side walls.
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = push(base[i][0], y0, base[i][1]);
    const b = push(base[j][0], y0, base[j][1]);
    const c = push(roof[j][0], y1, roof[j][1]);
    const d = push(roof[i][0], y1, roof[i][1]);
    idx.push(a, b, c, a, c, d);
  }

  if (cap) {
    // Roof, fanned from the centroid so concave-ish outlines still tessellate.
    let cx = 0, cz = 0;
    for (const p of roof) { cx += p[0]; cz += p[1]; }
    cx /= n; cz /= n;
    const centre = push(cx, y1, cz);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = push(roof[i][0], y1, roof[i][1]);
      const b = push(roof[j][0], y1, roof[j][1]);
      idx.push(centre, a, b);
    }
    // Floor.
    let bx = 0, bz = 0;
    for (const p of base) { bx += p[0]; bz += p[1]; }
    bx /= n; bz /= n;
    const bc = push(bx, y0, bz);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = push(base[i][0], y0, base[i][1]);
      const b = push(base[j][0], y0, base[j][1]);
      idx.push(bc, b, a);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  rescaleUV(geo, 0.16);
  return geo;
}

/** Base and roof plan outlines, derived from the spec. */
export function turretPlan() {
  const hw = TU.width / 2;
  const bw = TU.bustleWidth / 2;
  const frontZ = TU.length - TU.bustleLength - 0.55;   // front face, ahead of the ring
  const shoulderZ = frontZ - TU.frontWedge;
  const sideRearZ = -0.49;
  const bustleZ = -TU.bustleLength - 0.49;
  const faceHalf = hw - TU.frontWedge * Math.tan(TU.cheekAngle);

  const base = [
    [ faceHalf,  frontZ],
    [ hw,        shoulderZ],
    [ hw,        sideRearZ],
    [ bw,        sideRearZ - 0.06],
    [ bw,        bustleZ],
    [-bw,        bustleZ],
    [-bw,        sideRearZ - 0.06],
    [-hw,        sideRearZ],
    [-hw,        shoulderZ],
    [-faceHalf,  frontZ],
  ];

  // Roof outline: front plate leans back hard, sides only slightly.
  const dFront = TU.height * Math.tan(TU.faceAngle);
  const dSide = TU.height * Math.tan(9 * DEG);
  const dBustle = TU.height * Math.tan(5 * DEG);

  const roof = [
    [ faceHalf - dSide * 0.6,  frontZ - dFront],
    [ hw - dSide,              shoulderZ - dFront * 0.35],
    [ hw - dSide,              sideRearZ],
    [ bw - dBustle,            sideRearZ - 0.06],
    [ bw - dBustle,            bustleZ + dBustle],
    [-bw + dBustle,            bustleZ + dBustle],
    [-bw + dBustle,            sideRearZ - 0.06],
    [-hw + dSide,              sideRearZ],
    [-hw + dSide,              shoulderZ - dFront * 0.35],
    [-faceHalf + dSide * 0.6,  frontZ - dFront],
  ];

  return { base, roof, frontZ, shoulderZ, bustleZ, faceHalf };
}

/* ------------------------------------------------------------------------- */

/** 50 mm XM913: breech shroud, thermal sleeve, tapering tube, muzzle. */
function buildGun(M) {
  const g = new THREE.Group();
  g.name = 'gun';

  // Mantlet — the armoured shield the tube passes through.
  const mantlet = solid(chamferBox(0.86, 0.62, 0.42, 0.06), M.hullDark);
  mantlet.position.z = 0.08;
  g.add(mantlet);

  const rotor = solid(new THREE.CylinderGeometry(0.24, 0.26, 0.30, 16), M.steelDark);
  rotor.rotation.x = Math.PI / 2;
  rotor.position.z = 0.26;
  g.add(rotor);

  // Thermal sleeve over the first ~45 % of the exposed tube.
  const sleeveLen = G.barrelLength * 0.45;
  const sleeve = solid(tubeZ(0.088, 0.095, sleeveLen, 16), M.gunSteel);
  sleeve.position.z = 0.32 + sleeveLen / 2;
  g.add(sleeve);

  // Sleeve retaining bands.
  for (let i = 0; i < 3; i++) {
    const band = solid(tubeZ(0.100, 0.100, 0.035, 14), M.steelDark);
    band.position.z = 0.42 + (i / 2) * (sleeveLen - 0.25);
    g.add(band);
  }

  // Bare tube, tapering toward the muzzle.
  const tubeLen = G.barrelLength - sleeveLen;
  const tube = solid(tubeZ(0.062, 0.082, tubeLen, 16), M.gunSteel);
  tube.position.z = 0.32 + sleeveLen + tubeLen / 2;
  g.add(tube);

  // Muzzle: a short thickened section with the bore visible.
  const muzzle = solid(tubeZ(0.072, 0.072, 0.16, 16), M.steelDark);
  muzzle.position.z = 0.32 + G.barrelLength - 0.08;
  g.add(muzzle);

  const bore = solid(tubeZ(G.calibre / 2, G.calibre / 2, 0.05, 12), M.optic);
  bore.position.z = 0.32 + G.barrelLength - 0.02;
  g.add(bore);

  // Coaxial machine gun, port to the left of the main tube.
  const coaxPort = solid(chamferBox(0.16, 0.16, 0.30, 0.02), M.hullDark);
  coaxPort.position.set(XM30.coax.offset.x, XM30.coax.offset.y, 0.22);
  g.add(coaxPort);
  const coaxTube = solid(tubeZ(0.026, 0.030, 0.62, 10), M.steelDark);
  coaxTube.position.set(XM30.coax.offset.x, XM30.coax.offset.y, 0.62);
  g.add(coaxTube);

  g.userData.muzzleZ = 0.32 + G.barrelLength;
  g.userData.coaxMuzzle = new THREE.Vector3(XM30.coax.offset.x, XM30.coax.offset.y, 0.93);
  return g;
}

/** Armoured electro-optical sight head with a hinged front shutter. */
function buildSightHead(M, { w, h, d, window: winW = 0.22 }) {
  const g = new THREE.Group();
  const body = solid(chamferBox(w, h, d, 0.02), M.hullDark);
  g.add(body);

  // Two apertures: day/TV channel and the thermal channel.
  const dayLens = solid(new THREE.CylinderGeometry(winW * 0.42, winW * 0.42, 0.02, 16), M.optic);
  dayLens.rotation.x = Math.PI / 2;
  dayLens.position.set(-w * 0.19, h * 0.06, d / 2 + 0.011);
  g.add(dayLens);

  const irWindow = solid(new THREE.BoxGeometry(winW * 0.72, winW * 0.58, 0.02), M.opticGold);
  irWindow.position.set(w * 0.21, h * 0.04, d / 2 + 0.011);
  g.add(irWindow);

  // Laser range-finder aperture.
  const lrf = solid(new THREE.CylinderGeometry(0.028, 0.028, 0.02, 10), M.optic);
  lrf.rotation.x = Math.PI / 2;
  lrf.position.set(-w * 0.19, -h * 0.28, d / 2 + 0.011);
  g.add(lrf);

  // Armoured shutter, hinged along the top edge of the aperture and standing
  // open. Modelled on a pivot so it reads as attached rather than floating.
  const hinge = new THREE.Group();
  hinge.position.set(0, h / 2, d / 2);
  hinge.rotation.x = -0.95;
  const shutter = solid(chamferBox(w * 0.98, 0.035, h * 0.92, 0.012), M.hullPlain);
  shutter.position.set(0, 0, h * 0.46);
  hinge.add(shutter);
  g.add(hinge);

  return g;
}

/** Multi-barrel smoke grenade discharger bank. */
function buildSmokeBank(M) {
  const g = new THREE.Group();
  const S = XM30.smoke;
  const base = solid(chamferBox(0.34, 0.07, 0.20, 0.015), M.hullDark);
  g.add(base);
  for (let i = 0; i < S.tubesPerBank; i++) {
    const t = i - (S.tubesPerBank - 1) / 2;
    const tube = solid(tubeZ(S.tubeRadius, S.tubeRadius, S.tubeLength, 10), M.steelDark);
    tube.position.set(t * 0.088, 0.05 + Math.sin(S.elevation) * S.tubeLength / 2, Math.cos(S.elevation) * S.tubeLength / 2);
    tube.rotation.x = -S.elevation;
    tube.rotation.y = t * S.splay;
    g.add(tube);
  }
  return g;
}

/* ------------------------------------------------------------------------- */

export function buildTurret() {
  const M = materials();
  const plan = turretPlan();
  const root = new THREE.Group();
  root.name = 'turret';
  root.position.set(0, DERIVED.ringY + TU.basketHeight, TU.ringZ);

  /* -------------------------------- shell ---------------------------------- */
  const shell = solid(loftPlan(plan.base, plan.roof, 0, TU.height), M.hull);
  root.add(shell);

  // Applique / APS modules on the cheeks. The XM30 offering carries an active
  // protection system; its sensor-and-launcher modules sit on the turret sides.
  for (const side of [-1, 1]) {
    const apsGeo = chamferBox(0.10, 0.40, 0.86, 0.02);
    const apsPos = { x: side * (TU.width / 2 - 0.02), y: TU.height * 0.52, z: plan.shoulderZ - 0.42 };
    rescaleUV(apsGeo, 0.16, apsPos);
    const aps = solid(apsGeo, M.applique);
    aps.position.set(apsPos.x, apsPos.y, apsPos.z);
    aps.rotation.y = side * 6 * DEG;
    root.add(aps);

    // Radar/sensor face for the APS, canted outboard.
    const sensor = solid(chamferBox(0.03, 0.20, 0.24, 0.01), M.optic);
    sensor.position.set(side * (TU.width / 2 + 0.05), TU.height * 0.62, plan.shoulderZ - 0.05);
    sensor.rotation.y = side * 26 * DEG;
    root.add(sensor);
  }

  /* ---------------------------------- gun ---------------------------------- */
  const gunMount = new THREE.Group();
  gunMount.name = 'gunMount';
  gunMount.position.set(0, TU.trunnionY, TU.trunnionZ);
  const gun = buildGun(M);
  gunMount.add(gun);
  root.add(gunMount);

  // Recoil is applied to this node so the tube slides in the mantlet.
  const recoilNode = gun;

  /* ------------------------------ gunner sight ----------------------------- */
  // Forward-right on the roof, boresighted with the gun. The head is fixed;
  // an internal mirror (modelled as the tilting front block) is slaved to the
  // gun's elevation, which is what the camera rides on.
  const gs = XM30.sights.gunner.mount;
  const gunnerSight = new THREE.Group();
  gunnerSight.position.set(gs.x, TU.height, gs.z);
  const gunnerHead = buildSightHead(M, { w: 0.46, h: 0.34, d: 0.40, window: 0.24 });
  gunnerHead.position.y = 0.17;
  gunnerSight.add(gunnerHead);
  root.add(gunnerSight);

  // Camera anchor, tilting with the gun.
  const gunnerEye = new THREE.Object3D();
  gunnerEye.position.set(gs.x, TU.height + 0.17, gs.z + 0.20);
  root.add(gunnerEye);

  /* ---------------------------- commander sight ---------------------------- */
  // Panoramic head on a pedestal, up and to the left so it clears the gun.
  const cs = XM30.sights.commander.mount;
  const pedestal = solid(new THREE.CylinderGeometry(0.15, 0.18, cs.y - TU.height + 0.18, 14), M.hullDark);
  pedestal.position.set(cs.x, TU.height + (cs.y - TU.height + 0.18) / 2, cs.z);
  root.add(pedestal);

  // Yawing head — traverses independently of the turret.
  const cmdHead = new THREE.Group();
  cmdHead.name = 'commanderHead';
  cmdHead.position.set(cs.x, cs.y + 0.16, cs.z);
  const cmdBody = buildSightHead(M, { w: 0.40, h: 0.32, d: 0.34, window: 0.20 });
  cmdHead.add(cmdBody);
  // A small sunshade over the windows sells it as a panoramic head.
  const shade = solid(new THREE.BoxGeometry(0.44, 0.02, 0.14), M.hullDark);
  shade.position.set(0, 0.17, 0.20);
  cmdHead.add(shade);
  root.add(cmdHead);

  const cmdEye = new THREE.Object3D();
  cmdEye.position.set(0, 0.02, 0.18);
  cmdHead.add(cmdEye);

  /* --------------------------------- hatches -------------------------------- */
  for (const [hx, hz] of [[-0.42, -0.30], [0.46, -0.30]]) {
    const ring = solid(new THREE.CylinderGeometry(0.30, 0.30, 0.05, 20), M.hullDark);
    ring.position.set(hx, TU.height + 0.02, hz);
    root.add(ring);
    const lid = solid(new THREE.CylinderGeometry(0.27, 0.27, 0.055, 20), M.hullPlain);
    lid.position.set(hx, TU.height + 0.06, hz);
    root.add(lid);
    const grab = solid(tubeX(0.012, 0.012, 0.22, 6), M.steel);
    grab.position.set(hx, TU.height + 0.11, hz - 0.14);
    root.add(grab);
  }

  /* ---------------------------- smoke dischargers --------------------------- */
  for (const side of [-1, 1]) {
    const bank = buildSmokeBank(M);
    bank.position.set(side * (TU.width / 2 - 0.14), TU.height * 0.74, plan.shoulderZ - 0.02);
    bank.rotation.y = side * 26 * DEG;
    root.add(bank);
  }

  /* ------------------------------- ATGM launcher ---------------------------- */
  const atgm = new THREE.Group();
  atgm.name = 'atgm';
  const pod = solid(chamferBox(0.30, 0.44, 1.30, 0.03), M.hullDark);
  atgm.add(pod);
  for (let i = 0; i < XM30.atgm.tubes; i++) {
    const cap = solid(tubeZ(0.13, 0.13, 0.06, 14), M.steelDark);
    cap.position.set(0, (i - 0.5) * 0.21, 0.66);
    atgm.add(cap);
  }
  atgm.position.set(XM30.atgm.side * (TU.width / 2 + 0.16), TU.height * 0.56, -0.55);
  atgm.rotation.y = XM30.atgm.side * -4 * DEG;
  root.add(atgm);

  /* --------------------------------- bustle --------------------------------- */
  // Open stowage basket: a frame of rails rather than a solid box.
  const basket = new THREE.Group();
  const bw = TU.bustleWidth / 2 + 0.10;
  const bz0 = plan.bustleZ - 0.02, bz1 = -0.55;
  const railGeo = tubeZ(0.014, 0.014, bz1 - bz0, 6);
  for (const side of [-1, 1]) {
    for (const y of [0.10, 0.34]) {
      const rail = solid(railGeo, M.steel);
      rail.position.set(side * bw, y, (bz0 + bz1) / 2);
      basket.add(rail);
    }
    const post = solid(tubeX(0.014, 0.014, 0.30, 6), M.steel);
    post.rotation.z = Math.PI / 2;
    post.position.set(side * bw, 0.22, bz0 + 0.06);
    basket.add(post);
  }
  const backRail = solid(tubeX(0.014, 0.014, bw * 2, 6), M.steel);
  backRail.position.set(0, 0.34, bz0);
  basket.add(backRail);
  // Kit in the basket.
  const kit = solid(chamferBox(1.0, 0.26, 0.5, 0.04), M.canvasStow);
  kit.position.set(-0.2, 0.24, bz0 + 0.34);
  basket.add(kit);
  const cans = solid(chamferBox(0.34, 0.30, 0.20, 0.02), M.hullDark);
  cans.position.set(0.62, 0.26, bz0 + 0.30);
  basket.add(cans);
  basket.position.y = TU.height * 0.30;
  root.add(basket);

  /* -------------------------------- antennas -------------------------------- */
  for (const [ax, az] of [[-0.74, -1.18], [0.74, -1.18]]) {
    const mountBase = solid(new THREE.CylinderGeometry(0.05, 0.06, 0.10, 8), M.hullDark);
    mountBase.position.set(ax, TU.height + 0.05, az);
    root.add(mountBase);
    const whip = solid(new THREE.CylinderGeometry(0.006, 0.014, 1.9, 6), M.steelDark);
    whip.position.set(ax + 0.06, TU.height + 1.0, az - 0.05);
    whip.rotation.z = -0.06;
    whip.rotation.x = 0.05;
    whip.castShadow = false;
    // Kept out of the batching pass so it keeps its own userData — otherwise
    // the aerials get merged into a shared mesh and start counting toward the
    // vehicle's measured height.
    whip.userData.excludeFromEnvelope = true;
    whip.userData.noMerge = true;
    root.add(whip);
  }

  /* ------------------------------ bustle rear ------------------------------- */
  // Ammunition resupply hatch and grab handles on the back plate — the face a
  // third-person camera spends most of its time looking at.
  const bz = plan.bustleZ - 0.01;
  const resupply = solid(chamferBox(0.72, 0.46, 0.05, 0.02), M.hullPlain);
  resupply.position.set(-0.18, TU.height * 0.52, bz);
  root.add(resupply);
  const latch = solid(tubeX(0.014, 0.014, 0.16, 6), M.steel);
  latch.position.set(0.10, TU.height * 0.52, bz - 0.05);
  root.add(latch);
  for (const gy of [TU.height * 0.22, TU.height * 0.80]) {
    const handle = solid(tubeX(0.013, 0.013, 0.26, 6), M.steel);
    handle.position.set(0.52, gy, bz - 0.05);
    root.add(handle);
  }
  // Bustle-mounted spare optics/stowage bin, offset to the right.
  const rearBin = solid(chamferBox(0.42, 0.34, 0.20, 0.02), M.hullPlain);
  rearBin.position.set(-0.62, TU.height * 0.14, bz - 0.09);
  root.add(rearBin);

  // Crosswind sensor on the bustle roof — a real fire-control input, and a
  // recognisable silhouette cue.
  const windMast = solid(new THREE.CylinderGeometry(0.012, 0.012, 0.34, 6), M.steel);
  windMast.position.set(0, TU.height + 0.17, plan.bustleZ + 0.24);
  root.add(windMast);
  const windHead = solid(new THREE.SphereGeometry(0.05, 8, 6), M.steelDark);
  windHead.position.set(0, TU.height + 0.36, plan.bustleZ + 0.24);
  root.add(windHead);

  // Everything bolted to the turret shell can batch; the gun, the commander's
  // head and the sight anchors move independently and must not.
  gunMount.userData.noMerge = true;
  cmdHead.userData.noMerge = true;
  gunnerEye.userData.noMerge = true;
  mergeGroupByMaterial(root);

  root.userData = {
    plan,
    gunMount,
    gun,
    recoilNode,
    gunnerSight,
    gunnerEye,
    cmdHead,
    cmdEye,
    atgm,
    /** Muzzle position in gunMount space, for spawning tracers. */
    muzzleLocal: new THREE.Vector3(0, 0, gun.userData.muzzleZ),
    coaxLocal: gun.userData.coaxMuzzle.clone(),
  };
  return root;
}

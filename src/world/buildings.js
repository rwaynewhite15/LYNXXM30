/**
 * Procedural roadside buildings.
 *
 * Buildings exist to hold targets, so the important output isn't the geometry
 * — it's the list of firing positions each building offers: window slots and
 * rooftop slots, in local space, ready to be transformed when the building is
 * placed. Windows are modelled as real recesses with a dark interior so a
 * figure standing in one is legible against the shadow at 400 m.
 */

import * as THREE from 'three';
import { materials } from '../model/materials.js';
import { chamferBox, solid, rescaleUV, mergeGroupByMaterial } from '../model/geo.js';

const FLOOR_H = 3.25;
const WINDOW_W = 1.25;
const WINDOW_H = 1.55;
const WINDOW_RECESS = 0.72;   // deep enough for a figure to stand inside
const PARAPET_H = 1.05;
const BALCONY_DEPTH = 1.35;
const BALCONY_RAIL_H = 1.02;

let rngState = 0x2f6e2b1;
function rnd() {
  rngState ^= rngState << 13; rngState >>>= 0;
  rngState ^= rngState >> 17;
  rngState ^= rngState << 5; rngState >>>= 0;
  return rngState / 4294967296;
}
function rangeR(a, b) { return a + rnd() * (b - a); }
function pick(arr) { return arr[Math.floor(rnd() * arr.length) % arr.length]; }

/** Deterministic prototypes so a seed reproduces the same street. */
export function seedBuildings(seed) { rngState = (seed >>> 0) || 1; }

/**
 * One window: a recessed dark cavity, a sill and a frame. Returns the geometry
 * pieces plus the slot a shooter would occupy.
 */
function addWindow(target, M, x, y, depth, w = WINDOW_W, h = WINDOW_H) {
  // Cavity — five faces of a box, open toward the street.
  const cavity = new THREE.Group();
  const back = solid(new THREE.PlaneGeometry(w, h), M.interior, { cast: false });
  back.position.set(x, y, depth - WINDOW_RECESS);
  target.add(back);

  // Reveals. Each must face INBOARD or back-face culling eats it, which is
  // what makes an unfixed recess look like a flat black sticker on the wall.
  const sideGeo = new THREE.PlaneGeometry(WINDOW_RECESS, h);
  for (const s of [-1, 1]) {
    const side = solid(sideGeo, M.interior, { cast: false });
    side.position.set(x + s * w / 2, y, depth - WINDOW_RECESS / 2);
    side.rotation.y = -s * Math.PI / 2;
    target.add(side);
  }
  const capGeo = new THREE.PlaneGeometry(w, WINDOW_RECESS);
  for (const s of [-1, 1]) {
    const cap = solid(capGeo, M.interior, { cast: false });
    cap.position.set(x, y + s * h / 2, depth - WINDOW_RECESS / 2);
    cap.rotation.x = s * Math.PI / 2;
    target.add(cap);
  }

  // A recessed frame around the opening: at 400 m this dark outline is what
  // makes a window read as a window rather than a smudge.
  const frameT = 0.10;
  for (const [fw, fh, fx, fy] of [
    [w + 0.16, frameT, 0, h / 2 + frameT / 2],
    [w + 0.16, frameT, 0, -h / 2 - frameT / 2],
    [frameT, h + 0.16, -w / 2 - frameT / 2, 0],
    [frameT, h + 0.16, w / 2 + frameT / 2, 0],
  ]) {
    const bar = solid(new THREE.BoxGeometry(fw, fh, 0.09), M.wreck, { cast: false });
    bar.position.set(x + fx, y + fy, depth + 0.02);
    target.add(bar);
  }

  // Concrete sill, proud of the wall.
  const sill = solid(new THREE.BoxGeometry(w + 0.24, 0.08, 0.18), M.concreteB, { cast: true });
  sill.position.set(x, y - h / 2 - 0.04, depth + 0.06);
  target.add(sill);

  // Lintel.
  const lintel = solid(new THREE.BoxGeometry(w + 0.24, 0.10, 0.12), M.concreteB, { cast: true });
  lintel.position.set(x, y + h / 2 + 0.05, depth + 0.03);
  target.add(lintel);

  return {
    // A figure standing in the opening, right at the plane of the wall. Set
    // them further back and the reveal hides them from every angle except
    // dead abeam, which on a straight road means they are never engageable.
    position: new THREE.Vector3(x, y - h / 2, depth - 0.12),
    kind: 'window',
    width: w, height: h,
  };
}

/**
 * A balcony off a window.
 *
 * This is the fix for the geometry of a straight street: a shooter standing
 * in a window opening is masked by their own reveal at anything but a beam
 * angle, so from a vehicle driving past they are only visible for a moment. A
 * balcony puts the figure OUTSIDE the wall plane, where it can be seen —
 * and engaged — from hundreds of metres down the road.
 */
function addBalcony(target, M, x, y, depth, w) {
  const bw = w + 1.05;
  const slab = solid(new THREE.BoxGeometry(bw, 0.14, BALCONY_DEPTH), M.concreteB);
  slab.position.set(x, y - 0.06, depth + BALCONY_DEPTH / 2);
  target.add(slab);

  // Solid lower panel plus a top rail: reads as a balcony at range, and gives
  // the figure something to be partially hidden behind up close.
  const panelH = BALCONY_RAIL_H * 0.62;
  const front = solid(new THREE.BoxGeometry(bw, panelH, 0.09), M.concreteA);
  front.position.set(x, y + panelH / 2, depth + BALCONY_DEPTH);
  target.add(front);
  for (const s of [-1, 1]) {
    const side = solid(new THREE.BoxGeometry(0.09, panelH, BALCONY_DEPTH), M.concreteA);
    side.position.set(x + s * bw / 2, y + panelH / 2, depth + BALCONY_DEPTH / 2);
    target.add(side);
  }
  const rail = solid(new THREE.BoxGeometry(bw, 0.05, 0.05), M.steelDark);
  rail.position.set(x, y + BALCONY_RAIL_H, depth + BALCONY_DEPTH);
  target.add(rail);
  for (const s of [-1, 1]) {
    const post = solid(new THREE.BoxGeometry(0.05, BALCONY_RAIL_H - panelH, 0.05), M.steelDark);
    post.position.set(x + s * bw / 2, y + (BALCONY_RAIL_H + panelH) / 2, depth + BALCONY_DEPTH);
    target.add(post);
  }

  return {
    position: new THREE.Vector3(x, y, depth + BALCONY_DEPTH * 0.55),
    kind: 'balcony',
    // The lower panel is partial cover, not concealment — a figure crouching
    // behind a balcony rail is still very much visible from the street.
    cover: panelH * 0.7,
    width: bw, height: 1.8,
  };
}

/** Roof furniture — gives rooftop shooters something to appear from behind. */
function addRoofClutter(target, M, w, d, topY) {
  const slots = [];

  // Stairwell head house.
  if (rnd() > 0.35) {
    const sw = rangeR(1.8, 2.8), sd = rangeR(1.8, 2.6), sh = rangeR(2.0, 2.6);
    const box = solid(chamferBox(sw, sh, sd, 0.04), M.concreteB);
    const sx = rangeR(-w / 2 + sw, w / 2 - sw) * 0.6;
    const sz = rangeR(-d / 2 + sd, d / 2 - sd) * 0.6;
    box.position.set(sx, topY + sh / 2, sz);
    target.add(box);
    slots.push(new THREE.Vector3(sx, topY, sz + sd / 2 + 0.6));
  }

  // Water tank on a frame.
  if (rnd() > 0.5) {
    const r = rangeR(0.7, 1.1);
    const tank = solid(new THREE.CylinderGeometry(r, r, rangeR(1.2, 1.8), 12), M.rust);
    const tx = rangeR(-w / 2 + 2, w / 2 - 2);
    const tz = rangeR(-d / 2 + 2, d / 2 - 2);
    tank.position.set(tx, topY + 1.9, tz);
    target.add(tank);
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const leg = solid(new THREE.BoxGeometry(0.1, 1.1, 0.1), M.steelDark);
      leg.position.set(tx + lx * r * 0.7, topY + 0.55, tz + lz * r * 0.7);
      target.add(leg);
    }
  }

  // Air-handling units.
  const units = Math.floor(rangeR(0, 3));
  for (let i = 0; i < units; i++) {
    const uw = rangeR(0.9, 1.6);
    const unit = solid(chamferBox(uw, rangeR(0.5, 0.9), uw * rangeR(0.7, 1.2), 0.03), M.steelDark);
    unit.position.set(rangeR(-w / 2 + 1.5, w / 2 - 1.5), topY + 0.35, rangeR(-d / 2 + 1.5, d / 2 - 1.5));
    target.add(unit);
  }

  return slots;
}

/**
 * Builds one building prototype.
 * @returns {{group:THREE.Group, windows:Array, roof:Array, size:THREE.Vector3}}
 */
export function makeBuilding(opts = {}) {
  const M = materials();
  const floors = opts.floors ?? Math.floor(rangeR(2, 6));
  const w = opts.width ?? rangeR(9, 19);
  const d = opts.depth ?? rangeR(8, 15);
  const h = floors * FLOOR_H;
  const facadeMat = pick([M.concreteA, M.concreteB, M.brick, M.concreteA]);

  const group = new THREE.Group();
  const windows = [];

  /* --------------------------------- shell --------------------------------- */
  // Four walls as slabs rather than one box, so the street facade can carry
  // recesses without cutting holes in a solid.
  const t = 0.35;
  // Brick needs a much finer UV scale than cast concrete or the courses come
  // out a metre tall.
  const uvScale = facadeMat === M.brick ? 0.62 : 0.22;
  const wallGeo = new THREE.BoxGeometry(w, h, t);
  rescaleUV(wallGeo, uvScale);
  const front = solid(wallGeo, facadeMat);
  front.position.set(0, h / 2, 0);
  group.add(front);

  const back = solid(wallGeo, facadeMat);
  back.position.set(0, h / 2, -d);
  group.add(back);

  const sideGeo = new THREE.BoxGeometry(t, h, d);
  rescaleUV(sideGeo, uvScale);
  for (const s of [-1, 1]) {
    const side = solid(sideGeo, facadeMat);
    side.position.set(s * (w / 2 - t / 2), h / 2, -d / 2);
    group.add(side);
  }

  const slab = solid(new THREE.BoxGeometry(w, 0.3, d), M.concreteB);
  slab.position.set(0, h + 0.15, -d / 2);
  group.add(slab);

  /* -------------------------------- windows -------------------------------- */
  const cols = Math.max(2, Math.floor((w - 1.6) / (WINDOW_W + 1.15)));
  const colPitch = (w - 2.2) / (cols - 1 || 1);
  const balconies = [];

  for (let f = 0; f < floors; f++) {
    const y = f * FLOOR_H + FLOOR_H * 0.62;
    // Balconies come in runs on a floor, the way they do on a real block.
    const balconyFloor = f > 0 && rnd() < 0.42;
    for (let c = 0; c < cols; c++) {
      const x = -(w - 2.2) / 2 + c * colPitch;
      // Ground floor of a shopfront style gets one wide opening instead.
      if (f === 0 && opts.shopfront && c % 2 === 0) continue;
      // A few windows are bricked up or shuttered — visual variety, and it
      // stops the player from assuming every opening is a firing position.
      if (rnd() < 0.10) {
        const boarded = solid(new THREE.BoxGeometry(WINDOW_W, WINDOW_H, 0.08), M.wreck);
        boarded.position.set(x, y, t / 2 + 0.02);
        group.add(boarded);
        continue;
      }
      const slot = addWindow(group, M, x, y, t / 2, WINDOW_W, WINDOW_H);
      // Only every other bay gets a balcony, so they don't merge into a ledge.
      if (balconyFloor && c % 2 === 1) {
        balconies.push(addBalcony(group, M, x, y - WINDOW_H / 2, t / 2, WINDOW_W));
      } else {
        windows.push(slot);
      }
    }
  }

  // Ground-floor entrance.
  const doorW = 1.5, doorH = 2.4;
  const doorX = rangeR(-w / 4, w / 4);
  const door = solid(new THREE.BoxGeometry(doorW, doorH, 0.1), M.wreck);
  door.position.set(doorX, doorH / 2, t / 2 + 0.03);
  group.add(door);

  /* -------------------------------- parapet -------------------------------- */
  const roofSlots = [];
  const pTop = h + 0.3;
  const parapetGeoLR = new THREE.BoxGeometry(0.30, PARAPET_H, d);
  const parapetGeoFB = new THREE.BoxGeometry(w, PARAPET_H, 0.30);
  const pf = solid(parapetGeoFB, M.concreteB);
  pf.position.set(0, pTop + PARAPET_H / 2, -0.15);
  group.add(pf);
  const pb = solid(parapetGeoFB, M.concreteB);
  pb.position.set(0, pTop + PARAPET_H / 2, -d + 0.15);
  group.add(pb);
  for (const s of [-1, 1]) {
    const p = solid(parapetGeoLR, M.concreteB);
    p.position.set(s * (w / 2 - 0.15), pTop + PARAPET_H / 2, -d / 2);
    group.add(p);
  }

  // Firing positions along the street-facing parapet.
  const roofPositions = Math.max(1, Math.floor(w / 4.5));
  for (let i = 0; i < roofPositions; i++) {
    const x = -w / 2 + (i + 0.5) * (w / roofPositions);
    roofSlots.push({
      position: new THREE.Vector3(x, pTop, -0.95),
      kind: 'roof',
      cover: PARAPET_H,
    });
  }

  addRoofClutter(group, M, w - 1.2, d - 1.2, pTop);

  // Weathering: a dirt skirt at the base helps buildings sit on the ground.
  const base = solid(new THREE.BoxGeometry(w + 0.5, 0.5, d + 0.5), M.concreteB);
  base.position.set(0, 0.2, -d / 2);
  group.add(base);

  // A building is a hundred small boxes; batch it before anyone clones it.
  mergeGroupByMaterial(group);

  group.userData = { windows, balconies, roofSlots, size: new THREE.Vector3(w, h, d), floors };
  return { group, windows, balconies, roofSlots, size: new THREE.Vector3(w, h, d) };
}

/**
 * Builds a palette of prototypes once. Chunks clone from it, which shares
 * geometry and materials — cloning a group is cheap, rebuilding one is not.
 */
export function makeBuildingPrototypes(count = 12) {
  const protos = [];
  for (let i = 0; i < count; i++) {
    protos.push(makeBuilding({
      floors: 1 + Math.floor(rangeR(1, 7)),
      width: rangeR(9, 20),
      depth: rangeR(8, 15),
      shopfront: rnd() > 0.7,
    }));
  }
  return protos;
}

export { FLOOR_H, PARAPET_H, rnd as buildingRandom, rangeR as buildingRange };

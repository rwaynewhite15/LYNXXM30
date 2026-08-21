/**
 * The route: one straight road with recycled scenery either side.
 *
 * Ground, carriageway and pavements are long strips that recentre on the
 * player, snapped to whole texture tiles so nothing visibly slides. Everything
 * with individuality — buildings, hazards, scenery — lives in fixed-length
 * chunks that are built ahead of the vehicle and released behind it.
 */

import * as THREE from 'three';
import { materials, ROAD_TILE_W, ROAD_TILE_L } from '../model/materials.js';
import { makeBuildingPrototypes, seedBuildings } from './buildings.js';
import { makePropPrototypes } from './props.js';
import { CONFIG } from '../config.js';

const CHUNK = CONFIG.world.chunkLength;

/**
 * How far off the facade's normal a firing position stays usable.
 * A figure in a window opening is hidden by the reveal past about 55 deg; a
 * figure on a balcony stands proud of the wall and holds out much further.
 * Rooftops and ground positions have no limit.
 */
const ANGLE_LIMIT = {
  window: 58 * Math.PI / 180,
  balcony: 80 * Math.PI / 180,
};

/** Entry parameter t in [0,1] where a segment first enters a box, or null. */
function slabEnter(o, dx, dy, dz, box) {
  let tmin = 0, tmax = 1;
  const axes = [
    [o.x, dx, box.min.x, box.max.x],
    [o.y, dy, box.min.y, box.max.y],
    [o.z, dz, box.min.z, box.max.z],
  ];
  for (const [start, delta, lo, hi] of axes) {
    if (Math.abs(delta) < 1e-8) {
      if (start < lo || start > hi) return null;
      continue;
    }
    let t1 = (lo - start) / delta;
    let t2 = (hi - start) / delta;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}

/** Slab-method ray/AABB test, restricted to the segment (t in [0,1]). */
function slabHit(o, dx, dy, dz, box) {
  let tmin = 0, tmax = 1;
  const axes = [
    [o.x, dx, box.min.x, box.max.x],
    [o.y, dy, box.min.y, box.max.y],
    [o.z, dz, box.min.z, box.max.z],
  ];
  for (const [start, delta, lo, hi] of axes) {
    if (Math.abs(delta) < 1e-8) {
      if (start < lo || start > hi) return false;
      continue;
    }
    let t1 = (lo - start) / delta;
    let t2 = (hi - start) / delta;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return true;
}

/** Cheap deterministic PRNG so a given seed always yields the same route. */
function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class World {
  constructor(scene, seed = 20260821) {
    this.scene = scene;
    this.seed = seed;
    this.root = new THREE.Group();
    this.root.name = 'world';
    scene.add(this.root);

    seedBuildings(seed);
    this.buildingProtos = makeBuildingPrototypes(14);
    this.props = makePropPrototypes();

    this.chunks = new Map();
    /** Live obstacle records the driving model tests against. */
    this.hazards = [];
    /** Firing positions currently streamed in, for the enemy manager. */
    this.slots = [];
    /** Coarse building volumes, for line-of-sight and projectile blocking. */
    this.boxes = [];

    this._buildSurfaces();
  }

  /* ------------------------------ static strips ----------------------------- */

  _buildSurfaces() {
    const M = materials();
    const W = CONFIG.world;
    const len = W.stripLength;

    const strip = (width, mat, tileW, tileL, y, x) => {
      const geo = new THREE.PlaneGeometry(width, len, 1, 1);
      const m = mat.clone();
      m.map = mat.map.clone();
      m.map.wrapS = m.map.wrapT = THREE.RepeatWrapping;
      m.map.repeat.set(width / tileW, len / tileL);
      m.map.needsUpdate = true;
      const mesh = new THREE.Mesh(geo, m);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, y, 0);
      mesh.receiveShadow = true;
      this.root.add(mesh);
      return mesh;
    };

    // Ground first, then the carriageway a hair above it to beat z-fighting.
    this.groundMesh = strip(W.groundWidth, M.ground, 10, 10, 0, 0);
    this.roadMesh = strip(ROAD_TILE_W, M.road, ROAD_TILE_W, ROAD_TILE_L, 0.012, 0);

    // Pavements and kerbs either side of the carriageway.
    this.pavements = [];
    for (const side of [-1, 1]) {
      const p = strip(W.pavementWidth, M.pavement, 3, 3, 0.10,
                      side * (ROAD_TILE_W / 2 + W.pavementWidth / 2));
      this.pavements.push(p);
      const kerbGeo = new THREE.BoxGeometry(0.22, 0.16, len);
      const kerb = new THREE.Mesh(kerbGeo, M.pavement);
      kerb.position.set(side * (ROAD_TILE_W / 2 + 0.11), 0.08, 0);
      kerb.receiveShadow = true;
      this.root.add(kerb);
      this.pavements.push(kerb);
    }

    this._surfaces = [this.groundMesh, this.roadMesh, ...this.pavements];
    this._snap = Math.max(10, ROAD_TILE_L);
  }

  /* -------------------------------- streaming ------------------------------- */

  /** @param {number} z  the vehicle's position along the route */
  update(z) {
    // Slide the infinite strips along, snapped to whole tiles.
    const anchor = Math.round(z / this._snap) * this._snap;
    for (const s of this._surfaces) s.position.z = anchor;

    const first = Math.floor((z - CONFIG.world.keepBehind) / CHUNK);
    const last = Math.floor((z + CONFIG.world.streamAhead) / CHUNK);

    for (let i = first; i <= last; i++) {
      if (!this.chunks.has(i)) this.chunks.set(i, this._buildChunk(i));
    }
    for (const [i, chunk] of this.chunks) {
      if (i < first || i > last) {
        this.root.remove(chunk.group);
        this.chunks.delete(i);
      }
    }

    this._refreshIndexes();
  }

  _refreshIndexes() {
    this.hazards.length = 0;
    this.slots.length = 0;
    this.boxes.length = 0;
    for (const chunk of this.chunks.values()) {
      for (const h of chunk.hazards) this.hazards.push(h);
      for (const s of chunk.slots) this.slots.push(s);
      for (const b of chunk.boxes) this.boxes.push(b);
    }
  }

  /* ------------------------------- chunk build ------------------------------ */

  _buildChunk(index) {
    const rng = mulberry(this.seed ^ (index * 0x9E3779B1));
    const z0 = index * CHUNK;
    const group = new THREE.Group();
    group.name = `chunk${index}`;
    this.root.add(group);

    const hazards = [];
    const slots = [];
    const boxes = [];
    const W = CONFIG.world;

    /* ------------------------------ buildings ------------------------------ */
    for (const side of [-1, 1]) {
      let cursor = z0 + rng() * 6;
      const end = z0 + CHUNK;
      // Leave the odd gap so the street doesn't read as a solid canyon.
      while (cursor < end) {
        if (rng() < W.buildingGapChance) {
          cursor += 8 + rng() * 14;
          continue;
        }
        const proto = this.buildingProtos[Math.floor(rng() * this.buildingProtos.length)];
        const bw = proto.size.x;
        if (cursor + bw > end + 6) break;

        const inst = proto.group.clone();
        const setback = W.buildingSetback + rng() * W.buildingSetbackJitter;
        inst.position.set(side * setback, 0, cursor + bw / 2);
        // Front wall faces the road, so the depth runs AWAY from it. The
        // prototype's frontage faces local +Z, and rotY maps +Z to
        // (sin, 0, cos) — so a building at +X needs -90 deg to face back
        // toward the centreline, and vice versa.
        inst.rotation.y = -side * Math.PI / 2;
        inst.updateMatrixWorld(true);
        group.add(inst);

        // One coarse volume per building. Line-of-sight checks and projectile
        // blocking run against these rather than the real geometry.
        const box = new THREE.Box3().setFromObject(inst);
        boxes.push(box);

        // Transform this instance's firing positions into world space.
        const collect = (list, kind) => {
          for (const s of list) {
            const p = s.position.clone().applyMatrix4(inst.matrixWorld);
            slots.push({
              kind,
              position: p,
              // Outward normal of the facade: points across the road.
              facing: side > 0 ? -1 : 1,
              cover: s.cover ?? 0,
              building: inst,
              occupied: false,
            });
          }
        };
        collect(proto.windows, 'window');
        collect(proto.balconies, 'balcony');
        collect(proto.roofSlots, 'roof');
        for (let k = slots.length - 1; k >= 0 && slots[k].building === inst; k--) {
          slots[k].box = box;
        }

        cursor += bw + 1.5 + rng() * 5;
      }
    }

    /* -------------------------------- scenery ------------------------------- */
    const sceneryCount = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < sceneryCount; i++) {
      const proto = this.props.scenery[Math.floor(rng() * this.props.scenery.length)];
      const inst = proto.group.clone();
      const side = rng() > 0.5 ? 1 : -1;
      inst.position.set(
        side * (ROAD_TILE_W / 2 + 1.1 + rng() * 1.6),
        0,
        z0 + rng() * CHUNK,
      );
      inst.rotation.y = rng() * Math.PI * 2;
      group.add(inst);
    }

    /* ----------------------------- road hazards ----------------------------- */
    // Density ramps up with distance travelled — see CONFIG.difficulty.
    const n = Math.floor(rng() * (W.hazardsPerChunkMax + 1));
    let lastZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const proto = this.props.hazards[Math.floor(rng() * this.props.hazards.length)];
      const hz = z0 + 4 + rng() * (CHUNK - 8);
      if (hz - lastZ < W.hazardMinGap) continue;
      lastZ = hz;

      // Keep at least one lane's worth of road clear so the route is always
      // driveable — a hazard sits to one side, never dead centre.
      const laneSide = rng() > 0.5 ? 1 : -1;
      const hx = laneSide * (0.9 + rng() * (ROAD_TILE_W / 2 - 0.4));

      const inst = proto.group.clone();
      inst.position.set(hx, 0, hz);
      inst.rotation.y += rng() * 0.6 - 0.3;
      group.add(inst);

      if (!proto.decorative) {
        hazards.push({
          position: new THREE.Vector3(hx, 0, hz),
          radius: proto.radius,
          height: proto.height,
          severity: proto.severity,
          name: proto.name,
          object: inst,
          hit: false,
        });
      }
      if (proto.firingPosition) {
        slots.push({
          kind: 'ground',
          position: new THREE.Vector3(hx, 0.35, hz - 0.4),
          facing: 0,
          cover: 1.0,
          occupied: false,
        });
      }
    }

    return { group, hazards, slots, boxes, z0 };
  }

  /**
   * First building a segment enters, with the entry point.
   * @returns {{point:THREE.Vector3, structure:true}|null}
   */
  segmentHit(from, to) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const minZ = Math.min(from.z, to.z), maxZ = Math.max(from.z, to.z);
    let bestT = Infinity;
    for (const box of this.boxes) {
      if (box.max.z < minZ || box.min.z > maxZ) continue;
      const t = slabEnter(from, dx, dy, dz, box);
      if (t !== null && t < bestT) bestT = t;
    }
    if (!isFinite(bestT)) return null;
    return {
      structure: true,
      point: new THREE.Vector3(from.x + dx * bestT, from.y + dy * bestT, from.z + dz * bestT),
    };
  }

  /**
   * Firing positions within a band ahead of the vehicle, for target spawning.
   *
   * Optionally rejects any position that will still be masked by an
   * intervening building by the time the vehicle is `engageableFrom` metres
   * short of it. Down a built-up street most far-off windows and rooftops are
   * hidden behind their own neighbours; without this filter a good half of
   * the targets spawn somewhere the crew can never see or shoot.
   *
   * @param {number} z      vehicle position along the route
   * @param {number} near   nearest distance ahead to consider
   * @param {number} far    furthest
   * @param {object} [opts] { eyeHeight, engageableFrom }
   */
  slotsAhead(z, near, far, opts = null) {
    const out = [];
    const eye = opts ? new THREE.Vector3(0, opts.eyeHeight ?? 3.0, 0) : null;
    for (const s of this.slots) {
      if (s.occupied) continue;
      const d = s.position.z - z;
      if (d < near || d > far) continue;
      if (eye) {
        // Sight the slot from where the vehicle will be when it comes into
        // useful range — approaching only ever improves the angle.
        eye.z = Math.max(z, s.position.z - (opts.engageableFrom ?? 250));
        if (this.segmentBlocked(eye, s.position, s.box)) continue;

        // Facade positions are also masked by their own reveal or railing
        // once the line of sight goes oblique. A rooftop figure stands clear
        // of everything, so it is exempt.
        const limit = ANGLE_LIMIT[s.kind];
        if (limit !== undefined) {
          const across = Math.abs(eye.x - s.position.x);
          const along = Math.abs(eye.z - s.position.z);
          if (Math.atan2(along, Math.max(0.01, across)) > limit) continue;
        }
      }
      out.push(s);
    }
    return out;
  }

  /** Frees every slot a destroyed/removed enemy was holding. */
  releaseSlot(slot) { if (slot) slot.occupied = false; }

  /**
   * True if a building stands between the two points.
   * @param {THREE.Box3} [ignore]  the shooter's own building, which they are
   *                               standing inside and must not be hidden by
   */
  segmentBlocked(from, to, ignore) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const minZ = Math.min(from.z, to.z), maxZ = Math.max(from.z, to.z);
    for (const box of this.boxes) {
      if (box === ignore) continue;
      if (box.max.z < minZ || box.min.z > maxZ) continue;
      if (slabHit(from, dx, dy, dz, box)) return true;
    }
    return false;
  }
}

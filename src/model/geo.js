/**
 * Geometry helpers shared by the vehicle, props and buildings.
 *
 * The vehicle is built the way a real hull is drawn: a 2D side profile that
 * gets extruded across the width, plus bolt-on plates. That keeps the
 * silhouette honest instead of stacking boxes and hoping.
 */

import * as THREE from 'three';

/**
 * Extrudes a 2D side profile across the vehicle's width.
 *
 * @param {Array<[number,number]>} profile  points as [z, y], counter-clockwise
 * @param {number} width                    extrusion span along X
 * @param {object} opts                     { bevel, uvScale }
 * @returns {THREE.BufferGeometry} centred on X, in world Z/Y
 */
export function extrudeProfile(profile, width, opts = {}) {
  const { bevel = 0, uvScale = 1 } = opts;
  const shape = new THREE.Shape();
  shape.moveTo(profile[0][0], profile[0][1]);
  for (let i = 1; i < profile.length; i++) shape.lineTo(profile[i][0], profile[i][1]);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 2,
  });

  // Shape X -> world Z, shape Y -> world Y, extrusion -> world X.
  geo.rotateY(-Math.PI / 2);
  geo.translate(width / 2, 0, 0);
  geo.computeVertexNormals();
  rescaleUV(geo, uvScale);
  return geo;
}

/**
 * Re-derives triplanar box UVs from position so tiled textures don't smear.
 *
 * `offset` shifts the sampling point, which is how separate parts end up
 * reading as one continuous paint job: pass each part's mounting position and
 * the camo flows across the panel gaps instead of restarting on every box.
 */
export function rescaleUV(geo, scale = 1, offset = null) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  if (!nor) geo.computeVertexNormals();
  const uv = new Float32Array(pos.count * 2);
  const ox = offset ? (offset.x ?? offset[0] ?? 0) : 0;
  const oy = offset ? (offset.y ?? offset[1] ?? 0) : 0;
  const oz = offset ? (offset.z ?? offset[2] ?? 0) : 0;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + ox, y = pos.getY(i) + oy, z = pos.getZ(i) + oz;
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    let u, v;
    if (nx >= ny && nx >= nz)      { u = z; v = y; }   // facing sideways
    else if (ny >= nx && ny >= nz) { u = x; v = z; }   // facing up/down
    else                           { u = x; v = y; }   // facing fore/aft
    uv[i * 2] = u * scale;
    uv[i * 2 + 1] = v * scale;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/* ------------------------------------------------------------------------- */
/*  Track band                                                               */
/* ------------------------------------------------------------------------- */

/**
 * Convex hull of a set of discs, sampled as a polygon.
 * A tracked vehicle's track band is exactly this: the taut outer wrap around
 * the sprocket, road wheels, idler and return rollers.
 *
 * @param {Array<{z:number,y:number,r:number}>} discs
 * @param {number} shrink  reduce every radius by this much (gives the inner
 *                         face of the band for free — Minkowski, so exact)
 * @param {number} seg     samples per disc
 */
export function hullOfDiscs(discs, shrink = 0, seg = 28) {
  const pts = [];
  for (const d of discs) {
    const r = Math.max(0.001, d.r - shrink);
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      pts.push([d.z + Math.cos(a) * r, d.y + Math.sin(a) * r]);
    }
  }
  return convexHull(pts);
}

/** Andrew's monotone chain. Returns CCW points, no duplicated endpoint. */
export function convexHull(points) {
  const p = points.slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

/**
 * Builds the track band as a closed ribbon with clean, arc-length UVs so the
 * texture can be scrolled to animate the track.
 *
 * @returns {THREE.BufferGeometry} with userData.arcLength (metres per loop)
 */
export function trackBand(discs, width, thickness) {
  const outer = hullOfDiscs(discs, 0);
  const inner = hullOfDiscs(discs, thickness);

  // Resample the inner ring to the same count so we can pair vertices up.
  const N = outer.length;
  const innerR = resampleClosed(inner, N);

  // Arc length along the outer contour, for U.
  const arc = [0];
  for (let i = 1; i <= N; i++) {
    const a = outer[i - 1], b = outer[i % N];
    arc.push(arc[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = arc[N];

  const hw = width / 2;
  const pos = [], uv = [], idx = [];
  const push = (x, z, y, u, v) => { pos.push(x, y, z); uv.push(u, v); };

  // Four longitudinal strips: outer face, inner face, left wall, right wall.
  // Each strip is (N+1) segments wide so the seam closes.
  const strips = [
    { a: outer, b: outer, xa: -hw, xb: hw, vScale: width },     // outer running surface
    { a: innerR, b: innerR, xa: hw, xb: -hw, vScale: width },   // inner face (flipped)
    { a: outer, b: innerR, xa: hw, xb: hw, vScale: thickness },  // right wall
    { a: innerR, b: outer, xa: -hw, xb: -hw, vScale: thickness },// left wall
  ];

  for (const s of strips) {
    const base = pos.length / 3;
    for (let i = 0; i <= N; i++) {
      const k = i % N;
      const u = arc[i] / total;
      push(s.xa, s.a[k][0], s.a[k][1], u, 0);
      push(s.xb, s.b[k][0], s.b[k][1], u, s.vScale / width);
    }
    for (let i = 0; i < N; i++) {
      const o = base + i * 2;
      idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.userData.arcLength = total;
  return geo;
}

/** Resamples a closed polyline to exactly n evenly spaced points. */
function resampleClosed(poly, n) {
  const m = poly.length;
  const seg = [];
  let total = 0;
  for (let i = 0; i < m; i++) {
    const a = poly[i], b = poly[(i + 1) % m];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    seg.push(d);
    total += d;
  }
  const out = [];
  let i = 0, walked = 0;
  for (let k = 0; k < n; k++) {
    const target = (k / n) * total;
    while (walked + seg[i] < target && i < m - 1) { walked += seg[i]; i++; }
    const t = seg[i] > 1e-9 ? (target - walked) / seg[i] : 0;
    const a = poly[i], b = poly[(i + 1) % m];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

/* ------------------------------------------------------------------------- */
/*  Small parts                                                              */
/* ------------------------------------------------------------------------- */

/**
 * A box with its edges knocked off. Built as a rounded rectangle extruded with
 * a bevel, so all twelve edges get the chamfer — a plain BoxGeometry can't,
 * it has no vertices to move.
 */
export function chamferBox(w, h, d, chamfer = 0.02) {
  const b = Math.min(chamfer, w / 2.05, h / 2.05, d / 2.05);
  if (b <= 0.0005) return new THREE.BoxGeometry(w, h, d);

  const iw = w - 2 * b, ih = h - 2 * b, id = d - 2 * b;
  const shape = new THREE.Shape();
  const x = -iw / 2, y = -ih / 2;
  shape.moveTo(x + b, y);
  shape.lineTo(x + iw - b, y);
  shape.absarc(x + iw - b, y + b, b, -Math.PI / 2, 0, false);
  shape.lineTo(x + iw, y + ih - b);
  shape.absarc(x + iw - b, y + ih - b, b, 0, Math.PI / 2, false);
  shape.lineTo(x + b, y + ih);
  shape.absarc(x + b, y + ih - b, b, Math.PI / 2, Math.PI, false);
  shape.lineTo(x, y + b);
  shape.absarc(x + b, y + b, b, Math.PI, Math.PI * 1.5, false);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: id,
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelOffset: 0,
    bevelSegments: 1,
    curveSegments: 1,
  });
  geo.translate(0, 0, -id / 2);
  geo.computeVertexNormals();
  return geo;
}

/** A row of bolt heads along X — used on the applique armour modules. */
export function boltRow(count, spacing, radius = 0.022, height = 0.016) {
  const g = new THREE.CylinderGeometry(radius, radius * 0.92, height, 6);
  g.rotateX(Math.PI / 2);
  const geos = [];
  for (let i = 0; i < count; i++) {
    const c = g.clone();
    c.translate((i - (count - 1) / 2) * spacing, 0, 0);
    geos.push(c);
  }
  const merged = mergeGeometries(geos);
  g.dispose();
  return merged;
}

/**
 * Minimal geometry merge (all inputs must share attributes).
 * Avoids pulling in the BufferGeometryUtils addon.
 */
export function mergeGeometries(geos) {
  const nonIndexed = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const keys = ['position', 'normal', 'uv'];
  const out = new THREE.BufferGeometry();
  for (const key of keys) {
    if (!nonIndexed[0].attributes[key]) continue;
    const size = nonIndexed[0].attributes[key].itemSize;
    let total = 0;
    for (const g of nonIndexed) total += g.attributes[key].count * size;
    const arr = new Float32Array(total);
    let off = 0;
    for (const g of nonIndexed) {
      arr.set(g.attributes[key].array, off);
      off += g.attributes[key].count * size;
    }
    out.setAttribute(key, new THREE.BufferAttribute(arr, size));
  }
  out.computeBoundingSphere();
  return out;
}

/** Mirrors a mesh/group across the vehicle centreline. */
export function mirrorX(object) {
  const clone = object.clone(true);
  clone.scale.x *= -1;
  clone.traverse((o) => { if (o.isMesh) o.userData.mirrored = true; });
  return clone;
}

/**
 * Cylinder aligned to Z (fore/aft), which is how nearly every tube on this
 * vehicle sits — gun barrels, smoke dischargers, exhaust.
 */
export function tubeZ(rTop, rBottom, length, seg = 16, open = false) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, length, seg, 1, open);
  g.rotateX(Math.PI / 2);
  return g;
}

/** Cylinder aligned to X (the axle direction for road wheels). */
export function tubeX(rTop, rBottom, length, seg = 16, open = false) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, length, seg, 1, open);
  g.rotateZ(Math.PI / 2);
  return g;
}

/** Shorthand for a mesh that casts and receives shadow. */
export function solid(geometry, material, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

/* ------------------------------------------------------------------------- */
/*  Batching                                                                 */
/* ------------------------------------------------------------------------- */

/**
 * Collapses a group's static meshes into one mesh per material.
 *
 * A procedural building is a hundred little boxes; a street of them is
 * thousands of draw calls for what is visually one object. Baking each mesh's
 * local transform into its geometry and merging by material turns a building
 * into three or four calls with no visible difference.
 *
 * Any subtree marked `userData.noMerge` is left alone — that is how articulated
 * parts (turret, wheels, hatches) survive the pass.
 *
 * @param {THREE.Object3D} group
 * @returns {THREE.Object3D} the same group, rebuilt in place
 */
export function mergeGroupByMaterial(group) {
  group.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(group.matrixWorld).invert();

  const buckets = new Map();     // material -> { geos, cast, receive }
  const doomed = [];

  const walk = (node) => {
    for (const child of node.children) {
      if (child.userData && child.userData.noMerge) continue;
      if (child.isMesh) {
        const mat = child.material;
        if (Array.isArray(mat)) continue;             // multi-material: leave it
        const geo = child.geometry;
        if (!geo || !geo.attributes.position) continue;
        if (!geo.attributes.normal) geo.computeVertexNormals();

        const baked = geo.clone();
        const m = new THREE.Matrix4().multiplyMatrices(inverse, child.matrixWorld);
        baked.applyMatrix4(m);
        if (!baked.attributes.uv) {
          const n = baked.attributes.position.count;
          baked.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
        }

        let bucket = buckets.get(mat);
        if (!bucket) {
          bucket = { geos: [], cast: false, receive: false };
          buckets.set(mat, bucket);
        }
        bucket.geos.push(baked);
        bucket.cast = bucket.cast || child.castShadow;
        bucket.receive = bucket.receive || child.receiveShadow;
        doomed.push(child);
      }
      walk(child);
    }
  };
  walk(group);

  for (const child of doomed) child.removeFromParent();

  for (const [mat, bucket] of buckets) {
    const merged = mergeGeometries(bucket.geos);
    for (const g of bucket.geos) g.dispose();
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = bucket.cast;
    mesh.receiveShadow = bucket.receive;
    mesh.userData.merged = true;
    group.add(mesh);
  }
  return group;
}

/** Counts the meshes under an object — handy when checking a batching pass. */
export function countMeshes(object) {
  let n = 0;
  object.traverse((o) => { if (o.isMesh) n++; });
  return n;
}

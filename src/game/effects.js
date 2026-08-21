/**
 * Weapon effects: tracers, muzzle flash, impacts, explosions, dust.
 *
 * Tracers are simulated as real projectiles with a time of flight and gravity
 * drop, not hitscan lines. At 1500 m a 50 mm round takes well over a second to
 * arrive and drops several metres — the player should be able to see that.
 */

import * as THREE from 'three';
import { materials } from '../model/materials.js';
import { CONFIG } from '../config.js';

const G = CONFIG.gunnery.gravity;
const _v = new THREE.Vector3();

/** Pooled billboard sprites for flashes, impacts and smoke. */
class SpritePool {
  constructor(scene, count, material) {
    this.free = [];
    this.live = [];
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, material);
      m.visible = false;
      m.frustumCulled = false;
      scene.add(m);
      this.free.push(m);
    }
  }

  spawn(pos, size, life, colour, growth = 2.5) {
    const m = this.free.pop();
    if (!m) return null;
    m.position.copy(pos);
    m.scale.setScalar(size);
    m.visible = true;
    m.material = m.material.clone();
    m.material.color.setHex(colour);
    m.material.opacity = 1;
    m.userData = { t: 0, life, size, growth };
    this.live.push(m);
    return m;
  }

  update(dt, camera) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const m = this.live[i];
      const u = m.userData;
      u.t += dt;
      const k = u.t / u.life;
      if (k >= 1) {
        m.visible = false;
        this.live.splice(i, 1);
        this.free.push(m);
        continue;
      }
      m.scale.setScalar(u.size * (1 + k * u.growth));
      m.material.opacity = (1 - k) * (1 - k);
      m.quaternion.copy(camera.quaternion);
    }
  }
}

/**
 * One projectile in flight.
 * @typedef {{pos:THREE.Vector3, vel:THREE.Vector3, t:number, life:number,
 *            mesh:THREE.Mesh, kind:string, damage:number, splash:number,
 *            fromEnemy:boolean, source:any}} Round
 */

export class Effects {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    const M = materials();

    this.rounds = [];
    this.tracerGeo = new THREE.CylinderGeometry(0.055, 0.055, 1, 5, 1, true);
    this.tracerGeo.rotateX(Math.PI / 2);

    this.flash = new SpritePool(scene, 26, M.muzzle.clone());
    this.impact = new SpritePool(scene, 60, M.muzzle.clone());

    // Reusable tracer meshes.
    this._tracerPool = [];
    for (let i = 0; i < 90; i++) {
      const m = new THREE.Mesh(this.tracerGeo, M.tracer);
      m.visible = false;
      m.frustumCulled = false;
      scene.add(m);
      this._tracerPool.push(m);
    }

    /** Callbacks: set by the game to resolve hits. */
    this.onHitTest = null;         // (round, from, to) => hitResult | null
    this.onImpact = null;          // (round, point, hitResult) => void
  }

  /**
   * Launches a projectile.
   * @param {THREE.Vector3} origin
   * @param {THREE.Vector3} direction  unit vector
   * @param {object} opts  { speed, damage, splash, kind, spread, fromEnemy, source, colour }
   */
  fire(origin, direction, opts = {}) {
    const mesh = this._tracerPool.pop();
    const speed = opts.speed ?? 1100;
    const dir = _v.copy(direction);
    if (opts.spread) {
      dir.x += (Math.random() - 0.5) * opts.spread * 2;
      dir.y += (Math.random() - 0.5) * opts.spread * 2;
      dir.z += (Math.random() - 0.5) * opts.spread * 2;
      dir.normalize();
    }

    const round = {
      pos: origin.clone(),
      prev: origin.clone(),
      vel: dir.clone().multiplyScalar(speed),
      t: 0,
      life: opts.life ?? 6,
      mesh,
      kind: opts.kind || 'ap',
      damage: opts.damage ?? 50,
      splash: opts.splash ?? 0,
      fromEnemy: !!opts.fromEnemy,
      source: opts.source ?? null,
      tracerLength: opts.tracerLength ?? Math.max(3, speed * 0.012),
      colour: opts.colour,
    };
    if (mesh) {
      mesh.visible = true;
      mesh.material = opts.colour === 'red' ? materials().tracerRed : materials().tracer;
    }
    this.rounds.push(round);

    // Muzzle flash.
    this.flash.spawn(origin, opts.flashSize ?? 1.6, 0.055, 0xfff2cc, 1.8);
    return round;
  }

  /** Dust and debris where a round lands. */
  impactAt(point, scale = 1, colour = 0xcbbfa4) {
    this.impact.spawn(point, 0.9 * scale, 0.42, colour, 3.2);
    this.impact.spawn(point, 0.55 * scale, 0.9, 0x6a6156, 4.5);
  }

  /** A high-explosive burst. */
  explodeAt(point, scale = 1) {
    this.impact.spawn(point, 1.6 * scale, 0.20, 0xffd08a, 2.0);
    this.impact.spawn(point, 2.2 * scale, 0.55, 0xd08040, 2.6);
    this.impact.spawn(point, 1.8 * scale, 1.3, 0x4a4239, 4.0);
  }

  update(dt) {
    for (let i = this.rounds.length - 1; i >= 0; i--) {
      const r = this.rounds[i];
      r.prev.copy(r.pos);
      r.vel.y -= G * dt;
      r.pos.addScaledVector(r.vel, dt);
      r.t += dt;

      let done = false;
      let hit = null;

      // Ground plane.
      if (r.pos.y <= 0) {
        const k = r.prev.y / Math.max(1e-6, r.prev.y - r.pos.y);
        r.pos.lerpVectors(r.prev, r.pos, k);
        r.pos.y = 0.02;
        done = true;
      }

      if (!done && this.onHitTest) {
        hit = this.onHitTest(r, r.prev, r.pos);
        if (hit) {
          if (hit.point) r.pos.copy(hit.point);
          done = true;
        }
      }

      if (!done && r.t >= r.life) done = true;

      if (done) {
        if (this.onImpact) this.onImpact(r, r.pos, hit);
        else this.impactAt(r.pos);
        if (r.mesh) { r.mesh.visible = false; this._tracerPool.push(r.mesh); }
        this.rounds.splice(i, 1);
        continue;
      }

      // Draw the tracer as a short streak along the velocity vector.
      if (r.mesh) {
        const len = Math.min(r.tracerLength, r.pos.distanceTo(r.prev) * 8 + 1);
        r.mesh.position.copy(r.pos);
        r.mesh.lookAt(_v.copy(r.pos).add(r.vel));
        r.mesh.scale.set(1, 1, len);
      }
    }

    this.flash.update(dt, this.camera);
    this.impact.update(dt, this.camera);
  }

  clear() {
    for (const r of this.rounds) {
      if (r.mesh) { r.mesh.visible = false; this._tracerPool.push(r.mesh); }
    }
    this.rounds.length = 0;
  }

  /**
   * Time of flight and drop for a shot, used by the HUD to draw the drop
   * chevrons on the reticle.
   */
  static ballistics(range, muzzleVelocity) {
    const t = range / muzzleVelocity;
    return { time: t, drop: 0.5 * G * t * t };
  }
}

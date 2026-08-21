/**
 * Targets: dismounted shooters in windows, on rooftops and behind sandbags.
 *
 * Everything here is placed at true scale on a real 3D position, which is what
 * makes the perception model work — a figure at 600 m is small because it is
 * far away, not because a size curve says so.
 */

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { makeFigurePrototypes, WEAPON_TYPES } from '../model/figures.js';

const E = CONFIG.enemies;
const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

const STATE = {
  HIDDEN: 'hidden',
  EXPOSING: 'exposing',
  AIMING: 'aiming',
  FIRING: 'firing',
  HIDING: 'hiding',
  DEAD: 'dead',
};

let nextId = 1;
function rand(range) { return range[0] + Math.random() * (range[1] - range[0]); }

export class Enemy {
  constructor(slot, weaponKey, prototype) {
    this.id = nextId++;
    this.slot = slot;
    this.weaponKey = weaponKey;
    this.type = WEAPON_TYPES[weaponKey];
    this.health = E.health;
    this.state = STATE.HIDDEN;
    this.timer = rand(E.exposeDelay);
    this.hasFired = false;
    this.shotsFired = 0;
    this.alive = true;
    this.age = 0;

    this.root = prototype.clone();
    this.root.userData = { ...prototype.userData, enemy: this };

    // Rooftop shooters rise from behind the parapet; window and ground
    // shooters are simply there.
    this.cover = slot.cover || 0;
    this.exposure = this.cover > 0 ? 0 : 1;
    this.basePosition = slot.position.clone();
    this.root.position.copy(this.basePosition);
    this.root.visible = this.cover > 0 ? false : true;

    /** Centre of the silhouette, recomputed each frame for aiming and hits. */
    this.centre = new THREE.Vector3();
    /** Where the silhouette would be if fully exposed — used for LOS tests. */
    this.firePosition = slot.position.clone();
    this.height = E.height;

    // Tracking state owned by the perception system.
    this.contact = null;
  }

  get muzzleWorld() {
    const m = this.root.userData.muzzle;
    m.updateWorldMatrix(true, false);
    return m.getWorldPosition(_b);
  }

  /** Where a round has to arrive to count as a hit. */
  updateCentre() {
    this.centre.copy(this.root.position);
    this.centre.y += this.root.userData.centreY;
    return this.centre;
  }

  hide() { this.state = STATE.HIDING; this.timer = rand(E.popCycle); }

  kill() {
    this.alive = false;
    this.state = STATE.DEAD;
    // Fall out of the position rather than vanish.
    this.root.rotation.x = -1.35;
    this.root.position.y -= 0.35;
    this.deathTimer = 2.2;
  }
}

export class EnemyManager {
  /**
   * @param {THREE.Scene} scene
   * @param {import('../world/world.js').World} world
   * @param {object} driving
   * @param {object} difficulty
   */
  constructor(scene, world, driving, difficulty) {
    this.scene = scene;
    this.world = world;
    this.driving = driving;
    this.diff = difficulty;

    this.group = new THREE.Group();
    this.group.name = 'enemies';
    scene.add(this.group);

    this.protos = makeFigurePrototypes();
    this.enemies = [];
    this.spawnCooldown = 0;

    /** Set by the game: called when a shooter looses a round. */
    this.onEnemyFire = null;
    /** Called when one dies, for scoring. */
    this.onEnemyKilled = null;
  }

  get targetCount() {
    return Math.round(6 * this.diff.enemyDensity);
  }

  /* -------------------------------- spawning ------------------------------- */

  /**
   * Weapon mix. Most of the incoming should be small arms — noisy, alarming
   * and nearly harmless to an IFV — with the rocket and missile teams rare
   * enough that spotting one first genuinely matters.
   */
  _pickWeapon(slot, range) {
    const r = Math.random();
    if (slot.kind === 'balcony') {
      if (r < 0.24) return 'rpg';
      if (r < 0.42) return 'mg';
      return 'rifle';
    }
    if (slot.kind === 'roof') {
      if (r < 0.07 && range > 420) return 'atgm';
      if (r < 0.28) return 'rpg';
      if (r < 0.58) return 'mg';
      return 'rifle';
    }
    if (slot.kind === 'ground') return r < 0.35 ? 'rpg' : 'rifle';
    return r < 0.22 ? 'rpg' : 'rifle';
  }

  _spawn() {
    const z = this.driving.position.z;
    // Only offer positions the crew will actually be able to see and engage.
    let candidates = this.world.slotsAhead(z, E.spawnBandNear, E.spawnBandFar, {
      eyeHeight: E.sightHeight,
      engageableFrom: E.engageableFrom,
    });
    // If the street is unusually closed in, fall back to any slot rather than
    // leaving the route empty.
    if (candidates.length < 3) {
      candidates = this.world.slotsAhead(z, E.spawnBandNear, E.spawnBandFar);
    }
    if (!candidates.length) return false;

    // Keep targets spread along the route rather than clumped in one block.
    for (let attempt = 0; attempt < 8; attempt++) {
      // Bias toward positions that stay visible down the length of the
      // street: rooftops and balconies. A figure standing in a plain window
      // opening only comes into view as the vehicle draws abeam of it.
      let slot = candidates[Math.floor(Math.random() * candidates.length)];
      if (slot.kind === 'window' && Math.random() < 0.7) {
        const open = candidates.filter((c) => !c.occupied && (c.kind === 'roof' || c.kind === 'balcony'));
        if (open.length) slot = open[Math.floor(Math.random() * open.length)];
      }
      if (slot.occupied) continue;
      let tooClose = false;
      for (const e of this.enemies) {
        if (!e.alive) continue;
        if (Math.abs(e.basePosition.z - slot.position.z) < E.minSpacing) { tooClose = true; break; }
      }
      if (tooClose) continue;

      const range = slot.position.z - z;
      const weapon = this._pickWeapon(slot, range);
      const protoList = this.protos[weapon];
      const proto = protoList[Math.floor(Math.random() * protoList.length)];

      const enemy = new Enemy(slot, weapon, proto);
      slot.occupied = true;
      this.group.add(enemy.root);
      this.enemies.push(enemy);
      return true;
    }
    return false;
  }

  /* --------------------------------- update -------------------------------- */

  update(dt, vehiclePosition) {
    // Top up the target set.
    this.spawnCooldown -= dt;
    let living = 0;
    for (const e of this.enemies) if (e.alive) living++;
    if (living < this.targetCount && this.spawnCooldown <= 0) {
      if (this._spawn()) this.spawnCooldown = 0.25;
      else this.spawnCooldown = 1.0;
    }

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      e.age += dt;

      // Retire anything the vehicle has driven past.
      if (e.basePosition.z < vehiclePosition.z - 45) {
        this.group.remove(e.root);
        this.world.releaseSlot(e.slot);
        this.enemies.splice(i, 1);
        continue;
      }

      if (!e.alive) {
        e.deathTimer -= dt;
        if (e.deathTimer <= 0) {
          this.group.remove(e.root);
          this.world.releaseSlot(e.slot);
          this.enemies.splice(i, 1);
        } else {
          e.updateCentre();
        }
        continue;
      }

      this._updateEnemy(dt, e, vehiclePosition);
    }
  }

  _updateEnemy(dt, e, vehiclePosition) {
    const range = e.basePosition.distanceTo(vehiclePosition);

    // Face the vehicle. Yaw only — nobody leans out of a window sideways.
    _v.copy(vehiclePosition).sub(e.root.position);
    e.root.rotation.y = Math.atan2(_v.x, _v.z);

    // Where this shooter's weapon would be if they were fully exposed. Their
    // decision to pop up has to be made from that position, not from the
    // ducked one — otherwise a rooftop shooter checks line of sight from
    // behind its own parapet and never comes up at all.
    e.firePosition.set(e.basePosition.x, e.basePosition.y + e.root.userData.centreY, e.basePosition.z);

    // Figures with real cover rise and drop behind it.
    if (e.cover > 0) {
      const target = (e.state === STATE.HIDDEN || e.state === STATE.HIDING) ? 0 : 1;
      e.exposure += (target - e.exposure) * Math.min(1, dt * 2.6);
      e.root.position.y = e.basePosition.y - e.cover * (1 - e.exposure);
      // Partial cover never takes the figure out of sight entirely.
      e.root.visible = e.cover < 0.6 || e.exposure > 0.05;
    }

    e.updateCentre();
    e.timer -= dt;

    let inReach = range < Math.min(e.type.reach, E.maxEngagementRange) && range > E.minEngagementRange;
    // Nobody shoots through a building. Without this the player takes fire
    // from positions they have no way of seeing, which just reads as unfair.
    if (inReach && (e.state === STATE.AIMING || e.state === STATE.HIDDEN)) {
      _v.copy(vehiclePosition); _v.y += E.sightHeight;
      e.hasLos = !this.world.segmentBlocked(e.firePosition, _v, e.slot.box);
      inReach = inReach && e.hasLos;
    }

    switch (e.state) {
      case STATE.HIDDEN:
        if (e.timer <= 0 && inReach) {
          e.state = STATE.EXPOSING;
          e.timer = 0.45;
        }
        break;

      case STATE.EXPOSING:
        if (e.timer <= 0) {
          e.state = STATE.AIMING;
          e.timer = rand(E.aimTime) * this.diff.enemyAimScale;
          e.aimTotal = e.timer;
        }
        break;

      case STATE.AIMING:
        if (!inReach) { e.hide(); break; }
        if (e.timer <= 0) {
          this._fire(e, vehiclePosition, range);
          e.state = STATE.FIRING;
          e.timer = 0.35;
        }
        break;

      case STATE.FIRING:
        if (e.timer <= 0) {
          e.state = e.cover > 0 ? STATE.HIDING : STATE.AIMING;
          e.timer = e.cover > 0
            ? rand(E.popCycle)
            : rand(E.fireInterval) * this.diff.enemyAimScale;
          if (e.state === STATE.AIMING) e.aimTotal = e.timer;
        }
        break;

      case STATE.HIDING:
        if (e.timer <= 0) { e.state = STATE.HIDDEN; e.timer = rand(E.exposeDelay); }
        break;
    }
  }

  _fire(e, vehiclePosition, range) {
    e.hasFired = true;
    e.shotsFired++;
    const origin = e.muzzleWorld.clone();

    // Aim at the hull, with an error that shrinks the longer they were
    // allowed to lay on the target.
    _a.copy(vehiclePosition);
    _a.y += 1.4;
    const dir = _a.sub(origin).normalize();

    // Dismounted shooters engaging a moving vehicle mostly miss at range and
    // mostly connect up close: the cone opens with distance, so a contact at
    // 500 m is a warning and one at 150 m is an emergency.
    const skill = 1 / this.diff.enemyAimScale;
    const spread = (0.020 / skill) * (0.40 + range / 450);
    if (this.onEnemyFire) this.onEnemyFire(e, origin, dir, spread);
  }

  /* ---------------------------------- hits --------------------------------- */

  /**
   * Segment-vs-target test for a projectile step.
   * Returns the closest enemy the segment passes through, or null.
   */
  hitTest(from, to, padOverride) {
    let best = null;
    let bestT = Infinity;
    const pad = padOverride ?? CONFIG.gunnery.hitPadding;

    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e.cover > 0 && e.exposure < 0.25) continue;

      // Closest approach of the segment to the figure's centre.
      _a.copy(to).sub(from);
      const lenSq = _a.lengthSq();
      if (lenSq < 1e-9) continue;
      _b.copy(e.centre).sub(from);
      let t = _b.dot(_a) / lenSq;
      t = Math.max(0, Math.min(1, t));
      _v.copy(from).addScaledVector(_a, t);

      // A standing figure is roughly a 0.5 m wide, 1.8 m tall box; treat it as
      // an ellipsoid so head-on and plunging shots both behave sensibly.
      const dx = _v.x - e.centre.x;
      const dy = (_v.y - e.centre.y) * 0.42;
      const dz = _v.z - e.centre.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 0.42 + pad && t < bestT) {
        bestT = t;
        best = { enemy: e, point: _v.clone(), distance: d };
      }
    }
    return best;
  }

  /** Applies damage; returns true if this killed the target. */
  damage(enemy, amount) {
    if (!enemy.alive) return false;
    enemy.health -= amount;
    if (enemy.health <= 0) {
      const preempted = !enemy.hasFired;
      enemy.kill();
      if (this.onEnemyKilled) this.onEnemyKilled(enemy, preempted);
      return true;
    }
    return false;
  }

  /** Everything within `radius` of a burst takes a share of the damage. */
  splash(point, radius, amount) {
    const killed = [];
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = e.centre.distanceTo(point);
      if (d > radius) continue;
      const falloff = 1 - d / radius;
      if (this.damage(e, amount * falloff)) killed.push(e);
    }
    return killed;
  }

  reset() {
    for (const e of this.enemies) {
      this.group.remove(e.root);
      this.world.releaseSlot(e.slot);
    }
    this.enemies.length = 0;
  }
}

export { STATE as ENEMY_STATE };

/**
 * Driving model.
 *
 * The player is not the driver — they direct one. A/D orders a lane change,
 * W/S orders a speed change, and the driver executes with the lag and inertia
 * of a 44-tonne tracked vehicle. Hitting something hurts.
 */

import * as THREE from 'three';
import { XM30, DERIVED } from '../spec/xm30.js';
import { CONFIG } from '../config.js';

const V = CONFIG.vehicle;

export class Driving {
  constructor(model, world, difficulty) {
    this.model = model;
    this.world = world;
    this.diff = difficulty;

    this.position = new THREE.Vector3(0, 0, 0);
    this.lateral = 0;               // metres from the road centreline
    this.lateralVel = 0;
    this.heading = 0;               // radians, small — the road is straight
    this.speed = V.cruiseSpeed * difficulty.speedScale;
    this.demandSpeed = this.speed;
    this.distance = 0;

    this.hull = XM30.protection.hullPoints;
    this.mobility = XM30.protection.mobilityPoints;
    this.destroyed = false;

    // Per-station suspension deflection, driven by a simple road-surface hash.
    this.suspL = new Array(XM30.track.roadWheels).fill(0);
    this.suspR = new Array(XM30.track.roadWheels).fill(0);
    this.pitch = 0;
    this.roll = 0;
    this._pitchVel = 0;
    this._rollVel = 0;

    this.collisions = [];
    this.lastCollision = null;
    this._bumpPhase = 0;
  }

  /** Fraction of full mobility currently available. */
  get mobilityFactor() {
    return 0.35 + 0.65 * Math.max(0, this.mobility) / XM30.protection.mobilityPoints;
  }

  get maxSpeed() {
    return V.maxSpeed * this.diff.speedScale * this.mobilityFactor;
  }

  changeSpeed(delta) {
    this.demandSpeed = Math.max(0, Math.min(this.maxSpeed, this.demandSpeed + delta));
  }

  /**
   * @param {number} dt
   * @param {number} steer  -1 (port) .. +1 (starboard)
   */
  update(dt, steer) {
    if (this.destroyed) {
      this.speed = Math.max(0, this.speed - 6 * dt);
    } else {
      // Longitudinal: accelerate or brake toward the ordered speed. A 44 t
      // vehicle stops far better than it starts, hence the asymmetric rates.
      const target = Math.min(this.demandSpeed, this.maxSpeed);
      this.speed = target > this.speed
        ? Math.min(target, this.speed + XM30.mobility.accel * this.mobilityFactor * dt)
        : Math.max(target, this.speed - XM30.mobility.brake * dt);
      this.speed = Math.max(0, Math.min(this.maxSpeed, this.speed));
    }

    /* -------------------------------- steering ------------------------------- */
    // +X is port, so a "steer right" order has to push lateral negative.
    const order = -steer;
    const targetVel = order * V.steerRate * (this.speed / V.maxSpeed + 0.35);
    const accel = order !== 0 ? V.steerAccel : V.steerReturn;
    this.lateralVel += (targetVel - this.lateralVel) * Math.min(1, accel * dt);

    // The driver keeps the vehicle on the carriageway even under a held order.
    const nextLateral = this.lateral + this.lateralVel * dt;
    if (Math.abs(nextLateral) > V.lateralLimit) {
      this.lateral = Math.sign(nextLateral) * V.lateralLimit;
      this.lateralVel *= -0.15;
    } else {
      this.lateral = nextLateral;
    }

    // Heading follows the lateral velocity — the hull crabs into the turn.
    const yawTarget = this.speed > 0.5 ? Math.atan2(this.lateralVel, this.speed) : 0;
    const yawPrev = this.heading;
    this.heading += (yawTarget - this.heading) * Math.min(1, 5 * dt);
    this.yawRate = dt > 0 ? (this.heading - yawPrev) / dt : 0;

    /* ------------------------------- integration ----------------------------- */
    const travel = this.speed * dt;
    this.distance += travel;
    this.position.z += travel;
    this.position.x = this.lateral;

    this.model.root.position.copy(this.position);
    this.model.root.rotation.y = this.heading;
    this.model.update(dt, travel, this.yawRate);

    this._updateSuspension(dt, travel);
    this._checkCollisions();
  }

  /**
   * Road-surface roughness as a function of distance, sampled independently at
   * each road-wheel station so the hull pitches and rolls the way a tracked
   * vehicle does rather than bobbing as one rigid lump.
   */
  _updateSuspension(dt, travel) {
    this._bumpPhase += travel;
    const amp = V.bumpAmplitude * (0.35 + this.speed / XM30.mobility.maxSpeed);
    const surface = (s) =>
      Math.sin(s * 0.9) * 0.5 + Math.sin(s * 2.3 + 1.7) * 0.3 + Math.sin(s * 5.1 + 0.4) * 0.2;

    let sumL = 0, sumR = 0, momentL = 0, momentR = 0;
    for (let i = 0; i < this.suspL.length; i++) {
      const z = XM30.track.firstWheelZ - i * XM30.track.wheelPitch;
      const sL = this._bumpPhase + z + this.lateral * 0.5;
      const sR = this._bumpPhase + z - this.lateral * 0.5 + 37.1;
      const dL = surface(sL) * amp;
      const dR = surface(sR) * amp;
      this.suspL[i] = dL;
      this.suspR[i] = dR;
      sumL += dL; sumR += dR;
      momentL += dL * z; momentR += dR * z;
    }
    this.model.setSuspension(this.suspL, this.suspR);

    const n = this.suspL.length;
    // Pitch from the fore/aft moment, roll from the left/right difference.
    const pitchTarget = -(momentL + momentR) / (n * 2) * XM30.mobility.pitchGain * 40;
    const rollTarget = (sumL - sumR) / (n * 2) * XM30.mobility.rollGain * 42;

    // Second-order response so the body settles rather than snapping.
    const w = XM30.mobility.suspFreq * Math.PI * 2;
    const zeta = XM30.mobility.suspDamp;
    this._pitchVel += (-(this.pitch - pitchTarget) * w * w - 2 * zeta * w * this._pitchVel) * dt;
    this._rollVel += (-(this.roll - rollTarget) * w * w - 2 * zeta * w * this._rollVel) * dt;
    this.pitch += this._pitchVel * dt;
    this.roll += this._rollVel * dt;

    // Braking and acceleration also pitch the hull.
    this.model.body.rotation.x = this.pitch;
    this.model.body.rotation.z = this.roll;
  }

  /** Tests the hull against every streamed hazard near the vehicle. */
  _checkCollisions() {
    this.lastCollision = null;
    const halfW = DERIVED.overallHalfWidth;
    const halfL = XM30.hull.length / 2;

    for (const h of this.world.hazards) {
      if (h.hit) continue;
      const dz = h.position.z - this.position.z;
      if (dz > halfL + h.radius || dz < -halfL - h.radius) continue;
      const dx = h.position.x - this.position.x;
      if (Math.abs(dx) > halfW + h.radius) continue;

      h.hit = true;
      const severity = h.severity * this.diff.hazardScale;
      // Impact scales with how fast you were going when you hit it.
      const speedFactor = 0.35 + (this.speed / XM30.mobility.maxSpeed) * 1.4;
      const damage = severity * 14 * speedFactor;

      this.mobility = Math.max(0, this.mobility - damage);
      this.hull = Math.max(0, this.hull - damage * 0.45);
      // A big strike also scrubs speed off and kicks the hull.
      this.speed = Math.max(0, this.speed - severity * 3.4 * speedFactor);
      this._pitchVel -= severity * 1.6;
      this._rollVel += Math.sign(dx || 1) * severity * 1.1;

      this.lastCollision = { hazard: h, damage };
      this.collisions.push(this.lastCollision);
      if (this.hull <= 0) this.destroyed = true;
    }
  }

  /** Applies damage from an enemy weapon. */
  takeHit(threatKey) {
    const t = XM30.protection.threat[threatKey] || XM30.protection.threat.smallArms;
    const scale = this.diff.damageScale;
    this.hull = Math.max(0, this.hull - t.hull * scale);
    this.mobility = Math.max(0, this.mobility - t.mob * scale);
    this._pitchVel -= 0.5 * scale;
    this._rollVel += (Math.random() - 0.5) * scale;
    if (this.hull <= 0) this.destroyed = true;
    return t;
  }
}

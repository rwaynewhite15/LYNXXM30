/**
 * ===========================================================================
 *  LYNX XM30 — DIMENSIONAL REFERENCE
 * ===========================================================================
 *
 *  The XM30 Mechanized Infantry Combat Vehicle is the U.S. Army programme to
 *  replace the M2 Bradley (formerly OMFV). American Rheinmetall Vehicles'
 *  offering is derived from the Rheinmetall Lynx KF41, re-armed with the
 *  50 mm XM913 cannon in place of the KF41's 35 mm Wotan.
 *
 *  Every number below is in SI units: metres, radians, kilograms, seconds.
 *
 *  AXES — the whole project uses one right-handed frame:
 *
 *      +Z = forward (the direction of travel)
 *      +Y = up
 *      -X = starboard        (+X = port)
 *
 *  The starboard sign is not arbitrary: for a right-handed frame with forward
 *  +Z and up +Y, the right-hand vector is F x U = Z x Y = -X. So the driver,
 *  who sits front-LEFT on a Lynx, has a POSITIVE x offset, and the powerpack,
 *  front-right, has a negative one.
 *
 *  PROVENANCE — please read before treating any of this as authoritative:
 *
 *    [P] "published"  — figures Rheinmetall / the Army have released publicly
 *                       (overall envelope, weight, crew, powerplant, speed).
 *    [D] "derived"    — computed from a published figure plus a proportion
 *                       measured off published orthographic-ish side views.
 *    [E] "estimated"  — scaled off reference photography by eye. Plausible
 *                       and self-consistent, but not engineering data.
 *
 *  This is a game asset. It is dimensionally faithful at the envelope level
 *  and honest about proportion everywhere else; it is NOT CAD, contains no
 *  controlled information, and should not be used as such.
 * ===========================================================================
 */

const DEG = Math.PI / 180;

export const XM30 = {

  meta: {
    designation: 'XM30',
    family: 'Rheinmetall Lynx KF41',
    role: 'Mechanized Infantry Combat Vehicle',
    crew: 3,            // [P] driver, gunner, commander
    dismounts: 6,       // [P] 6 for the XM30 configuration (KF41 carries up to 8)
  },

  /* ---------------------------------------------------------------- hull */
  hull: {
    length:        7.73,   // [P] hull length, excluding gun overhang
    widthOverall:  3.60,   // [P] across the side-armour / skirt line
    widthHull:     3.06,   // [D] structural tub, inboard of the applique modules
    heightRoof:    2.24,   // [D] ground to hull roof (overall 3.30 less turret stack)
    groundClear:   0.45,   // [P] nominal hull-floor clearance

    // Belly is a shallow V — mine/IED deflection. Depth below the tub floor.
    bellyVee:      0.16,   // [E]

    // Glacis. The Lynx nose is a two-plane front: a short steep lower plate
    // off the belly, then a long upper glacis running back to the roof line.
    lowerGlacisAngle: 52 * DEG,  // [E] from horizontal
    upperGlacisAngle: 38 * DEG,  // [E] from horizontal — the Lynx nose is tall
                                 //     and blunt, not a long shallow wedge
    noseLength:       1.90,      // [D] longitudinal run of the two glacis plates

    // Height of the sponson line: below it the tub narrows to clear the
    // tracks, above it the hull widens out over them.
    sponsonY:      1.18,   // [E]
    tubHalfWidth:  1.06,   // [E] half-width below the sponson line

    // Rear plate is close to vertical with a slight rearward lean.
    rearRake:      5 * DEG,      // [E] top of the rear plate overhangs slightly

    // Side armour modules stand proud of the tub and tilt out at the top.
    sideModuleThickness: 0.14,   // [E]
    sideModuleFlare:     4 * DEG,// [E]

    // Powerpack is front-right, driver front-left — this asymmetry is visible
    // as a raised engine deck and a set of louvred intakes on the right.
    engineDeckWidth:  1.36,      // [E]
    engineDeckRise:   0.10,      // [E] deck sits proud of the roof
    driverHatchX:     0.86,      // [E] lateral offset; +X is port, so the
                                 //     driver sits front-left as on the Lynx
    driverHatchZ:     1.95,      // [E] longitudinal, just aft of the glacis join

    // Rear ramp aperture
    rampWidth:   1.52,           // [E]
    rampHeight:  1.60,           // [E]
  },

  /* -------------------------------------------------------- running gear */
  // KF41 rides on seven road wheels per side, torsion-bar sprung, with the
  // drive sprocket forward (front-mounted powerpack) and the idler at the rear.
  track: {
    roadWheels:     7,        // [P]
    wheelDiameter:  0.62,     // [E]
    wheelWidth:     0.17,     // [E] each station is a doubled wheel pair
    wheelGap:       0.10,     // [E] gap between the pair
    firstWheelZ:    2.52,     // [D] centre of the #1 station, forward of hull centre
    wheelPitch:     0.855,    // [D] (firstWheelZ - lastWheelZ) / 6
    sprocketRadius: 0.35,     // [E]
    sprocketZ:      3.34,     // [E]
    idlerRadius:    0.31,     // [E]
    idlerZ:        -3.30,     // [E]
    returnRollers:  3,        // [E]
    rollerRadius:   0.10,     // [E]
    trackWidth:     0.51,     // [E]
    trackGauge:     2.63,     // [D] centreline-to-centreline of the two runs
    trackThickness: 0.055,    // [E]
    shoeLength:     0.19,     // [E] one track link, used for the scroll rate
    travel:         0.42,     // [E] wheel vertical travel available
  },

  /* -------------------------------------------------------------- turret */
  // Two-man turret in the Lance 2.0 lineage: faceted, low, with the gunner's
  // sight forward-right of the gun and an independent commander's panoramic
  // sight on a pedestal to the left — the "hunter-killer" arrangement.
  turret: {
    ringZ:        -0.28,      // [E] ring centre, just aft of hull centre
    ringRadius:    0.92,      // [E]
    basketHeight:  0.20,      // [E] ring/collar height above the roof
    length:        2.98,      // [E] front face to bustle rear
    width:         2.34,      // [E] at the widest, across the cheeks
    height:        0.80,      // [E] roof of the turret above the collar
    frontWedge:    0.75,      // [E] longitudinal depth of the sloped cheeks
    cheekAngle:    38 * DEG,  // [E] plan-view convergence of the cheeks
    faceAngle:     22 * DEG,  // [E] front plate slope from vertical
    bustleLength:  0.94,      // [E]
    bustleWidth:   1.74,      // [E]

    trunnionZ:     0.42,      // [E] gun trunnion, forward of the ring centre
    trunnionY:     0.40,      // [E] height above the turret collar

    elevMax:  45 * DEG,       // [E] the XM30 requirement emphasises high elevation
    elevMin:  -10 * DEG,      // [E]
    traverse: Math.PI * 2,    // [P] full 360°

    slewRate:    60 * DEG,    // [E] rad/s power traverse
    elevRate:    45 * DEG,    // [E] rad/s
  },

  /* ------------------------------------------------------------ armament */
  mainGun: {
    name:      'XM913',
    calibre:    0.050,        // [P] 50 mm × 228
    barrelLength: 3.42,       // [E] exposed tube forward of the mantlet
    muzzleVelocity: 1150,     // [E] m/s, AP; used for the ballistic solution
    // Rate of fire: the Bushmaster III family is dual-feed, ~200 rpm.
    cyclicRpm:  200,          // [E]
    recoil:     0.16,         // [E] visible tube travel
    ammo: {
      ap:  { name: '50mm AP',   rounds: 90,  vel: 1150, damage: 100, splash: 0.0 },
      abm: { name: '50mm ABM',  rounds: 70,  vel:  980, damage:  55, splash: 3.4 },
    },
  },

  coax: {
    name: 'M240 coax',
    calibre: 0.00762,
    muzzleVelocity: 850,      // [E]
    cyclicRpm: 650,           // [E]
    rounds: 1400,
    damage: 26,
    // Mounted to port of the main gun in the mantlet.
    offset: { x: 0.34, y: -0.06, z: 0.0 },   // [E]
  },

  atgm: {
    name: 'Spike LR2',        // launcher pod is an optional turret-side fit
    tubes: 2,
    side: 1,                  // +1 = port side of the turret
  },

  smoke: {
    banksPerSide: 1,
    tubesPerBank: 4,          // [E] 76 mm multi-barrel dischargers
    tubeLength: 0.30,         // [E]
    tubeRadius: 0.042,        // [E]
    elevation:  38 * DEG,     // [E]
    splay:      13 * DEG,     // [E] fan angle between tubes
  },

  /* --------------------------------------------------------------- sights */
  // Both seats look through stabilised electro-optical heads. Field of view
  // figures are typical of a modern IFV sight with 3 discrete magnifications.
  sights: {
    gunner: {
      // Head sits forward-right on the turret roof, boresighted to the gun.
      mount: { x: -0.62, y: 0.52, z: 0.86 },  // [E] turret-local, starboard of the gun
      // Vertical FOV per magnification step, in degrees.
      fov: [18.0, 6.0, 2.0],
      labels: ['WIDE 1.6×', 'MED 4.8×', 'NARROW 14×'],
      // Rough magnification implied by each FOV, for the HUD.
      mag: [1.6, 4.8, 14.0],
    },
    commander: {
      // Panoramic head on a pedestal, left of and above the gunner's sight so
      // it clears the gun in all elevations.
      mount: { x: 0.56, y: 0.86, z: 0.34 },   // [E] turret-local, port and raised
      fov: [30.0, 10.0, 3.4],
      labels: ['WIDE 1.0×', 'MED 3.0×', 'NARROW 8.8×'],
      mag: [1.0, 3.0, 8.8],
      // The commander's head traverses independently of the turret.
      slewRate: 90 * DEG,
    },
    // Range-finder characteristics used by the ranging model.
    lrf: {
      minRange: 40,
      maxRange: 6000,
      beamDivergence: 0.30 * DEG,   // narrow enough to bracket a window
      cycleTime: 0.55,              // seconds between lases
    },
  },

  /* ------------------------------------------------------------ mobility */
  mobility: {
    combatWeight: 44000,      // [P] kg, base configuration
    enginePowerHp: 1140,      // [P] Liebherr V8 diesel
    maxSpeed: 70 / 3.6,       // [P] 70 km/h → m/s
    maxReverse: 25 / 3.6,     // [E]
    accel: 1.35,              // [E] m/s², a 44 t vehicle is not brisk
    brake: 3.6,               // [E] m/s²
    // Steering: tracked skid steer, but on a road at speed it behaves like a
    // slow-yaw wheeled vehicle. Peak yaw rate falls off as speed rises.
    yawRateLow:  0.85,        // [E] rad/s at crawl
    yawRateHigh: 0.30,        // [E] rad/s at top speed
    // Suspension response for the visible body roll / pitch.
    pitchGain: 0.030,         // [E]
    rollGain:  0.055,         // [E]
    suspFreq:  1.6,           // [E] Hz
    suspDamp:  0.55,          // [E]
  },

  /* --------------------------------------------------- survivability */
  protection: {
    hullPoints: 100,
    // Mobility kill threshold — below this the vehicle limps.
    mobilityPoints: 100,
    // Damage taken from each threat type.
    // Per-hit damage. A 44 t IFV with applique and a spall liner is not
    // killed by a single rocket; it is killed by taking hits all afternoon
    // because the crew kept letting shooters get their shot off first.
    threat: {
      rpg:  { hull: 11, mob: 8 },
      atgm: { hull: 26, mob: 18 },
      smallArms: { hull: 0.7, mob: 0 },
    },
  },
};

/**
 * Convenient derived values. Kept here (rather than sprinkled through the
 * builders) so the geometry has exactly one source of truth.
 */
const trackTop = XM30.track.trackThickness;              // top of the ground run
const wheelAxisY = trackTop + XM30.track.wheelDiameter / 2;

export const DERIVED = {
  /** Longitudinal centre of the last (rearmost) road-wheel station. */
  lastWheelZ: XM30.track.firstWheelZ - XM30.track.wheelPitch * (XM30.track.roadWheels - 1),

  /** Height of the road-wheel axis above the ground plane. */
  wheelAxisY,

  /** Drive sprocket and idler ride higher than the road wheels. */
  sprocketY: wheelAxisY + 0.41,   // [E]
  idlerY:    wheelAxisY + 0.16,   // [E]
  rollerY:   wheelAxisY + 0.60,   // [E] return rollers, under the skirt line

  /** Hull tub floor and roof planes, above the ground. */
  hullFloorY: XM30.hull.groundClear,
  hullRoofY:  XM30.hull.heightRoof,

  /** Turret ring plane == hull roof; turret roof should land near 3.30 m. */
  ringY: XM30.hull.heightRoof,
  turretRoofY:
    XM30.hull.heightRoof + XM30.turret.basketHeight + XM30.turret.height,

  /** Half-gauge of the two track runs. */
  trackHalfGauge: XM30.track.trackGauge / 2,

  /** Hull half-widths. */
  hullHalfWidth:    XM30.hull.widthHull / 2,
  overallHalfWidth: XM30.hull.widthOverall / 2,
};

/** Height over the commander's sight head — taller than the quoted 3.30 m. */
DERIVED.heightOverSights =
  DERIVED.turretRoofY + XM30.sights.commander.mount.y * 0.5;

export { DEG };
export default XM30;

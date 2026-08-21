/**
 * Every tunable in one place. Anything you'd want to change to alter how the
 * run feels lives here rather than being buried in a system.
 */

const DEG = Math.PI / 180;

export const CONFIG = {

  render: {
    // A long far plane is the whole point: targets must be able to start
    // genuinely small and grow as the range closes.
    far: 2400,
    near: 0.06,
    fogDensity: 0.00062,
    fogColor: 0xaeb9bb,
    shadowDistance: 90,
    maxPixelRatio: 2,
  },

  touch: {
    // A finger travels a fraction of the distance a mouse does, so the same
    // pixel delta has to cover much more of the sight picture.
    lookGain: 2.4,
    // Fraction of the steer pad's travel treated as centre, so a resting
    // thumb does not creep the vehicle across the road.
    steerDeadZone: 0.12,
  },

  /**
   * Graphics presets.
   *
   * The renderer is WebGL2 throughout, so the work always lands on the GPU;
   * these presets decide how much of it to ask for. Each one moves the four
   * settings that actually cost something — render resolution, shadow map
   * size and range, texture filtering, and how far ahead the route is built —
   * together, so a single choice stays coherent.
   */
  quality: {
    default: 'balanced',
    // Phones and tablets start lower; the player can still raise it.
    mobileDefault: 'low',
    presets: {
      minimal: {
        label: 'MINIMAL',
        renderScale: 0.75,
        shadows: false,
        softShadows: false,
        shadowMap: 1024,
        shadowDistance: 45,
        anisotropy: 1,
        streamAhead: 300,
      },
      low: {
        label: 'LOW',
        // Render scale is ABSOLUTE, not a fraction of the display's device
        // pixel ratio: on a Retina panel 1.0 halves the buffer and saves a lot
        // of fill rate, and on a 1x monitor 2.0 supersamples. Clamping these
        // to devicePixelRatio would make the setting do nothing at all on the
        // 1x displays most desktops still use.
        renderScale: 1.0,
        // Hard shadows rather than none: dropping them entirely flattens the
        // scene badly, and PCF costs a fraction of PCFSoft.
        shadows: true,
        softShadows: false,
        shadowMap: 1024,
        shadowDistance: 55,
        anisotropy: 4,
        streamAhead: 460,
      },
      balanced: {
        label: 'BALANCED',
        renderScale: 1.5,
        shadows: true,
        softShadows: true,
        shadowMap: 2048,
        shadowDistance: 90,
        anisotropy: 8,
        streamAhead: 780,
      },
      high: {
        label: 'HIGH',
        renderScale: 2.0,
        shadows: true,
        softShadows: true,
        shadowMap: 4096,
        shadowDistance: 150,
        anisotropy: 16,
        streamAhead: 1150,
      },
    },

    // Adaptive resolution. Frames that run long trim the render scale; frames
    // with headroom give it back, up to the preset's own ceiling.
    adaptive: true,
    adjustInterval: 0.75,   // seconds between decisions
    slowFrameMs: 22,        // below ~45 fps: back off
    fastFrameMs: 13,        // above ~77 fps: there is room to spare
    resStep: 0.1,
    minResScale: 0.6,
    // Hard ceiling on the drawing buffer, whatever a preset asks for.
    maxRenderScale: 2.0,
  },

  route: {
    // A run is a fixed stretch of road. Reaching the end is the win state.
    length: 4000,
    briefingHint: 'Route SIERRA — 4 km. Expect dismounted contacts in windows, on balconies and on rooftops.',
  },

  world: {
    chunkLength: 60,
    streamAhead: 780,       // metres of route built ahead of the vehicle
    keepBehind: 90,
    stripLength: 2200,      // length of the recentring ground/road strips
    groundWidth: 420,
    pavementWidth: 3.2,

    // A street has a building LINE. Too much jitter and the buildings set
    // further back are permanently masked by their neighbours, which quietly
    // makes half the firing positions unusable.
    buildingSetback: 10.8,
    buildingSetbackJitter: 1.6,
    buildingGapChance: 0.22,

    hazardsPerChunkMax: 3,
    hazardMinGap: 16,
  },

  vehicle: {
    // Road speed the driver holds unless the player orders otherwise.
    cruiseSpeed: 34 / 3.6,
    minSpeed: 8 / 3.6,
    maxSpeed: 62 / 3.6,
    speedStep: 4 / 3.6,
    // Lateral limit: the vehicle stays on the carriageway and its shoulders.
    lateralLimit: 5.2,
    steerRate: 2.1,         // m/s of lateral velocity per unit of input
    steerAccel: 5.0,
    steerReturn: 1.8,
    // Visible body motion.
    bumpAmplitude: 0.022,
    bumpFrequency: 1.35,
  },

  turret: {
    // Mouse sensitivity is scaled by the sight's field of view so a given
    // hand movement always covers the same fraction of the sight picture.
    sensitivity: 0.0022,
    stabilised: true,
    // Lay error the stabiliser can't remove, radians. Grows with speed.
    jitterBase: 0.00035,
    jitterPerMs: 0.00013,
  },

  gunnery: {
    // Gravity drop is modelled, so the reticle's aiming mark is only correct
    // at the ranged distance — the drop chevrons exist for everything else.
    gravity: 9.81,
    // Rounds are traced, not instantaneous, which matters at 800 m+.
    tracerSpeedScale: 1.0,
    burstLength: 3,
    burstGap: 0.42,
    coaxSpread: 0.0022,
    mainSpread: 0.00055,
    // A hit inside this fraction of a target's silhouette counts.
    hitPadding: 0.28,
  },

  perception: {
    /**
     * Johnson-criteria-flavoured recognition ladder. A target is DETECTED,
     * then RECOGNISED, then IDENTIFIED as its apparent angular size grows.
     *
     * Thresholds are in APPARENT milliradians: the true subtense of the
     * target multiplied by the sight's magnification. That coupling is the
     * whole mechanic — you can close the range, or you can narrow the field
     * of view, and both move a contact up the ladder. Narrowing costs you
     * search area, so the two seats end up wanting different zooms.
     *
     * These aren't the real Johnson numbers (which are line-pairs across the
     * critical dimension); they're a playable analogue with the same shape.
     *
     * For a 1.78 m figure:
     *     600 m, 1.6x wide   ->  4.7 apparent mils  -> DETECT
     *     600 m, 4.8x medium -> 14.2                -> RECOGNISE
     *     600 m, 14x narrow  -> 41.5                -> IDENTIFY
     *     150 m, 1.6x wide   -> 19.0                -> RECOGNISE
     */
    detectMils: 2.5,
    recogniseMils: 9.0,
    identifyMils: 22.0,
    // Time the sight must dwell within this angle of a contact to progress.
    dwellAngle: 5.0 * DEG,
    dwellDetect: 0.25,
    dwellRecognise: 0.75,
    dwellIdentify: 1.25,
    // Contacts decay back down the ladder once they leave the sight picture.
    decayRate: 0.14,
    // Magnification multiplies effective resolution, so narrow FOV helps.
    magnificationGain: 1.0,
    // A contact that fires is instantly detected regardless of dwell.
    muzzleFlashDetect: true,
    // Designating from the spotter's seat hands the gunner a head start.
    designationBonus: 0.9,
    maxTrackedContacts: 14,
  },

  enemies: {
    // Targets appear inside this band ahead of the vehicle. Pushed much
    // further out and the street geometry masks them before you ever see
    // them; the far edge is about as far as a rooftop stays in line of sight.
    // Height of the crew's sights above the ground, used for line-of-sight.
    sightHeight: 3.05,
    // A position only counts as usable if it is unmasked by the time the
    // vehicle is this close to it.
    engageableFrom: 260,
    spawnBandNear: 150,
    spawnBandFar: 560,
    // Targets are placed this far apart along the route.
    minSpacing: 22,
    height: 1.78,          // a standing figure, for mil-relation ranging
    // Engagement behaviour.
    exposeDelay: [1.2, 4.0],
    aimTime: [2.4, 4.6],
    fireInterval: [4.5, 9.0],
    maxEngagementRange: 620,
    minEngagementRange: 40,
    // Rooftop shooters duck back down between engagements.
    popCycle: [2.6, 5.5],
    health: 100,
  },

  difficulty: {
    training: {
      label: 'TRAINING',
      speedScale: 0.72,
      enemyDensity: 0.55,
      enemyAimScale: 1.9,
      damageScale: 0.45,
      hazardScale: 0.6,
    },
    standard: {
      label: 'STANDARD',
      speedScale: 1.0,
      enemyDensity: 1.0,
      enemyAimScale: 1.0,
      damageScale: 1.0,
      hazardScale: 1.0,
    },
    gunnery: {
      label: 'GUNNERY TABLE',
      speedScale: 1.28,
      enemyDensity: 1.5,
      enemyAimScale: 0.78,
      damageScale: 1.15,
      hazardScale: 1.3,
    },
  },

  scoring: {
    kill: 100,
    killBeforeFired: 60,       // bonus for pre-empting a shooter
    identifyBonus: 25,
    designateBonus: 20,
    rangeBonusPerHundred: 12,  // reward for engaging further out
    hazardStrike: -80,
    hitTaken: -45,
    roundWasted: -2,
  },

  audio: {
    enabled: true,
    masterGain: 0.5,
  },
};

export { DEG };
export default CONFIG;

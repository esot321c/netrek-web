import { ShipType, PlanetFeature, Team, type ShipStats } from "./types";

// ---------------------------------------------------------------------------
// Core simulation
// ---------------------------------------------------------------------------

export const TICK_RATE = 10;
export const TICK_MS = 100;
export const GALAXY_WIDTH = 100_000;
export const GALAXY_HEIGHT = 100_000;

// ---------------------------------------------------------------------------
// Players & entities
// ---------------------------------------------------------------------------

export const MAX_PLAYERS = 16;
export const MAX_TORPS_PER_PLAYER = 8;
export const MAX_TORPS = MAX_PLAYERS * MAX_TORPS_PER_PLAYER; // 128
export const MAX_PHASERS = MAX_PLAYERS;
export const MAX_EXPLOSIONS = 32;
export const DIRECTION_COUNT = 256;

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

/** Game units per warp per tick. At warp 8 a CA moves 320 units/tick = 3200 units/sec. */
export const SPEED_SCALE = 40;

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

export const PHASER_COOLDOWN_TICKS = 10; // 1 second

export const DET_FUEL_COST = 100;
export const DET_WEAPON_HEAT = 20;
export const DET_RANGE = 1600;

export const TORP_LIFETIME_BASE = 50;
export const TORP_LIFETIME_VARIANCE = 20;
export const TORP_WOBBLE = 1.5; // direction units of random deflection per tick
export const TORP_HIT_RADIUS = 250; // game units — ship shield radius for torp impact

export const TORP_SPLASH_MAX_DIST = 2000;
export const TORP_SPLASH_DIVISOR = 1650;

// ---------------------------------------------------------------------------
// Temperature & overheat
// ---------------------------------------------------------------------------

export const OVERHEAT_BURNOUT_CHANCE = 1 / 40;
export const BURNOUT_MIN_TICKS = 100;
export const BURNOUT_RANDOM_TICKS = 150;

// ---------------------------------------------------------------------------
// Explosions
// ---------------------------------------------------------------------------

export const EXPLOSION_INNER_RADIUS = 350;
export const EXPLOSION_OUTER_RADIUS = 3000;
export const EXPLOSION_FALLOFF_DIVISOR = 2650;
export const EXPLOSION_DURATION_TICKS = 20; // 2 seconds visual

// ---------------------------------------------------------------------------
// Alert status thresholds
// ---------------------------------------------------------------------------

/** 1/7 galaxy width — yellow alert distance */
export const YELLOW_ALERT_DIST = Math.floor(GALAXY_WIDTH / 7);
/** Red alert distance — close range */
export const RED_ALERT_DIST = Math.floor(GALAXY_WIDTH / 20);

// ---------------------------------------------------------------------------
// Planets
// ---------------------------------------------------------------------------

export const PLANET_COUNT = 40;
export const PLANET_RADIUS_GU = 600; // visual radius in game units

/** Army growth interval in ticks (roughly every 40 seconds = 400 ticks) */
export const ARMY_POP_INTERVAL = 400;
/** Normal planet: 10% chance to pop */
export const ARMY_POP_CHANCE = 0.1;
/** Bonus chance when below threshold */
export const ARMY_POP_LOW_BONUS = 0.05;
/** Threshold for low-army bonus */
export const ARMY_POP_LOW_THRESHOLD = 4;
/** Agricultural planet: additional 20% chance */
export const ARMY_POP_AGRI_CHANCE = 0.2;
/** Max armies a pop can add (normal) */
export const ARMY_POP_MAX = 3;

/** Sentinel value for neutral/unowned planet team */
export const TEAM_NEUTRAL = 0xff;

// ---------------------------------------------------------------------------
// Orbit
// ---------------------------------------------------------------------------

/** Distance from planet center to enter orbit (game units) */
export const ORBIT_DIST = 900;
/** Distance from planet center at which pressing 'o' will engage orbit (auto-decel) */
export const ORBIT_ENGAGE_DIST = 1500;
/** Ship speed must be at or below this to orbit */
export const ORBIT_MAX_SPEED = 2;
/** Radius at which ship circles the planet (game units) */
export const ORBIT_RADIUS = 750;
/** Orbit angular speed in radians per tick (one full circle in ~6 seconds) */
export const ORBIT_ANGULAR_SPEED = (Math.PI * 2) / 60;

// ---------------------------------------------------------------------------
// Bombing
// ---------------------------------------------------------------------------

/** Minimum armies on planet to bomb */
export const BOMB_MIN_ARMIES = 5;
/** Ticks between bomb rolls (0.5 seconds = 5 ticks) */
export const BOMB_INTERVAL = 5;

// ---------------------------------------------------------------------------
// Beaming
// ---------------------------------------------------------------------------

/** Minimum armies on planet to beam up */
export const BEAM_MIN_ARMIES = 5;
/** Ticks between army transfers (0.8 seconds = 8 ticks) */
export const BEAM_INTERVAL = 8;

// ---------------------------------------------------------------------------
// Cloaking
// ---------------------------------------------------------------------------

/** Fuel cost per tick while cloaked (base, ship-dependent would be a multiplier) */
export const CLOAK_FUEL_PER_TICK = 10;
/** Ticks to uncloak (0.7 seconds = 7 ticks) */
export const UNCLOAK_TICKS = 7;
/** Position fuzz range for cloaked enemies (game units) */
export const CLOAK_FUZZ_RANGE = 3000;

// ---------------------------------------------------------------------------
// Tractor/Pressor
// ---------------------------------------------------------------------------

/** Fuel cost per tick for tractor/pressor (200 fuel/sec = 20/tick) */
export const TRACTOR_FUEL_PER_TICK = 20;
/** Engine heat per tick from tractor/pressor */
export const TRACTOR_ENGINE_HEAT = 5;

// ---------------------------------------------------------------------------
// Hostile planet damage
// ---------------------------------------------------------------------------

/** Base damage per tick from hostile planet (with armies > 0) */
export const HOSTILE_PLANET_DMG_BASE = 0.3;
/** Additional damage per tick per 10 armies on hostile planet */
export const HOSTILE_PLANET_DMG_PER_10 = 0.2;

// ---------------------------------------------------------------------------
// Refitting
// ---------------------------------------------------------------------------

/** Ticks to complete a refit (5 seconds = 50 ticks) */
export const REFIT_TICKS = 50;
/** Minimum shield percentage to refit */
export const REFIT_MIN_SHIELD_PCT = 0.75;
/** Minimum fuel percentage to refit */
export const REFIT_MIN_FUEL_PCT = 0.75;
/** Maximum hull damage percentage to refit */
export const REFIT_MAX_HULL_PCT = 0.75;

// ---------------------------------------------------------------------------
// Kill economy
// ---------------------------------------------------------------------------

/** Kills awarded per army bombed */
export const KILLS_PER_BOMB = 0.02;
/** Kills awarded for capturing a planet */
export const KILLS_PER_CAPTURE = 0.25;

// ---------------------------------------------------------------------------
// T-Mode
// ---------------------------------------------------------------------------

/** Minimum players per team to activate T-Mode */
export const TMODE_MIN_PLAYERS = 4;

// ---------------------------------------------------------------------------
// Win conditions
// ---------------------------------------------------------------------------

export const SURRENDER_PLANET_THRESHOLD = 2;
export const SURRENDER_FREEZE_PLANETS = 3;
export const SURRENDER_CLEAR_PLANETS = 4;
/** 20 minutes at 10Hz = 12000 ticks */
export const SURRENDER_TIMER_TICKS = 20 * 60 * 10;

/** Planet definition for initial placement */
export interface PlanetDef {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly team: number; // Team enum or TEAM_NEUTRAL
  readonly armies: number;
  readonly features: number; // bitmask of PlanetFeature
}

/** Starting army count for all planets */
export const PLANET_START_ARMIES = 17;

/**
 * 40 planets from the original Bronco Netrek server (ntserv/planet.c virginal array).
 * Fed=bottom-left, Rom=top-left, Kli=top-right, Ori=bottom-right.
 * Y=0 is top of galaxy.
 *
 * Only homeworlds have static REPAIR+FUEL. Other features (AGRI, REPAIR, FUEL)
 * are randomized at galaxy reset — see randomizePlanetFeatures().
 */
export const PLANET_DEFS: readonly PlanetDef[] = Object.freeze([
  // --- Federation (bottom-left quadrant) ---
  {
    name: "Earth",
    x: 20000,
    y: 80000,
    team: Team.FEDERATION,
    armies: PLANET_START_ARMIES,
    features: PlanetFeature.REPAIR | PlanetFeature.FUEL,
  },
  {
    name: "Rigel",
    x: 10000,
    y: 60000,
    team: Team.FEDERATION,
    armies: PLANET_START_ARMIES,
    features: 0,
  },
  {
    name: "Canopus",
    x: 25000,
    y: 60000,
    team: Team.FEDERATION,
    armies: PLANET_START_ARMIES,
    features: 0,
  },
  {
    name: "Beta Crucis",
    x: 44000,
    y: 81000,
    team: Team.FEDERATION,
    armies: PLANET_START_ARMIES,
    features: 0,
  },
  {
    name: "Organia",
    x: 39000,
    y: 55000,
    team: Team.FEDERATION,
    armies: PLANET_START_ARMIES,
    features: 0,
  },
  {
    name: "Deneb",
    x: 30000,
    y: 90000,
    team: Team.FEDERATION,
    armies: PLANET_START_ARMIES,
    features: 0,
  },
  {
    name: "Ceti Alpha V",
    x: 45000,
    y: 66000,
    team: Team.FEDERATION,
    armies: PLANET_START_ARMIES,
    features: 0,
  },
  {
    name: "Altair",
    x: 11000,
    y: 75000,
    team: Team.FEDERATION,
    armies: PLANET_START_ARMIES,
    features: 0,
  },
  {
    name: "Vega",
    x: 8000,
    y: 93000,
    team: Team.FEDERATION,
    armies: PLANET_START_ARMIES,
    features: 0,
  },
  {
    name: "Alpha Centauri",
    x: 32000,
    y: 74000,
    team: Team.FEDERATION,
    armies: PLANET_START_ARMIES,
    features: 0,
  },

  // --- Romulans (top-left quadrant) ---
  {
    name: "Romulus",
    x: 20000,
    y: 20000,
    team: Team.ROMULANS,
    armies: PLANET_START_ARMIES,
    features: PlanetFeature.REPAIR | PlanetFeature.FUEL,
  },
  {
    name: "Eridani",
    x: 45000,
    y: 7000,
    team: Team.ROMULANS,
    armies: PLANET_START_ARMIES,
    features: 0,
  },
  {
    name: "Aldeberan",
    x: 4000,
    y: 12000,
    team: Team.ROMULANS,
    armies: PLANET_START_ARMIES,
    features: 0,
  },
  {
    name: "Regulus",
    x: 42000,
    y: 44000,
    team: Team.ROMULANS,
    armies: PLANET_START_ARMIES,
    features: 0,
  },
  {
    name: "Capella",
    x: 13000,
    y: 45000,
    team: Team.ROMULANS,
    armies: PLANET_START_ARMIES,
    features: 0,
  },
  {
    name: "Tauri",
    x: 28000,
    y: 8000,
    team: Team.ROMULANS,
    armies: PLANET_START_ARMIES,
    features: 0,
  },
  {
    name: "Draconis",
    x: 28000,
    y: 23000,
    team: Team.ROMULANS,
    armies: PLANET_START_ARMIES,
    features: 0,
  },
  {
    name: "Sirius",
    x: 40000,
    y: 25000,
    team: Team.ROMULANS,
    armies: PLANET_START_ARMIES,
    features: 0,
  },
  {
    name: "Indi",
    x: 25000,
    y: 44000,
    team: Team.ROMULANS,
    armies: PLANET_START_ARMIES,
    features: 0,
  },
  {
    name: "Hydrae",
    x: 8000,
    y: 29000,
    team: Team.ROMULANS,
    armies: PLANET_START_ARMIES,
    features: 0,
  },

  // --- Klingons (top-right quadrant) ---
  {
    name: "Klingus",
    x: 80000,
    y: 20000,
    team: Team.KLINGONS,
    armies: PLANET_START_ARMIES,
    features: PlanetFeature.REPAIR | PlanetFeature.FUEL,
  },
  {
    name: "Pleiades V",
    x: 70000,
    y: 40000,
    team: Team.KLINGONS,
    armies: PLANET_START_ARMIES,
    features: 0,
  },
  {
    name: "Andromeda",
    x: 60000,
    y: 10000,
    team: Team.KLINGONS,
    armies: PLANET_START_ARMIES,
    features: 0,
  },
  {
    name: "Lalande",
    x: 56400,
    y: 38200,
    team: Team.KLINGONS,
    armies: PLANET_START_ARMIES,
    features: 0,
  },
  {
    name: "Praxis",
    x: 91120,
    y: 9320,
    team: Team.KLINGONS,
    armies: PLANET_START_ARMIES,
    features: 0,
  },
  {
    name: "Lyrae",
    x: 89960,
    y: 31760,
    team: Team.KLINGONS,
    armies: PLANET_START_ARMIES,
    features: 0,
  },
  {
    name: "Scorpii",
    x: 70720,
    y: 26320,
    team: Team.KLINGONS,
    armies: PLANET_START_ARMIES,
    features: 0,
  },
  {
    name: "Mira",
    x: 83600,
    y: 45400,
    team: Team.KLINGONS,
    armies: PLANET_START_ARMIES,
    features: 0,
  },
  {
    name: "Cygni",
    x: 54600,
    y: 22600,
    team: Team.KLINGONS,
    armies: PLANET_START_ARMIES,
    features: 0,
  },
  {
    name: "Achernar",
    x: 73080,
    y: 6640,
    team: Team.KLINGONS,
    armies: PLANET_START_ARMIES,
    features: 0,
  },

  // --- Orions (bottom-right quadrant) ---
  {
    name: "Orion",
    x: 80000,
    y: 80000,
    team: Team.ORIONS,
    armies: PLANET_START_ARMIES,
    features: PlanetFeature.REPAIR | PlanetFeature.FUEL,
  },
  {
    name: "Cassiopeia",
    x: 91200,
    y: 56600,
    team: Team.ORIONS,
    armies: PLANET_START_ARMIES,
    features: 0,
  },
  {
    name: "El Nath",
    x: 70800,
    y: 54200,
    team: Team.ORIONS,
    armies: PLANET_START_ARMIES,
    features: 0,
  },
  {
    name: "Spica",
    x: 57400,
    y: 62600,
    team: Team.ORIONS,
    armies: PLANET_START_ARMIES,
    features: 0,
  },
  {
    name: "Procyon",
    x: 72720,
    y: 70880,
    team: Team.ORIONS,
    armies: PLANET_START_ARMIES,
    features: 0,
  },
  {
    name: "Polaris",
    x: 61400,
    y: 77000,
    team: Team.ORIONS,
    armies: PLANET_START_ARMIES,
    features: 0,
  },
  {
    name: "Arcturus",
    x: 55600,
    y: 89000,
    team: Team.ORIONS,
    armies: PLANET_START_ARMIES,
    features: 0,
  },
  {
    name: "Ursae Majoris",
    x: 91000,
    y: 94000,
    team: Team.ORIONS,
    armies: PLANET_START_ARMIES,
    features: 0,
  },
  {
    name: "Herculis",
    x: 70000,
    y: 93000,
    team: Team.ORIONS,
    armies: PLANET_START_ARMIES,
    features: 0,
  },
  {
    name: "Antares",
    x: 86920,
    y: 68920,
    team: Team.ORIONS,
    armies: PLANET_START_ARMIES,
    features: 0,
  },
]);

/**
 * Core planet indices per team (4 each, close to homeworld).
 * Front planet indices per team (5 each, outer edge toward center).
 * Used by randomizePlanetFeatures().
 */
const TEAM_CORE: readonly number[][] = [
  [7, 9, 5, 8], // Fed: Altair, Alpha Centauri, Deneb, Vega
  [12, 19, 15, 16], // Rom: Aldeberan, Hydrae, Tauri, Draconis
  [24, 29, 25, 26], // Kli: Praxis, Achernar, Lyrae, Scorpii
  [34, 39, 38, 37], // Ori: Procyon, Antares, Herculis, Ursae Majoris
];
const TEAM_FRONT: readonly number[][] = [
  [1, 2, 4, 6, 3], // Fed: Rigel, Canopus, Organia, Ceti Alpha V, Beta Crucis
  [14, 18, 13, 17, 11], // Rom: Capella, Indi, Regulus, Sirius, Eridani
  [22, 28, 23, 21, 27], // Kli: Andromeda, Cygni, Lalande, Pleiades V, Mira
  [31, 32, 33, 35, 36], // Ori: Cassiopeia, El Nath, Spica, Polaris, Arcturus
];
const HOME_INDICES = [0, 10, 20, 30]; // Earth, Romulus, Klingus, Orion

/**
 * Randomize planet features (AGRI, REPAIR, FUEL) matching the original
 * Bronco server pl_reset() algorithm. Mutates the features field of
 * the provided planet states.
 *
 * Per team:
 *  - Homeworld always has REPAIR + FUEL (already set in PLANET_DEFS)
 *  - 2 AGRI total: 1 random core + 1 random front
 *  - 3 REPAIR total: homeworld + 1 random core + 1 random front
 *  - 5 FUEL total: homeworld + 2 random core + 2 random front
 */
export function randomizePlanetFeatures(planets: { features: number }[]): void {
  // Clear all features except homeworld REPAIR+FUEL
  for (let i = 0; i < planets.length; i++) {
    if (HOME_INDICES.includes(i)) {
      planets[i]!.features = PlanetFeature.REPAIR | PlanetFeature.FUEL;
    } else {
      planets[i]!.features = 0;
    }
  }

  for (let t = 0; t < 4; t++) {
    const core = [...TEAM_CORE[t]!];
    const front = [...TEAM_FRONT[t]!];

    // Shuffle each array
    for (let i = core.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [core[i], core[j]] = [core[j]!, core[i]!];
    }
    for (let i = front.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [front[i], front[j]] = [front[j]!, front[i]!];
    }

    // AGRI: 1 core + 1 front
    planets[core[0]!]!.features |= PlanetFeature.AGRICULTURAL;
    planets[front[0]!]!.features |= PlanetFeature.AGRICULTURAL;

    // REPAIR: 1 core + 1 front (homeworld already has it)
    planets[core[1]!]!.features |= PlanetFeature.REPAIR;
    planets[front[1]!]!.features |= PlanetFeature.REPAIR;

    // FUEL: 2 core + 2 front (homeworld already has it)
    planets[core[2]!]!.features |= PlanetFeature.FUEL;
    planets[core[3]!]!.features |= PlanetFeature.FUEL;
    planets[front[2]!]!.features |= PlanetFeature.FUEL;
    planets[front[3]!]!.features |= PlanetFeature.FUEL;
  }
}

// ---------------------------------------------------------------------------
// Ship stats table — source of truth from Spec.md + Bronco defaults
// ---------------------------------------------------------------------------

export const SHIP_STATS: Readonly<Record<ShipType, ShipStats>> = Object.freeze({
  [ShipType.SC]: {
    maxSpeed: 12,
    cruiseSpeed: 8,
    combatSpeed: 6,
    maxShields: 75,
    maxHull: 75,
    maxFuel: 5000,
    maxArmies: 2,
    armiesPerKill: 2,
    torpSpeed: 16,
    torpDamage: 25,
    phaserDamage: 75,
    maxPhaserRange: 4500,
    shieldCostPerTick: 2,
    tractorStrength: 2000,
    tractorRange: 0.7,
    engineCooling: 8,
    weaponCooling: 2,
    fuelRecharge: 6,
    shieldRepairRate: 2,
    hullRepairRate: 1,
    accelRate: 1.5,
    decelRate: 2.0,
    baseTurnRate: 40,
    phaserFuelMultiplier: 7,
    torpFuelMultiplier: 7,
    phaserHeat: 75,
    torpHeat: 25,
    explosionDamage: 75,
    maxWpnTemp: 1000,
    maxEgnTemp: 1000,
  },
  [ShipType.DD]: {
    maxSpeed: 10,
    cruiseSpeed: 7,
    combatSpeed: 5,
    maxShields: 85,
    maxHull: 85,
    maxFuel: 7000,
    maxArmies: 5,
    armiesPerKill: 1.67,
    torpSpeed: 14,
    torpDamage: 30,
    phaserDamage: 85,
    maxPhaserRange: 5100,
    shieldCostPerTick: 3,
    tractorStrength: 2500,
    tractorRange: 0.9,
    engineCooling: 7,
    weaponCooling: 2,
    fuelRecharge: 8,
    shieldRepairRate: 2,
    hullRepairRate: 1,
    accelRate: 1.2,
    decelRate: 1.5,
    baseTurnRate: 36,
    phaserFuelMultiplier: 7,
    torpFuelMultiplier: 7,
    phaserHeat: 85,
    torpHeat: 30,
    explosionDamage: 100,
    maxWpnTemp: 1000,
    maxEgnTemp: 1000,
  },
  [ShipType.CA]: {
    maxSpeed: 9,
    cruiseSpeed: 6,
    combatSpeed: 4,
    maxShields: 100,
    maxHull: 100,
    maxFuel: 10000,
    maxArmies: 10,
    armiesPerKill: 2,
    torpSpeed: 12,
    torpDamage: 40,
    phaserDamage: 100,
    maxPhaserRange: 6000,
    shieldCostPerTick: 3,
    tractorStrength: 3000,
    tractorRange: 1.0,
    engineCooling: 6,
    weaponCooling: 2,
    fuelRecharge: 8,
    shieldRepairRate: 2,
    hullRepairRate: 1,
    accelRate: 1.0,
    decelRate: 1.2,
    baseTurnRate: 32,
    phaserFuelMultiplier: 7,
    torpFuelMultiplier: 7,
    phaserHeat: 100,
    torpHeat: 40,
    explosionDamage: 100,
    maxWpnTemp: 1000,
    maxEgnTemp: 1000,
  },
  [ShipType.BB]: {
    maxSpeed: 8,
    cruiseSpeed: 4,
    combatSpeed: 3,
    maxShields: 130,
    maxHull: 130,
    maxFuel: 14000,
    maxArmies: 6,
    armiesPerKill: 2,
    torpSpeed: 12,
    torpDamage: 40,
    phaserDamage: 105,
    maxPhaserRange: 6300,
    shieldCostPerTick: 3,
    tractorStrength: 3700,
    tractorRange: 1.2,
    engineCooling: 6,
    weaponCooling: 2,
    fuelRecharge: 10,
    shieldRepairRate: 2,
    hullRepairRate: 1,
    accelRate: 0.8,
    decelRate: 1.0,
    baseTurnRate: 28,
    phaserFuelMultiplier: 10,
    torpFuelMultiplier: 10,
    phaserHeat: 105,
    torpHeat: 40,
    explosionDamage: 100,
    maxWpnTemp: 1000,
    maxEgnTemp: 1000,
  },
  [ShipType.AS]: {
    maxSpeed: 8,
    cruiseSpeed: 8,
    combatSpeed: 4,
    maxShields: 80,
    maxHull: 200,
    maxFuel: 6000,
    maxArmies: 20,
    armiesPerKill: 3,
    torpSpeed: 16,
    torpDamage: 30,
    phaserDamage: 80,
    maxPhaserRange: 4800,
    shieldCostPerTick: 3,
    tractorStrength: 2500,
    tractorRange: 0.7,
    engineCooling: 6,
    weaponCooling: 2,
    fuelRecharge: 6,
    shieldRepairRate: 2,
    hullRepairRate: 1,
    accelRate: 1.0,
    decelRate: 1.2,
    baseTurnRate: 32,
    phaserFuelMultiplier: 14,
    torpFuelMultiplier: 14,
    phaserHeat: 80,
    torpHeat: 30,
    explosionDamage: 100,
    maxWpnTemp: 1000,
    maxEgnTemp: 1200,
  },
  [ShipType.SB]: {
    maxSpeed: 2,
    cruiseSpeed: 2,
    combatSpeed: 2,
    maxShields: 500,
    maxHull: 600,
    maxFuel: 60000,
    maxArmies: 25,
    armiesPerKill: 0,
    torpSpeed: 14,
    torpDamage: 30,
    phaserDamage: 120,
    maxPhaserRange: 7200,
    shieldCostPerTick: 6,
    tractorStrength: 8000,
    tractorRange: 1.5,
    engineCooling: 6,
    weaponCooling: 3,
    fuelRecharge: 40,
    shieldRepairRate: 4,
    hullRepairRate: 2,
    accelRate: 0.5,
    decelRate: 0.5,
    baseTurnRate: 16,
    phaserFuelMultiplier: 28,
    torpFuelMultiplier: 28,
    phaserHeat: 120,
    torpHeat: 30,
    explosionDamage: 200,
    maxWpnTemp: 1300,
    maxEgnTemp: 1000,
  },
});

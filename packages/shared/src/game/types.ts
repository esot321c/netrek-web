// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export enum Team {
  FEDERATION = 0,
  ROMULANS = 1,
  KLINGONS = 2,
  ORIONS = 3,
}

export enum ShipType {
  SC = 0,
  DD = 1,
  CA = 2,
  BB = 3,
  AS = 4,
  SB = 5,
}

export enum ShipStatus {
  ALIVE = 0,
  EXPLODING = 1,
  DEAD = 2,
}

export enum AlertStatus {
  GREEN = 0,
  YELLOW = 1,
  RED = 2,
}

export enum InputCommand {
  SET_DIRECTION = 1,
  SET_SPEED = 2,
  FIRE_TORP = 3,
  FIRE_PHASER = 4,
  SHIELD_TOGGLE = 5,
  REPAIR_TOGGLE = 6,
  DETONATE = 7,
  ORBIT = 8,
  BOMB = 9,
  BEAM_UP = 10,
  BEAM_DOWN = 11,
  CLOAK_TOGGLE = 12,
  TRACTOR = 13,
  PRESSOR = 14,
  REFIT = 15,
  LOCK = 16,
  DETONATE_SELF = 17,
  DOCK = 18,
  FIRE_PLASMA = 19,
}

/** Lock target type for autopilot navigation */
export enum LockType {
  NONE = 0,
  PLANET = 1,
  PLAYER = 2,
}

/** Planet feature flags (bitmask) */
export enum PlanetFeature {
  AGRICULTURAL = 1,
  REPAIR = 2,
  FUEL = 4,
}

// ---------------------------------------------------------------------------
// Ship stats (immutable per ship type)
// ---------------------------------------------------------------------------

export interface ShipStats {
  readonly maxSpeed: number;
  readonly cruiseSpeed: number;
  readonly combatSpeed: number;
  readonly maxShields: number;
  readonly maxHull: number;
  readonly maxFuel: number;
  readonly maxArmies: number;
  readonly armiesPerKill: number;
  readonly torpSpeed: number;
  readonly torpDamage: number;
  readonly phaserDamage: number;
  readonly maxPhaserRange: number;
  readonly shieldCostPerTick: number;
  readonly tractorStrength: number;
  readonly tractorRange: number;
  // Derived/additional constants
  readonly engineCooling: number;
  readonly weaponCooling: number;
  readonly fuelRecharge: number;
  readonly shieldRepairRate: number;
  readonly hullRepairRate: number;
  readonly accelRate: number;
  readonly decelRate: number;
  readonly baseTurnRate: number;
  readonly phaserFuelMultiplier: number;
  readonly torpFuelMultiplier: number;
  readonly phaserHeat: number;
  readonly torpHeat: number;
  readonly explosionDamage: number;
  readonly maxWpnTemp: number;
  readonly maxEgnTemp: number;
  readonly cloakFuelPerTick: number;
}

// ---------------------------------------------------------------------------
// Mutable game state (per-entity, per-tick)
// ---------------------------------------------------------------------------

export interface ShipState {
  slotIndex: number;
  team: Team;
  shipType: ShipType;
  status: ShipStatus;

  // Position & movement
  x: number;
  y: number;
  direction: number; // 0-255
  speed: number; // current warp (float)
  desiredSpeed: number;
  desiredDirection: number;

  // Health & resources
  shieldStrength: number;
  hullDamage: number;
  fuel: number;

  // Temperatures
  weaponTemp: number;
  engineTemp: number;

  // Flags
  shieldsUp: boolean;
  repairMode: boolean;
  cloaked: boolean;

  // Burnout timers
  engineBurnoutTicks: number;
  weaponBurnoutTicks: number;

  // Weapon cooldowns
  phaserCooldownTicks: number;

  // Combat stats
  kills: number;
  armies: number; // armies currently carried

  // Orbit state (-1 = not orbiting, otherwise planet index)
  orbitPlanetId: number;
  orbitAngle: number; // radians, current position around planet

  // Bombing state
  bombing: boolean;
  bombCooldownTicks: number; // ticks until next bomb roll (every 5 ticks = 0.5s)

  // Beaming state
  beaming: number; // 0 = not beaming, 1 = beam up, 2 = beam down
  beamCooldownTicks: number; // ticks until next army transfer (every 8 ticks = 0.8s)

  // Cloaking state
  uncloakTicks: number; // ticks remaining in uncloak transition (7 = 0.7s)

  // Tractor/pressor state
  tractorTarget: number; // slot of target ship (-1 = none)
  pressorTarget: number; // slot of target ship (-1 = none)

  // Refitting state
  refitTicks: number; // ticks remaining in refit freeze (50 = 5s)
  refitShipType: number; // ship type being refitted to (-1 = not refitting)

  // Lock — autopilot toward a planet (auto-orbit on arrival) or player (follow)
  lockType: LockType; // NONE, PLANET, or PLAYER
  lockTargetId: number; // planet index or player slot (-1 when NONE)

  // Explosion timer (while EXPLODING)
  explodeTicks: number;
  deathTick: number;

  // Damage attribution — slot of last ship that dealt weapon damage (-1 = none/environment)
  lastDamagedBySlot: number;

  // Owning player
  playerId: string;

  // Docking state
  dockedAt: number; // SB slot index this ship is docked at (-1 = not docked)
  dockedShips: number[]; // slot indices of ships docked at this SB (empty for non-SBs)
}

export interface TorpState {
  alive: boolean;
  x: number;
  y: number;
  dx: number; // velocity x component
  dy: number; // velocity y component
  ownerSlot: number;
  team: Team;
  damage: number;
  ticksRemaining: number;
}

export interface PhaserState {
  alive: boolean;
  ownerSlot: number;
  team: Team;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  damage: number;
  ticksRemaining: number;
}

export interface ExplosionState {
  alive: boolean;
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  ticksRemaining: number;
}

export interface PlasmaState {
  alive: boolean;
  ownerSlot: number;
  team: Team;
  x: number;
  y: number;
  direction: number; // 0-255
  targetSlot: number; // -1 if lost tracking
  ticksRemaining: number;
}

export interface PlanetState {
  planetId: number; // 0-39
  x: number;
  y: number;
  name: string;
  team: Team; // owner; -1 for neutral (use Team enum or sentinel)
  armies: number;
  features: number; // bitmask of PlanetFeature
  lastPopTick: number; // tick of last army growth attempt
}

export interface PlayerInput {
  command: InputCommand;
  tick: number;
  value: number; // direction for SET_DIRECTION, speed for SET_SPEED, angle for FIRE_PHASER/TORP
}

// ---------------------------------------------------------------------------
// Client-side deserialized state
// ---------------------------------------------------------------------------

export interface ClientShip {
  slotIndex: number;
  status: ShipStatus;
  team: Team;
  shipType: ShipType;
  x: number;
  y: number;
  direction: number;
  speed: number;
  shieldPct: number; // 0-1
  hullDamagePct: number; // 0-1
  fuelPct: number; // 0-1
  weaponTemp: number;
  engineTemp: number;
  shieldsUp: boolean;
  repairMode: boolean;
  cloaked: boolean;
  orbiting: boolean;
  bombing: boolean;
  beaming: number; // 0=none, 1=up, 2=down
  tractoring: boolean;
  pressoring: boolean;
  tractorTarget: number; // slot of target (-1 = none)
  pressorTarget: number; // slot of target (-1 = none)
  alertStatus: AlertStatus;
  docked: boolean;
}

export interface ClientTorp {
  x: number;
  y: number;
  ownerSlot: number;
  team: Team;
}

export interface ClientPhaser {
  ownerSlot: number;
  team: Team;
  targetX: number;
  targetY: number;
  damage: number;
}

export interface ClientExplosion {
  x: number;
  y: number;
  radius: number;
}

export interface ClientPlasma {
  x: number;
  y: number;
  ownerSlot: number;
  team: Team;
}

export interface ClientPlanet {
  planetId: number;
  x: number;
  y: number;
  name: string;
  team: number; // Team enum value or 0xFF for neutral
  armies: number;
  features: number; // bitmask of PlanetFeature
}

export interface ClientSelfExtra {
  kills: number;
  armies: number;
  phaserCooldown: number;
  engineBurnout: number;
  weaponBurnout: number;
  engineTemp: number;
  fuel: number;
  shieldStrength: number;
  hullDamage: number;
  orbitPlanetId: number; // -1 if not orbiting
  lockType: number; // LockType enum value
  lockTargetId: number; // planet index or player slot (-1 when NONE)
  tmode: boolean;
}

export interface ClientGameState {
  tick: number;
  recipientSlot: number;
  ships: ClientShip[];
  torps: ClientTorp[];
  phasers: ClientPhaser[];
  explosions: ClientExplosion[];
  plasmas: ClientPlasma[];
  planets: ClientPlanet[];
  self: ClientSelfExtra;
}

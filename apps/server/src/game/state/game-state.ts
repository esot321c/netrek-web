import {
  MAX_PLAYERS,
  MAX_TORPS,
  MAX_PHASERS,
  MAX_EXPLOSIONS,
  MAX_PLASMAS,
  SHIP_STATS,
  PLANET_DEFS,
  randomizePlanetFeatures,
  type ShipState,
  type TorpState,
  type PhaserState,
  type ExplosionState,
  type PlasmaState,
  type PlanetState,
  ShipType,
  ShipStatus,
  Team,
  LockType,
} from "@netrek/shared";

// ---------------------------------------------------------------------------
// Pre-allocated game state — zero GC in the hot path
// ---------------------------------------------------------------------------

function createShip(slotIndex: number): ShipState {
  return {
    slotIndex,
    team: Team.FEDERATION,
    shipType: ShipType.CA,
    status: ShipStatus.DEAD,
    x: 0,
    y: 0,
    direction: 0,
    speed: 0,
    desiredSpeed: 0,
    desiredDirection: 0,
    shieldStrength: 0,
    hullDamage: 0,
    fuel: 0,
    weaponTemp: 0,
    engineTemp: 0,
    shieldsUp: false,
    repairMode: false,
    cloaked: false,
    engineBurnoutTicks: 0,
    weaponBurnoutTicks: 0,
    phaserCooldownTicks: 0,
    kills: 0,
    armies: 0,
    orbitPlanetId: -1,
    orbitAngle: 0,
    bombing: false,
    bombCooldownTicks: 0,
    beaming: 0,
    beamCooldownTicks: 0,
    uncloakTicks: 0,
    tractorTarget: -1,
    pressorTarget: -1,
    refitTicks: 0,
    refitShipType: -1,
    lockType: LockType.NONE,
    lockTargetId: -1,
    explodeTicks: 0,
    deathTick: 0,
    lastDamagedBySlot: -1,
    playerId: "",
    dockedAt: -1,
    dockedShips: [],
  };
}

function createTorp(): TorpState {
  return {
    alive: false,
    x: 0,
    y: 0,
    dx: 0,
    dy: 0,
    ownerSlot: 0,
    team: Team.FEDERATION,
    damage: 0,
    ticksRemaining: 0,
  };
}

function createPhaser(): PhaserState {
  return {
    alive: false,
    ownerSlot: 0,
    team: Team.FEDERATION,
    x1: 0,
    y1: 0,
    x2: 0,
    y2: 0,
    damage: 0,
    ticksRemaining: 0,
  };
}

function createExplosion(): ExplosionState {
  return {
    alive: false,
    x: 0,
    y: 0,
    radius: 0,
    maxRadius: 0,
    ticksRemaining: 0,
  };
}

function createPlasma(): PlasmaState {
  return {
    alive: false,
    ownerSlot: 0,
    team: Team.FEDERATION,
    x: 0,
    y: 0,
    direction: 0,
    targetSlot: -1,
    ticksRemaining: 0,
  };
}

export class GameState {
  readonly ships: ShipState[];
  readonly torps: TorpState[];
  readonly phasers: PhaserState[];
  readonly explosions: ExplosionState[];
  readonly plasmas: PlasmaState[];
  readonly planets: PlanetState[];
  currentTick = 0;

  constructor() {
    this.ships = Array.from({ length: MAX_PLAYERS }, (_, i) => createShip(i));
    this.torps = Array.from({ length: MAX_TORPS }, () => createTorp());
    this.phasers = Array.from({ length: MAX_PHASERS }, () => createPhaser());
    this.explosions = Array.from({ length: MAX_EXPLOSIONS }, () =>
      createExplosion(),
    );
    this.plasmas = Array.from({ length: MAX_PLASMAS }, () => createPlasma());
    this.planets = PLANET_DEFS.map((def, i) => ({
      planetId: i,
      x: def.x,
      y: def.y,
      name: def.name,
      team: def.team as Team,
      armies: def.armies,
      features: def.features,
      lastPopTick: 0,
    }));

    // Randomize AGRI, REPAIR, FUEL per team (matching original Bronco pl_reset)
    randomizePlanetFeatures(this.planets);
  }

  /** Find an empty player slot. Returns -1 if full. */
  findEmptySlot(): number {
    for (let i = 0; i < this.ships.length; i++) {
      if (
        this.ships[i]!.status === ShipStatus.DEAD &&
        !this.ships[i]!.playerId
      ) {
        return i;
      }
    }
    return -1;
  }

  /** Initialize a ship at a slot for a joining player. */
  initShip(
    slot: number,
    team: Team,
    shipType: ShipType,
    playerId: string,
    x: number,
    y: number,
  ): void {
    const ship = this.ships[slot]!;
    const stats = SHIP_STATS[shipType];

    ship.team = team;
    ship.shipType = shipType;
    ship.status = ShipStatus.ALIVE;
    ship.playerId = playerId;

    ship.x = x;
    ship.y = y;
    ship.direction = Math.floor(Math.random() * 256);
    ship.speed = 0;
    ship.desiredSpeed = 0;
    ship.desiredDirection = ship.direction;

    ship.shieldStrength = stats.maxShields;
    ship.hullDamage = 0;
    ship.fuel = stats.maxFuel;

    ship.weaponTemp = 0;
    ship.engineTemp = 0;

    ship.shieldsUp = true;
    ship.repairMode = false;
    ship.cloaked = false;

    ship.engineBurnoutTicks = 0;
    ship.weaponBurnoutTicks = 0;
    ship.phaserCooldownTicks = 0;

    ship.kills = 0;
    ship.armies = 0;
    ship.orbitPlanetId = -1;
    ship.bombing = false;
    ship.bombCooldownTicks = 0;
    ship.beaming = 0;
    ship.beamCooldownTicks = 0;
    ship.uncloakTicks = 0;
    ship.tractorTarget = -1;
    ship.pressorTarget = -1;
    ship.refitTicks = 0;
    ship.refitShipType = -1;
    ship.lockType = LockType.NONE;
    ship.lockTargetId = -1;
    ship.explodeTicks = 0;
    ship.deathTick = 0;
    ship.lastDamagedBySlot = -1;
    ship.dockedAt = -1;
    ship.dockedShips = [];
  }

  /** Clear a ship slot (player left). */
  clearShip(slot: number): void {
    const ship = this.ships[slot]!;
    ship.status = ShipStatus.DEAD;
    ship.playerId = "";

    // Kill all torps owned by this player
    for (let i = 0; i < this.torps.length; i++) {
      if (this.torps[i]!.ownerSlot === slot) {
        this.torps[i]!.alive = false;
      }
    }
  }

  /** Allocate a torp from the pool for a player. Returns null if at max. */
  allocateTorp(ownerSlot: number): TorpState | null {
    // Count existing torps for this player
    let count = 0;
    let freeIdx = -1;
    for (let i = 0; i < this.torps.length; i++) {
      const t = this.torps[i]!;
      if (t.alive && t.ownerSlot === ownerSlot) {
        count++;
        if (count >= 8) return null; // MAX_TORPS_PER_PLAYER
      }
      if (!t.alive && freeIdx === -1) {
        freeIdx = i;
      }
    }
    if (freeIdx === -1) return null;
    return this.torps[freeIdx]!;
  }

  /** Allocate a phaser slot (one per player, overwrites). */
  allocatePhaser(ownerSlot: number): PhaserState {
    const p = this.phasers[ownerSlot]!;
    p.alive = true;
    return p;
  }

  /** Allocate an explosion from the pool. */
  allocateExplosion(): ExplosionState | null {
    for (let i = 0; i < this.explosions.length; i++) {
      if (!this.explosions[i]!.alive) {
        return this.explosions[i]!;
      }
    }
    return null;
  }

  /** Allocate a plasma from the pool. */
  allocatePlasma(): PlasmaState | null {
    for (let i = 0; i < this.plasmas.length; i++) {
      if (!this.plasmas[i]!.alive) return this.plasmas[i]!;
    }
    return null;
  }

  /** Reset all game state for a new game. */
  resetGame(): void {
    for (let i = 0; i < this.ships.length; i++) {
      this.clearShip(i);
    }
    for (let i = 0; i < this.torps.length; i++) {
      this.torps[i]!.alive = false;
    }
    for (let i = 0; i < this.phasers.length; i++) {
      this.phasers[i]!.alive = false;
    }
    for (let i = 0; i < this.explosions.length; i++) {
      this.explosions[i]!.alive = false;
    }
    for (let i = 0; i < this.plasmas.length; i++) {
      this.plasmas[i]!.alive = false;
    }

    for (let i = 0; i < PLANET_DEFS.length && i < this.planets.length; i++) {
      const def = PLANET_DEFS[i]!;
      const planet = this.planets[i]!;
      planet.team = def.team as Team;
      planet.armies = def.armies;
      planet.features = def.features;
      planet.lastPopTick = 0;
    }
    randomizePlanetFeatures(this.planets);
    this.currentTick = 0;
  }
}

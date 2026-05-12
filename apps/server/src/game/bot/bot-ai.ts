import {
  type ClientGameState,
  type ClientShip,
  type ClientPlanet,
  type PlayerInput,
  BotDifficulty,
  BotAIState,
  BotRole,
  InputCommand,
  Team,
  ShipStatus,
  distance,
  ORBIT_DIST,
  ORBIT_MAX_SPEED,
  SHIP_STATS,
  BEAM_MIN_ARMIES,
} from "@netrek/shared";
import {
  nearestEnemyShip,
  nearestFriendlyPlanet,
  nearestEnemyPlanet,
  nearestRepairPlanet,
  nearestFuelPlanet,
  enemyCarriers,
  friendlyBombers,
  directionTo,
} from "./bot-navigation";
import {
  selectTarget,
  shouldRetreat,
  shouldFirePhaser,
  shouldFireTorp,
} from "./bot-combat";

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

const ATTACK_TRIGGER_DIST = 10000;
const PATROL_ARRIVED_DIST = 1800;
const ESCORT_MIN_DIST = 2000;
const ESCORT_MAX_DIST = 3000;
const DEFEND_ENGAGE_DIST = 8000;
const ESCORT_ENGAGE_DIST = 8000;
const ORDER_EXPIRE_TICKS = 600;
const BOMB_WORTHWHILE_ARMIES = 5;
const BOMB_CLOAK_FUEL_THRESHOLD = 3000;
const RETREAT_DONE_HULL = 20;
const RETREAT_DONE_FUEL = 5000;
const TAKE_MAX_ENEMY_ARMIES = 4;
const TAKE_SPEED = 6;

const PATROL_SPEED = 5;
const ATTACK_SPEED = 8;
const RETREAT_SPEED = 9;
const BOMB_SPEED = 6;
const ESCORT_SPEED = 8;
const OGG_SPEED = 9;

const OGG_DETONATE_DIST = 500;

/** Ticks in PATROL before picking an offensive mission (~5 seconds) */
const PATROL_MISSION_TICKS = 50;

/** DEFEND: max ticks before rotating to a new planet */
const DEFEND_ROTATE_TICKS = 600;

/** Minimum armies for a planet to be worth defending */
const FRONTLINE_MIN_ARMIES = 8;

/** Proximity to infer which planet a bombing ship is at */
const BOMB_PROXIMITY = 2000;

/**
 * Approach zone multiplier for orbit deceleration.
 * Bot starts slowing at ORBIT_DIST * this value.
 */
const ORBIT_APPROACH_MULT = 8;

// ---------------------------------------------------------------------------
// BotBrain
// ---------------------------------------------------------------------------

export class BotBrain {
  currentState = BotAIState.PATROL;
  public slot: number;
  readonly enemyTeam: Team;
  readonly role: BotRole;

  // Per-state targets
  private patrolTargetPlanetId = -1;
  private attackTargetSlot = -1;
  private bombTargetPlanetId = -1;
  private escortTargetSlot = -1;
  private defendPlanetId = -1;
  private oggTargetSlot = -1;
  private takePlanetId = -1;
  private takePickupPlanetId = -1;
  private takePhase: "pickup" | "drop" = "pickup";
  private ticksInState = 0;

  // Mission memory — resume after ATTACK/RETREAT interruptions
  private savedMission: BotAIState = BotAIState.PATROL;
  private savedMissionTarget = -1;

  // Order override (from team chat commands)
  private orderState: BotAIState | null = null;
  private orderTargetId = -1;
  private orderExpiresTick = 0;

  constructor(
    readonly difficulty: BotDifficulty,
    readonly team: Team,
    slot: number,
    role: BotRole = BotRole.AGGRESSOR,
  ) {
    this.slot = slot;
    this.enemyTeam = team === Team.FEDERATION ? Team.ROMULANS : Team.FEDERATION;
    this.role = role;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  setOrder(state: BotAIState, targetId: number, currentTick: number): void {
    this.orderState = state;
    this.orderTargetId = targetId;
    this.orderExpiresTick = currentTick + ORDER_EXPIRE_TICKS;
  }

  clearOrder(): void {
    this.orderState = null;
    this.orderTargetId = -1;
    this.orderExpiresTick = 0;
  }

  think(gameState: ClientGameState): PlayerInput[] {
    const { tick, ships, planets, self } = gameState;

    const mySelf = ships.find(
      (s) => s.slotIndex === this.slot && s.status === ShipStatus.ALIVE,
    );
    if (!mySelf) return [];

    const { x: myX, y: myY } = mySelf;

    if (this.orderState !== null && tick >= this.orderExpiresTick) {
      this.clearOrder();
    }

    // -----------------------------------------------------------------------
    // Priority 1: RETREAT if hurt
    // -----------------------------------------------------------------------
    if (shouldRetreat(self, this.difficulty)) {
      if (this.currentState !== BotAIState.RETREAT) {
        this.saveMission();
        this.transition(BotAIState.RETREAT);
      }
      return this.doRetreat(myX, myY, tick, planets, self, mySelf);
    }

    // -----------------------------------------------------------------------
    // Priority 2: Active orders from team chat
    // -----------------------------------------------------------------------
    if (this.orderState !== null) {
      if (this.currentState !== this.orderState) {
        this.transitionWithTarget(this.orderState, this.orderTargetId);
      }
      return this.dispatchState(myX, myY, tick, gameState, mySelf);
    }

    // -----------------------------------------------------------------------
    // Priority 3: Proactive tactical responses (competent+)
    // -----------------------------------------------------------------------
    if (this.difficulty >= BotDifficulty.COMPETENT) {
      // OGG enemy carriers — high priority for non-defenders
      if (this.role !== BotRole.DEFENDER) {
        const carriers = enemyCarriers(this.team, ships, this.enemyTeam);
        if (carriers.length > 0) {
          const bestCarrier = selectTarget(myX, myY, carriers, this.difficulty);
          if (bestCarrier !== null) {
            const distToCarrier = distance(
              myX,
              myY,
              bestCarrier.x,
              bestCarrier.y,
            );
            const range =
              this.difficulty === BotDifficulty.VETERAN
                ? Infinity
                : ATTACK_TRIGGER_DIST * 2;
            if (distToCarrier <= range) {
              if (
                this.currentState !== BotAIState.OGG ||
                this.oggTargetSlot !== bestCarrier.slotIndex
              ) {
                this.saveMission();
                this.oggTargetSlot = bestCarrier.slotIndex;
                this.transition(BotAIState.OGG);
              }
              return this.dispatchState(myX, myY, tick, gameState, mySelf);
            }
          }
        }
      }

      // ESCORT friendly bombers (hunters only)
      if (this.role === BotRole.HUNTER) {
        const bombers = friendlyBombers(this.team, this.slot, ships);
        if (bombers.length > 0) {
          const bomber = bombers[0]!;
          if (
            this.currentState !== BotAIState.ESCORT ||
            this.escortTargetSlot !== bomber.slotIndex
          ) {
            this.saveMission();
            this.escortTargetSlot = bomber.slotIndex;
            this.transition(BotAIState.ESCORT);
          }
          return this.dispatchState(myX, myY, tick, gameState, mySelf);
        }
      }
    }

    // -----------------------------------------------------------------------
    // Priority 4: React to nearby enemies (all difficulties)
    // -----------------------------------------------------------------------
    {
      const nearby = nearestEnemyShip(
        myX,
        myY,
        this.team,
        this.slot,
        ships,
        this.enemyTeam,
      );
      if (nearby !== null) {
        const distToEnemy = distance(myX, myY, nearby.x, nearby.y);
        if (distToEnemy <= ATTACK_TRIGGER_DIST) {
          const best = selectTarget(myX, myY, [nearby], this.difficulty);
          if (best !== null && this.currentState !== BotAIState.ATTACK) {
            this.saveMission();
            this.attackTargetSlot = best.slotIndex;
            this.transition(BotAIState.ATTACK);
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // Priority 5: Role-based mission from PATROL
    // -----------------------------------------------------------------------
    if (
      this.currentState === BotAIState.PATROL &&
      this.ticksInState >= PATROL_MISSION_TICKS
    ) {
      this.pickMission(myX, myY, planets, ships, self);
    }

    // -----------------------------------------------------------------------
    // Execute current state
    // -----------------------------------------------------------------------
    const stateInputs = this.dispatchState(myX, myY, tick, gameState, mySelf);

    if (
      this.currentState !== BotAIState.BOMB &&
      this.currentState !== BotAIState.RETREAT &&
      this.currentState !== BotAIState.TAKE &&
      !mySelf.shieldsUp
    ) {
      return [
        { command: InputCommand.SHIELD_TOGGLE, value: 1, tick },
        ...stateInputs,
      ];
    }
    return stateInputs;
  }

  // ---------------------------------------------------------------------------
  // Mission picker — role-based offensive assignment
  // ---------------------------------------------------------------------------

  private pickMission(
    myX: number,
    myY: number,
    planets: ClientPlanet[],
    ships: ClientShip[],
    self: ClientGameState["self"],
  ): void {
    // All roles: escort a friendly carrier if one exists
    if (this.tryEscortCarrier(myX, myY, ships)) return;

    switch (this.role) {
      case BotRole.AGGRESSOR:
        this.pickAggressorMission(myX, myY, planets, ships, self);
        break;
      case BotRole.DEFENDER:
        this.pickDefenderMission(myX, myY, planets);
        break;
      case BotRole.HUNTER:
        this.pickHunterMission(myX, myY, planets, ships, self);
        break;
    }
  }

  private pickAggressorMission(
    myX: number,
    myY: number,
    planets: ClientPlanet[],
    ships: ClientShip[],
    self: ClientGameState["self"],
  ): void {
    // Take a bombed-down planet if we have enough capacity
    if (self.tmode && self.kills >= 1) {
      const takeable = this.findTakeablePlanetForCapacity(
        myX,
        myY,
        planets,
        self,
      );
      if (takeable !== null) {
        this.takePlanetId = takeable.planetId;
        this.takePhase = self.armies > 0 ? "drop" : "pickup";
        this.transition(BotAIState.TAKE);
        return;
      }
    }

    // Bomb an enemy planet
    const bombTarget = this.pickBombTarget(myX, myY, planets, ships);
    if (bombTarget !== null) {
      this.bombTargetPlanetId = bombTarget.planetId;
      this.transition(BotAIState.BOMB);
    }
  }

  private pickDefenderMission(
    myX: number,
    myY: number,
    planets: ClientPlanet[],
  ): void {
    const frontline = this.findFrontlinePlanet(myX, myY, planets);
    if (frontline !== null) {
      if (this.defendPlanetId !== frontline.planetId) {
        this.defendPlanetId = frontline.planetId;
        this.transition(BotAIState.DEFEND);
      } else if (this.ticksInState > DEFEND_ROTATE_TICKS) {
        this.defendPlanetId = frontline.planetId;
        this.transition(BotAIState.DEFEND);
      }
    }
  }

  private pickHunterMission(
    myX: number,
    myY: number,
    planets: ClientPlanet[],
    ships: ClientShip[],
    self: ClientGameState["self"],
  ): void {
    // Take planets when available and we have capacity
    if (self.tmode && self.kills >= 1) {
      const takeable = this.findTakeablePlanetForCapacity(
        myX,
        myY,
        planets,
        self,
      );
      if (takeable !== null) {
        this.takePlanetId = takeable.planetId;
        this.takePhase = self.armies > 0 ? "drop" : "pickup";
        this.transition(BotAIState.TAKE);
        return;
      }
    }

    // Go bomb — the journey through enemy space generates fights
    const bombTarget = this.pickBombTarget(myX, myY, planets, ships);
    if (bombTarget !== null) {
      this.bombTargetPlanetId = bombTarget.planetId;
      this.transition(BotAIState.BOMB);
    }
  }

  // ---------------------------------------------------------------------------
  // Target selection helpers
  // ---------------------------------------------------------------------------

  private pickBombTarget(
    myX: number,
    myY: number,
    planets: ClientPlanet[],
    ships: ClientShip[],
  ): ClientPlanet | null {
    // Find planets already being bombed by friendlies (using proximity)
    const bombedPlanetIds = new Set<number>();
    for (const s of ships) {
      if (s.slotIndex === this.slot) continue;
      if (s.team !== this.team) continue;
      if (!s.bombing) continue;
      for (const p of planets) {
        if (distance(s.x, s.y, p.x, p.y) <= BOMB_PROXIMITY) {
          bombedPlanetIds.add(p.planetId);
          break;
        }
      }
    }

    const candidates: { planet: ClientPlanet; score: number }[] = [];
    for (const p of planets) {
      if (p.team === this.team || (p.team as number) === 0xff) continue;
      if (p.armies < BOMB_WORTHWHILE_ARMIES) continue;
      if (bombedPlanetIds.has(p.planetId)) continue;

      const dist = distance(myX, myY, p.x, p.y);
      const score = dist - p.armies * 100 + Math.random() * 8000;
      candidates.push({ planet: p, score });
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.score - b.score);
    return candidates[0]!.planet;
  }

  /**
   * Find a takeable planet that this bot has enough capacity to capture
   * in a single trip. Requires capacity >= planet.armies + 1.
   */
  private findTakeablePlanetForCapacity(
    myX: number,
    myY: number,
    planets: ClientPlanet[],
    self: ClientGameState["self"],
  ): ClientPlanet | null {
    // We don't know our ship type from self, but we can look it up
    const mySelf = this.findMyShip(planets);
    if (!mySelf) return null;

    const stats = SHIP_STATS[mySelf.shipType];
    const capacity = Math.min(
      stats.maxArmies,
      Math.floor(self.kills * stats.armiesPerKill),
    );

    let best: ClientPlanet | null = null;
    let bestDist = Infinity;
    for (const p of planets) {
      if (p.team === this.team) continue;
      if (p.armies > TAKE_MAX_ENEMY_ARMIES) continue;
      // Need enough capacity to kill all defenders + 1 to capture
      if (capacity < p.armies + 1) continue;
      const d = distance(myX, myY, p.x, p.y);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    return best;
  }

  // Cache: populated during think() via the ships array
  private lastShipsRef: ClientShip[] | null = null;

  private findMyShip(_planets: ClientPlanet[]): ClientShip | null {
    // The ships array was captured during think() — use it
    if (!this.lastShipsRef) return null;
    return (
      this.lastShipsRef.find(
        (s) => s.slotIndex === this.slot && s.status === ShipStatus.ALIVE,
      ) ?? null
    );
  }

  /**
   * Look for a friendly ship that is beaming up (loading armies for a take
   * operation). If found, escort them to protect the carrier.
   */
  private tryEscortCarrier(
    myX: number,
    myY: number,
    ships: ClientShip[],
  ): boolean {
    // Don't override an existing escort
    if (this.currentState === BotAIState.ESCORT) return false;
    // Don't escort if we're already taking
    if (this.currentState === BotAIState.TAKE) return false;

    for (const s of ships) {
      if (s.slotIndex === this.slot) continue;
      if (s.team !== this.team) continue;
      if (s.status !== ShipStatus.ALIVE) continue;
      // Friendly is beaming up = loading armies for a take operation
      if (s.beaming === 1 || s.beaming === 2) {
        const dist = distance(myX, myY, s.x, s.y);
        // Only escort if reasonably close
        if (dist <= ATTACK_TRIGGER_DIST * 3) {
          this.saveMission();
          this.escortTargetSlot = s.slotIndex;
          this.transition(BotAIState.ESCORT);
          return true;
        }
      }
    }
    return false;
  }

  private findFrontlinePlanet(
    myX: number,
    myY: number,
    planets: ClientPlanet[],
  ): ClientPlanet | null {
    let best: ClientPlanet | null = null;
    let bestScore = -Infinity;

    for (const p of planets) {
      if (p.team !== this.team) continue;
      if (p.armies < FRONTLINE_MIN_ARMIES) continue;

      let minEnemyDist = Infinity;
      for (const ep of planets) {
        if (ep.team === this.team || (ep.team as number) === 0xff) continue;
        const d = distance(p.x, p.y, ep.x, ep.y);
        if (d < minEnemyDist) minEnemyDist = d;
      }

      const proximityScore = 100000 - minEnemyDist;
      const armyScore = p.armies * 200;
      const distPenalty = distance(myX, myY, p.x, p.y) * 0.3;
      const score = proximityScore + armyScore - distPenalty;

      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }

    return best;
  }

  // ---------------------------------------------------------------------------
  // Mission memory
  // ---------------------------------------------------------------------------

  private saveMission(): void {
    if (
      this.currentState === BotAIState.BOMB ||
      this.currentState === BotAIState.TAKE ||
      this.currentState === BotAIState.DEFEND ||
      this.currentState === BotAIState.ESCORT
    ) {
      this.savedMission = this.currentState;
      switch (this.currentState) {
        case BotAIState.BOMB:
          this.savedMissionTarget = this.bombTargetPlanetId;
          break;
        case BotAIState.TAKE:
          this.savedMissionTarget = this.takePlanetId;
          break;
        case BotAIState.DEFEND:
          this.savedMissionTarget = this.defendPlanetId;
          break;
        case BotAIState.ESCORT:
          this.savedMissionTarget = this.escortTargetSlot;
          break;
      }
    }
  }

  private resumeMission(): void {
    if (this.savedMission === BotAIState.PATROL) {
      this.transition(BotAIState.PATROL);
      return;
    }
    this.transitionWithTarget(this.savedMission, this.savedMissionTarget);
    this.savedMission = BotAIState.PATROL;
    this.savedMissionTarget = -1;
  }

  // ---------------------------------------------------------------------------
  // State dispatch
  // ---------------------------------------------------------------------------

  private dispatchState(
    myX: number,
    myY: number,
    tick: number,
    gs: ClientGameState,
    mySelf: ClientShip,
  ): PlayerInput[] {
    // Cache ships ref so findMyShip works in mission pickers
    this.lastShipsRef = gs.ships;

    switch (this.currentState) {
      case BotAIState.PATROL:
        return this.doPatrol(myX, myY, tick, gs.planets, mySelf);
      case BotAIState.ATTACK:
        return this.doAttack(myX, myY, tick, gs.ships, gs.self, mySelf);
      case BotAIState.BOMB:
        return this.doBomb(myX, myY, tick, gs.planets, gs.self, mySelf);
      case BotAIState.ESCORT:
        return this.doEscort(myX, myY, tick, gs.ships, gs.self, mySelf);
      case BotAIState.DEFEND:
        return this.doDefend(
          myX,
          myY,
          tick,
          gs.ships,
          gs.planets,
          gs.self,
          mySelf,
        );
      case BotAIState.OGG:
        return this.doOgg(myX, myY, tick, gs.ships, gs.self, mySelf);
      case BotAIState.RETREAT:
        return this.doRetreat(myX, myY, tick, gs.planets, gs.self, mySelf);
      case BotAIState.TAKE:
        return this.doTake(myX, myY, tick, gs.planets, gs.self, mySelf);
      default:
        return [];
    }
  }

  // ---------------------------------------------------------------------------
  // PATROL — strategic movement toward the front
  // ---------------------------------------------------------------------------

  private doPatrol(
    myX: number,
    myY: number,
    tick: number,
    planets: ClientPlanet[],
    mySelf: ClientShip,
  ): PlayerInput[] {
    this.ticksInState++;
    const inputs: PlayerInput[] = [];

    inputs.push(...shieldsUp(mySelf, tick));

    if (this.patrolTargetPlanetId === -1) {
      this.patrolTargetPlanetId = this.pickPatrolTarget(myX, myY, planets);
    }

    const target = planets.find(
      (p) => p.planetId === this.patrolTargetPlanetId,
    );
    if (!target) {
      this.patrolTargetPlanetId = this.pickPatrolTarget(myX, myY, planets);
      const fallback = planets.find(
        (p) => p.planetId === this.patrolTargetPlanetId,
      );
      if (fallback) {
        inputs.push(
          ...moveTo(myX, myY, fallback.x, fallback.y, PATROL_SPEED, tick),
        );
      }
      return inputs;
    }

    if (distance(myX, myY, target.x, target.y) <= PATROL_ARRIVED_DIST) {
      this.patrolTargetPlanetId = this.pickPatrolTarget(myX, myY, planets);
      const next = planets.find(
        (p) => p.planetId === this.patrolTargetPlanetId,
      );
      if (next) {
        inputs.push(...moveTo(myX, myY, next.x, next.y, PATROL_SPEED, tick));
      }
    } else {
      inputs.push(...moveTo(myX, myY, target.x, target.y, PATROL_SPEED, tick));
    }

    return inputs;
  }

  private pickPatrolTarget(
    myX: number,
    myY: number,
    planets: ClientPlanet[],
  ): number {
    const roll = Math.random();

    if (this.role === BotRole.DEFENDER) {
      const frontline = this.findFrontlinePlanet(myX, myY, planets);
      if (frontline) return frontline.planetId;
    } else {
      if (roll < 0.6) {
        const enemy = nearestEnemyPlanet(
          myX,
          myY,
          this.team,
          planets,
          this.enemyTeam,
        );
        if (enemy) return enemy.planetId;
      }
      if (roll < 0.85) {
        const frontline = this.findFrontlinePlanet(myX, myY, planets);
        if (frontline) return frontline.planetId;
      }
    }

    const friendly = planets.filter(
      (p) => p.team === this.team && p.planetId !== this.patrolTargetPlanetId,
    );
    if (friendly.length > 0) {
      return friendly[Math.floor(Math.random() * friendly.length)]!.planetId;
    }
    const nearest = nearestFriendlyPlanet(myX, myY, this.team, planets);
    return nearest?.planetId ?? -1;
  }

  // ---------------------------------------------------------------------------
  // ATTACK — resume previous mission when target is lost
  // ---------------------------------------------------------------------------

  private doAttack(
    myX: number,
    myY: number,
    tick: number,
    ships: ClientShip[],
    self: ClientGameState["self"],
    mySelf: ClientShip,
  ): PlayerInput[] {
    this.ticksInState++;
    const inputs: PlayerInput[] = [];

    inputs.push(...shieldsUp(mySelf, tick));

    const target = ships.find(
      (s) =>
        s.slotIndex === this.attackTargetSlot && s.status === ShipStatus.ALIVE,
    );
    if (!target) {
      this.resumeMission();
      return inputs;
    }

    const dist = distance(myX, myY, target.x, target.y);

    inputs.push(...moveTo(myX, myY, target.x, target.y, ATTACK_SPEED, tick));

    if (shouldFirePhaser(dist, self)) {
      inputs.push({
        command: InputCommand.FIRE_PHASER,
        value: directionTo(myX, myY, target.x, target.y),
        tick,
      });
    }
    if (shouldFireTorp(dist)) {
      inputs.push({
        command: InputCommand.FIRE_TORP,
        value: directionTo(myX, myY, target.x, target.y),
        tick,
      });
    }

    return inputs;
  }

  // ---------------------------------------------------------------------------
  // RETREAT — resume previous mission when healed
  // ---------------------------------------------------------------------------

  private doRetreat(
    myX: number,
    myY: number,
    tick: number,
    planets: ClientPlanet[],
    self: ClientGameState["self"],
    mySelf: ClientShip,
  ): PlayerInput[] {
    this.ticksInState++;
    const inputs: PlayerInput[] = [];

    if (self.hullDamage <= RETREAT_DONE_HULL && self.fuel > RETREAT_DONE_FUEL) {
      if (mySelf.repairMode) {
        inputs.push({ command: InputCommand.REPAIR_TOGGLE, value: 0, tick });
      }
      inputs.push(...shieldsUp(mySelf, tick));
      this.resumeMission();
      return inputs;
    }

    const fuelCritical = self.fuel < 1000;
    let dest: ClientPlanet | null = null;
    if (fuelCritical) {
      dest = nearestFuelPlanet(myX, myY, this.team, planets);
    }
    if (!dest) {
      dest = nearestRepairPlanet(myX, myY, this.team, planets);
    }
    if (!dest) {
      dest = nearestFriendlyPlanet(myX, myY, this.team, planets);
    }

    if (!dest) return inputs;

    if (mySelf.orbiting) {
      // In orbit: drop shields and repair
      if (mySelf.shieldsUp) {
        inputs.push({ command: InputCommand.SHIELD_TOGGLE, value: 0, tick });
      }
      if (!mySelf.repairMode) {
        inputs.push({ command: InputCommand.REPAIR_TOGGLE, value: 1, tick });
      }
      inputs.push({ command: InputCommand.SET_SPEED, value: 0, tick });
    } else {
      // Approach planet and try to orbit
      inputs.push(...shieldsUp(mySelf, tick));
      inputs.push(
        ...approachAndOrbit(myX, myY, dest.x, dest.y, RETREAT_SPEED, tick),
      );
    }

    return inputs;
  }

  // ---------------------------------------------------------------------------
  // BOMB
  // ---------------------------------------------------------------------------

  private doBomb(
    myX: number,
    myY: number,
    tick: number,
    planets: ClientPlanet[],
    self: ClientGameState["self"],
    mySelf: ClientShip,
  ): PlayerInput[] {
    this.ticksInState++;
    const inputs: PlayerInput[] = [];

    let target = planets.find((p) => p.planetId === this.bombTargetPlanetId);

    if (
      !target ||
      target.team === this.team ||
      target.armies < BOMB_WORTHWHILE_ARMIES
    ) {
      // Planet bombed down — try to take it if we have capacity
      if (
        target &&
        target.team !== this.team &&
        target.armies <= TAKE_MAX_ENEMY_ARMIES &&
        self.kills >= 1 &&
        self.tmode
      ) {
        const stats = SHIP_STATS[mySelf.shipType];
        const capacity = Math.min(
          stats.maxArmies,
          Math.floor(self.kills * stats.armiesPerKill),
        );
        if (capacity >= target.armies + 1) {
          this.takePlanetId = target.planetId;
          this.takePhase = "pickup";
          this.transition(BotAIState.TAKE);
          return inputs;
        }
      }

      const newTarget = nearestEnemyPlanet(
        myX,
        myY,
        this.team,
        planets,
        this.enemyTeam,
      );
      if (newTarget && newTarget.armies >= BOMB_WORTHWHILE_ARMIES) {
        this.bombTargetPlanetId = newTarget.planetId;
        target = newTarget;
      } else {
        this.transition(BotAIState.PATROL);
        return inputs;
      }
    }

    if (mySelf.orbiting) {
      // In orbit: shields must be DOWN for bombing
      if (mySelf.shieldsUp) {
        inputs.push({ command: InputCommand.SHIELD_TOGGLE, value: 0, tick });
      }
      if (!mySelf.bombing) {
        inputs.push({ command: InputCommand.BOMB, value: 1, tick });
      }

      if (
        this.difficulty >= BotDifficulty.COMPETENT &&
        !mySelf.cloaked &&
        self.fuel > BOMB_CLOAK_FUEL_THRESHOLD
      ) {
        inputs.push({ command: InputCommand.CLOAK_TOGGLE, value: 1, tick });
      }
    } else {
      // Approach and orbit
      inputs.push(...shieldsUp(mySelf, tick));
      inputs.push(
        ...approachAndOrbit(myX, myY, target.x, target.y, BOMB_SPEED, tick),
      );
    }

    return inputs;
  }

  // ---------------------------------------------------------------------------
  // DEFEND
  // ---------------------------------------------------------------------------

  private doDefend(
    myX: number,
    myY: number,
    tick: number,
    ships: ClientShip[],
    planets: ClientPlanet[],
    self: ClientGameState["self"],
    mySelf: ClientShip,
  ): PlayerInput[] {
    this.ticksInState++;
    const inputs: PlayerInput[] = [];

    inputs.push(...shieldsUp(mySelf, tick));

    const planet = planets.find((p) => p.planetId === this.defendPlanetId);
    if (!planet || planet.team !== this.team) {
      this.transition(BotAIState.PATROL);
      return inputs;
    }

    // Engage enemies threatening the defended planet
    const enemy = nearestEnemyShip(
      myX,
      myY,
      this.team,
      this.slot,
      ships,
      this.enemyTeam,
    );
    if (enemy !== null) {
      const distEnemyToPlanet = distance(enemy.x, enemy.y, planet.x, planet.y);
      if (distEnemyToPlanet <= DEFEND_ENGAGE_DIST) {
        const distToEnemy = distance(myX, myY, enemy.x, enemy.y);
        inputs.push(...moveTo(myX, myY, enemy.x, enemy.y, ATTACK_SPEED, tick));
        if (shouldFirePhaser(distToEnemy, self)) {
          inputs.push({
            command: InputCommand.FIRE_PHASER,
            value: directionTo(myX, myY, enemy.x, enemy.y),
            tick,
          });
        }
        if (shouldFireTorp(distToEnemy)) {
          inputs.push({
            command: InputCommand.FIRE_TORP,
            value: directionTo(myX, myY, enemy.x, enemy.y),
            tick,
          });
        }
        return inputs;
      }
    }

    // No threat — orbit the defended planet
    if (mySelf.orbiting) {
      inputs.push({ command: InputCommand.SET_SPEED, value: 0, tick });
    } else {
      inputs.push(
        ...approachAndOrbit(myX, myY, planet.x, planet.y, PATROL_SPEED, tick),
      );
    }

    return inputs;
  }

  // ---------------------------------------------------------------------------
  // ESCORT
  // ---------------------------------------------------------------------------

  private doEscort(
    myX: number,
    myY: number,
    tick: number,
    ships: ClientShip[],
    self: ClientGameState["self"],
    mySelf: ClientShip,
  ): PlayerInput[] {
    this.ticksInState++;
    const inputs: PlayerInput[] = [];

    inputs.push(...shieldsUp(mySelf, tick));

    const target = ships.find(
      (s) =>
        s.slotIndex === this.escortTargetSlot && s.status === ShipStatus.ALIVE,
    );
    if (!target) {
      this.resumeMission();
      return inputs;
    }

    const enemy = nearestEnemyShip(
      myX,
      myY,
      this.team,
      this.slot,
      ships,
      this.enemyTeam,
    );
    if (enemy !== null) {
      const distEnemyToTarget = distance(enemy.x, enemy.y, target.x, target.y);
      if (distEnemyToTarget <= ESCORT_ENGAGE_DIST) {
        const distToEnemy = distance(myX, myY, enemy.x, enemy.y);
        inputs.push(...moveTo(myX, myY, enemy.x, enemy.y, ESCORT_SPEED, tick));
        if (shouldFirePhaser(distToEnemy, self)) {
          inputs.push({
            command: InputCommand.FIRE_PHASER,
            value: directionTo(myX, myY, enemy.x, enemy.y),
            tick,
          });
        }
        if (shouldFireTorp(distToEnemy)) {
          inputs.push({
            command: InputCommand.FIRE_TORP,
            value: directionTo(myX, myY, enemy.x, enemy.y),
            tick,
          });
        }
        return inputs;
      }
    }

    const distToTarget = distance(myX, myY, target.x, target.y);
    if (distToTarget > ESCORT_MAX_DIST) {
      inputs.push(...moveTo(myX, myY, target.x, target.y, ESCORT_SPEED, tick));
    } else if (distToTarget < ESCORT_MIN_DIST) {
      inputs.push({ command: InputCommand.SET_SPEED, value: 2, tick });
    }

    return inputs;
  }

  // ---------------------------------------------------------------------------
  // OGG
  // ---------------------------------------------------------------------------

  private doOgg(
    myX: number,
    myY: number,
    tick: number,
    ships: ClientShip[],
    self: ClientGameState["self"],
    mySelf: ClientShip,
  ): PlayerInput[] {
    this.ticksInState++;
    const inputs: PlayerInput[] = [];

    inputs.push(...shieldsUp(mySelf, tick));

    const target = ships.find(
      (s) =>
        s.slotIndex === this.oggTargetSlot && s.status === ShipStatus.ALIVE,
    );
    if (!target) {
      this.resumeMission();
      return inputs;
    }

    const dist = distance(myX, myY, target.x, target.y);

    inputs.push(...moveTo(myX, myY, target.x, target.y, OGG_SPEED, tick));

    if (dist <= OGG_DETONATE_DIST) {
      inputs.push({ command: InputCommand.DETONATE_SELF, value: 0, tick });
      return inputs;
    }

    if (shouldFirePhaser(dist, self)) {
      inputs.push({
        command: InputCommand.FIRE_PHASER,
        value: directionTo(myX, myY, target.x, target.y),
        tick,
      });
    }
    if (shouldFireTorp(dist)) {
      inputs.push({
        command: InputCommand.FIRE_TORP,
        value: directionTo(myX, myY, target.x, target.y),
        tick,
      });
    }

    return inputs;
  }

  // ---------------------------------------------------------------------------
  // TAKE — pick up enough armies, then drop on enemy planet
  // ---------------------------------------------------------------------------

  private doTake(
    myX: number,
    myY: number,
    tick: number,
    planets: ClientPlanet[],
    self: ClientGameState["self"],
    mySelf: ClientShip,
  ): PlayerInput[] {
    this.ticksInState++;
    const inputs: PlayerInput[] = [];

    const stats = SHIP_STATS[mySelf.shipType];
    const capacity = Math.min(
      stats.maxArmies,
      Math.floor(self.kills) * stats.armiesPerKill,
    );

    if (capacity <= 0 || !self.tmode) {
      this.transition(BotAIState.PATROL);
      return inputs;
    }

    const targetPlanet = planets.find((p) => p.planetId === this.takePlanetId);

    if (!targetPlanet || targetPlanet.team === this.team) {
      this.transition(BotAIState.PATROL);
      return inputs;
    }

    // How many armies we need to take: kill all defenders + 1 to capture
    const armiesNeeded = targetPlanet.armies + 1;

    // If we can't carry enough even at full capacity, abort
    if (capacity < armiesNeeded) {
      this.transition(BotAIState.PATROL);
      return inputs;
    }

    if (this.takePhase === "pickup") {
      // Switch to drop once we have enough armies loaded
      if (self.armies >= armiesNeeded) {
        this.takePhase = "drop";
        return inputs;
      }

      // Find a friendly planet with enough armies to beam from
      let pickup = planets.find((p) => p.planetId === this.takePickupPlanetId);
      if (
        !pickup ||
        pickup.team !== this.team ||
        pickup.armies < BEAM_MIN_ARMIES
      ) {
        const fresh = nearestFriendlyPlanet(myX, myY, this.team, planets);
        if (!fresh || fresh.armies < BEAM_MIN_ARMIES) {
          this.transition(BotAIState.PATROL);
          return inputs;
        }
        this.takePickupPlanetId = fresh.planetId;
        pickup = fresh;
      }

      if (mySelf.orbiting) {
        // In orbit: beam up armies
        if (mySelf.shieldsUp) {
          inputs.push({ command: InputCommand.SHIELD_TOGGLE, value: 0, tick });
        }
        if (mySelf.beaming !== 1) {
          inputs.push({ command: InputCommand.BEAM_UP, value: 0, tick });
        }
      } else {
        // Approach pickup planet
        inputs.push(...shieldsUp(mySelf, tick));
        inputs.push(
          ...approachAndOrbit(myX, myY, pickup.x, pickup.y, TAKE_SPEED, tick),
        );
      }
    } else {
      // Drop phase
      if (self.armies <= 0) {
        if (targetPlanet.team !== this.team) {
          // Need more armies — go back for another load
          this.takePhase = "pickup";
        } else {
          this.transition(BotAIState.PATROL);
        }
        return inputs;
      }

      if (mySelf.orbiting) {
        // In orbit at target: beam down
        if (mySelf.shieldsUp) {
          inputs.push({ command: InputCommand.SHIELD_TOGGLE, value: 0, tick });
        }
        if (mySelf.beaming !== 2) {
          inputs.push({ command: InputCommand.BEAM_DOWN, value: 0, tick });
        }
      } else {
        // Approach target planet
        inputs.push(...shieldsUp(mySelf, tick));
        inputs.push(
          ...approachAndOrbit(
            myX,
            myY,
            targetPlanet.x,
            targetPlanet.y,
            TAKE_SPEED,
            tick,
          ),
        );
      }
    }

    return inputs;
  }

  private findTakeablePlanet(
    myX: number,
    myY: number,
    planets: ClientPlanet[],
  ): ClientPlanet | null {
    let best: ClientPlanet | null = null;
    let bestDist = Infinity;
    for (const p of planets) {
      if (p.team === this.team) continue;
      if (p.armies > TAKE_MAX_ENEMY_ARMIES) continue;
      const d = distance(myX, myY, p.x, p.y);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // State transition helpers
  // ---------------------------------------------------------------------------

  private transition(state: BotAIState): void {
    this.currentState = state;
    this.ticksInState = 0;
  }

  private transitionWithTarget(state: BotAIState, targetId: number): void {
    this.currentState = state;
    this.ticksInState = 0;
    switch (state) {
      case BotAIState.ATTACK:
        this.attackTargetSlot = targetId;
        break;
      case BotAIState.BOMB:
        this.bombTargetPlanetId = targetId;
        break;
      case BotAIState.ESCORT:
        this.escortTargetSlot = targetId;
        break;
      case BotAIState.DEFEND:
        this.defendPlanetId = targetId;
        break;
      case BotAIState.OGG:
        this.oggTargetSlot = targetId;
        break;
      case BotAIState.TAKE:
        this.takePlanetId = targetId;
        this.takePhase = "pickup";
        break;
      default:
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (module-level to avoid allocations in hot path)
// ---------------------------------------------------------------------------

/** Emit SET_DIRECTION + SET_SPEED toward a point. */
function moveTo(
  myX: number,
  myY: number,
  tx: number,
  ty: number,
  speed: number,
  tick: number,
): PlayerInput[] {
  return [
    {
      command: InputCommand.SET_DIRECTION,
      value: directionTo(myX, myY, tx, ty),
      tick,
    },
    { command: InputCommand.SET_SPEED, value: speed, tick },
  ];
}

/**
 * Approach a planet for orbit: decelerate early so the ship is at
 * orbit speed (warp 2) by the time it reaches orbit distance.
 * Also sends the ORBIT command when close enough.
 */
function approachAndOrbit(
  myX: number,
  myY: number,
  tx: number,
  ty: number,
  cruiseSpeed: number,
  tick: number,
): PlayerInput[] {
  const dist = distance(myX, myY, tx, ty);
  const approachZone = ORBIT_DIST * ORBIT_APPROACH_MULT;

  let speed: number;
  if (dist <= ORBIT_DIST * 2) {
    // Final approach: slow to orbit speed
    speed = ORBIT_MAX_SPEED;
  } else if (dist <= approachZone) {
    // Deceleration zone: scale speed linearly
    const pct = (dist - ORBIT_DIST * 2) / (approachZone - ORBIT_DIST * 2);
    speed = Math.max(
      ORBIT_MAX_SPEED,
      Math.ceil(ORBIT_MAX_SPEED + (cruiseSpeed - ORBIT_MAX_SPEED) * pct),
    );
  } else {
    speed = cruiseSpeed;
  }

  const result: PlayerInput[] = [
    {
      command: InputCommand.SET_DIRECTION,
      value: directionTo(myX, myY, tx, ty),
      tick,
    },
    { command: InputCommand.SET_SPEED, value: speed, tick },
  ];

  // Try to orbit when within range (will fail safely if still too fast)
  if (dist <= ORBIT_DIST) {
    result.push({ command: InputCommand.ORBIT, value: 0, tick });
  }

  return result;
}

/** Emit SHIELD_TOGGLE if shields are currently down. */
function shieldsUp(ship: ClientShip, tick: number): PlayerInput[] {
  if (!ship.shieldsUp) {
    return [{ command: InputCommand.SHIELD_TOGGLE, value: 1, tick }];
  }
  return [];
}

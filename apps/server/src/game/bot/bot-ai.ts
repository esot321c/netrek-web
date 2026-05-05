import {
  type ClientGameState,
  type ClientShip,
  type ClientPlanet,
  type PlayerInput,
  BotDifficulty,
  BotAIState,
  InputCommand,
  Team,
  ShipStatus,
  distance,
  ORBIT_DIST,
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

/** Distance at which a nearby enemy triggers ATTACK transition from PATROL */
const ATTACK_TRIGGER_DIST = 10000;

/** Distance at which a bot considers itself "arrived" at a patrol planet */
const PATROL_ARRIVED_DIST = 1800;

/** ESCORT: minimum distance to escort target */
const ESCORT_MIN_DIST = 2000;

/** ESCORT: maximum distance before closing in */
const ESCORT_MAX_DIST = 3000;

/** Distance at which DEFEND or ESCORT engages a nearby enemy */
const DEFEND_ENGAGE_DIST = 8000;
const ESCORT_ENGAGE_DIST = 8000;

/** Order expiry duration in ticks (60 seconds at 10 Hz) */
const ORDER_EXPIRE_TICKS = 600;

/** Minimum armies on a target planet before bombing is worthwhile */
const BOMB_WORTHWHILE_ARMIES = 5;

/** Fuel threshold for veteran cloaking while bombing */
const BOMB_CLOAK_FUEL_THRESHOLD = 3000;

/** RETREAT is over when hull is at or below this value AND fuel is above threshold */
const RETREAT_DONE_HULL = 20;
const RETREAT_DONE_FUEL = 5000;

/** Idle ticks in PATROL before considering a BOMB mission */
const PATROL_BOMB_IDLE_TICKS = 300;

// Movement speeds
const PATROL_SPEED = 5;
const ATTACK_SPEED = 8;
const RETREAT_SPEED = 9;
const BOMB_SPEED = 6;
const ESCORT_SPEED = 8;
const OGG_SPEED = 9;

/** Self-detonate within this distance during OGG */
const OGG_DETONATE_DIST = 500;

// ---------------------------------------------------------------------------
// BotBrain
// ---------------------------------------------------------------------------

export class BotBrain {
  currentState = BotAIState.PATROL;
  public slot: number;

  // Per-state targets
  private patrolTargetPlanetId = -1;
  private attackTargetSlot = -1;
  private bombTargetPlanetId = -1;
  private escortTargetSlot = -1;
  private defendPlanetId = -1;
  private oggTargetSlot = -1;
  private ticksInState = 0;

  // Order override (from team chat commands)
  private orderState: BotAIState | null = null;
  private orderTargetId = -1;
  private orderExpiresTick = 0;

  constructor(
    readonly difficulty: BotDifficulty,
    readonly team: Team,
    slot: number,
  ) {
    this.slot = slot;
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

    // Find our own ship entry
    const mySelf = ships.find(
      (s) => s.slotIndex === this.slot && s.status === ShipStatus.ALIVE,
    );
    if (!mySelf) return [];

    const { x: myX, y: myY } = mySelf;

    // Expire stale orders
    if (this.orderState !== null && tick >= this.orderExpiresTick) {
      this.clearOrder();
    }

    // -------------------------------------------------------------------------
    // Priority 1: RETREAT if hurt (overrides everything)
    // -------------------------------------------------------------------------
    if (shouldRetreat(self, this.difficulty)) {
      if (this.currentState !== BotAIState.RETREAT) {
        this.transition(BotAIState.RETREAT);
      }
      return this.doRetreat(myX, myY, tick, planets, self, mySelf);
    }

    // -------------------------------------------------------------------------
    // Priority 2: Active orders
    // -------------------------------------------------------------------------
    if (this.orderState !== null) {
      if (this.currentState !== this.orderState) {
        this.transitionWithTarget(this.orderState, this.orderTargetId);
      }
      return this.dispatchState(myX, myY, tick, gameState, mySelf);
    }

    // -------------------------------------------------------------------------
    // Priority 3: Veteran proactive behaviours
    // -------------------------------------------------------------------------
    if (this.difficulty === BotDifficulty.VETERAN) {
      // OGG enemy carriers
      const carriers = enemyCarriers(this.team, ships);
      if (carriers.length > 0) {
        const bestCarrier = selectTarget(myX, myY, carriers, this.difficulty);
        if (bestCarrier !== null) {
          if (
            this.currentState !== BotAIState.OGG ||
            this.oggTargetSlot !== bestCarrier.slotIndex
          ) {
            this.oggTargetSlot = bestCarrier.slotIndex;
            this.transition(BotAIState.OGG);
          }
          return this.dispatchState(myX, myY, tick, gameState, mySelf);
        }
      }

      // ESCORT friendly bombers
      const bombers = friendlyBombers(this.team, this.slot, ships);
      if (bombers.length > 0) {
        const bomber = bombers[0]!;
        if (
          this.currentState !== BotAIState.ESCORT ||
          this.escortTargetSlot !== bomber.slotIndex
        ) {
          this.escortTargetSlot = bomber.slotIndex;
          this.transition(BotAIState.ESCORT);
        }
        return this.dispatchState(myX, myY, tick, gameState, mySelf);
      }
    }

    // -------------------------------------------------------------------------
    // Priority 4: Competent+ intercept enemy nearby
    // -------------------------------------------------------------------------
    if (this.difficulty >= BotDifficulty.COMPETENT) {
      const nearby = nearestEnemyShip(myX, myY, this.team, this.slot, ships);
      if (
        nearby !== null &&
        distance(myX, myY, nearby.x, nearby.y) <= ATTACK_TRIGGER_DIST
      ) {
        const best = selectTarget(myX, myY, [nearby], this.difficulty);
        if (best !== null && this.attackTargetSlot !== best.slotIndex) {
          this.attackTargetSlot = best.slotIndex;
          this.transition(BotAIState.ATTACK);
        }
      }
    }

    // -------------------------------------------------------------------------
    // Priority 5: All-difficulty attack transition from PATROL
    // -------------------------------------------------------------------------
    if (this.currentState === BotAIState.PATROL) {
      const nearby = nearestEnemyShip(myX, myY, this.team, this.slot, ships);
      if (
        nearby !== null &&
        distance(myX, myY, nearby.x, nearby.y) <= ATTACK_TRIGGER_DIST
      ) {
        const best = selectTarget(myX, myY, [nearby], this.difficulty);
        if (best !== null) {
          this.attackTargetSlot = best.slotIndex;
          this.transition(BotAIState.ATTACK);
        }
      }
    }

    // -------------------------------------------------------------------------
    // Priority 6: BOMB if T-Mode active or idle in PATROL too long
    // -------------------------------------------------------------------------
    if (this.currentState === BotAIState.PATROL) {
      const shouldBomb =
        self.tmode || this.ticksInState > PATROL_BOMB_IDLE_TICKS;
      if (shouldBomb) {
        const enemyPlanet = nearestEnemyPlanet(myX, myY, this.team, planets);
        if (
          enemyPlanet !== null &&
          enemyPlanet.armies >= BOMB_WORTHWHILE_ARMIES
        ) {
          this.bombTargetPlanetId = enemyPlanet.planetId;
          this.transition(BotAIState.BOMB);
        }
      }
    }

    // -------------------------------------------------------------------------
    // Execute current state
    // -------------------------------------------------------------------------
    return this.dispatchState(myX, myY, tick, gameState, mySelf);
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
      default:
        return [];
    }
  }

  // ---------------------------------------------------------------------------
  // PATROL
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

    // Pick a patrol target if none
    if (this.patrolTargetPlanetId === -1) {
      const nearest = nearestFriendlyPlanet(myX, myY, this.team, planets);
      this.patrolTargetPlanetId = nearest?.planetId ?? -1;
    }

    const target = planets.find(
      (p) => p.planetId === this.patrolTargetPlanetId,
    );
    if (!target) {
      const fallback = nearestFriendlyPlanet(myX, myY, this.team, planets);
      if (fallback) {
        this.patrolTargetPlanetId = fallback.planetId;
        inputs.push(
          ...moveTo(myX, myY, fallback.x, fallback.y, PATROL_SPEED, tick),
        );
      }
      return inputs;
    }

    if (distance(myX, myY, target.x, target.y) <= PATROL_ARRIVED_DIST) {
      // Arrived — pick a different friendly planet
      const others = planets.filter(
        (p) => p.team === this.team && p.planetId !== this.patrolTargetPlanetId,
      );
      if (others.length > 0) {
        const next = others[Math.floor(Math.random() * others.length)]!;
        this.patrolTargetPlanetId = next.planetId;
        inputs.push(...moveTo(myX, myY, next.x, next.y, PATROL_SPEED, tick));
      }
    } else {
      inputs.push(...moveTo(myX, myY, target.x, target.y, PATROL_SPEED, tick));
    }

    return inputs;
  }

  // ---------------------------------------------------------------------------
  // ATTACK
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
      this.transition(BotAIState.PATROL);
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
  // RETREAT
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

    // Drop shields to allow hull repair
    if (mySelf.shieldsUp) {
      inputs.push({ command: InputCommand.SHIELD_TOGGLE, value: 0, tick });
    }
    // Enable repair mode
    if (!mySelf.repairMode) {
      inputs.push({ command: InputCommand.REPAIR_TOGGLE, value: 1, tick });
    }

    // Done retreating?
    if (self.hullDamage <= RETREAT_DONE_HULL && self.fuel > RETREAT_DONE_FUEL) {
      // Disable repair mode before leaving
      if (mySelf.repairMode) {
        inputs.push({ command: InputCommand.REPAIR_TOGGLE, value: 0, tick });
      }
      this.transition(BotAIState.PATROL);
      return inputs;
    }

    // Head to fuel first if critically low, otherwise repair planet
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

    const dist = distance(myX, myY, dest.x, dest.y);
    if (dist <= ORBIT_DIST) {
      inputs.push({ command: InputCommand.ORBIT, value: 0, tick });
      inputs.push({ command: InputCommand.SET_SPEED, value: 0, tick });
    } else {
      inputs.push(...moveTo(myX, myY, dest.x, dest.y, RETREAT_SPEED, tick));
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

    inputs.push(...shieldsUp(mySelf, tick));

    let target = planets.find((p) => p.planetId === this.bombTargetPlanetId);

    // Re-pick if planet is now friendly or depleted
    if (
      !target ||
      target.team === this.team ||
      target.armies < BOMB_WORTHWHILE_ARMIES
    ) {
      const newTarget = nearestEnemyPlanet(myX, myY, this.team, planets);
      if (newTarget && newTarget.armies >= BOMB_WORTHWHILE_ARMIES) {
        this.bombTargetPlanetId = newTarget.planetId;
        target = newTarget;
      } else {
        this.transition(BotAIState.PATROL);
        return inputs;
      }
    }

    const dist = distance(myX, myY, target.x, target.y);

    if (dist <= ORBIT_DIST) {
      inputs.push({ command: InputCommand.ORBIT, value: 0, tick });
      inputs.push({ command: InputCommand.SET_SPEED, value: 0, tick });
      inputs.push({ command: InputCommand.BOMB, value: 1, tick });

      // Veteran cloaks while bombing if fuel is sufficient
      if (
        this.difficulty === BotDifficulty.VETERAN &&
        !mySelf.cloaked &&
        self.fuel > BOMB_CLOAK_FUEL_THRESHOLD
      ) {
        inputs.push({ command: InputCommand.CLOAK_TOGGLE, value: 1, tick });
      }
    } else {
      inputs.push(...moveTo(myX, myY, target.x, target.y, BOMB_SPEED, tick));
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

    // Check for enemy threatening the defended planet
    const enemy = nearestEnemyShip(myX, myY, this.team, this.slot, ships);
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
    const distToPlanet = distance(myX, myY, planet.x, planet.y);
    if (distToPlanet <= ORBIT_DIST) {
      inputs.push({ command: InputCommand.ORBIT, value: 0, tick });
      inputs.push({ command: InputCommand.SET_SPEED, value: 0, tick });
    } else {
      inputs.push(...moveTo(myX, myY, planet.x, planet.y, PATROL_SPEED, tick));
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
      this.transition(BotAIState.PATROL);
      return inputs;
    }

    // Intercept enemies threatening the escort target
    const enemy = nearestEnemyShip(myX, myY, this.team, this.slot, ships);
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

    // Follow escort target at the configured distance band
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
      this.transition(BotAIState.PATROL);
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

/** Emit SHIELD_TOGGLE if shields are currently down. */
function shieldsUp(ship: ClientShip, tick: number): PlayerInput[] {
  if (!ship.shieldsUp) {
    return [{ command: InputCommand.SHIELD_TOGGLE, value: 1, tick }];
  }
  return [];
}

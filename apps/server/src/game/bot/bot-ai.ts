import {
  type ClientGameState,
  type ClientShip,
  type PlayerInput,
  BotDifficulty,
  BotAIState,
  Team,
  ShipStatus,
  SHIP_STATS,
} from "@netrek/shared";
import {
  type Mission,
  type TeamBotState,
  type CombatState,
  type BotOrder,
  type TakePhaseState,
  MissionType,
  CombatPhase,
  ASSESS_INTERVAL_TICKS,
  ORDER_EXPIRE_TICKS,
  aiStateToMissionType,
} from "./bot-types";
import { assess } from "./bot-assessor";
import {
  executePatrol,
  executeBomb,
  executeTake,
  executeEscort,
  executeDefend,
  executeOgg,
  executeResupply,
  type MissionContext,
} from "./bot-missions";
import { createCombatState, updateCombat } from "./bot-combat-module";

export class BotBrain {
  public slot: number;
  readonly enemyTeam: Team;

  private mission: Mission = {
    type: MissionType.PATROL,
    targetId: -1,
    score: 0,
    startTick: 0,
  };
  private combat: CombatState;
  private order: BotOrder | null = null;
  private lastAssessTick = 0;
  private lastHullDamage = 0;
  private takeState: TakePhaseState = { phase: "pickup", pickupPlanetId: -1 };
  private needsReassessment = true;

  constructor(
    readonly difficulty: BotDifficulty,
    readonly team: Team,
    slot: number,
  ) {
    this.slot = slot;
    this.enemyTeam = team === Team.FEDERATION ? Team.ROMULANS : Team.FEDERATION;
    this.combat = createCombatState();
  }

  get currentState(): BotAIState {
    if (this.combat.phase !== CombatPhase.NONE) return BotAIState.ATTACK;
    switch (this.mission.type) {
      case MissionType.PATROL:
        return BotAIState.PATROL;
      case MissionType.BOMB:
        return BotAIState.BOMB;
      case MissionType.TAKE:
        return BotAIState.TAKE;
      case MissionType.ESCORT:
        return BotAIState.ESCORT;
      case MissionType.DEFEND:
        return BotAIState.DEFEND;
      case MissionType.OGG:
        return BotAIState.OGG;
      case MissionType.RESUPPLY:
        return BotAIState.RETREAT;
      default:
        return BotAIState.PATROL;
    }
  }

  get currentMission(): MissionType {
    return this.mission.type;
  }
  get currentMissionTargetId(): number {
    return this.mission.targetId;
  }

  setOrder(state: BotAIState, targetId: number, currentTick: number): void {
    this.order = {
      missionType: aiStateToMissionType(state),
      targetId,
      receivedTick: currentTick,
      expiresTick: currentTick + ORDER_EXPIRE_TICKS,
    };
    this.needsReassessment = true;
  }

  clearOrder(): void {
    this.order = null;
  }

  think(
    gameState: ClientGameState,
    teamBots: TeamBotState[] = [],
  ): PlayerInput[] {
    const { tick, ships, self } = gameState;

    const mySelf = ships.find(
      (s) => s.slotIndex === this.slot && s.status === ShipStatus.ALIVE,
    );
    if (!mySelf) return [];

    const { x: myX, y: myY } = mySelf;

    // Expire stale orders
    if (this.order !== null && tick >= this.order.expiresTick) {
      this.order = null;
    }

    // Emergency re-assess: sudden heavy damage
    const hullDelta = self.hullDamage - this.lastHullDamage;
    const stats = SHIP_STATS[mySelf.shipType];
    if (hullDelta > stats.maxHull * 0.3) {
      this.needsReassessment = true;
    }
    this.lastHullDamage = self.hullDamage;

    // Assessor: run on timer, on trigger, or on explicit need
    const shouldAssess =
      this.needsReassessment ||
      tick - this.lastAssessTick >= ASSESS_INTERVAL_TICKS;

    if (shouldAssess) {
      const candidates = assess(
        myX,
        myY,
        gameState,
        this.team,
        this.enemyTeam,
        this.slot,
        this.difficulty,
        teamBots,
        this.order,
        mySelf,
      );
      if (candidates.length > 0) {
        const best = candidates[0]!;
        if (
          best.type !== this.mission.type ||
          best.targetId !== this.mission.targetId
        ) {
          this.mission = {
            type: best.type,
            targetId: best.targetId,
            score: best.score,
            startTick: tick,
          };
          if (best.type === MissionType.TAKE) {
            this.takeState = { phase: "pickup", pickupPlanetId: -1 };
          }
        }
      }
      this.lastAssessTick = tick;
      this.needsReassessment = false;
    }

    // Combat module: runs as sub-behavior if engaged
    const combatInputs = updateCombat(
      gameState,
      mySelf,
      self,
      this.combat,
      this.difficulty,
      this.team,
      this.enemyTeam,
      tick,
    );

    if (combatInputs !== null) {
      return combatInputs;
    }

    // If combat just ended, check if mission is still valid
    if (this.combat.phase === CombatPhase.NONE && this.lastAssessTick < tick) {
      this.needsReassessment = true;
    }

    // Execute current mission
    const ctx: MissionContext = {
      myX,
      myY,
      tick,
      gs: gameState,
      mySelf,
      difficulty: this.difficulty,
      team: this.team,
      enemyTeam: this.enemyTeam,
      slot: this.slot,
      mission: this.mission,
    };

    let inputs: PlayerInput[];
    switch (this.mission.type) {
      case MissionType.BOMB:
        inputs = executeBomb(ctx);
        break;
      case MissionType.TAKE:
        inputs = executeTake(ctx, this.takeState);
        break;
      case MissionType.ESCORT:
        inputs = executeEscort(ctx);
        break;
      case MissionType.DEFEND:
        inputs = executeDefend(ctx);
        break;
      case MissionType.OGG:
        inputs = executeOgg(ctx);
        break;
      case MissionType.RESUPPLY:
        inputs = executeResupply(ctx);
        break;
      default:
        inputs = executePatrol(ctx);
    }

    if (inputs.length === 0) {
      this.needsReassessment = true;
    }

    return inputs;
  }
}

import {
  type ClientGameState,
  type ClientShip,
  type PlayerInput,
  BotDifficulty,
  BotAIState,
  Team,
  ShipStatus,
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
  COMBAT_ENGAGE_DIST,
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
import { nearestEnemyShip } from "./bot-navigation";
import { createCombatState, updateCombat } from "./bot-combat-module";
import { Logger } from "@nestjs/common";
import { distance } from "@netrek/shared";
import { botFileLog } from "./bot-logger";

const FORCED_FIGHT_RANGE = 3000;
const ESCORT_FIGHT_RANGE = 5000;
const THREAT_REASSESS_DIST = 8000;

const botLogger = new Logger("BotAI");

const MISSION_NAMES: Record<number, string> = {
  [MissionType.PATROL]: "PATROL",
  [MissionType.BOMB]: "BOMB",
  [MissionType.TAKE]: "TAKE",
  [MissionType.ESCORT]: "ESCORT",
  [MissionType.DEFEND]: "DEFEND",
  [MissionType.OGG]: "OGG",
  [MissionType.RESUPPLY]: "RESUPPLY",
};

function isPurposefulMission(m: MissionType): boolean {
  return (
    m === MissionType.BOMB ||
    m === MissionType.TAKE ||
    m === MissionType.ESCORT ||
    m === MissionType.DEFEND ||
    m === MissionType.OGG
  );
}

function missionEngageRange(mission: MissionType): number {
  switch (mission) {
    case MissionType.BOMB:
    case MissionType.TAKE:
    case MissionType.RESUPPLY:
      return FORCED_FIGHT_RANGE;
    case MissionType.ESCORT:
      return ESCORT_FIGHT_RANGE;
    case MissionType.OGG:
      return FORCED_FIGHT_RANGE;
    default:
      return COMBAT_ENGAGE_DIST;
  }
}

export class BotBrain {
  public slot: number;
  public name = "";
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
  private wasInCombat = false;
  private lastLoggedMission: MissionType = -1 as MissionType;
  private failedMissionType: MissionType | null = null;
  private failedMissionUntil = 0;

  constructor(
    readonly difficulty: BotDifficulty,
    readonly team: Team,
    slot: number,
  ) {
    this.slot = slot;
    this.enemyTeam = team === Team.FEDERATION ? Team.ROMULANS : Team.FEDERATION;
    this.combat = createCombatState();
  }

  private get tag(): string {
    return `[${this.name || `slot${this.slot}`}]`;
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
      botLogger.debug(`${this.tag} order expired at tick ${tick}`);
      this.order = null;
      this.needsReassessment = true;
    }

    // Emergency re-assess: sudden heavy damage (use ClientShip's 0-1 ratio, not self.hullDamage which is always 0)
    const hullDelta = mySelf.hullDamagePct - this.lastHullDamage;
    if (hullDelta > 0.3) {
      botLogger.log(
        `${this.tag} HEAVY DAMAGE +${(hullDelta * 100).toFixed(0)}% hull → reassess`,
      );
      this.needsReassessment = true;
    }
    this.lastHullDamage = mySelf.hullDamagePct;

    // Purposeful missions (BOMB, TAKE, ESCORT, DEFEND, OGG) stay committed —
    // only reassess on explicit triggers or when an enemy gets close.
    // PATROL and RESUPPLY reassess on the normal timer.
    const purposeful = isPurposefulMission(this.mission.type);
    let shouldAssess = this.needsReassessment;

    if (!shouldAssess && !purposeful) {
      shouldAssess = tick - this.lastAssessTick >= ASSESS_INTERVAL_TICKS;
    }

    if (
      !shouldAssess &&
      purposeful &&
      tick - this.lastAssessTick >= ASSESS_INTERVAL_TICKS
    ) {
      const enemy = nearestEnemyShip(
        myX,
        myY,
        this.team,
        this.slot,
        ships,
        this.enemyTeam,
      );
      if (enemy) {
        const enemyDist = distance(myX, myY, enemy.x, enemy.y);
        if (enemyDist < THREAT_REASSESS_DIST) {
          shouldAssess = true;
        }
      }
    }

    if (this.failedMissionType !== null && tick >= this.failedMissionUntil) {
      this.failedMissionType = null;
    }

    // Armies are gold: if on TAKE with armies loaded, don't reassess
    // unless hull damage is critical (> 80%). Commit to the drop.
    if (
      shouldAssess &&
      this.mission.type === MissionType.TAKE &&
      self.armies > 0 &&
      mySelf.hullDamagePct <= 0.8
    ) {
      shouldAssess = false;
    }

    if (shouldAssess) {
      let candidates = assess(
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
        this.mission,
      );

      if (this.failedMissionType !== null) {
        candidates = candidates.filter(
          (c) => c.type !== this.failedMissionType,
        );
      }

      // TAKE commitment: don't switch to a different TAKE target mid-mission
      if (this.mission.type === MissionType.TAKE) {
        candidates = candidates.filter(
          (c) =>
            c.type !== MissionType.TAKE || c.targetId === this.mission.targetId,
        );
      }

      if (candidates.length > 0) {
        const best = candidates[0]!;
        if (
          best.type !== this.mission.type ||
          best.targetId !== this.mission.targetId
        ) {
          const oldMission = MISSION_NAMES[this.mission.type] ?? "?";
          const newMission = MISSION_NAMES[best.type] ?? "?";
          const top3 = candidates
            .slice(0, 3)
            .map(
              (c) =>
                `${MISSION_NAMES[c.type] ?? c.type}(t=${c.targetId},s=${c.score.toFixed(1)})`,
            )
            .join(", ");
          const msg = `${this.tag} t=${tick} ${oldMission}→${newMission} target=${best.targetId} | [${top3}] hp=${(mySelf.hullDamagePct * 100).toFixed(0)}% fuel=${(mySelf.fuelPct * 100).toFixed(0)}%`;
          botLogger.log(msg);
          botFileLog(msg);
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
    // TAKE with armies loaded: suppress combat entirely — commit to the drop
    const carryingArmies =
      this.mission.type === MissionType.TAKE && self.armies > 0;

    let combatInputs: PlayerInput[] | null = null;
    if (carryingArmies) {
      if (this.combat.phase !== CombatPhase.NONE) {
        this.combat.phase = CombatPhase.NONE;
        this.combat.targetSlot = -1;
        this.combat.ticksSinceLastThreat = 0;
      }
      this.wasInCombat = false;
    } else {
      const engageRange = missionEngageRange(this.mission.type);
      combatInputs = updateCombat(
        gameState,
        mySelf,
        self,
        this.combat,
        this.difficulty,
        this.team,
        this.enemyTeam,
        tick,
        engageRange,
      );
    }

    if (combatInputs !== null) {
      if (!this.wasInCombat) {
        const cmsg = `${this.tag} t=${tick} COMBAT target=slot${this.combat.targetSlot}`;
        botLogger.log(cmsg);
        botFileLog(cmsg);
      }
      this.wasInCombat = true;
      return combatInputs;
    }

    if (this.wasInCombat) {
      botLogger.log(`${this.tag} t=${tick} COMBAT END`);
      botFileLog(`${this.tag} t=${tick} COMBAT END`);
      this.wasInCombat = false;
      if (this.mission.type !== MissionType.TAKE) {
        this.needsReassessment = true;
      }
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
      const failedType = this.mission.type;
      const fmsg = `${this.tag} t=${tick} ${MISSION_NAMES[failedType] ?? "?"} complete`;
      botLogger.log(fmsg);
      botFileLog(fmsg);
      this.failedMissionType = failedType;
      this.failedMissionUntil = tick + ASSESS_INTERVAL_TICKS * 3;

      const fallback = assess(
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
      ).filter((c) => c.type !== failedType);

      const next = fallback[0];
      if (next) {
        const nmsg = `${this.tag} t=${tick} → ${MISSION_NAMES[next.type] ?? "?"} target=${next.targetId}`;
        botLogger.log(nmsg);
        botFileLog(nmsg);
        this.mission = {
          type: next.type,
          targetId: next.targetId,
          score: next.score,
          startTick: tick,
        };
        if (next.type === MissionType.TAKE) {
          this.takeState = { phase: "pickup", pickupPlanetId: -1 };
        }
      } else {
        this.mission = {
          type: MissionType.PATROL,
          targetId: -1,
          score: 0,
          startTick: tick,
        };
      }
      this.lastAssessTick = tick;
    }

    return inputs;
  }
}

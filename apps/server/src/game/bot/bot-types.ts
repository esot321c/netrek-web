import { BotDifficulty, BotAIState } from "@netrek/shared";

export enum MissionType {
  PATROL = 0,
  BOMB = 1,
  TAKE = 2,
  ESCORT = 3,
  DEFEND = 4,
  OGG = 5,
  RESUPPLY = 6,
}

export interface Mission {
  type: MissionType;
  targetId: number; // planet index or ship slot, -1 for PATROL/RESUPPLY
  score: number; // score from assessor when assigned
  startTick: number;
}

export interface TeamBotState {
  slot: number;
  currentMission: MissionType;
  missionTargetId: number;
}

export interface MissionCandidate {
  type: MissionType;
  targetId: number;
  score: number;
}

export enum CombatPhase {
  NONE = 0,
  ENGAGED = 1,
  DISENGAGING = 2, // no enemies for < 20 ticks, waiting to confirm exit
}

export interface CombatState {
  phase: CombatPhase;
  targetSlot: number; // primary combat target
  ticksSinceLastThreat: number; // ticks since last enemy in range
  lastSpeedChangeTick: number; // for purposeful speed timing
  lastDirectionChangeTick: number;
  currentManeuverSpeed: number; // current committed speed
}

export interface ResupplyNeeds {
  needsFuel: boolean;
  needsHullRepair: boolean;
  hullDamagePct: number; // 0-1
  fuelPct: number; // 0-1
}

export interface TakePhaseState {
  phase: "pickup" | "transit" | "approach" | "drop";
  pickupPlanetId: number;
}

export interface BotOrder {
  missionType: MissionType;
  targetId: number;
  receivedTick: number;
  expiresTick: number;
}

/** Map BotAIState (from chat orders) to MissionType. */
export function aiStateToMissionType(state: BotAIState): MissionType {
  switch (state) {
    case BotAIState.PATROL:
      return MissionType.PATROL;
    case BotAIState.BOMB:
      return MissionType.BOMB;
    case BotAIState.TAKE:
      return MissionType.TAKE;
    case BotAIState.ESCORT:
      return MissionType.ESCORT;
    case BotAIState.DEFEND:
      return MissionType.DEFEND;
    case BotAIState.OGG:
      return MissionType.OGG;
    case BotAIState.RETREAT:
      return MissionType.RESUPPLY;
    case BotAIState.ATTACK:
      return MissionType.PATROL; // ATTACK is handled by combat module, not a mission
    default:
      return MissionType.PATROL;
  }
}

/** Assessor timer interval in ticks (1.5 seconds at 10Hz). */
export const ASSESS_INTERVAL_TICKS = 15;

/** Combat exit hysteresis — ticks with no enemies before exiting combat. */
export const COMBAT_EXIT_TICKS = 20;

/** Chat order scoring bonus. */
export const ORDER_SCORE_BONUS = 40;

/** Chat order expiry in ticks (60 seconds). */
export const ORDER_EXPIRE_TICKS = 600;

/** Minimum ticks between speed changes during combat (2-4 seconds). */
export const MIN_SPEED_HOLD_TICKS: Record<BotDifficulty, number> = {
  [BotDifficulty.NEWBIE]: 0, // newbie doesn't change speed
  [BotDifficulty.COMPETENT]: 30,
  [BotDifficulty.VETERAN]: 20,
};

/** Minimum ticks between direction changes during combat. */
export const MIN_DIR_HOLD_TICKS: Record<BotDifficulty, number> = {
  [BotDifficulty.NEWBIE]: 0,
  [BotDifficulty.COMPETENT]: 25,
  [BotDifficulty.VETERAN]: 15,
};

/** Engagement range — enter combat when enemy is this close and threatening. */
export const COMBAT_ENGAGE_DIST = 8000;

/** Distance thresholds for combat range management. */
export const MIN_COMBAT_DIST = 2500;
export const MAX_COMBAT_DIST = 6000;

/** Fuel percentage thresholds for combat. */
export const FUEL_DISENGAGE_PCT = 0.3;
export const FUEL_CRITICAL_PCT = 0.15;

/** Weapon temp percentage thresholds. */
export const WTEMP_TORP_STOP_PCT = 0.7;
export const WTEMP_ALL_STOP_PCT = 0.9;

/** Max torps in flight per difficulty. */
export const MAX_TORPS_IN_FLIGHT: Record<BotDifficulty, number> = {
  [BotDifficulty.NEWBIE]: 8,
  [BotDifficulty.COMPETENT]: 5,
  [BotDifficulty.VETERAN]: 4,
};

/** Torp danger distance for evasion per difficulty. */
export const TORP_DANGER_DIST: Record<BotDifficulty, number> = {
  [BotDifficulty.NEWBIE]: 0,
  [BotDifficulty.COMPETENT]: 1200,
  [BotDifficulty.VETERAN]: 1800,
};

/** Shields-down safe distance — no enemies this close = safe to drop shields. */
export const SHIELDS_DOWN_SAFE_DIST = 10000;

/** Newbie shield react delay — ticks before raising shields after enemy appears. */
export const NEWBIE_SHIELD_REACT_TICKS = 15;

import {
  type ClientShip,
  type ClientSelfExtra,
  type ClientTorp,
  BotDifficulty,
  distance,
  ShipType,
  SPEED_SCALE,
  angleBetween,
  directionToRadians,
} from "@netrek/shared";
import {
  MAX_TORPS_IN_FLIGHT,
  FUEL_DISENGAGE_PCT,
  WTEMP_TORP_STOP_PCT,
  WTEMP_ALL_STOP_PCT,
} from "./bot-types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PHASER_MAX_RANGE = 6000;
const TORP_EFFECTIVE_RANGE = 9000;
const FUEL_RETREAT_THRESHOLD = 1000;

// Hull damage thresholds for retreating (higher = waits longer before retreating)
const RETREAT_HULL_THRESHOLDS: Record<BotDifficulty, number> = {
  [BotDifficulty.NEWBIE]: 85, // nearly dead before retreating
  [BotDifficulty.COMPETENT]: 60, // retreats at moderate damage
  [BotDifficulty.VETERAN]: 50, // retreats early
};

// Penalty added to score for starbase targets (discourages picking them)
const STARBASE_SCORE_PENALTY = 20000;

// ---------------------------------------------------------------------------
// Target selection
// ---------------------------------------------------------------------------

/**
 * Select best target from enemies.
 * Newbie: always picks closest.
 * Competent/Veteran: scores by distance + damage (prefers damaged targets,
 *   avoids starbases).
 */
export function selectTarget(
  x: number,
  y: number,
  enemies: ClientShip[],
  difficulty: BotDifficulty,
): ClientShip | null {
  if (enemies.length === 0) return null;

  if (difficulty === BotDifficulty.NEWBIE) {
    // Simple: pick the closest enemy
    let best: ClientShip | null = null;
    let bestDist = Infinity;
    for (const e of enemies) {
      const d = distance(x, y, e.x, e.y);
      if (d < bestDist) {
        bestDist = d;
        best = e;
      }
    }
    return best;
  }

  // Competent / Veteran: score-based selection
  // Lower score = better target
  // Score = distance - (hullDamagePct * 10000) + starbase penalty
  let best: ClientShip | null = null;
  let bestScore = Infinity;
  for (const e of enemies) {
    const dist = distance(x, y, e.x, e.y);
    const damageBenefit = e.hullDamagePct * 10000;
    const sbPenalty = e.shipType === ShipType.SB ? STARBASE_SCORE_PENALTY : 0;
    const score = dist - damageBenefit + sbPenalty;
    if (score < bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Retreat decision
// ---------------------------------------------------------------------------

/**
 * Should the bot retreat?
 * Triggers when hull damage meets or exceeds the difficulty threshold,
 * or when fuel is critically low.
 */
export function shouldRetreat(
  self: ClientSelfExtra,
  difficulty: BotDifficulty,
): boolean {
  if (self.fuel < FUEL_RETREAT_THRESHOLD) return true;
  return self.hullDamage >= RETREAT_HULL_THRESHOLDS[difficulty];
}

// ---------------------------------------------------------------------------
// Weapon fire decisions
// ---------------------------------------------------------------------------

/**
 * Should fire phaser?
 * Only if off cooldown, no weapon burnout, and within phaser range.
 */
export function shouldFirePhaser(
  distToTarget: number,
  self: ClientSelfExtra,
): boolean {
  if (self.phaserCooldown > 0) return false;
  if (self.weaponBurnout > 0) return false;
  return distToTarget <= PHASER_MAX_RANGE;
}

/**
 * Should fire torpedo?
 * Only if within effective range, no burnout.
 */
export function shouldFireTorp(
  distToTarget: number,
  self: ClientSelfExtra,
): boolean {
  if (self.weaponBurnout > 0) return false;
  return distToTarget <= TORP_EFFECTIVE_RANGE;
}

// ---------------------------------------------------------------------------
// Cloaking decision
// ---------------------------------------------------------------------------

/**
 * Should cloak?
 * Newbies never cloak.
 * Others cloak when carrying armies and have sufficient fuel.
 */
export function shouldCloak(
  self: ClientSelfExtra,
  difficulty: BotDifficulty,
): boolean {
  if (difficulty === BotDifficulty.NEWBIE) return false;
  if (self.armies <= 0) return false;
  return self.fuel > FUEL_RETREAT_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Target leading
// ---------------------------------------------------------------------------

/**
 * Calculate torp firing direction with target leading.
 * NEWBIE: fires at current position.
 * COMPETENT: 50% lead.
 * VETERAN: full lead.
 */
export function leadTarget(
  myX: number,
  myY: number,
  targetX: number,
  targetY: number,
  targetDir: number,
  targetSpeed: number,
  torpSpeed: number,
  difficulty: BotDifficulty,
): number {
  const directDir = angleBetween(myX, myY, targetX, targetY);
  if (difficulty === BotDifficulty.NEWBIE) return directDir;

  const dist = Math.sqrt((targetX - myX) ** 2 + (targetY - myY) ** 2);
  if (dist < 100 || torpSpeed <= 0) return directDir;

  const torpTravel = torpSpeed * SPEED_SCALE;
  const ticksToReach = dist / torpTravel;

  const targetRad = directionToRadians(targetDir);
  const targetDist = targetSpeed * SPEED_SCALE * ticksToReach;
  const predictX = targetX + Math.sin(targetRad) * targetDist;
  const predictY = targetY + -Math.cos(targetRad) * targetDist;

  const leadDir = angleBetween(myX, myY, predictX, predictY);

  if (difficulty === BotDifficulty.COMPETENT) {
    let delta = (leadDir - directDir + 256) % 256;
    if (delta > 128) delta -= 256;
    const halfDelta = Math.round(delta * 0.5);
    return (directDir + halfDelta + 256) % 256;
  }

  return leadDir;
}

// ---------------------------------------------------------------------------
// Torp discipline
// ---------------------------------------------------------------------------

/** Count how many torps a given slot currently has in flight. */
export function countTorpsInFlight(torps: ClientTorp[], slot: number): number {
  let count = 0;
  for (const t of torps) {
    if (t.ownerSlot === slot) count++;
  }
  return count;
}

/** Should fire torp with discipline? Checks in-flight count against difficulty limit. */
export function shouldFireTorpDisciplined(
  torpsInFlight: number,
  distToTarget: number,
  self: ClientSelfExtra,
  difficulty: BotDifficulty,
): boolean {
  if (self.weaponBurnout > 0) return false;
  if (distToTarget > 9000) return false;
  if (torpsInFlight >= MAX_TORPS_IN_FLIGHT[difficulty]) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Fuel and temperature awareness
// ---------------------------------------------------------------------------

/** Should disengage due to low fuel? */
export function shouldDisengageFuel(fuel: number, maxFuel: number): boolean {
  return fuel / maxFuel < FUEL_DISENGAGE_PCT;
}

/** Should stop firing torps due to weapon temp? */
export function shouldStopTorpTemp(
  weaponTemp: number,
  maxWpnTemp: number,
): boolean {
  return weaponTemp / maxWpnTemp >= WTEMP_TORP_STOP_PCT;
}

/** Should stop firing all weapons due to weapon temp? */
export function shouldStopAllTemp(
  weaponTemp: number,
  maxWpnTemp: number,
): boolean {
  return weaponTemp / maxWpnTemp >= WTEMP_ALL_STOP_PCT;
}

// ---------------------------------------------------------------------------
// Enemy torp detonation
// ---------------------------------------------------------------------------

/** Should det enemy torps? Based on difficulty and number of nearby enemy torps. */
export function shouldDetEnemyTorps(
  myX: number,
  myY: number,
  torps: ClientTorp[],
  myTeam: number,
  difficulty: BotDifficulty,
): boolean {
  if (difficulty === BotDifficulty.NEWBIE) return false;

  const detRange = 1600; // DET_RANGE from constants
  let nearbyCount = 0;
  for (const t of torps) {
    if (t.team === myTeam) continue;
    const dx = t.x - myX;
    const dy = t.y - myY;
    if (dx * dx + dy * dy < detRange * detRange) {
      nearbyCount++;
    }
  }

  if (difficulty === BotDifficulty.COMPETENT) return nearbyCount >= 3;
  return nearbyCount >= 2; // VETERAN: more aggressive det
}

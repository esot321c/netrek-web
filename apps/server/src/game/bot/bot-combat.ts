import {
  type ClientShip,
  type ClientSelfExtra,
  BotDifficulty,
  distance,
  ShipType,
} from "@netrek/shared";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PHASER_MAX_RANGE = 6000;
const TORP_EFFECTIVE_RANGE = 15000;
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
 * Only if within effective torpedo range.
 */
export function shouldFireTorp(distToTarget: number): boolean {
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

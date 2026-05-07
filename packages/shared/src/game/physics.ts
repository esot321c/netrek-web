import {
  GALAXY_WIDTH,
  GALAXY_HEIGHT,
  DIRECTION_COUNT,
  SPEED_SCALE,
  SHIP_STATS,
  TORP_SPLASH_MAX_DIST,
  TORP_SPLASH_DIVISOR,
  EXPLOSION_INNER_RADIUS,
  EXPLOSION_OUTER_RADIUS,
  EXPLOSION_FALLOFF_DIVISOR,
  OVERHEAT_BURNOUT_CHANCE,
  BURNOUT_MIN_TICKS,
  BURNOUT_RANDOM_TICKS,
  TORP_WOBBLE,
} from "./constants";
import { ShipType, type ShipState, type TorpState } from "./types";

const TWO_PI = Math.PI * 2;
const DIR_TO_RAD = TWO_PI / DIRECTION_COUNT;
const RAD_TO_DIR = DIRECTION_COUNT / TWO_PI;

// ---------------------------------------------------------------------------
// Direction math
// ---------------------------------------------------------------------------

/** Convert 0-255 direction to radians. Dir 0 = north (up), clockwise. */
export function directionToRadians(dir: number): number {
  return dir * DIR_TO_RAD;
}

/** Convert radians to 0-255 direction. */
export function radiansToDirection(rad: number): number {
  const normalized = ((rad % TWO_PI) + TWO_PI) % TWO_PI;
  return Math.round(normalized * RAD_TO_DIR) & 0xff;
}

/** Get direction (0-255) from point (fromX,fromY) toward (toX,toY). */
export function angleBetween(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): number {
  // atan2 gives angle from positive X axis, counter-clockwise
  // We need angle from north (negative Y), clockwise
  const dx = toX - fromX;
  const dy = toY - fromY;
  const rad = Math.atan2(dx, -dy); // north=0, clockwise positive
  return radiansToDirection(rad);
}

/**
 * Shortest signed turn delta from current to target direction.
 * Returns value in range [-128, 127].
 */
export function directionDelta(current: number, target: number): number {
  let delta = (target - current) & 0xff;
  if (delta > 128) delta -= 256;
  return delta;
}

// ---------------------------------------------------------------------------
// Distance
// ---------------------------------------------------------------------------

export function distance(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

/** Max direction units a ship can turn per tick. Halves per warp above 0. */
export function turnRate(shipType: ShipType, speed: number): number {
  const base = SHIP_STATS[shipType].baseTurnRate;
  if (speed <= 0) return base;
  // Each warp level halves turn rate
  return Math.max(1, Math.floor(base / Math.pow(2, speed)));
}

/** Max warp speed given hull damage. */
export function maxWarpForHull(shipType: ShipType, hullDamage: number): number {
  const stats = SHIP_STATS[shipType];
  if (hullDamage <= 0) return stats.maxSpeed;
  const ratio = 1 - hullDamage / stats.maxHull;
  return Math.max(1, Math.floor(stats.maxSpeed * ratio));
}

/** Accelerate/decelerate current speed toward desired speed. */
export function accelerate(
  currentSpeed: number,
  desiredSpeed: number,
  shipType: ShipType,
): number {
  const stats = SHIP_STATS[shipType];
  if (currentSpeed < desiredSpeed) {
    return Math.min(desiredSpeed, currentSpeed + stats.accelRate);
  }
  if (currentSpeed > desiredSpeed) {
    return Math.max(desiredSpeed, currentSpeed - stats.decelRate);
  }
  return currentSpeed;
}

/**
 * Update ship position based on current speed and direction.
 * Bounces off galaxy walls.
 */
export function moveShip(ship: ShipState): void {
  if (ship.speed <= 0) return;

  const rad = directionToRadians(ship.direction);
  const dist = ship.speed * SPEED_SCALE;
  // North = negative Y in game coords
  const dx = Math.sin(rad) * dist;
  const dy = -Math.cos(rad) * dist;

  let newX = ship.x + dx;
  let newY = ship.y + dy;

  // Bounce off walls — reflect both direction and desiredDirection
  if (newX < 0) {
    newX = -newX;
    ship.direction = (DIRECTION_COUNT - ship.direction) & 0xff;
    ship.desiredDirection = (DIRECTION_COUNT - ship.desiredDirection) & 0xff;
  } else if (newX > GALAXY_WIDTH) {
    newX = GALAXY_WIDTH * 2 - newX;
    ship.direction = (DIRECTION_COUNT - ship.direction) & 0xff;
    ship.desiredDirection = (DIRECTION_COUNT - ship.desiredDirection) & 0xff;
  }

  if (newY < 0) {
    newY = -newY;
    ship.direction = (DIRECTION_COUNT / 2 - ship.direction) & 0xff;
    ship.desiredDirection =
      (DIRECTION_COUNT / 2 - ship.desiredDirection) & 0xff;
  } else if (newY > GALAXY_HEIGHT) {
    newY = GALAXY_HEIGHT * 2 - newY;
    ship.direction = (DIRECTION_COUNT / 2 - ship.direction) & 0xff;
    ship.desiredDirection =
      (DIRECTION_COUNT / 2 - ship.desiredDirection) & 0xff;
  }

  // Clamp to bounds (safety)
  ship.x = Math.max(0, Math.min(GALAXY_WIDTH, newX));
  ship.y = Math.max(0, Math.min(GALAXY_HEIGHT, newY));
}

/**
 * Move a torpedo one tick. Applies wobble and decrements lifetime.
 * Returns false if the torp should be killed (expired or hit wall).
 */
export function moveTorp(torp: TorpState): boolean {
  torp.ticksRemaining--;
  if (torp.ticksRemaining <= 0) return false;

  // Apply wobble — small random deflection to velocity direction
  const currentAngle = Math.atan2(torp.dx, -torp.dy);
  const wobble = (Math.random() - 0.5) * TORP_WOBBLE * DIR_TO_RAD * 2;
  const speed = Math.sqrt(torp.dx * torp.dx + torp.dy * torp.dy);
  const newAngle = currentAngle + wobble;
  torp.dx = Math.sin(newAngle) * speed;
  torp.dy = -Math.cos(newAngle) * speed;

  torp.x += torp.dx;
  torp.y += torp.dy;

  // Kill on wall hit
  if (
    torp.x < 0 ||
    torp.x > GALAXY_WIDTH ||
    torp.y < 0 ||
    torp.y > GALAXY_HEIGHT
  ) {
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Damage formulas
// ---------------------------------------------------------------------------

/** Phaser damage at distance. Linear falloff. */
export function phaserDamage(
  baseDamage: number,
  dist: number,
  maxRange: number,
): number {
  if (dist >= maxRange) return 0;
  return Math.max(0, baseDamage * (1 - dist / maxRange));
}

/** Torpedo splash damage at distance from explosion. */
export function torpSplashDamage(baseDamage: number, dist: number): number {
  if (dist >= TORP_SPLASH_MAX_DIST) return 0;
  return Math.max(
    0,
    (baseDamage * (TORP_SPLASH_MAX_DIST - dist)) / TORP_SPLASH_DIVISOR,
  );
}

/** Ship explosion damage at distance. Full inside inner radius, falloff beyond. */
export function explosionDamage(baseDamage: number, dist: number): number {
  if (dist <= EXPLOSION_INNER_RADIUS) return baseDamage;
  if (dist >= EXPLOSION_OUTER_RADIUS) return 0;
  return Math.max(
    0,
    (baseDamage * (EXPLOSION_OUTER_RADIUS - dist)) / EXPLOSION_FALLOFF_DIVISOR,
  );
}

// ---------------------------------------------------------------------------
// Temperature system
// ---------------------------------------------------------------------------

/** Update engine temperature for one tick. Returns true if burnout triggered this tick. */
export function updateEngineTemp(ship: ShipState): boolean {
  const stats = SHIP_STATS[ship.shipType];

  // Burnout countdown
  if (ship.engineBurnoutTicks > 0) {
    ship.engineBurnoutTicks--;
    // During burnout: locked to warp 1
    ship.desiredSpeed = Math.min(ship.desiredSpeed, 1);
    // Still cool down
    ship.engineTemp = Math.max(0, ship.engineTemp - stats.engineCooling);
    return false;
  }

  // Heat: +speed per tick
  ship.engineTemp += ship.speed;
  // Cool
  ship.engineTemp = Math.max(0, ship.engineTemp - stats.engineCooling);

  // Overheat check — burnout risk when temp exceeds max (from getship.c s_maxegntemp)
  if (ship.engineTemp > stats.maxEgnTemp) {
    if (Math.random() < OVERHEAT_BURNOUT_CHANCE) {
      ship.engineBurnoutTicks =
        BURNOUT_MIN_TICKS + Math.floor(Math.random() * BURNOUT_RANDOM_TICKS);
      return true;
    }
  }

  return false;
}

/** Update weapon temperature for one tick. Returns true if burnout triggered this tick. */
export function updateWeaponTemp(ship: ShipState): boolean {
  const stats = SHIP_STATS[ship.shipType];

  // Burnout countdown
  if (ship.weaponBurnoutTicks > 0) {
    ship.weaponBurnoutTicks--;
    ship.weaponTemp = Math.max(0, ship.weaponTemp - stats.weaponCooling);
    return false;
  }

  // Cool
  ship.weaponTemp = Math.max(0, ship.weaponTemp - stats.weaponCooling);

  // Overheat check — burnout risk when temp exceeds max (from getship.c s_maxwpntemp)
  if (ship.weaponTemp > stats.maxWpnTemp) {
    if (Math.random() < OVERHEAT_BURNOUT_CHANCE) {
      ship.weaponBurnoutTicks =
        BURNOUT_MIN_TICKS + Math.floor(Math.random() * BURNOUT_RANDOM_TICKS);
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Fuel & repair
// ---------------------------------------------------------------------------

/** Update fuel for one tick. */
export function updateFuel(ship: ShipState): void {
  const stats = SHIP_STATS[ship.shipType];

  // Regen
  ship.fuel += stats.fuelRecharge * 2;

  // Shield cost
  if (ship.shieldsUp) {
    ship.fuel -= stats.shieldCostPerTick;
  }

  // Speed fuel cost (1 fuel per warp per tick)
  ship.fuel -= ship.speed;

  // Clamp
  ship.fuel = Math.max(0, Math.min(stats.maxFuel, ship.fuel));

  // If out of fuel, drop shields
  if (ship.fuel <= 0) {
    ship.shieldsUp = false;
  }
}

/** Update shield and hull repair for one tick. Rates are in thousandths of max. */
export function updateRepair(ship: ShipState): void {
  const stats = SHIP_STATS[ship.shipType];
  const multiplier = ship.repairMode ? 4 : 2;

  // Shield repair — always active
  if (ship.shieldStrength < stats.maxShields) {
    const gain =
      (stats.shieldRepairRate * multiplier * stats.maxShields) / 1000;
    ship.shieldStrength = Math.min(
      stats.maxShields,
      ship.shieldStrength + gain,
    );
  }

  // Hull repair — only when shields are down, half as fast as shields
  if (!ship.shieldsUp && ship.hullDamage > 0) {
    const gain = (stats.hullRepairRate * multiplier * stats.maxHull) / 1000;
    ship.hullDamage = Math.max(0, ship.hullDamage - gain);
  }
}

// ---------------------------------------------------------------------------
// Combat helpers
// ---------------------------------------------------------------------------

/** Apply damage to a ship. Returns true if the ship was killed. */
export function applyDamage(ship: ShipState, damage: number): boolean {
  const stats = SHIP_STATS[ship.shipType];

  if (ship.shieldsUp && ship.shieldStrength > 0) {
    const absorbed = Math.min(damage, ship.shieldStrength);
    ship.shieldStrength -= absorbed;
    damage -= absorbed;
  }

  if (damage > 0) {
    ship.hullDamage += damage;
  }

  return ship.hullDamage >= stats.maxHull;
}

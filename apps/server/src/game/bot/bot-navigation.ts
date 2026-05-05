import {
  type ClientShip,
  type ClientPlanet,
  ShipStatus,
  ShipType,
  Team,
  PlanetFeature,
  distance,
  angleBetween,
} from "@netrek/shared";

// ---------------------------------------------------------------------------
// Nearest-entity helpers
// ---------------------------------------------------------------------------

/** Find the closest planet to position (x, y). Returns null if array is empty. */
export function nearestPlanet(
  x: number,
  y: number,
  planets: ClientPlanet[],
): ClientPlanet | null {
  let best: ClientPlanet | null = null;
  let bestDist = Infinity;
  for (const p of planets) {
    const d = distance(x, y, p.x, p.y);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

/** Find the closest alive enemy ship. Skips own slot and dead/same-team ships. */
export function nearestEnemyShip(
  x: number,
  y: number,
  myTeam: Team,
  mySlot: number,
  ships: ClientShip[],
): ClientShip | null {
  let best: ClientShip | null = null;
  let bestDist = Infinity;
  for (const s of ships) {
    if (s.slotIndex === mySlot) continue;
    if (s.team === myTeam) continue;
    if (s.status !== ShipStatus.ALIVE) continue;
    const d = distance(x, y, s.x, s.y);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best;
}

/** Find the closest alive friendly ship (not self). */
export function nearestFriendlyShip(
  x: number,
  y: number,
  myTeam: Team,
  mySlot: number,
  ships: ClientShip[],
): ClientShip | null {
  let best: ClientShip | null = null;
  let bestDist = Infinity;
  for (const s of ships) {
    if (s.slotIndex === mySlot) continue;
    if (s.team !== myTeam) continue;
    if (s.status !== ShipStatus.ALIVE) continue;
    const d = distance(x, y, s.x, s.y);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Planet filters
// ---------------------------------------------------------------------------

/** Find the closest planet owned by team. */
export function nearestFriendlyPlanet(
  x: number,
  y: number,
  team: Team,
  planets: ClientPlanet[],
): ClientPlanet | null {
  let best: ClientPlanet | null = null;
  let bestDist = Infinity;
  for (const p of planets) {
    if (p.team !== team) continue;
    const d = distance(x, y, p.x, p.y);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

/** Find the closest planet owned by an enemy (not own team, not neutral 0xff). */
export function nearestEnemyPlanet(
  x: number,
  y: number,
  team: Team,
  planets: ClientPlanet[],
): ClientPlanet | null {
  let best: ClientPlanet | null = null;
  let bestDist = Infinity;
  for (const p of planets) {
    if (p.team === team) continue;
    if (p.team === 0xff) continue;
    const d = distance(x, y, p.x, p.y);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

/** Find the closest friendly planet with REPAIR feature. */
export function nearestRepairPlanet(
  x: number,
  y: number,
  team: Team,
  planets: ClientPlanet[],
): ClientPlanet | null {
  let best: ClientPlanet | null = null;
  let bestDist = Infinity;
  for (const p of planets) {
    if (p.team !== team) continue;
    if ((p.features & PlanetFeature.REPAIR) === 0) continue;
    const d = distance(x, y, p.x, p.y);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

/** Find the closest friendly planet with FUEL feature. */
export function nearestFuelPlanet(
  x: number,
  y: number,
  team: Team,
  planets: ClientPlanet[],
): ClientPlanet | null {
  let best: ClientPlanet | null = null;
  let bestDist = Infinity;
  for (const p of planets) {
    if (p.team !== team) continue;
    if ((p.features & PlanetFeature.FUEL) === 0) continue;
    const d = distance(x, y, p.x, p.y);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Counting helpers
// ---------------------------------------------------------------------------

/** Count planets owned by team. */
export function planetsOwnedByTeam(
  team: Team,
  planets: ClientPlanet[],
): number {
  let count = 0;
  for (const p of planets) {
    if (p.team === team) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Tactical queries
// ---------------------------------------------------------------------------

/**
 * Find enemy ships that look like army carriers:
 * ShipType.AS (4) or currently beaming down (beaming === 2).
 * Only alive ships are included.
 */
export function enemyCarriers(myTeam: Team, ships: ClientShip[]): ClientShip[] {
  const result: ClientShip[] = [];
  for (const s of ships) {
    if (s.team === myTeam) continue;
    if (s.status !== ShipStatus.ALIVE) continue;
    if (s.shipType === ShipType.AS || s.beaming === 2) {
      result.push(s);
    }
  }
  return result;
}

/** Find friendly ships (not self) that are currently bombing. */
export function friendlyBombers(
  myTeam: Team,
  mySlot: number,
  ships: ClientShip[],
): ClientShip[] {
  const result: ClientShip[] = [];
  for (const s of ships) {
    if (s.slotIndex === mySlot) continue;
    if (s.team !== myTeam) continue;
    if (s.bombing) {
      result.push(s);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Direction helper
// ---------------------------------------------------------------------------

/**
 * Direction from one point to another (returns 0-255).
 * Wraps angleBetween from the shared physics module.
 */
export function directionTo(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): number {
  return angleBetween(fromX, fromY, toX, toY);
}

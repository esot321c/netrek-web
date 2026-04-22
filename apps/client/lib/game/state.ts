import { type ClientGameState, type ClientShip } from "@netrek/shared";

// ---------------------------------------------------------------------------
// Client game state — two-snapshot buffer for interpolation
// ---------------------------------------------------------------------------

let snapshot0: ClientGameState | null = null; // older
let snapshot1: ClientGameState | null = null; // newer
let snapshotTime0 = 0;
let snapshotTime1 = 0;
let mySlot = -1;

export function setMySlot(slot: number): void {
  mySlot = slot;
}

export function getMySlot(): number {
  return mySlot;
}

export function pushSnapshot(state: ClientGameState): void {
  snapshot0 = snapshot1;
  snapshotTime0 = snapshotTime1;
  snapshot1 = state;
  snapshotTime1 = performance.now();
}

export function getLatestSnapshot(): ClientGameState | null {
  return snapshot1;
}

/**
 * Compute interpolation factor (0-1) between the two snapshots
 * based on the current time.
 */
export function getInterpolationFactor(): number {
  if (!snapshot0 || !snapshot1) return 1;
  const dt = snapshotTime1 - snapshotTime0;
  if (dt <= 0) return 1;
  const elapsed = performance.now() - snapshotTime1;
  return Math.min(1, Math.max(0, elapsed / dt));
}

/**
 * Get interpolated position for a ship.
 * Lerps between the two most recent snapshot positions.
 */
export function getInterpolatedShip(
  slotIndex: number,
): { x: number; y: number } | null {
  const ship1 = snapshot1?.ships.find((s) => s.slotIndex === slotIndex);
  if (!ship1) return null;

  const ship0 = snapshot0?.ships.find((s) => s.slotIndex === slotIndex);
  if (!ship0) return { x: ship1.x, y: ship1.y };

  const t = getInterpolationFactor();
  return {
    x: ship0.x + (ship1.x - ship0.x) * t,
    y: ship0.y + (ship1.y - ship0.y) * t,
  };
}

/** Get all ships from the latest snapshot (for rendering). */
export function getShips(): ClientShip[] {
  return snapshot1?.ships ?? [];
}

export function resetState(): void {
  snapshot0 = null;
  snapshot1 = null;
  mySlot = -1;
}

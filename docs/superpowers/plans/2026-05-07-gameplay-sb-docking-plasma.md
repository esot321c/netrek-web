# Gameplay: SB Docking, Warp-to-SB & Plasma Torpedoes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add starbase docking (repair/refuel at friendly SB), player lock / warp-to-SB convenience, and plasma torpedoes (heavy tracking projectiles) to complete the Phase 2 gameplay feature set.

**Architecture:** All three features share the same data pipeline: new fields in shared types → server game-loop logic → binary protocol serialization → client rendering. Docking adds `dockedAt`/`dockedShips` to `ShipState` and `docked` to `ClientShip`. Player lock extends the existing `LockType.PLAYER` handling (already partially in place). Plasma adds a new `PlasmaState` entity type parallel to `TorpState`, with its own protocol segment, collision, and rendering.

**Tech Stack:** TypeScript, NestJS (server), Canvas 2D (client renderer), binary ArrayBuffer protocol

**Known deferral:** Galaxy map click-to-lock (spec item) is deferred — no galaxy map click handling exists yet, and `l` / `L` keys cover the essential lock use cases for beta.

---

### Task 1: Shared Types & Constants for Docking

**Files:**

- Modify: `packages/shared/src/game/types.ts`
- Modify: `packages/shared/src/game/constants.ts`

- [ ] **Step 1: Add docking fields to ShipState**

In `packages/shared/src/game/types.ts`, add after `playerId: string;` (line 184) inside the `ShipState` interface:

```typescript
  dockedAt: number; // SB slot index this ship is docked at (-1 = not docked)
  dockedShips: number[]; // slot indices of ships docked at this SB (empty for non-SBs)
```

- [ ] **Step 2: Add `docked` to ClientShip**

In `packages/shared/src/game/types.ts`, add after `alertStatus: AlertStatus;` (line 265) in the `ClientShip` interface:

```typescript
docked: boolean;
```

- [ ] **Step 3: Add `InputCommand.DOCK` and `InputCommand.FIRE_PLASMA`**

In `packages/shared/src/game/types.ts`, add after `DETONATE_SELF = 17,` (line 50) in the `InputCommand` enum:

```typescript
  DOCK = 18,
  FIRE_PLASMA = 19,
```

- [ ] **Step 4: Add docking constants**

In `packages/shared/src/game/constants.ts`, add a new section after the alert status thresholds section:

```typescript
// ---------------------------------------------------------------------------
// Docking
// ---------------------------------------------------------------------------

export const MAX_DOCK_SHIPS = 4;
export const DOCK_DIST = 900; // same as ORBIT_DIST
export const DOCK_SHIELD_REPAIR_MULT = 5; // 5x normal shield repair while docked
export const DOCK_FUEL_RECHARGE_MULT = 12; // 12x normal fuel recharge while docked
```

- [ ] **Step 5: Build shared**

Run: `npx turbo build --filter=@netrek/shared`
Expected: Success.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/game/types.ts packages/shared/src/game/constants.ts
git commit -m "feat(shared): add docking types, InputCommand.DOCK, InputCommand.FIRE_PLASMA, and docking constants"
```

---

### Task 2: Shared Types & Constants for Plasma Torpedoes

**Files:**

- Modify: `packages/shared/src/game/types.ts`
- Modify: `packages/shared/src/game/constants.ts`

- [ ] **Step 1: Add PlasmaState interface**

In `packages/shared/src/game/types.ts`, add after the `ExplosionState` interface (after line 218):

```typescript
export interface PlasmaState {
  alive: boolean;
  ownerSlot: number;
  team: Team;
  x: number;
  y: number;
  direction: number; // 0-255
  targetSlot: number; // -1 if lost tracking
  ticksRemaining: number;
}
```

- [ ] **Step 2: Add ClientPlasma interface**

In `packages/shared/src/game/types.ts`, add after the `ClientExplosion` interface (after line 287):

```typescript
export interface ClientPlasma {
  x: number;
  y: number;
  ownerSlot: number;
  team: Team;
}
```

- [ ] **Step 3: Add plasmas to ClientGameState**

In `packages/shared/src/game/types.ts`, in the `ClientGameState` interface, add after `explosions: ClientExplosion[];` (line 321):

```typescript
  plasmas: ClientPlasma[];
```

- [ ] **Step 4: Add plasma constants**

In `packages/shared/src/game/constants.ts`, add a new section after the docking constants:

```typescript
// ---------------------------------------------------------------------------
// Plasma torpedoes
// ---------------------------------------------------------------------------

export const MAX_PLASMAS = 16; // one per possible player slot
export const PLASMA_SPEED = 5;
export const PLASMA_DAMAGE = 150;
export const PLASMA_SPLASH_RADIUS = 1500;
export const PLASMA_FUEL_COST = 2000;
export const PLASMA_HEAT = 50;
export const PLASMA_LIFETIME = 60; // 6 seconds at 10Hz
export const PLASMA_TURN_RATE = 4; // direction units per tick
export const PLASMA_MIN_KILLS = 2; // need 2+ kills to fire
export const PLASMA_HIT_RADIUS = 200; // collision radius for phaser/torp counterplay
export const PLASMA_LOCK_RANGE = 6000; // max range to acquire target on fire
```

- [ ] **Step 5: Build shared**

Run: `npx turbo build --filter=@netrek/shared`
Expected: Success.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/game/types.ts packages/shared/src/game/constants.ts
git commit -m "feat(shared): add PlasmaState, ClientPlasma types and plasma constants"
```

---

### Task 3: Game State Initialization (Docking + Plasma)

**Files:**

- Modify: `apps/server/src/game/state/game-state.ts`

- [ ] **Step 1: Add docking fields to createShip and initShip**

In `apps/server/src/game/state/game-state.ts`, in `createShip()`, add after `playerId: "",` (line 65):

```typescript
    dockedAt: -1,
    dockedShips: [],
```

In `initShip()`, add after `ship.lastDamagedBySlot = -1;` (line 204):

```typescript
ship.dockedAt = -1;
ship.dockedShips = [];
```

- [ ] **Step 2: Import PlasmaState and MAX_PLASMAS**

In the import from `@netrek/shared` at the top of `game-state.ts`, add `PlasmaState` to the type imports and `MAX_PLASMAS` to the value imports:

```typescript
import {
  MAX_PLAYERS,
  MAX_TORPS,
  MAX_PHASERS,
  MAX_EXPLOSIONS,
  MAX_PLASMAS,
  SHIP_STATS,
  PLANET_DEFS,
  randomizePlanetFeatures,
  type ShipState,
  type TorpState,
  type PhaserState,
  type ExplosionState,
  type PlasmaState,
  type PlanetState,
  ShipType,
  ShipStatus,
  Team,
  LockType,
} from "@netrek/shared";
```

- [ ] **Step 3: Add createPlasma factory and plasmas array**

Add a `createPlasma` function after `createExplosion()`:

```typescript
function createPlasma(): PlasmaState {
  return {
    alive: false,
    ownerSlot: 0,
    team: Team.FEDERATION,
    x: 0,
    y: 0,
    direction: 0,
    targetSlot: -1,
    ticksRemaining: 0,
  };
}
```

In the `GameState` class, add the `plasmas` array declaration after `readonly explosions`:

```typescript
  readonly plasmas: PlasmaState[];
```

In the constructor, add after the explosions initialization:

```typescript
this.plasmas = Array.from({ length: MAX_PLASMAS }, () => createPlasma());
```

- [ ] **Step 4: Add allocatePlasma method**

Add after the existing `allocateExplosion` method in the `GameState` class:

```typescript
  allocatePlasma(): PlasmaState | null {
    for (let i = 0; i < this.plasmas.length; i++) {
      if (!this.plasmas[i]!.alive) return this.plasmas[i]!;
    }
    return null;
  }
```

- [ ] **Step 5: Build server**

Run: `npx turbo build --filter=@netrek/server`
Expected: Success.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/game/state/game-state.ts
git commit -m "feat(server): initialize docking fields and plasmas array in game state"
```

---

### Task 4: Binary Protocol — Docking Flag + Plasma Serialization

**Files:**

- Modify: `packages/shared/src/game/protocol.ts`

- [ ] **Step 1: Add docked flag to ship flags2 byte**

In `packages/shared/src/game/protocol.ts`, update the `packFlags2` function to include docked status. The flags2 byte currently uses bits 0 (pressoring) and 1-2 (beaming). Add docked as bit 3:

Change `packFlags2`:

```typescript
function packFlags2(
  pressoring: boolean,
  beaming: number,
  docked: boolean,
): number {
  return (pressoring ? 1 : 0) | ((beaming & 0x03) << 1) | (docked ? 0x08 : 0);
}
```

Change `unpackFlags2`:

```typescript
function unpackFlags2(flags: number) {
  return {
    pressoring: (flags & 1) !== 0,
    beaming: (flags >> 1) & 0x03,
    docked: (flags & 0x08) !== 0,
  };
}
```

Update the `packFlags2` call in `serializeGameState` (around line 249) to pass the docked flag:

```typescript
dv.setUint8(
  offset++,
  packFlags2(s.pressorTarget >= 0, s.beaming, s.dockedAt >= 0),
);
```

- [ ] **Step 2: Add PlasmaState imports and constants**

Add `PlasmaState`, `ClientPlasma` to the type imports and `MAX_PLASMAS` to value imports from `./types` and `./constants`:

```typescript
import {
  GALAXY_WIDTH,
  GALAXY_HEIGHT,
  SHIP_STATS,
  PLANET_DEFS,
  CLOAK_FUZZ_RANGE,
  MAX_PLASMAS,
} from "./constants";
import {
  AlertStatus,
  InputCommand,
  ShipStatus,
  Team,
  type ClientExplosion,
  type ClientGameState,
  type ClientPhaser,
  type ClientPlanet,
  type ClientPlasma,
  type ClientSelfExtra,
  type ClientShip,
  type ClientTorp,
  type PlayerInput,
  type ShipState,
  type TorpState,
  type PhaserState,
  type ExplosionState,
  type PlasmaState,
  type PlanetState,
} from "./types";
```

Add the plasma binary size constant:

```typescript
const PLASMA_SIZE = 7; // alive(1) + x(2) + y(2) + ownerSlot(1) + team(1)
```

- [ ] **Step 3: Update serializeGameState signature and body**

Add `plasmas: PlasmaState[]` parameter to `serializeGameState` after `planets`:

```typescript
export function serializeGameState(
  tick: number,
  recipientSlot: number,
  recipientTeam: Team,
  ships: ShipState[],
  torps: TorpState[],
  phasers: PhaserState[],
  explosions: ExplosionState[],
  plasmas: PlasmaState[],
  alertStatuses: AlertStatus[],
  planets: PlanetState[],
  tmode = false,
): ArrayBuffer {
```

Add alive plasmas collection after the `aliveExplosions` loop:

```typescript
const alivePlasmas: PlasmaState[] = [];
for (let i = 0; i < plasmas.length; i++) {
  if (plasmas[i]!.alive) alivePlasmas.push(plasmas[i]!);
}
```

Update `totalSize` to include plasmas:

```typescript
const totalSize =
  HEADER_SIZE +
  aliveShips.length * SHIP_SIZE +
  aliveTorps.length * TORP_SIZE +
  alivePhasers.length * PHASER_SIZE +
  aliveExplosions.length * EXPLOSION_SIZE +
  alivePlasmas.length * PLASMA_SIZE +
  planets.length * PLANET_BINARY_SIZE +
  SELF_EXTRA_SIZE;
```

Update the header to include plasma count. The current header is 12 bytes. We need to add one byte for plasma count, making it 13 bytes. Update `HEADER_SIZE` to 13:

```typescript
const HEADER_SIZE = 13;
```

Write the plasma count byte after the planet count byte in the header:

```typescript
dv.setUint8(offset++, planets.length);
dv.setUint8(offset++, alivePlasmas.length);
```

Add plasma serialization after explosions, before planets:

```typescript
// Plasmas
for (let i = 0; i < alivePlasmas.length; i++) {
  const p = alivePlasmas[i]!;
  dv.setUint8(offset++, 1); // alive flag (always 1 since we filtered)
  dv.setUint16(offset, gameToU16X(p.x), true);
  offset += 2;
  dv.setUint16(offset, gameToU16Y(p.y), true);
  offset += 2;
  dv.setUint8(offset++, p.ownerSlot);
  dv.setUint8(offset++, p.team);
}
```

- [ ] **Step 4: Update deserializeGameState**

Read plasma count from header (after `planetCount`):

```typescript
const plasmaCount = dv.getUint8(offset++);
```

Add plasma deserialization after explosions, before planets:

```typescript
// Plasmas
const plasmas: ClientPlasma[] = [];
for (let i = 0; i < plasmaCount; i++) {
  offset++; // skip alive flag
  const x = u16ToGameX(dv.getUint16(offset, true));
  offset += 2;
  const y = u16ToGameY(dv.getUint16(offset, true));
  offset += 2;
  const ownerSlot = dv.getUint8(offset++);
  const plasmaTeam = dv.getUint8(offset++);
  plasmas.push({ x, y, ownerSlot, team: plasmaTeam });
}
```

Include `plasmas` in the return value and `docked` from flags2:

In the ship push block, ensure `docked` is included from `...flags2` (it already will be since we updated `unpackFlags2`).

In the return value at the bottom, add `plasmas`:

```typescript
  return {
    tick,
    recipientSlot,
    ships,
    torps,
    phasers,
    explosions,
    plasmas,
    planets,
    self: { ... },
  };
```

- [ ] **Step 5: Update serializeGameState callers**

Find all callers of `serializeGameState` and add the `plasmas` parameter. The caller is in `apps/server/src/game/game-broadcast.service.ts`. Search for `serializeGameState(` and add `state.plasmas` after `state.explosions`:

```typescript
const buf = serializeGameState(
  state.currentTick,
  player.slot,
  player.team,
  state.ships,
  state.torps,
  state.phasers,
  state.explosions,
  state.plasmas,
  this.alertStatuses,
  state.planets,
  this.tmode,
);
```

- [ ] **Step 6: Build shared and server**

Run: `npx turbo build --filter=@netrek/shared --filter=@netrek/server`
Expected: Success.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/game/protocol.ts apps/server/src/game/game-broadcast.service.ts
git commit -m "feat(shared): serialize docking flag and plasma torpedoes in binary protocol"
```

---

### Task 5: Server — Docking Logic

**Files:**

- Modify: `apps/server/src/game/game-loop.service.ts`

- [ ] **Step 1: Add docking constants to imports**

In the import from `@netrek/shared` at the top of `game-loop.service.ts`, add:

```typescript
  MAX_DOCK_SHIPS,
  DOCK_DIST,
  DOCK_SHIELD_REPAIR_MULT,
  DOCK_FUEL_RECHARGE_MULT,
```

- [ ] **Step 2: Handle InputCommand.DOCK in processInputs**

Add a new case in the `switch (input.command)` block (after the `DETONATE_SELF` case):

```typescript
          case InputCommand.DOCK:
            this.toggleDock(ship);
            break;
```

- [ ] **Step 3: Implement toggleDock method**

Add after the `setLock` method:

```typescript
  private toggleDock(ship: ShipState): void {
    // If already docked, undock
    if (ship.dockedAt >= 0) {
      this.undock(ship);
      return;
    }

    // SBs can't dock at SBs
    if (ship.shipType === ShipType.SB) return;

    // Find a friendly SB in range
    const ships = this.gameService.state.ships;
    for (let i = 0; i < ships.length; i++) {
      const sb = ships[i]!;
      if (sb.status !== ShipStatus.ALIVE) continue;
      if (sb.shipType !== ShipType.SB) continue;
      if (sb.team !== ship.team) continue;
      if (sb.dockedShips.length >= MAX_DOCK_SHIPS) continue;

      const dist = distance(ship.x, ship.y, sb.x, sb.y);
      if (dist <= DOCK_DIST) {
        this.dock(ship, sb);
        return;
      }
    }
  }

  private dock(ship: ShipState, sb: ShipState): void {
    ship.dockedAt = sb.slotIndex;
    sb.dockedShips.push(ship.slotIndex);
    ship.speed = 0;
    ship.desiredSpeed = 0;
    // Break tractor/pressor on the docking ship
    ship.tractorTarget = -1;
    ship.pressorTarget = -1;
    // Break orbit if orbiting
    if (ship.orbitPlanetId >= 0) {
      this.breakOrbit(ship);
    }
  }

  private undock(ship: ShipState): void {
    const sbSlot = ship.dockedAt;
    ship.dockedAt = -1;
    if (sbSlot >= 0) {
      const sb = this.gameService.state.ships[sbSlot]!;
      const idx = sb.dockedShips.indexOf(ship.slotIndex);
      if (idx >= 0) sb.dockedShips.splice(idx, 1);
    }
  }
```

- [ ] **Step 4: Add undock-on-action triggers**

In `processInputs`, add undock checks at the start of movement/weapon commands. Before the `switch (input.command)` block, after the refit skip check, add:

```typescript
// Undock on movement or weapon commands
if (ship.dockedAt >= 0) {
  if (
    input.command === InputCommand.SET_SPEED ||
    input.command === InputCommand.SET_DIRECTION ||
    input.command === InputCommand.FIRE_TORP ||
    input.command === InputCommand.FIRE_PHASER ||
    input.command === InputCommand.FIRE_PLASMA
  ) {
    this.undock(ship);
  }
}
```

- [ ] **Step 5: Add cloak-break to player lock in updateLock**

In the `updateLock` method (around line 479), inside the `else if (ship.lockType === LockType.PLAYER)` block, add a cloaked check to the existing dead check:

```typescript
      } else if (ship.lockType === LockType.PLAYER) {
        const target = ships[ship.lockTargetId];
        if (!target || target.status !== ShipStatus.ALIVE || target.cloaked) {
          this.clearLock(ship);
          continue;
        }
```

- [ ] **Step 6: Add updateDocking method for position sync and SB death**

Add a new method that runs each tick:

```typescript
  private updateDocking(ships: ShipState[]): void {
    for (let i = 0; i < ships.length; i++) {
      const ship = ships[i]!;
      if (ship.dockedAt < 0) continue;

      const sb = ships[ship.dockedAt]!;

      // Force undock if SB died
      if (sb.status !== ShipStatus.ALIVE) {
        this.undock(ship);
        continue;
      }

      // Sync position to SB
      ship.x = sb.x;
      ship.y = sb.y;
      ship.speed = 0;
      ship.desiredSpeed = 0;
    }
  }
```

Call this in the `tick()` method after Step 1b (updateLock) and before Step 2 (updateMovement):

```typescript
// Step 1c: Update docking (sync positions, force-undock on SB death)
this.updateDocking(state.ships);
```

- [ ] **Step 7: Apply docking bonuses in updateShipSystems**

In the `updateShipSystems` method, add docking bonuses before the existing `updateFuel(ship)` call. After the orbit fuel bonus block (around line 1324), add:

```typescript
// Docked fuel recharge bonus
if (ship.dockedAt >= 0) {
  const dockedStats = SHIP_STATS[ship.shipType];
  ship.fuel += dockedStats.fuelRecharge * (DOCK_FUEL_RECHARGE_MULT - 2);
}
```

For shield repair bonus, in the same method, after the orbit repair bonus block, add:

```typescript
// Docked shield repair bonus
if (ship.dockedAt >= 0) {
  const dockedStats = SHIP_STATS[ship.shipType];
  const dockShieldGain =
    (dockedStats.shieldRepairRate *
      (DOCK_SHIELD_REPAIR_MULT - 2) *
      dockedStats.maxShields) /
    1000;
  if (ship.shieldStrength < dockedStats.maxShields) {
    ship.shieldStrength = Math.min(
      dockedStats.maxShields,
      ship.shieldStrength + dockShieldGain,
    );
  }
}
```

Note: We subtract 2 from the multipliers because `updateFuel` already applies 2x regen and `updateRepair` already applies 2x (or 4x in repair mode) repair. The dock bonus is the additional amount on top.

- [ ] **Step 8: Force-undock docked ships when they die**

In the `checkDeaths` method, where a ship transitions to EXPLODING, add undocking for ships docked at this ship:

After the line that sets `ship.status = ShipStatus.EXPLODING` (find it in checkDeaths), add:

```typescript
// Force-undock all ships docked at this ship (if it's an SB)
for (let d = ship.dockedShips.length - 1; d >= 0; d--) {
  const dockedSlot = ship.dockedShips[d]!;
  const dockedShip = ships[dockedSlot]!;
  if (dockedShip.dockedAt === ship.slotIndex) {
    dockedShip.dockedAt = -1;
  }
}
ship.dockedShips.length = 0;

// Also undock this ship if it was docked somewhere
if (ship.dockedAt >= 0) {
  this.undock(ship);
}
```

- [ ] **Step 9: Build server**

Run: `npx turbo build --filter=@netrek/server`
Expected: Success.

- [ ] **Step 10: Commit**

```bash
git add apps/server/src/game/game-loop.service.ts
git commit -m "feat(server): implement SB docking with repair/fuel bonuses and undock triggers"
```

---

### Task 6: Server — Plasma Torpedo Logic

**Files:**

- Modify: `apps/server/src/game/game-loop.service.ts`

- [ ] **Step 1: Add plasma constants to imports**

In the import from `@netrek/shared` at the top of `game-loop.service.ts`, add:

```typescript
  PLASMA_SPEED,
  PLASMA_DAMAGE,
  PLASMA_SPLASH_RADIUS,
  PLASMA_FUEL_COST,
  PLASMA_HEAT,
  PLASMA_LIFETIME,
  PLASMA_TURN_RATE,
  PLASMA_MIN_KILLS,
  PLASMA_HIT_RADIUS,
  PLASMA_LOCK_RANGE,
```

- [ ] **Step 2: Handle InputCommand.FIRE_PLASMA in processInputs**

Add a new case in the `switch (input.command)` block:

```typescript
          case InputCommand.FIRE_PLASMA:
            if (ship.cloaked || ship.uncloakTicks > 0) break;
            this.firePlasma(ship, input.value & 0xff);
            break;
```

- [ ] **Step 3: Implement firePlasma method**

Add after `fireTorp`:

```typescript
  private firePlasma(ship: ShipState, direction: number): void {
    // Ship type check: only DD, CA, BB, SB
    if (
      ship.shipType !== ShipType.DD &&
      ship.shipType !== ShipType.CA &&
      ship.shipType !== ShipType.BB &&
      ship.shipType !== ShipType.SB
    ) return;

    // Kill requirement
    if (ship.kills < PLASMA_MIN_KILLS) return;

    // Weapon burnout check
    if (ship.weaponBurnoutTicks > 0) return;

    // Fuel check
    if (ship.fuel < PLASMA_FUEL_COST) return;

    // Max 1 plasma in flight per ship
    const plasmas = this.gameService.state.plasmas;
    for (let i = 0; i < plasmas.length; i++) {
      if (plasmas[i]!.alive && plasmas[i]!.ownerSlot === ship.slotIndex) return;
    }

    const plasma = this.gameService.state.allocatePlasma();
    if (!plasma) return;

    ship.fuel -= PLASMA_FUEL_COST;
    ship.weaponTemp += PLASMA_HEAT;

    plasma.alive = true;
    plasma.x = ship.x;
    plasma.y = ship.y;
    plasma.direction = direction;
    plasma.ownerSlot = ship.slotIndex;
    plasma.team = ship.team;
    plasma.ticksRemaining = PLASMA_LIFETIME;

    // Lock onto nearest enemy within range
    const ships = this.gameService.state.ships;
    let bestTarget = -1;
    let bestDist = PLASMA_LOCK_RANGE;
    for (let i = 0; i < ships.length; i++) {
      const target = ships[i]!;
      if (target.status !== ShipStatus.ALIVE) continue;
      if (target.team === ship.team) continue;
      if (target.cloaked) continue;
      const dist = distance(ship.x, ship.y, target.x, target.y);
      if (dist < bestDist) {
        bestDist = dist;
        bestTarget = target.slotIndex;
      }
    }
    plasma.targetSlot = bestTarget;
  }
```

- [ ] **Step 4: Implement updatePlasmas method**

Add a new method:

```typescript
  private updatePlasmas(): void {
    const state = this.gameService.state;
    const plasmas = state.plasmas;
    const ships = state.ships;

    for (let i = 0; i < plasmas.length; i++) {
      const p = plasmas[i]!;
      if (!p.alive) continue;

      // Tick lifetime
      p.ticksRemaining--;
      if (p.ticksRemaining <= 0) {
        this.explodePlasma(p);
        continue;
      }

      // Tracking — steer toward target
      if (p.targetSlot >= 0) {
        const target = ships[p.targetSlot]!;
        if (target.status !== ShipStatus.ALIVE || target.cloaked) {
          p.targetSlot = -1; // lose tracking
        } else {
          const targetDir = angleBetween(p.x, p.y, target.x, target.y);
          let diff = targetDir - p.direction;
          if (diff > 128) diff -= 256;
          if (diff < -128) diff += 256;
          if (Math.abs(diff) <= PLASMA_TURN_RATE) {
            p.direction = targetDir;
          } else {
            p.direction = (p.direction + (diff > 0 ? PLASMA_TURN_RATE : -PLASMA_TURN_RATE) + 256) % 256;
          }
        }
      }

      // Move
      const rad = directionToRadians(p.direction);
      const vel = PLASMA_SPEED * SPEED_SCALE;
      p.x += Math.sin(rad) * vel;
      p.y += -Math.cos(rad) * vel;

      // Bounce off galaxy walls
      if (p.x < 0 || p.x > GALAXY_WIDTH || p.y < 0 || p.y > GALAXY_HEIGHT) {
        p.alive = false;
        continue;
      }

      // Check collision with ships
      for (let j = 0; j < ships.length; j++) {
        const target = ships[j]!;
        if (target.status !== ShipStatus.ALIVE) continue;
        if (target.slotIndex === p.ownerSlot) continue;

        const dist = distance(p.x, p.y, target.x, target.y);
        if (dist <= PLASMA_HIT_RADIUS) {
          this.explodePlasma(p);
          break;
        }
      }
    }
  }

  private explodePlasma(plasma: PlasmaState): void {
    plasma.alive = false;

    const state = this.gameService.state;
    const ships = state.ships;

    // Splash damage to ALL ships within radius (including friendlies and firer)
    for (let i = 0; i < ships.length; i++) {
      const target = ships[i]!;
      if (target.status !== ShipStatus.ALIVE) continue;

      const dist = distance(plasma.x, plasma.y, target.x, target.y);
      if (dist > PLASMA_SPLASH_RADIUS) continue;

      const dmg = PLASMA_DAMAGE * (1 - dist / PLASMA_SPLASH_RADIUS);
      if (dmg > 0) {
        applyDamage(target, dmg);
        target.lastDamagedBySlot = plasma.ownerSlot;
      }
    }

    // Visual explosion
    const expl = state.allocateExplosion();
    if (expl) {
      expl.alive = true;
      expl.x = plasma.x;
      expl.y = plasma.y;
      expl.radius = 0;
      expl.maxRadius = 800;
      expl.ticksRemaining = 12;
    }
  }
```

- [ ] **Step 5: Call updatePlasmas in the tick method**

In the `tick()` method, add after `this.updateTorpedoes();` (Step 3):

```typescript
// Step 3b: Move plasmas, track targets, check collisions
this.updatePlasmas();
```

- [ ] **Step 6: Add plasma counterplay to detonate method**

In the `detonate` method, after the torp detonation loop, add plasma detonation:

```typescript
// Also detonate enemy plasmas in range
const plasmas = this.gameService.state.plasmas;
for (let i = 0; i < plasmas.length; i++) {
  const p = plasmas[i]!;
  if (!p.alive) continue;
  if (p.team === ship.team) continue;

  const pdist = distance(ship.x, ship.y, p.x, p.y);
  if (pdist > DET_RANGE) continue;

  this.explodePlasma(p);
}
```

- [ ] **Step 7: Add plasma counterplay — torp and phaser hits**

In `updateTorpedoes`, inside the ship collision loop, after the ship collision check, add a plasma collision check:

```typescript
// Check collision with plasmas (torps can destroy plasmas)
if (torp.alive) {
  const plasmas = state.plasmas;
  for (let k = 0; k < plasmas.length; k++) {
    const p = plasmas[k]!;
    if (!p.alive) continue;
    if (p.team === torp.team) continue;

    const pdist = distance(torp.x, torp.y, p.x, p.y);
    if (pdist <= PLASMA_HIT_RADIUS) {
      torp.alive = false;
      this.explodePlasma(p);
      break;
    }
  }
}
```

In `firePhaser`, after the phaser hits a target (the damage application), add plasma targeting. Or better: add a separate check in `updatePhaserCooldowns` or in a dedicated method. Actually, the simplest approach: after the phaser fires and finds a target, also check if the phaser line passes near any enemy plasma. Since phasers are instant, we check at fire time.

In `firePhaser`, after `ship.phaserCooldownTicks = PHASER_COOLDOWN_TICKS;` and the target-finding loop, add:

```typescript
// Phaser can destroy plasmas — check if any enemy plasma is within hit radius of the phaser line
const plasmas = this.gameService.state.plasmas;
for (let i = 0; i < plasmas.length; i++) {
  const p = plasmas[i]!;
  if (!p.alive) continue;
  if (p.team === ship.team) continue;

  const pdist = distance(ship.x, ship.y, p.x, p.y);
  if (pdist <= stats.maxPhaserRange) {
    const pDistToLine = distance(p.x, p.y, ship.x, ship.y);
    if (pDistToLine <= PLASMA_HIT_RADIUS) {
      this.explodePlasma(p);
    }
  }
}
```

Wait — phaser damage is applied to a specific target, not along a line. The simplest faithful implementation: if the phaser target point is within `PLASMA_HIT_RADIUS` of a plasma, destroy the plasma. Let me revise:

In `firePhaser`, after the phaser is created and the hit point is known, check plasmas near the hit point. The phaser's `x2, y2` is the endpoint. But actually, for simplicity and faithfulness to original Netrek: a phaser destroys a plasma if the plasma is within phaser range AND within `PLASMA_HIT_RADIUS` of the phaser beam endpoint (`phaser.x2, y2`). Add this after the phaser state is written:

```typescript
// Phaser can destroy enemy plasmas near the hit point
const plasmaArr = this.gameService.state.plasmas;
for (let pi = 0; pi < plasmaArr.length; pi++) {
  const p = plasmaArr[pi]!;
  if (!p.alive) continue;
  if (p.team === ship.team) continue;

  const pdist = distance(phaser.x2, phaser.y2, p.x, p.y);
  if (pdist <= PLASMA_HIT_RADIUS) {
    this.explodePlasma(p);
  }
}
```

- [ ] **Step 8: Reset plasmas in resetGame**

Find the `resetGame` method (or wherever torps are reset during game reset) and add:

```typescript
for (let i = 0; i < state.plasmas.length; i++) {
  state.plasmas[i]!.alive = false;
}
```

- [ ] **Step 9: Build server**

Run: `npx turbo build --filter=@netrek/server`
Expected: Success.

- [ ] **Step 10: Commit**

```bash
git add apps/server/src/game/game-loop.service.ts
git commit -m "feat(server): implement plasma torpedoes with tracking, splash damage, and counterplay"
```

---

### Task 7: Client — Warp-to-SB (`L` key) and Galaxy Map Click Lock

**Files:**

- Modify: `apps/client/lib/game/input.ts`

- [ ] **Step 1: Add `L` key handler for lock-to-friendly-SB**

In `apps/client/lib/game/input.ts`, in the `handleGameKey` function, add a case for `L` (shift+l) after the existing `l` case:

```typescript
    case "L": {
      e.preventDefault();
      const snap = getLatestSnapshot();
      if (!snap) break;
      const myShipState = snap.ships.find((s) => s.slotIndex === getMySlot());
      if (!myShipState) break;
      // Find friendly SB
      for (const s of snap.ships) {
        if (s.team === myShipState.team && s.shipType === 5 && s.status === 0) {
          sendInput(InputCommand.LOCK, (LockType.PLAYER << 8) | s.slotIndex);
          break;
        }
      }
      break;
    }
```

- [ ] **Step 2: Add `f` key handler for plasma fire**

In `handleGameKey`, add a case for `f`:

```typescript
    case "f":
      e.preventDefault();
      fireWeaponInDirection(InputCommand.FIRE_PLASMA);
      break;
```

The `fireWeaponInDirection` function already exists and computes the direction from ship to mouse cursor. If it doesn't exist by that exact name, look at how `FIRE_TORP` is triggered — it uses the mouse position to compute a direction byte. The same pattern applies.

Check: the torp fire is handled by mouse click, not keyboard. Let me provide the direction calculation directly:

```typescript
    case "f": {
      e.preventDefault();
      if (!canvas) break;
      const rect = canvas.getBoundingClientRect();
      const mx = lastMouseX - rect.left;
      const my = lastMouseY - rect.top;
      const gx = viewportCenterX + (mx - canvas.width / 2) / viewportScale;
      const gy = viewportCenterY + (my - canvas.height / 2) / viewportScale;
      const snap2 = getLatestSnapshot();
      if (!snap2) break;
      const me = snap2.ships.find((s) => s.slotIndex === getMySlot());
      if (!me) break;
      const dx = gx - me.x;
      const dy = gy - me.y;
      const angle = Math.atan2(dx, -dy);
      const dir = ((Math.round((angle / (2 * Math.PI)) * 256) % 256) + 256) % 256;
      sendInput(InputCommand.FIRE_PLASMA, dir);
      break;
    }
```

- [ ] **Step 3: Add `e` key handler for dock toggle**

In `handleGameKey`, add a case for `e`:

```typescript
    case "e":
      e.preventDefault();
      sendInput(InputCommand.DOCK, 0);
      break;
```

- [ ] **Step 4: Build client**

Run: `npx turbo build --filter=@netrek/client`
Expected: Success.

- [ ] **Step 5: Commit**

```bash
git add apps/client/lib/game/input.ts
git commit -m "feat(client): add L key (warp-to-SB), f key (plasma fire), e key (dock toggle)"
```

---

### Task 8: Client — Plasma Rendering

**Files:**

- Modify: `apps/client/lib/game/renderer.ts`

- [ ] **Step 1: Add plasma rendering in tactical view**

In `apps/client/lib/game/renderer.ts`, after the torp rendering loop (after `drawTorp(ctx, torp);`), add:

```typescript
// Plasmas (draw as larger pulsing dots)
for (const plasma of state.plasmas) {
  drawPlasma(ctx, plasma, state.tick);
}
```

- [ ] **Step 2: Implement drawPlasma function**

Add after `drawTorp`:

```typescript
function drawPlasma(
  ctx: CanvasRenderingContext2D,
  plasma: ClientPlasma,
  tick: number,
): void {
  const [cx, cy] = gameToScreen(plasma.x, plasma.y);
  if (!canvas) return;
  if (cx < -10 || cx > canvas.width + 10 || cy < -10 || cy > canvas.height + 10)
    return;

  const scale = getScale();
  const basePx = Math.max(4, 120 * scale);
  // Pulsing effect: oscillate size by ±30%
  const pulse = 1 + 0.3 * Math.sin(tick * 0.5);
  const px = basePx * pulse;
  const color = TEAM_COLORS[plasma.team] ?? "#888888";

  ctx.fillStyle = color;
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.arc(cx, cy, px / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1.0;
}
```

- [ ] **Step 3: Add plasma rendering on galaxy map**

Find where torps are drawn on the galaxy map (search for the galaxy map rendering section). Add plasma dots after torp dots, using a slightly larger size:

```typescript
// Plasmas on galaxy map (larger dots)
for (const plasma of state.plasmas) {
  const px = (plasma.x / GALAXY_WIDTH) * galSize;
  const py = (plasma.y / GALAXY_HEIGHT) * galSize;
  galCtx.fillStyle = TEAM_COLORS[plasma.team] ?? "#888";
  galCtx.fillRect(Math.round(px) - 1, Math.round(py) - 1, 3, 3);
}
```

- [ ] **Step 4: Build client**

Run: `npx turbo build --filter=@netrek/client`
Expected: Success.

- [ ] **Step 5: Commit**

```bash
git add apps/client/lib/game/renderer.ts
git commit -m "feat(client): render plasma torpedoes in tactical view and galaxy map"
```

---

### Task 9: Client — Sound Effects and Help Text Updates

**Files:**

- Modify: `apps/client/lib/game/sound.ts`
- Modify: `apps/client/components/game-canvas.tsx`

- [ ] **Step 1: Add plasma sounds to SOUNDS array**

In `apps/client/lib/game/sound.ts`, add `"nt_plasma"` and `"nt_plasma_other"` to the SOUNDS array:

```typescript
const SOUNDS = [
  "nt_phaser",
  "nt_phaser_other",
  "nt_fire_torp",
  "nt_fire_torp_other",
  "nt_explosion",
  "nt_explosion_other",
  "nt_shield_up",
  "nt_shield_down",
  "nt_torp_hit",
  "nt_enter_ship",
  "nt_red_alert",
  "nt_tractor",
  "nt_plasma",
  "nt_plasma_other",
] as const;
```

- [ ] **Step 2: Add plasma tracking variable and sound trigger**

After `let prevTractoring = false;`, add:

```typescript
let prevPlasmaCount = 0;
```

In `processSounds()`, after the torp sound block, add:

```typescript
// --- Plasma fire ---
const currentPlasmaCount = state.plasmas.length;
if (currentPlasmaCount > prevPlasmaCount) {
  const myPlasma = state.plasmas.find((p) => p.ownerSlot === mySlot);
  if (myPlasma) {
    play("nt_plasma", 0.6);
  } else {
    play("nt_plasma_other", 0.4);
  }
}
prevPlasmaCount = currentPlasmaCount;
```

In `resetSound()`, add:

```typescript
prevPlasmaCount = 0;
```

- [ ] **Step 3: Update help overlay with new keybinds**

In `apps/client/components/game-canvas.tsx`, in the help overlay, add the new keybinds:

After the `<HelpRow k="d" desc="Detonate enemy torps" />` line, add:

```tsx
<HelpRow k="f" desc="Fire plasma torpedo" />
```

After the beam/army section, add:

```tsx
<HelpRow k="e" desc="Dock/undock at starbase" />
```

In the navigation section, after the existing `l` key entry, add:

```tsx
<HelpRow k="L" desc="Lock onto friendly starbase" />
```

- [ ] **Step 4: Build client**

Run: `npx turbo build --filter=@netrek/client`
Expected: Success.

- [ ] **Step 5: Commit**

```bash
git add apps/client/lib/game/sound.ts apps/client/components/game-canvas.tsx
git commit -m "feat(client): add plasma sound triggers and update help overlay with new keybinds"
```

---

### Task 10: Full Build Verification

**Files:** None (verification only)

- [ ] **Step 1: Build all packages**

Run: `npx turbo build`
Expected: All packages build successfully.

- [ ] **Step 2: Verify no type errors**

Run: `npx turbo build --filter=@netrek/shared --filter=@netrek/server --filter=@netrek/backend --filter=@netrek/client`
Expected: 4/4 tasks successful, 0 errors.

- [ ] **Step 3: Manual smoke test checklist**

Start the server and client. Verify:

1. Fly near friendly SB and press `e` — ship docks, position syncs with SB, speed drops to 0
2. While docked, press any movement key or fire — undocks
3. While docked, fuel recharges visibly faster
4. SB explodes — docked ships auto-undock
5. Press `L` — ship locks onto friendly SB and auto-steers toward it
6. Press `l` near a ship — locks onto that ship
7. With 2+ kills, press `f` — plasma fires toward mouse cursor
8. Plasma tracks nearest enemy with slight turning
9. Plasma explodes on ship contact with splash damage
10. Press `d` near enemy plasma — detonates it
11. Phaser hits near plasma — destroys it
12. Torp hits plasma — both destroyed
13. Plasma appears as larger pulsing dot on tactical view

- [ ] **Step 4: Commit any fixes**

If any build or test issues are found, fix and commit.

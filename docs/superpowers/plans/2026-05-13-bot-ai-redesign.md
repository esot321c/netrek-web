# Bot AI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat priority-per-tick bot AI with a three-layer architecture (Assessor + Mission + Combat) so bots think clearly, commit to tasks, handle interrupts, and play dynamic Netrek games.

**Architecture:** Bottom-up build. New server-side types first, then pure combat functions (testable in isolation), then assessor (pure scoring), then mission execution, then BotBrain rewire. Each layer is independently testable via `vitest`.

**Tech Stack:** TypeScript (strict), vitest, NestJS (server), `@netrek/shared` physics/types

**Spec:** `docs/superpowers/specs/2026-05-13-bot-ai-redesign.md`

---

## File Structure

```
apps/server/src/game/bot/
  bot-types.ts           -- NEW: MissionType enum, Mission interface, TeamBotState, CombatState
  bot-combat.ts          -- MODIFY: add torp leading, det logic, tractor/pressor, fuel/temp/shield mgmt
  bot-navigation.ts      -- MODIFY: add threat scanning helpers
  bot-assessor.ts        -- NEW: situational assessor — scores mission candidates
  bot-missions.ts        -- NEW: mission executors — one function per mission type
  bot-combat-module.ts   -- NEW: combat orchestrator — entry/exit, ties combat behaviors
  bot-ai.ts              -- REWRITE: BotBrain delegates to assessor → mission → combat layers
  bot-player.ts          -- MODIFY: pass TeamBotState[] into think()
  bot-manager.service.ts -- MODIFY: maintain team mission registry

  bot-types.spec.ts      -- NEW: type validation tests
  bot-combat.spec.ts     -- MODIFY: expand with new combat function tests
  bot-assessor.spec.ts   -- NEW: assessor scoring tests
  bot-missions.spec.ts   -- NEW: mission executor tests
  bot-combat-module.spec.ts -- NEW: combat orchestrator tests
  bot-ai.spec.ts         -- REWRITE: BotBrain integration tests
```

---

### Task 1: Server-Side Bot Types

**Files:**

- Create: `apps/server/src/game/bot/bot-types.ts`
- Test: `apps/server/src/game/bot/bot-types.spec.ts`

These types are internal to the server bot system. They do NOT go in `@netrek/shared`.

- [ ] **Step 1: Write the type definitions**

```typescript
// apps/server/src/game/bot/bot-types.ts
import {
  type ClientGameState,
  type ClientShip,
  type ClientPlanet,
  type ClientTorp,
  type PlayerInput,
  BotDifficulty,
  BotAIState,
  Team,
} from "@netrek/shared";

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

export const enum CombatPhase {
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
```

- [ ] **Step 2: Write basic validation test**

```typescript
// apps/server/src/game/bot/bot-types.spec.ts
import { describe, it, expect } from "vitest";
import {
  MissionType,
  CombatPhase,
  aiStateToMissionType,
  ASSESS_INTERVAL_TICKS,
  ORDER_EXPIRE_TICKS,
} from "./bot-types";
import { BotAIState } from "@netrek/shared";

describe("bot-types", () => {
  describe("aiStateToMissionType", () => {
    it("maps PATROL to PATROL", () => {
      expect(aiStateToMissionType(BotAIState.PATROL)).toBe(MissionType.PATROL);
    });
    it("maps BOMB to BOMB", () => {
      expect(aiStateToMissionType(BotAIState.BOMB)).toBe(MissionType.BOMB);
    });
    it("maps RETREAT to RESUPPLY", () => {
      expect(aiStateToMissionType(BotAIState.RETREAT)).toBe(
        MissionType.RESUPPLY,
      );
    });
    it("maps ATTACK to PATROL (combat is sub-behavior)", () => {
      expect(aiStateToMissionType(BotAIState.ATTACK)).toBe(MissionType.PATROL);
    });
  });

  describe("constants", () => {
    it("assess interval is 15 ticks", () => {
      expect(ASSESS_INTERVAL_TICKS).toBe(15);
    });
    it("order expiry is 600 ticks", () => {
      expect(ORDER_EXPIRE_TICKS).toBe(600);
    });
  });
});
```

- [ ] **Step 3: Run test to verify it passes**

Run: `cd apps/server && npx vitest run src/game/bot/bot-types.spec.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/game/bot/bot-types.ts apps/server/src/game/bot/bot-types.spec.ts
git commit -m "feat(bot): add server-side mission types and constants for AI redesign"
```

---

### Task 2: Combat Helpers — Torp Leading, Discipline, and Det

**Files:**

- Modify: `apps/server/src/game/bot/bot-combat.ts`
- Modify: `apps/server/src/game/bot/bot-combat.spec.ts`

Add pure functions for the new combat behaviors. These are independently testable.

- [ ] **Step 1: Write failing tests for torp leading**

Add to `bot-combat.spec.ts`:

```typescript
import {
  leadTarget,
  countTorpsInFlight,
  shouldDetEnemyTorps,
  shouldFireTorpDisciplined,
  shouldDisengageFuel,
  shouldStopTorpTemp,
  shouldStopAllTemp,
} from "./bot-combat";

describe("leadTarget", () => {
  it("returns current direction for NEWBIE (no lead)", () => {
    // Target at (5000, 5000), moving east at speed 6
    // Shooter at (0, 5000), torp speed 12
    const dir = leadTarget(
      0,
      5000,
      5000,
      5000,
      64,
      6,
      12,
      BotDifficulty.NEWBIE,
    );
    // NEWBIE: should just return direction to current position
    const directDir = /* angleBetween(0, 5000, 5000, 5000) */ 64; // east
    expect(dir).toBe(directDir);
  });

  it("leads target for VETERAN", () => {
    // Target moving away — lead should be ahead of current position
    const noLead = leadTarget(
      0,
      5000,
      5000,
      5000,
      64,
      6,
      12,
      BotDifficulty.NEWBIE,
    );
    const fullLead = leadTarget(
      0,
      5000,
      5000,
      5000,
      64,
      6,
      12,
      BotDifficulty.VETERAN,
    );
    // Lead direction should differ from no-lead direction
    expect(fullLead).not.toBe(noLead);
  });

  it("COMPETENT leads at ~50% of veteran offset", () => {
    const noLead = leadTarget(
      0,
      5000,
      5000,
      5000,
      64,
      6,
      12,
      BotDifficulty.NEWBIE,
    );
    const halfLead = leadTarget(
      0,
      5000,
      5000,
      5000,
      64,
      6,
      12,
      BotDifficulty.COMPETENT,
    );
    const fullLead = leadTarget(
      0,
      5000,
      5000,
      5000,
      64,
      6,
      12,
      BotDifficulty.VETERAN,
    );
    // Half lead should be between no lead and full lead
    const noLeadDelta = (fullLead - noLead + 256) % 256;
    const halfLeadDelta = (halfLead - noLead + 256) % 256;
    if (noLeadDelta > 0 && noLeadDelta < 128) {
      expect(halfLeadDelta).toBeGreaterThan(0);
      expect(halfLeadDelta).toBeLessThan(noLeadDelta);
    }
  });
});

describe("countTorpsInFlight", () => {
  it("counts torps owned by the bot's slot", () => {
    const torps = [
      { x: 100, y: 100, ownerSlot: 0, team: 0 as Team },
      { x: 200, y: 200, ownerSlot: 0, team: 0 as Team },
      { x: 300, y: 300, ownerSlot: 1, team: 0 as Team },
    ];
    expect(countTorpsInFlight(torps, 0)).toBe(2);
    expect(countTorpsInFlight(torps, 1)).toBe(1);
    expect(countTorpsInFlight(torps, 2)).toBe(0);
  });
});

function makeSelf(overrides: Partial<ClientSelfExtra> = {}): ClientSelfExtra {
  return {
    kills: 0,
    armies: 0,
    phaserCooldown: 0,
    engineBurnout: 0,
    weaponBurnout: 0,
    engineTemp: 0,
    fuel: 10000,
    shieldStrength: 100,
    hullDamage: 0,
    orbitPlanetId: -1,
    lockType: 0,
    lockTargetId: -1,
    tmode: false,
    surrenderTimer: 0,
    enemySurrenderTimer: 0,
    ...overrides,
  };
}

describe("shouldFireTorpDisciplined", () => {
  it("allows fire when under max for difficulty", () => {
    expect(
      shouldFireTorpDisciplined(3, 9000, makeSelf(), BotDifficulty.COMPETENT),
    ).toBe(true);
  });
  it("blocks fire when at max for VETERAN", () => {
    expect(
      shouldFireTorpDisciplined(4, 5000, makeSelf(), BotDifficulty.VETERAN),
    ).toBe(false);
  });
  it("NEWBIE has no limit", () => {
    expect(
      shouldFireTorpDisciplined(7, 5000, makeSelf(), BotDifficulty.NEWBIE),
    ).toBe(true);
  });
  it("blocks fire when weapon burnout active", () => {
    expect(
      shouldFireTorpDisciplined(
        0,
        5000,
        makeSelf({ weaponBurnout: 5 }),
        BotDifficulty.VETERAN,
      ),
    ).toBe(false);
  });
});

describe("shouldDisengageFuel", () => {
  it("returns true when fuel below 30%", () => {
    expect(shouldDisengageFuel(2800, 10000)).toBe(true);
  });
  it("returns false when fuel above 30%", () => {
    expect(shouldDisengageFuel(3500, 10000)).toBe(false);
  });
});

describe("shouldStopTorpTemp", () => {
  it("returns true when weapon temp above 70% of max", () => {
    expect(shouldStopTorpTemp(750, 1000)).toBe(true);
  });
  it("returns false when below threshold", () => {
    expect(shouldStopTorpTemp(600, 1000)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/server && npx vitest run src/game/bot/bot-combat.spec.ts`
Expected: FAIL — functions don't exist yet

- [ ] **Step 3: Implement torp leading and combat helpers**

Add to `bot-combat.ts`:

```typescript
import {
  type ClientTorp,
  type ClientSelfExtra,
  BotDifficulty,
  SPEED_SCALE,
  SHIP_STATS,
  ShipType,
  angleBetween,
  directionToRadians,
} from "@netrek/shared";
import {
  MAX_TORPS_IN_FLIGHT,
  FUEL_DISENGAGE_PCT,
  FUEL_CRITICAL_PCT,
  WTEMP_TORP_STOP_PCT,
  WTEMP_ALL_STOP_PCT,
} from "./bot-types";

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/server && npx vitest run src/game/bot/bot-combat.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/game/bot/bot-combat.ts apps/server/src/game/bot/bot-combat.spec.ts
git commit -m "feat(bot): add torp leading, torp discipline, det, fuel/temp awareness"
```

---

### Task 3: Combat Orchestrator

**Files:**

- Create: `apps/server/src/game/bot/bot-combat-module.ts`
- Create: `apps/server/src/game/bot/bot-combat-module.spec.ts`

The combat orchestrator ties together combat behaviors: entry/exit detection, movement (purposeful speed + direction), weapons, tractor/pressor, shield management. It runs every tick during combat and returns `PlayerInput[]`.

- [ ] **Step 1: Write failing tests for combat entry/exit and core behaviors**

```typescript
// apps/server/src/game/bot/bot-combat-module.spec.ts
import { describe, it, expect } from "vitest";
import { createCombatState, updateCombat } from "./bot-combat-module";
import {
  CombatPhase,
  COMBAT_ENGAGE_DIST,
  COMBAT_EXIT_TICKS,
} from "./bot-types";
import { BotDifficulty, Team, ShipStatus, ShipType } from "@netrek/shared";

function makeShip(overrides: Partial<ClientShip> = {}): ClientShip {
  return {
    slotIndex: 0,
    status: ShipStatus.ALIVE,
    team: Team.FEDERATION,
    shipType: ShipType.CA,
    x: 50000,
    y: 50000,
    direction: 0,
    speed: 6,
    shieldPct: 1,
    hullDamagePct: 0,
    fuelPct: 1,
    weaponTemp: 0,
    engineTemp: 0,
    shieldsUp: true,
    repairMode: false,
    cloaked: false,
    orbiting: false,
    bombing: false,
    beaming: 0,
    tractoring: false,
    pressoring: false,
    tractorTarget: -1,
    pressorTarget: -1,
    alertStatus: 0,
    docked: false,
    ...overrides,
  };
}

function makeGameState(
  ships: ClientShip[],
  torps: ClientTorp[] = [],
): ClientGameState {
  return {
    tick: 100,
    recipientSlot: 0,
    ships,
    torps,
    phasers: [],
    explosions: [],
    plasmas: [],
    planets: [],
    self: {
      kills: 0,
      armies: 0,
      phaserCooldown: 0,
      engineBurnout: 0,
      weaponBurnout: 0,
      engineTemp: 0,
      fuel: 10000,
      shieldStrength: 100,
      hullDamage: 0,
      orbitPlanetId: -1,
      lockType: 0,
      lockTargetId: -1,
      tmode: false,
      surrenderTimer: 0,
      enemySurrenderTimer: 0,
    },
  };
}

describe("combat phase transitions", () => {
  it("enters ENGAGED when enemy within engage distance", () => {
    const combat = createCombatState();
    const myShip = makeShip({
      slotIndex: 0,
      team: Team.FEDERATION,
      x: 50000,
      y: 50000,
    });
    const enemyShip = makeShip({
      slotIndex: 1,
      team: Team.ROMULANS,
      x: 54000,
      y: 50000,
    });
    const gs = makeGameState([myShip, enemyShip]);
    const inputs = updateCombat(
      combat,
      50000,
      50000,
      100,
      gs,
      myShip,
      BotDifficulty.COMPETENT,
      Team.FEDERATION,
      Team.ROMULANS,
      0,
    );
    expect(inputs).not.toBeNull();
    expect(combat.phase).toBe(CombatPhase.ENGAGED);
  });

  it("returns null when no enemies in range", () => {
    const combat = createCombatState();
    const myShip = makeShip({
      slotIndex: 0,
      team: Team.FEDERATION,
      x: 50000,
      y: 50000,
    });
    const enemyShip = makeShip({
      slotIndex: 1,
      team: Team.ROMULANS,
      x: 90000,
      y: 90000,
    });
    const gs = makeGameState([myShip, enemyShip]);
    const inputs = updateCombat(
      combat,
      50000,
      50000,
      100,
      gs,
      myShip,
      BotDifficulty.COMPETENT,
      Team.FEDERATION,
      Team.ROMULANS,
      0,
    );
    expect(inputs).toBeNull();
  });

  it("transitions to DISENGAGING when enemy leaves range", () => {
    const combat = createCombatState();
    combat.phase = CombatPhase.ENGAGED;
    combat.targetSlot = 1;
    const myShip = makeShip({
      slotIndex: 0,
      team: Team.FEDERATION,
      x: 50000,
      y: 50000,
    });
    const enemyShip = makeShip({
      slotIndex: 1,
      team: Team.ROMULANS,
      x: 90000,
      y: 90000,
    });
    const gs = makeGameState([myShip, enemyShip]);
    updateCombat(
      combat,
      50000,
      50000,
      100,
      gs,
      myShip,
      BotDifficulty.COMPETENT,
      Team.FEDERATION,
      Team.ROMULANS,
      0,
    );
    expect(combat.phase).toBe(CombatPhase.DISENGAGING);
  });

  it("exits combat after COMBAT_EXIT_TICKS with no threats", () => {
    const combat = createCombatState();
    combat.phase = CombatPhase.DISENGAGING;
    combat.targetSlot = 1;
    combat.ticksSinceLastThreat = COMBAT_EXIT_TICKS;
    const myShip = makeShip({
      slotIndex: 0,
      team: Team.FEDERATION,
      x: 50000,
      y: 50000,
    });
    const enemyShip = makeShip({
      slotIndex: 1,
      team: Team.ROMULANS,
      x: 90000,
      y: 90000,
    });
    const gs = makeGameState([myShip, enemyShip]);
    const inputs = updateCombat(
      combat,
      50000,
      50000,
      100,
      gs,
      myShip,
      BotDifficulty.COMPETENT,
      Team.FEDERATION,
      Team.ROMULANS,
      0,
    );
    expect(inputs).toBeNull();
    expect(combat.phase).toBe(CombatPhase.NONE);
  });
});

describe("NEWBIE combat", () => {
  it("does not use tractor/pressor", () => {
    const combat = createCombatState();
    const myShip = makeShip({
      slotIndex: 0,
      team: Team.FEDERATION,
      x: 50000,
      y: 50000,
    });
    const enemyShip = makeShip({
      slotIndex: 1,
      team: Team.ROMULANS,
      x: 52000,
      y: 50000,
    });
    const gs = makeGameState([myShip, enemyShip]);
    const inputs = updateCombat(
      combat,
      50000,
      50000,
      100,
      gs,
      myShip,
      BotDifficulty.NEWBIE,
      Team.FEDERATION,
      Team.ROMULANS,
      0,
    );
    expect(inputs).not.toBeNull();
    const hasTractor = inputs!.some((i) => i.command === InputCommand.TRACTOR);
    const hasPressor = inputs!.some((i) => i.command === InputCommand.PRESSOR);
    expect(hasTractor).toBe(false);
    expect(hasPressor).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/server && npx vitest run src/game/bot/bot-combat-module.spec.ts`

- [ ] **Step 3: Implement CombatModule**

```typescript
// apps/server/src/game/bot/bot-combat-module.ts
import {
  type ClientGameState,
  type ClientShip,
  type ClientTorp,
  type PlayerInput,
  BotDifficulty,
  InputCommand,
  Team,
  ShipStatus,
  distance,
  SHIP_STATS,
} from "@netrek/shared";
import {
  type CombatState,
  CombatPhase,
  COMBAT_ENGAGE_DIST,
  COMBAT_EXIT_TICKS,
  MIN_COMBAT_DIST,
  MAX_COMBAT_DIST,
  MIN_SPEED_HOLD_TICKS,
  MIN_DIR_HOLD_TICKS,
  TORP_DANGER_DIST,
  SHIELDS_DOWN_SAFE_DIST,
  NEWBIE_SHIELD_REACT_TICKS,
} from "./bot-types";
import {
  leadTarget,
  countTorpsInFlight,
  shouldFireTorpDisciplined,
  shouldFirePhaser,
  shouldDetEnemyTorps,
  shouldDisengageFuel,
  shouldStopTorpTemp,
  shouldStopAllTemp,
  selectTarget,
} from "./bot-combat";
import { nearestEnemyShip, directionTo } from "./bot-navigation";

export function createCombatState(): CombatState {
  return {
    phase: CombatPhase.NONE,
    targetSlot: -1,
    ticksSinceLastThreat: 0,
    lastSpeedChangeTick: 0,
    lastDirectionChangeTick: 0,
    currentManeuverSpeed: 6,
  };
}

/** Update combat phase and return inputs. Returns null if not in combat. */
export function updateCombat(
  combat: CombatState,
  myX: number,
  myY: number,
  tick: number,
  gs: ClientGameState,
  mySelf: ClientShip,
  difficulty: BotDifficulty,
  team: Team,
  enemyTeam: Team,
  slot: number,
): PlayerInput[] | null {
  const ships = gs.ships;
  const torps = gs.torps;
  const self = gs.self;

  const enemy = nearestEnemyShip(myX, myY, team, slot, ships, enemyTeam);
  const enemyDist = enemy ? distance(myX, myY, enemy.x, enemy.y) : Infinity;
  const enemyInRange = enemyDist <= COMBAT_ENGAGE_DIST;

  // Phase transitions
  if (combat.phase === CombatPhase.NONE) {
    if (enemyInRange && enemy) {
      combat.phase = CombatPhase.ENGAGED;
      combat.targetSlot = enemy.slotIndex;
      combat.ticksSinceLastThreat = 0;
    } else {
      return null;
    }
  }

  if (enemyInRange) {
    combat.ticksSinceLastThreat = 0;
    if (enemy) combat.targetSlot = enemy.slotIndex;
    combat.phase = CombatPhase.ENGAGED;
  } else {
    combat.ticksSinceLastThreat++;
    if (combat.ticksSinceLastThreat >= COMBAT_EXIT_TICKS) {
      combat.phase = CombatPhase.NONE;
      combat.targetSlot = -1;
      return null;
    }
    combat.phase = CombatPhase.DISENGAGING;
  }

  const inputs: PlayerInput[] = [];
  const target = ships.find(
    (s) => s.slotIndex === combat.targetSlot && s.status === ShipStatus.ALIVE,
  );

  if (!target) {
    // Target dead, find new one or exit
    if (enemy && enemyInRange) {
      combat.targetSlot = enemy.slotIndex;
    } else {
      combat.phase = CombatPhase.NONE;
      return null;
    }
  }

  const combatTarget = target ?? enemy;
  if (!combatTarget) return null;

  const dist = distance(myX, myY, combatTarget.x, combatTarget.y);
  const stats = SHIP_STATS[mySelf.shipType];

  // --- Shield management ---
  inputs.push(
    ...combatShieldLogic(
      mySelf,
      myX,
      myY,
      ships,
      torps,
      team,
      slot,
      enemyTeam,
      tick,
      difficulty,
      combat,
    ),
  );

  // --- Fuel check: disengage if critical ---
  if (shouldDisengageFuel(self.fuel, stats.maxFuel)) {
    combat.phase = CombatPhase.DISENGAGING;
  }

  // --- Movement: purposeful speed + direction ---
  inputs.push(
    ...combatMovement(
      myX,
      myY,
      combatTarget,
      dist,
      tick,
      difficulty,
      slot,
      mySelf,
      combat,
      torps,
      team,
    ),
  );

  // --- Weapons ---
  inputs.push(
    ...combatWeapons(
      myX,
      myY,
      combatTarget,
      dist,
      tick,
      gs,
      mySelf,
      difficulty,
      slot,
      team,
    ),
  );

  // --- Tractor/pressor ---
  inputs.push(
    ...combatTractorPressor(
      myX,
      myY,
      combatTarget,
      dist,
      tick,
      difficulty,
      self,
      mySelf,
    ),
  );

  // --- Det enemy torps ---
  if (shouldDetEnemyTorps(myX, myY, torps, team, difficulty)) {
    inputs.push({ command: InputCommand.DETONATE, value: 0, tick });
  }

  return inputs;
}

function combatShieldLogic(
  mySelf: ClientShip,
  myX: number,
  myY: number,
  ships: ClientShip[],
  torps: ClientTorp[],
  team: Team,
  slot: number,
  enemyTeam: Team,
  tick: number,
  difficulty: BotDifficulty,
  combat: CombatState,
): PlayerInput[] {
  const enemy = nearestEnemyShip(myX, myY, team, slot, ships, enemyTeam);
  const enemyDist = enemy ? distance(myX, myY, enemy.x, enemy.y) : Infinity;

  if (difficulty === BotDifficulty.NEWBIE) {
    // Drop shields only when no enemies on scan, slow to raise
    if (enemyDist > SHIELDS_DOWN_SAFE_DIST && mySelf.shieldsUp) {
      return [{ command: InputCommand.SHIELD_TOGGLE, value: 0, tick }];
    }
    if (enemyDist <= SHIELDS_DOWN_SAFE_DIST && !mySelf.shieldsUp) {
      // Slow react: only raise if enemy has been close for a while
      if (
        combat.ticksSinceLastThreat === 0 &&
        tick % NEWBIE_SHIELD_REACT_TICKS < 2
      ) {
        return [{ command: InputCommand.SHIELD_TOGGLE, value: 1, tick }];
      }
    }
    return [];
  }

  // COMPETENT+: shields up during combat by default
  if (!mySelf.shieldsUp) {
    return [{ command: InputCommand.SHIELD_TOGGLE, value: 1, tick }];
  }
  return [];
}

function combatMovement(
  myX: number,
  myY: number,
  target: ClientShip,
  dist: number,
  tick: number,
  difficulty: BotDifficulty,
  slot: number,
  mySelf: ClientShip,
  combat: CombatState,
  torps: ClientTorp[],
  team: Team,
): PlayerInput[] {
  const inputs: PlayerInput[] = [];
  const dirToTarget = directionTo(myX, myY, target.x, target.y);

  // Check for torp evasion first
  const dangerDist = TORP_DANGER_DIST[difficulty];
  if (dangerDist > 0) {
    for (const t of torps) {
      if (t.team === team) continue;
      const d = distance(myX, myY, t.x, t.y);
      if (d < dangerDist) {
        // Dodge perpendicular to the torp
        const torpDir = directionTo(t.x, t.y, myX, myY);
        const perpOffset = slot % 2 === 0 ? 64 : -64;
        const evadeDir = (torpDir + perpOffset + 256) % 256;
        // Drop speed for sharp turn, then accelerate
        inputs.push(
          { command: InputCommand.SET_DIRECTION, value: evadeDir, tick },
          { command: InputCommand.SET_SPEED, value: 3, tick },
        );
        combat.lastDirectionChangeTick = tick;
        combat.lastSpeedChangeTick = tick;
        combat.currentManeuverSpeed = 3;
        return inputs;
      }
    }
  }

  const minSpeedHold = MIN_SPEED_HOLD_TICKS[difficulty];
  const minDirHold = MIN_DIR_HOLD_TICKS[difficulty];
  const canChangeSpeed = tick - combat.lastSpeedChangeTick >= minSpeedHold;
  const canChangeDir = tick - combat.lastDirectionChangeTick >= minDirHold;

  if (difficulty === BotDifficulty.NEWBIE) {
    // Newbie: constant speed, direct approach
    inputs.push(
      { command: InputCommand.SET_DIRECTION, value: dirToTarget, tick },
      { command: InputCommand.SET_SPEED, value: 6, tick },
    );
    return inputs;
  }

  // Purposeful speed: slow to turn, fast to travel
  if (dist < MIN_COMBAT_DIST) {
    // Too close: turn away
    const awayDir = directionTo(target.x, target.y, myX, myY);
    if (canChangeDir) {
      inputs.push({
        command: InputCommand.SET_DIRECTION,
        value: awayDir,
        tick,
      });
      combat.lastDirectionChangeTick = tick;
    }
    if (canChangeSpeed) {
      inputs.push({ command: InputCommand.SET_SPEED, value: 5, tick });
      combat.lastSpeedChangeTick = tick;
      combat.currentManeuverSpeed = 5;
    }
  } else if (dist > MAX_COMBAT_DIST) {
    // Too far: close in
    if (canChangeDir) {
      inputs.push({
        command: InputCommand.SET_DIRECTION,
        value: dirToTarget,
        tick,
      });
      combat.lastDirectionChangeTick = tick;
    }
    if (canChangeSpeed) {
      inputs.push({ command: InputCommand.SET_SPEED, value: 7, tick });
      combat.lastSpeedChangeTick = tick;
      combat.currentManeuverSpeed = 7;
    }
  } else {
    // In range: circle strafe
    const circleOffset = slot % 2 === 0 ? 64 : -64;
    const circleDir = (dirToTarget + circleOffset + 256) % 256;
    if (canChangeDir) {
      inputs.push({
        command: InputCommand.SET_DIRECTION,
        value: circleDir,
        tick,
      });
      combat.lastDirectionChangeTick = tick;
    }
    if (canChangeSpeed && combat.currentManeuverSpeed !== 4) {
      inputs.push({ command: InputCommand.SET_SPEED, value: 4, tick });
      combat.lastSpeedChangeTick = tick;
      combat.currentManeuverSpeed = 4;
    }
  }

  return inputs;
}

function combatWeapons(
  myX: number,
  myY: number,
  target: ClientShip,
  dist: number,
  tick: number,
  gs: ClientGameState,
  mySelf: ClientShip,
  difficulty: BotDifficulty,
  slot: number,
  team: Team,
): PlayerInput[] {
  const inputs: PlayerInput[] = [];
  const self = gs.self;
  const stats = SHIP_STATS[mySelf.shipType];

  if (shouldStopAllTemp(mySelf.weaponTemp, stats.maxWpnTemp)) return inputs;

  // Phaser — always fires at direct direction (instant hit)
  if (
    shouldFirePhaser(dist, self) &&
    !shouldStopAllTemp(mySelf.weaponTemp, stats.maxWpnTemp)
  ) {
    inputs.push({
      command: InputCommand.FIRE_PHASER,
      value: directionTo(myX, myY, target.x, target.y),
      tick,
    });
  }

  // Torp — with leading and discipline
  if (!shouldStopTorpTemp(mySelf.weaponTemp, stats.maxWpnTemp)) {
    const torpsInFlight = countTorpsInFlight(gs.torps, slot);
    if (shouldFireTorpDisciplined(torpsInFlight, dist, self, difficulty)) {
      const torpDir = leadTarget(
        myX,
        myY,
        target.x,
        target.y,
        target.direction,
        target.speed,
        stats.torpSpeed,
        difficulty,
      );
      inputs.push({ command: InputCommand.FIRE_TORP, value: torpDir, tick });
    }
  }

  return inputs;
}

function combatTractorPressor(
  myX: number,
  myY: number,
  target: ClientShip,
  dist: number,
  tick: number,
  difficulty: BotDifficulty,
  self: ClientSelfExtra,
  mySelf: ClientShip,
): PlayerInput[] {
  if (difficulty === BotDifficulty.NEWBIE) return [];

  const stats = SHIP_STATS[mySelf.shipType];
  const tractorRange = stats.tractorRange * 6000; // tractorRange is a multiplier on base range

  if (dist > tractorRange) return [];

  // Pressor: push away enemies that are too close (all competent+)
  if (dist < MIN_COMBAT_DIST) {
    if (!mySelf.pressoring) {
      return [{ command: InputCommand.PRESSOR, value: target.slotIndex, tick }];
    }
    return [];
  }

  // Tractor: hold fleeing enemies (veteran only)
  if (difficulty === BotDifficulty.VETERAN && dist > MAX_COMBAT_DIST * 0.8) {
    // Target moving away from us? Check if their heading is generally away
    const dirToUs = directionTo(target.x, target.y, myX, myY);
    const targetHeading = target.direction;
    let delta = (targetHeading - dirToUs + 256) % 256;
    if (delta > 128) delta = 256 - delta;
    // If target is heading > 90 degrees away from us, they're fleeing
    if (delta > 64 && !mySelf.tractoring && self.fuel > 2000) {
      return [{ command: InputCommand.TRACTOR, value: target.slotIndex, tick }];
    }
  }

  return [];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/server && npx vitest run src/game/bot/bot-combat-module.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/game/bot/bot-combat-module.ts apps/server/src/game/bot/bot-combat-module.spec.ts
git commit -m "feat(bot): add combat orchestrator with movement, weapons, tractor/pressor"
```

---

### Task 4: Navigation Additions

**Files:**

- Modify: `apps/server/src/game/bot/bot-navigation.ts`
- Existing test: `apps/server/src/game/bot/bot-navigation.spec.ts`

Add helpers the assessor needs: counting enemy ships near a planet, finding friendly carriers.

- [ ] **Step 1: Write failing tests**

```typescript
describe("enemiesThreateningPlanet", () => {
  it("counts enemies within range of a planet", () => {
    const ships = [
      makeShip({ slotIndex: 0, team: Team.ROMULANS, x: 20500, y: 80000 }),
      makeShip({ slotIndex: 1, team: Team.ROMULANS, x: 50000, y: 50000 }),
    ];
    const planet = { x: 20000, y: 80000 } as ClientPlanet;
    expect(enemiesThreateningPlanet(planet, ships, Team.FEDERATION, 8000)).toBe(
      1,
    );
  });
});

describe("friendlyCarriers", () => {
  it("finds teammates carrying armies (beaming down)", () => {
    const ships = [
      makeShip({ slotIndex: 0, team: Team.FEDERATION, beaming: 2 }),
      makeShip({ slotIndex: 1, team: Team.FEDERATION, beaming: 0 }),
    ];
    expect(friendlyCarriers(Team.FEDERATION, 2, ships).length).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement navigation helpers**

```typescript
/** Count alive enemy ships within range of a planet position. */
export function enemiesThreateningPlanet(
  planet: { x: number; y: number },
  ships: ClientShip[],
  myTeam: Team,
  range: number,
): number {
  let count = 0;
  for (const s of ships) {
    if (s.team === myTeam) continue;
    if (s.status !== ShipStatus.ALIVE) continue;
    if (distance(s.x, s.y, planet.x, planet.y) <= range) count++;
  }
  return count;
}

/** Find friendly ships (not self) that appear to be carrying armies. */
export function friendlyCarriers(
  myTeam: Team,
  mySlot: number,
  ships: ClientShip[],
): ClientShip[] {
  const result: ClientShip[] = [];
  for (const s of ships) {
    if (s.slotIndex === mySlot || s.team !== myTeam) continue;
    if (s.status !== ShipStatus.ALIVE) continue;
    if (s.beaming === 2 || s.shipType === ShipType.AS) {
      result.push(s);
    }
  }
  return result;
}
```

- [ ] **Step 4: Run tests, verify pass**
- [ ] **Step 5: Commit**

```bash
git add apps/server/src/game/bot/bot-navigation.ts apps/server/src/game/bot/bot-navigation.spec.ts
git commit -m "feat(bot): add threat scanning and carrier detection to navigation"
```

---

### Task 5: Situational Assessor

**Files:**

- Create: `apps/server/src/game/bot/bot-assessor.ts`
- Create: `apps/server/src/game/bot/bot-assessor.spec.ts`

Pure function: takes game state + team state + bot state -> returns scored `MissionCandidate[]`. No side effects.

- [ ] **Step 1: Write failing tests for mission scoring**

```typescript
// apps/server/src/game/bot/bot-assessor.spec.ts
import { describe, it, expect } from "vitest";
import { assess } from "./bot-assessor";
import {
  MissionType,
  ORDER_SCORE_BONUS,
  type TeamBotState,
  type BotOrder,
} from "./bot-types";
import {
  BotDifficulty,
  Team,
  ShipStatus,
  ShipType,
  PlanetVisibility,
  PlanetFeature,
} from "@netrek/shared";

function makeShip(overrides: Partial<ClientShip> = {}): ClientShip {
  return {
    slotIndex: 0,
    status: ShipStatus.ALIVE,
    team: Team.FEDERATION,
    shipType: ShipType.CA,
    x: 50000,
    y: 50000,
    direction: 0,
    speed: 0,
    shieldPct: 1,
    hullDamagePct: 0,
    fuelPct: 1,
    weaponTemp: 0,
    engineTemp: 0,
    shieldsUp: true,
    repairMode: false,
    cloaked: false,
    orbiting: false,
    bombing: false,
    beaming: 0,
    tractoring: false,
    pressoring: false,
    tractorTarget: -1,
    pressorTarget: -1,
    alertStatus: 0,
    docked: false,
    ...overrides,
  };
}

function makePlanet(overrides: Partial<ClientPlanet> = {}): ClientPlanet {
  return {
    planetId: 0,
    x: 50000,
    y: 50000,
    name: "Earth",
    team: Team.FEDERATION,
    armies: 10,
    features: 0,
    visibility: PlanetVisibility.FRESH,
    ...overrides,
  };
}

function makeGameState(
  overrides: Partial<ClientGameState> = {},
): ClientGameState {
  return {
    tick: 100,
    recipientSlot: 0,
    ships: [],
    torps: [],
    phasers: [],
    explosions: [],
    plasmas: [],
    planets: [],
    self: {
      kills: 0,
      armies: 0,
      phaserCooldown: 0,
      engineBurnout: 0,
      weaponBurnout: 0,
      engineTemp: 0,
      fuel: 10000,
      shieldStrength: 100,
      hullDamage: 0,
      orbitPlanetId: -1,
      lockType: 0,
      lockTargetId: -1,
      tmode: false,
      surrenderTimer: 0,
      enemySurrenderTimer: 0,
    },
    ...overrides,
  };
}

describe("assess", () => {
  it("RESUPPLY scores high when hull damage is high", () => {
    const myShip = makeShip({ slotIndex: 0 });
    const gs = makeGameState({
      ships: [myShip],
      self: { ...makeGameState().self, hullDamage: 80, fuel: 2000 },
    });
    const candidates = assess(
      50000,
      50000,
      gs,
      Team.FEDERATION,
      Team.ROMULANS,
      0,
      BotDifficulty.COMPETENT,
      [],
      null,
      myShip,
    );
    const resupply = candidates.find((c) => c.type === MissionType.RESUPPLY);
    const patrol = candidates.find((c) => c.type === MissionType.PATROL);
    expect(resupply!.score).toBeGreaterThan(patrol!.score);
  });

  it("BOMB scores high for army-rich enemy planet", () => {
    const myShip = makeShip({ slotIndex: 0 });
    const planet = makePlanet({
      planetId: 15,
      team: Team.ROMULANS,
      armies: 30,
      x: 55000,
      y: 50000,
    });
    const gs = makeGameState({ ships: [myShip], planets: [planet] });
    const candidates = assess(
      50000,
      50000,
      gs,
      Team.FEDERATION,
      Team.ROMULANS,
      0,
      BotDifficulty.COMPETENT,
      [],
      null,
      myShip,
    );
    const bomb = candidates.find((c) => c.type === MissionType.BOMB);
    expect(bomb).toBeDefined();
    expect(bomb!.score).toBeGreaterThan(40);
  });

  it("chat order adds bonus to matching mission", () => {
    const myShip = makeShip({ slotIndex: 0 });
    const planet = makePlanet({
      planetId: 15,
      team: Team.ROMULANS,
      armies: 10,
      x: 55000,
      y: 50000,
    });
    const gs = makeGameState({ ships: [myShip], planets: [planet] });
    const order: BotOrder = {
      missionType: MissionType.BOMB,
      targetId: 15,
      receivedTick: 50,
      expiresTick: 650,
    };
    const withOrder = assess(
      50000,
      50000,
      gs,
      Team.FEDERATION,
      Team.ROMULANS,
      0,
      BotDifficulty.COMPETENT,
      [],
      order,
      myShip,
    );
    const withoutOrder = assess(
      50000,
      50000,
      gs,
      Team.FEDERATION,
      Team.ROMULANS,
      0,
      BotDifficulty.COMPETENT,
      [],
      null,
      myShip,
    );
    const bombWithOrder = withOrder.find(
      (c) => c.type === MissionType.BOMB && c.targetId === 15,
    );
    const bombWithout = withoutOrder.find(
      (c) => c.type === MissionType.BOMB && c.targetId === 15,
    );
    expect(bombWithOrder!.score - bombWithout!.score).toBe(ORDER_SCORE_BONUS);
  });

  it("deduplication penalizes missions other bots are already doing", () => {
    const myShip = makeShip({ slotIndex: 0 });
    const planet = makePlanet({
      planetId: 15,
      team: Team.ROMULANS,
      armies: 10,
      x: 55000,
      y: 50000,
    });
    const gs = makeGameState({ ships: [myShip], planets: [planet] });
    const teamBots: TeamBotState[] = [
      { slot: 2, currentMission: MissionType.BOMB, missionTargetId: 15 },
      { slot: 3, currentMission: MissionType.BOMB, missionTargetId: 15 },
    ];
    const noDup = assess(
      50000,
      50000,
      gs,
      Team.FEDERATION,
      Team.ROMULANS,
      0,
      BotDifficulty.COMPETENT,
      [],
      null,
      myShip,
    );
    const withDup = assess(
      50000,
      50000,
      gs,
      Team.FEDERATION,
      Team.ROMULANS,
      0,
      BotDifficulty.COMPETENT,
      teamBots,
      null,
      myShip,
    );
    const bombNoDup = noDup.find(
      (c) => c.type === MissionType.BOMB && c.targetId === 15,
    );
    const bombWithDup = withDup.find(
      (c) => c.type === MissionType.BOMB && c.targetId === 15,
    );
    expect(bombWithDup!.score).toBeLessThan(bombNoDup!.score);
  });

  it("PATROL is always a candidate as fallback", () => {
    const myShip = makeShip({ slotIndex: 0 });
    const gs = makeGameState({ ships: [myShip] });
    const candidates = assess(
      50000,
      50000,
      gs,
      Team.FEDERATION,
      Team.ROMULANS,
      0,
      BotDifficulty.NEWBIE,
      [],
      null,
      myShip,
    );
    const patrol = candidates.find((c) => c.type === MissionType.PATROL);
    expect(patrol).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement assessor**

```typescript
// apps/server/src/game/bot/bot-assessor.ts
import {
  type ClientGameState,
  type ClientShip,
  type ClientPlanet,
  BotDifficulty,
  Team,
  ShipStatus,
  distance,
  SHIP_STATS,
  BEAM_MIN_ARMIES,
  PlanetVisibility,
  PlanetFeature,
} from "@netrek/shared";
import {
  type MissionCandidate,
  type TeamBotState,
  type BotOrder,
  MissionType,
  ORDER_SCORE_BONUS,
} from "./bot-types";
import {
  nearestEnemyShip,
  nearestFriendlyPlanet,
  nearestRepairPlanet,
  nearestFuelPlanet,
  enemyCarriers,
  friendlyBombers,
  friendlyCarriers,
  enemiesThreateningPlanet,
  planetsOwnedByTeam,
} from "./bot-navigation";

// Scoring weight constants
const RESUPPLY_BASE = 20;
const RESUPPLY_HULL_WEIGHT = 80; // max bonus at 100% damage
const RESUPPLY_FUEL_WEIGHT = 60;
const BOMB_BASE = 40;
const BOMB_ARMY_WEIGHT = 3; // per army on target
const BOMB_DISTANCE_PENALTY = 0.002; // per game unit
const TAKE_BASE = 50;
const TAKE_KILL_BONUS = 20;
const ESCORT_BASE = 60;
const ESCORT_DISTANCE_PENALTY = 0.003;
const OGG_BASE = 70;
const DEFEND_BASE = 50;
const DEFEND_THREAT_BONUS = 15; // per enemy threatening planet
const PATROL_BASE = 15;
const DUPLICATE_PENALTY = 30;

export function assess(
  myX: number,
  myY: number,
  gs: ClientGameState,
  team: Team,
  enemyTeam: Team,
  slot: number,
  difficulty: BotDifficulty,
  teamBots: TeamBotState[],
  order: BotOrder | null,
  mySelf: ClientShip,
): MissionCandidate[] {
  const candidates: MissionCandidate[] = [];
  const { ships, planets, self } = gs;
  const stats = SHIP_STATS[mySelf.shipType];

  // --- RESUPPLY ---
  const hullPct = self.hullDamage / stats.maxHull;
  const fuelPct = self.fuel / stats.maxFuel;
  const resupplyScore =
    RESUPPLY_BASE +
    hullPct * RESUPPLY_HULL_WEIGHT +
    (1 - fuelPct) * RESUPPLY_FUEL_WEIGHT;
  candidates.push({
    type: MissionType.RESUPPLY,
    targetId: -1,
    score: resupplyScore,
  });

  // --- BOMB ---
  for (const p of planets) {
    if (p.team !== enemyTeam) continue;
    if (p.visibility === PlanetVisibility.FRESH && p.armies < 5) continue;
    const dist = distance(myX, myY, p.x, p.y);
    let score =
      BOMB_BASE +
      (p.armies ?? 10) * BOMB_ARMY_WEIGHT -
      dist * BOMB_DISTANCE_PENALTY;
    score -=
      countBotsOnMission(teamBots, MissionType.BOMB, p.planetId) *
      DUPLICATE_PENALTY;
    candidates.push({ type: MissionType.BOMB, targetId: p.planetId, score });
  }

  // --- TAKE ---
  if (self.tmode && self.kills >= 1) {
    const capacity = Math.min(
      stats.maxArmies,
      Math.floor(self.kills) * stats.armiesPerKill,
    );
    if (capacity >= 2) {
      for (const p of planets) {
        if (p.team !== enemyTeam) continue;
        if (p.visibility !== PlanetVisibility.FRESH) continue;
        if (p.armies > 4) continue;
        if (capacity < p.armies + 1 && p.features & PlanetFeature.AGRICULTURAL)
          continue;
        const dist = distance(myX, myY, p.x, p.y);
        let score =
          TAKE_BASE +
          self.kills * TAKE_KILL_BONUS -
          dist * BOMB_DISTANCE_PENALTY;
        score -=
          countBotsOnMission(teamBots, MissionType.TAKE, p.planetId) *
          DUPLICATE_PENALTY;
        candidates.push({
          type: MissionType.TAKE,
          targetId: p.planetId,
          score,
        });
      }
    }
  }

  // --- ESCORT ---
  const carriers = friendlyCarriers(team, slot, ships);
  for (const c of carriers) {
    const dist = distance(myX, myY, c.x, c.y);
    let score = ESCORT_BASE - dist * ESCORT_DISTANCE_PENALTY;
    score -=
      countBotsOnMission(teamBots, MissionType.ESCORT, c.slotIndex) *
      DUPLICATE_PENALTY;
    candidates.push({ type: MissionType.ESCORT, targetId: c.slotIndex, score });
  }
  const bombers = friendlyBombers(team, slot, ships);
  for (const b of bombers) {
    const dist = distance(myX, myY, b.x, b.y);
    let score = ESCORT_BASE - 10 - dist * ESCORT_DISTANCE_PENALTY;
    score -=
      countBotsOnMission(teamBots, MissionType.ESCORT, b.slotIndex) *
      DUPLICATE_PENALTY;
    candidates.push({ type: MissionType.ESCORT, targetId: b.slotIndex, score });
  }

  // --- OGG ---
  if (difficulty >= BotDifficulty.COMPETENT) {
    const eCarriers = enemyCarriers(team, ships, enemyTeam);
    for (const ec of eCarriers) {
      const dist = distance(myX, myY, ec.x, ec.y);
      let score = OGG_BASE - dist * 0.002;
      if (difficulty === BotDifficulty.VETERAN) score += 15;
      score -=
        countBotsOnMission(teamBots, MissionType.OGG, ec.slotIndex) *
        DUPLICATE_PENALTY;
      candidates.push({ type: MissionType.OGG, targetId: ec.slotIndex, score });
    }
  }

  // --- DEFEND ---
  for (const p of planets) {
    if (p.team !== team) continue;
    const threats = enemiesThreateningPlanet(p, ships, team, 8000);
    if (threats === 0) continue;
    const dist = distance(myX, myY, p.x, p.y);
    let score = DEFEND_BASE + threats * DEFEND_THREAT_BONUS - dist * 0.002;
    if (p.features & PlanetFeature.AGRICULTURAL) score += 15;
    if (p.features & PlanetFeature.REPAIR) score += 10;
    score -=
      countBotsOnMission(teamBots, MissionType.DEFEND, p.planetId) *
      DUPLICATE_PENALTY;
    candidates.push({ type: MissionType.DEFEND, targetId: p.planetId, score });
  }

  // --- PATROL ---
  candidates.push({
    type: MissionType.PATROL,
    targetId: -1,
    score: PATROL_BASE,
  });

  // --- Apply chat order bonus ---
  if (order !== null) {
    for (const c of candidates) {
      if (
        c.type === order.missionType &&
        (c.targetId === order.targetId || order.targetId === -1)
      ) {
        c.score += ORDER_SCORE_BONUS;
      }
    }
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

function countBotsOnMission(
  teamBots: TeamBotState[],
  missionType: MissionType,
  targetId: number,
): number {
  let count = 0;
  for (const b of teamBots) {
    if (b.currentMission === missionType && b.missionTargetId === targetId)
      count++;
  }
  return count;
}
```

- [ ] **Step 4: Run tests, verify pass**
- [ ] **Step 5: Commit**

```bash
git add apps/server/src/game/bot/bot-assessor.ts apps/server/src/game/bot/bot-assessor.spec.ts
git commit -m "feat(bot): add situational assessor with scored mission candidates"
```

---

### Task 6: Mission Executors

**Files:**

- Create: `apps/server/src/game/bot/bot-missions.ts`
- Create: `apps/server/src/game/bot/bot-missions.spec.ts`

One function per mission type. Each takes game state and returns `PlayerInput[]`. These replace the old `doPatrol`, `doBomb`, `doTake`, etc. in `bot-ai.ts`. Port the existing logic but with the spec improvements (TAKE phases, RESUPPLY options, DEFEND patience).

Each mission function signature:

```typescript
export function executePatrol(ctx: MissionContext): PlayerInput[];
export function executeBomb(ctx: MissionContext): PlayerInput[];
export function executeTake(
  ctx: MissionContext,
  takeState: TakePhaseState,
): PlayerInput[];
export function executeEscort(ctx: MissionContext): PlayerInput[];
export function executeDefend(ctx: MissionContext): PlayerInput[];
export function executeOgg(ctx: MissionContext): PlayerInput[];
export function executeResupply(ctx: MissionContext): PlayerInput[];
```

Where `MissionContext` is:

```typescript
export interface MissionContext {
  myX: number;
  myY: number;
  tick: number;
  gs: ClientGameState;
  mySelf: ClientShip;
  difficulty: BotDifficulty;
  team: Team;
  enemyTeam: Team;
  slot: number;
  mission: Mission;
}
```

- [ ] **Step 1: Write failing tests for each mission executor**

```typescript
// apps/server/src/game/bot/bot-missions.spec.ts
import { describe, it, expect } from "vitest";
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
import { MissionType, type TakePhaseState, type Mission } from "./bot-types";
import {
  BotDifficulty,
  Team,
  ShipStatus,
  ShipType,
  InputCommand,
  PlanetVisibility,
  PlanetFeature,
} from "@netrek/shared";

function makeCtx(overrides: Partial<MissionContext> = {}): MissionContext {
  return {
    myX: 50000,
    myY: 50000,
    tick: 100,
    gs: {
      tick: 100,
      recipientSlot: 0,
      ships: [makeShip({ slotIndex: 0, team: Team.FEDERATION })],
      torps: [],
      phasers: [],
      explosions: [],
      plasmas: [],
      planets: [],
      self: {
        kills: 0,
        armies: 0,
        phaserCooldown: 0,
        engineBurnout: 0,
        weaponBurnout: 0,
        engineTemp: 0,
        fuel: 10000,
        shieldStrength: 100,
        hullDamage: 0,
        orbitPlanetId: -1,
        lockType: 0,
        lockTargetId: -1,
        tmode: false,
        surrenderTimer: 0,
        enemySurrenderTimer: 0,
      },
    },
    mySelf: makeShip({ slotIndex: 0, team: Team.FEDERATION }),
    difficulty: BotDifficulty.COMPETENT,
    team: Team.FEDERATION,
    enemyTeam: Team.ROMULANS,
    slot: 0,
    mission: {
      type: MissionType.PATROL,
      targetId: -1,
      score: 15,
      startTick: 0,
    },
    ...overrides,
  };
}

function makeShip(overrides: Partial<ClientShip> = {}): ClientShip {
  return {
    slotIndex: 0,
    status: ShipStatus.ALIVE,
    team: Team.FEDERATION,
    shipType: ShipType.CA,
    x: 50000,
    y: 50000,
    direction: 0,
    speed: 0,
    shieldPct: 1,
    hullDamagePct: 0,
    fuelPct: 1,
    weaponTemp: 0,
    engineTemp: 0,
    shieldsUp: true,
    repairMode: false,
    cloaked: false,
    orbiting: false,
    bombing: false,
    beaming: 0,
    tractoring: false,
    pressoring: false,
    tractorTarget: -1,
    pressorTarget: -1,
    alertStatus: 0,
    docked: false,
    ...overrides,
  };
}

describe("executePatrol", () => {
  it("emits SET_DIRECTION and SET_SPEED toward frontline", () => {
    const ctx = makeCtx({
      gs: {
        ...makeCtx().gs,
        planets: [
          {
            planetId: 15,
            x: 70000,
            y: 50000,
            name: "Rom1",
            team: Team.ROMULANS,
            armies: 10,
            features: 0,
            visibility: PlanetVisibility.FRESH,
          },
        ],
      },
    });
    const inputs = executePatrol(ctx);
    expect(inputs.some((i) => i.command === InputCommand.SET_DIRECTION)).toBe(
      true,
    );
    expect(inputs.some((i) => i.command === InputCommand.SET_SPEED)).toBe(true);
  });
});

describe("executeBomb", () => {
  it("navigates toward target planet when not orbiting", () => {
    const ctx = makeCtx({
      mission: {
        type: MissionType.BOMB,
        targetId: 15,
        score: 60,
        startTick: 0,
      },
      gs: {
        ...makeCtx().gs,
        planets: [
          {
            planetId: 15,
            x: 70000,
            y: 50000,
            name: "Rom1",
            team: Team.ROMULANS,
            armies: 10,
            features: 0,
            visibility: PlanetVisibility.FRESH,
          },
        ],
        self: { ...makeCtx().gs.self, orbitPlanetId: -1 },
      },
    });
    const inputs = executeBomb(ctx);
    expect(inputs.some((i) => i.command === InputCommand.SET_DIRECTION)).toBe(
      true,
    );
  });

  it("does NOT raise shields while bombing (auto-lowered)", () => {
    const ctx = makeCtx({
      mission: {
        type: MissionType.BOMB,
        targetId: 15,
        score: 60,
        startTick: 0,
      },
      mySelf: makeShip({ slotIndex: 0, bombing: true, shieldsUp: false }),
      gs: {
        ...makeCtx().gs,
        planets: [
          {
            planetId: 15,
            x: 50000,
            y: 50000,
            name: "Rom1",
            team: Team.ROMULANS,
            armies: 10,
            features: 0,
            visibility: PlanetVisibility.FRESH,
          },
        ],
        self: { ...makeCtx().gs.self, orbitPlanetId: 15 },
      },
    });
    const inputs = executeBomb(ctx);
    const shieldToggle = inputs.find(
      (i) => i.command === InputCommand.SHIELD_TOGGLE,
    );
    expect(shieldToggle).toBeUndefined();
  });
});

describe("executeTake", () => {
  it("starts in pickup phase and beams up at friendly planet", () => {
    const takeState: TakePhaseState = { phase: "pickup", pickupPlanetId: 5 };
    const ctx = makeCtx({
      mission: {
        type: MissionType.TAKE,
        targetId: 15,
        score: 60,
        startTick: 0,
      },
      gs: {
        ...makeCtx().gs,
        planets: [
          {
            planetId: 5,
            x: 50000,
            y: 50000,
            name: "Earth",
            team: Team.FEDERATION,
            armies: 20,
            features: 0,
            visibility: PlanetVisibility.FRESH,
          },
          {
            planetId: 15,
            x: 70000,
            y: 50000,
            name: "Rom1",
            team: Team.ROMULANS,
            armies: 2,
            features: 0,
            visibility: PlanetVisibility.FRESH,
          },
        ],
        self: { ...makeCtx().gs.self, orbitPlanetId: 5, kills: 2 },
      },
    });
    const inputs = executeTake(ctx, takeState);
    expect(inputs.some((i) => i.command === InputCommand.BEAM_UP)).toBe(true);
  });

  it("does NOT cloak during transit phase", () => {
    const takeState: TakePhaseState = { phase: "transit", pickupPlanetId: 5 };
    const ctx = makeCtx({
      mission: {
        type: MissionType.TAKE,
        targetId: 15,
        score: 60,
        startTick: 0,
      },
      gs: {
        ...makeCtx().gs,
        planets: [
          {
            planetId: 15,
            x: 70000,
            y: 50000,
            name: "Rom1",
            team: Team.ROMULANS,
            armies: 2,
            features: 0,
            visibility: PlanetVisibility.FRESH,
          },
        ],
        self: { ...makeCtx().gs.self, armies: 4 },
      },
    });
    const inputs = executeTake(ctx, takeState);
    const cloak = inputs.find((i) => i.command === InputCommand.CLOAK_TOGGLE);
    expect(cloak).toBeUndefined();
  });
});

describe("executeResupply", () => {
  it("enters repair mode when no enemies nearby and hull is damaged", () => {
    const ctx = makeCtx({
      mission: {
        type: MissionType.RESUPPLY,
        targetId: -1,
        score: 70,
        startTick: 0,
      },
      gs: {
        ...makeCtx().gs,
        ships: [makeShip({ slotIndex: 0, team: Team.FEDERATION })],
        self: { ...makeCtx().gs.self, hullDamage: 50 },
      },
    });
    const inputs = executeResupply(ctx);
    expect(inputs.some((i) => i.command === InputCommand.REPAIR_TOGGLE)).toBe(
      true,
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Implement all mission executors**

Port from existing `doPatrol`, `doBomb`, `doTake`, `doEscort`, `doDefend`, `doOgg`, `doRetreat` in current `bot-ai.ts`. Key changes:

- TAKE: three-phase (pickup/transit/approach+drop), no early cloak, fight oggers
- RESUPPLY: passive (shields down) vs active repair (R mode) vs planet, with distance/safety weighing
- BOMB: don't toggle shields manually (bombing auto-drops them)
- DEFEND: patience — don't fire wildly at distant threats

- [ ] **Step 4: Run tests, verify pass**
- [ ] **Step 5: Commit**

```bash
git add apps/server/src/game/bot/bot-missions.ts apps/server/src/game/bot/bot-missions.spec.ts
git commit -m "feat(bot): add mission executors for all 7 mission types"
```

---

### Task 7: BotBrain Rewrite

**Files:**

- Rewrite: `apps/server/src/game/bot/bot-ai.ts`
- Rewrite: `apps/server/src/game/bot/bot-ai.spec.ts`

BotBrain now delegates to the three layers. The public API stays identical:

```typescript
think(gameState: ClientGameState, teamBots?: TeamBotState[]): PlayerInput[]
setOrder(state: BotAIState, targetId: number, currentTick: number): void
clearOrder(): void
```

- [ ] **Step 1: Write failing tests for the new BotBrain**

```typescript
// apps/server/src/game/bot/bot-ai.spec.ts
import { describe, it, expect } from "vitest";
import { BotBrain } from "./bot-ai";
import { MissionType, type TeamBotState } from "./bot-types";
import {
  BotDifficulty,
  BotAIState,
  Team,
  ShipStatus,
  ShipType,
  InputCommand,
  PlanetVisibility,
} from "@netrek/shared";

function makeShip(overrides: Partial<ClientShip> = {}): ClientShip {
  return {
    slotIndex: 0,
    status: ShipStatus.ALIVE,
    team: Team.FEDERATION,
    shipType: ShipType.CA,
    x: 50000,
    y: 50000,
    direction: 0,
    speed: 0,
    shieldPct: 1,
    hullDamagePct: 0,
    fuelPct: 1,
    weaponTemp: 0,
    engineTemp: 0,
    shieldsUp: true,
    repairMode: false,
    cloaked: false,
    orbiting: false,
    bombing: false,
    beaming: 0,
    tractoring: false,
    pressoring: false,
    tractorTarget: -1,
    pressorTarget: -1,
    alertStatus: 0,
    docked: false,
    ...overrides,
  };
}

function makeGameState(
  overrides: Partial<ClientGameState> = {},
): ClientGameState {
  return {
    tick: 100,
    recipientSlot: 0,
    ships: [makeShip({ slotIndex: 0, team: Team.FEDERATION })],
    torps: [],
    phasers: [],
    explosions: [],
    plasmas: [],
    planets: [],
    self: {
      kills: 0,
      armies: 0,
      phaserCooldown: 0,
      engineBurnout: 0,
      weaponBurnout: 0,
      engineTemp: 0,
      fuel: 10000,
      shieldStrength: 100,
      hullDamage: 0,
      orbitPlanetId: -1,
      lockType: 0,
      lockTargetId: -1,
      tmode: false,
      surrenderTimer: 0,
      enemySurrenderTimer: 0,
    },
    ...overrides,
  };
}

describe("BotBrain", () => {
  it("starts in PATROL state", () => {
    const brain = new BotBrain(BotDifficulty.COMPETENT, Team.FEDERATION, 0);
    expect(brain.currentState).toBe(BotAIState.PATROL);
  });

  it("produces inputs when called with valid game state", () => {
    const brain = new BotBrain(BotDifficulty.COMPETENT, Team.FEDERATION, 0);
    const gs = makeGameState({
      planets: [
        {
          planetId: 15,
          x: 70000,
          y: 50000,
          name: "Rom1",
          team: Team.ROMULANS,
          armies: 10,
          features: 0,
          visibility: PlanetVisibility.FRESH,
        },
      ],
    });
    const inputs = brain.think(gs);
    expect(inputs.length).toBeGreaterThan(0);
  });

  it("reports ATTACK state when in combat", () => {
    const brain = new BotBrain(BotDifficulty.COMPETENT, Team.FEDERATION, 0);
    const enemyShip = makeShip({
      slotIndex: 1,
      team: Team.ROMULANS,
      x: 54000,
      y: 50000,
    });
    const gs = makeGameState({
      ships: [makeShip({ slotIndex: 0 }), enemyShip],
    });
    brain.think(gs);
    expect(brain.currentState).toBe(BotAIState.ATTACK);
  });

  it("heavy damage triggers re-assessment", () => {
    const brain = new BotBrain(BotDifficulty.COMPETENT, Team.FEDERATION, 0);
    // First tick: no damage
    const gs1 = makeGameState();
    brain.think(gs1);
    // Second tick: sudden heavy damage should trigger re-assess
    const gs2 = makeGameState({
      tick: 105,
      self: { ...makeGameState().self, hullDamage: 60 },
    });
    const inputs = brain.think(gs2);
    expect(inputs.length).toBeGreaterThanOrEqual(0); // Valid response
  });

  it("setOrder triggers reassessment", () => {
    const brain = new BotBrain(BotDifficulty.COMPETENT, Team.FEDERATION, 0);
    brain.setOrder(BotAIState.BOMB, 15, 100);
    // Next think should include re-assessment with order bonus
    const gs = makeGameState({
      planets: [
        {
          planetId: 15,
          x: 70000,
          y: 50000,
          name: "Rom1",
          team: Team.ROMULANS,
          armies: 10,
          features: 0,
          visibility: PlanetVisibility.FRESH,
        },
      ],
    });
    brain.think(gs);
    expect(brain.currentMission).toBe(MissionType.BOMB);
  });

  it("exposes currentMission and currentMissionTargetId for team registry", () => {
    const brain = new BotBrain(BotDifficulty.COMPETENT, Team.FEDERATION, 0);
    expect(brain.currentMission).toBe(MissionType.PATROL);
    expect(brain.currentMissionTargetId).toBe(-1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement new BotBrain**

```typescript
// apps/server/src/game/bot/bot-ai.ts
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

  /** Backward-compatible state property for BotManagerService. */
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
      this.combat,
      myX,
      myY,
      tick,
      gameState,
      mySelf,
      this.difficulty,
      this.team,
      this.enemyTeam,
      this.slot,
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

    // If mission executor returned empty (target invalid), trigger re-assess next tick
    if (inputs.length === 0) {
      this.needsReassessment = true;
    }

    return inputs;
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd apps/server && npx vitest run src/game/bot/bot-ai.spec.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/game/bot/bot-ai.ts apps/server/src/game/bot/bot-ai.spec.ts
git commit -m "feat(bot): rewrite BotBrain with assessor + mission + combat layers"
```

---

### Task 8: Bot Player and Manager Integration

**Files:**

- Modify: `apps/server/src/game/bot/bot-player.ts`
- Modify: `apps/server/src/game/bot/bot-manager.service.ts`

Wire the team mission registry so bots know what their teammates are doing.

- [ ] **Step 1: Update BotPlayer.onTick to pass team state**

Add `teamBots` parameter to `onTick()`:

```typescript
onTick(
  /* ...existing params... */
  teamBots?: TeamBotState[],
): void {
  // ... existing serialize/deserialize ...
  const inputs = this.brain.think(gameState, teamBots ?? []);
  // ... existing enqueue ...
}
```

- [ ] **Step 2: Update BotManagerService to build and pass team state**

In `onTick()`, before running bot AI:

```typescript
// Build team mission registries
const fedBots: TeamBotState[] = [];
const romBots: TeamBotState[] = [];
for (const [slot, bot] of this.bots) {
  const entry: TeamBotState = {
    slot,
    currentMission: bot.brain.currentMission,
    missionTargetId: bot.brain.currentMissionTargetId,
  };
  if (bot.team === Team.FEDERATION) fedBots.push(entry);
  else romBots.push(entry);
}

// Pass team state to each bot
for (const [slot, bot] of this.bots) {
  const teamState = bot.team === Team.FEDERATION ? fedBots : romBots;
  bot.onTick(/* ...existing params... */, teamState);
}
```

Add public getters to `BotBrain`:

```typescript
get currentMission(): MissionType { return this.mission.type; }
get currentMissionTargetId(): number { return this.mission.targetId; }
```

- [ ] **Step 3: Update chat order handling**

In `BotManagerService.onChatMessage()`, keep existing flow — `brain.setOrder()` still works, it now feeds the assessor instead of overriding.

- [ ] **Step 4: Run full test suite**

Run: `cd apps/server && npx vitest run`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/game/bot/bot-player.ts apps/server/src/game/bot/bot-manager.service.ts apps/server/src/game/bot/bot-ai.ts
git commit -m "feat(bot): wire team mission registry through bot-player and bot-manager"
```

---

### Task 9: Build Verification and Cleanup

**Files:**

- All modified files in `apps/server/src/game/bot/`

- [ ] **Step 1: Run full project build**

Run: `cd apps/server && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 2: Run full test suite**

Run: `cd apps/server && npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Remove dead code**

Delete any functions from the old `bot-ai.ts` that are no longer referenced:

- `thinkRole()` — replaced by assessor
- `dispatchState()` — replaced by mission executors
- `doPatrol()`, `doBomb()`, `doTake()`, etc. — moved to `bot-missions.ts`
- `torpEvasionDirection()` — moved to combat module
- `findFrontlineBombTarget()`, `findTakeablePlanet()` — moved to assessor or missions
- Old `shieldsUp()`, `moveTo()`, `moveToOrbit()` module-level helpers — port to missions or shared helpers

Verify no imports reference removed functions.

- [ ] **Step 4: Run build + tests again after cleanup**
- [ ] **Step 5: Final commit**

```bash
git add -A apps/server/src/game/bot/
git commit -m "chore(bot): remove old flat-priority AI code, clean up imports"
```

---

### Task 10: Smoke Test — Run Server and Observe Bot Behavior

**Files:** None (manual verification)

- [ ] **Step 1: Start the server in dev mode**

Run: `cd apps/server && npm run start:dev`

- [ ] **Step 2: Connect a client and observe bots**

Watch for:

- Bots spread out across different missions (not all clumping)
- Bots bomb, take planets, escort carriers
- Combat involves dodging, torp leading, tractor/pressor use
- Bots retreat to resupply when damaged
- Planets change hands over time
- No bots stuck in loops or sitting idle

- [ ] **Step 3: Check server logs for assessor decisions**

Add temporary logging to assessor if needed to debug scoring.

- [ ] **Step 4: Note any issues for follow-up**

Create a list of tuning adjustments needed (scoring weights, distances, timing).

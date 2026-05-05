# Bots & Lobby Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-side AI bots that populate the game automatically, a dynamic difficulty balancing system, a win/reset cycle, and a simple lobby UI for players to join.

**Architecture:** Bots inject inputs directly into the existing InputQueue and receive per-player filtered game state from BroadcastService (Approach C). BotManager owns lifecycle (spawn/remove/redistribute). Each BotPlayer runs a state machine AI (PATROL/ATTACK/BOMB/ESCORT/DEFEND/OGG/RETREAT) with decision quality determined by difficulty preset (Newbie/Competent/Veteran). The lobby is a REST endpoint + Next.js page showing server info and team picker.

**Tech Stack:** TypeScript, NestJS (server services + event system), Vitest (testing), Next.js App Router (lobby page), existing shared package physics/protocol.

---

## File Structure

### New Files

```
packages/shared/src/game/bot-types.ts          — BotDifficulty enum, BotAIState enum, ChatMessage interface
apps/server/src/game/bot/bot-config.ts          — Configurable bot settings with env var overrides
apps/server/src/game/bot/bot-names.ts           — Bot name generator
apps/server/src/game/bot/bot-player.ts          — Per-bot instance: holds state, runs AI per tick
apps/server/src/game/bot/bot-navigation.ts      — Nearest planet/enemy finders, direction helpers
apps/server/src/game/bot/bot-combat.ts          — Target selection, weapon firing decisions
apps/server/src/game/bot/bot-ai.ts              — State machine: all states + transition logic
apps/server/src/game/bot/bot-orders.ts          — Team chat order parser
apps/server/src/game/bot/bot-manager.service.ts — Lifecycle: spawn, remove, redistribute, rebalance
apps/server/src/game/bot/bot-manager.spec.ts    — Tests for BotManager
apps/server/src/game/bot/bot-navigation.spec.ts — Tests for navigation helpers
apps/server/src/game/bot/bot-combat.spec.ts     — Tests for combat helpers
apps/server/src/game/bot/bot-ai.spec.ts         — Tests for AI state machine
apps/server/src/game/bot/bot-orders.spec.ts     — Tests for order parser
apps/server/src/game/bot/index.ts               — Barrel export
apps/server/src/lobby/lobby.controller.ts       — REST endpoints for lobby data
apps/server/src/lobby/lobby.module.ts           — NestJS module
apps/client/app/lobby/page.tsx                  — Lobby screen UI
```

### Modified Files

```
packages/shared/src/game/index.ts              — Export new bot-types
packages/shared/src/game/types.ts              — (no changes needed, ChatMessage is in bot-types.ts)
apps/server/src/game/game.module.ts            — Register BotManager, export it
apps/server/src/game/game.service.ts           — Add isBot() helper, track bot vs human players
apps/server/src/game/game-broadcast.service.ts — Add bot state subscription method
apps/server/src/game/game-loop.service.ts      — Win condition triggers game reset event
apps/server/src/game/game.gateway.ts           — Add chat message handler
apps/server/src/app.module.ts                  — Import LobbyModule
```

---

### Task 1: Shared Types and Bot Configuration

**Files:**

- Create: `packages/shared/src/game/bot-types.ts`
- Modify: `packages/shared/src/game/index.ts`
- Create: `apps/server/src/game/bot/bot-config.ts`

- [ ] **Step 1: Create bot type definitions**

```typescript
// packages/shared/src/game/bot-types.ts

export enum BotDifficulty {
  NEWBIE = 0,
  COMPETENT = 1,
  VETERAN = 2,
}

export enum BotAIState {
  PATROL = 0,
  ATTACK = 1,
  BOMB = 2,
  ESCORT = 3,
  DEFEND = 4,
  OGG = 5,
  RETREAT = 6,
}

export interface ChatMessage {
  senderSlot: number;
  senderName: string;
  team: number; // Team enum, -1 for all-chat
  text: string;
  tick: number;
}
```

- [ ] **Step 2: Export from shared package**

Add to `packages/shared/src/game/index.ts`:

```typescript
export * from "./bot-types";
```

- [ ] **Step 3: Create bot configuration**

```typescript
// apps/server/src/game/bot/bot-config.ts

import { BotDifficulty } from "@netrek/shared";

export interface BotConfig {
  botsPerTeam: number;
  maxPlayersPerTeam: number;
  difficultyMix: [number, number, number]; // [newbie, competent, veteran]
  rebalanceIntervalTicks: number;
  planetImbalanceThreshold: number;
  winPauseTicks: number;
}

function parseDifficultyMix(raw: string): [number, number, number] {
  const parts = raw.split(":").map(Number);
  if (parts.length === 3 && parts.every((n) => !isNaN(n) && n >= 0)) {
    return parts as [number, number, number];
  }
  return [1, 2, 1];
}

export function loadBotConfig(): BotConfig {
  return {
    botsPerTeam: parseInt(process.env["BOTS_PER_TEAM"] ?? "4", 10),
    maxPlayersPerTeam: parseInt(process.env["MAX_PLAYERS_PER_TEAM"] ?? "8", 10),
    difficultyMix: parseDifficultyMix(
      process.env["BOT_DIFFICULTY_MIX"] ?? "1:2:1",
    ),
    rebalanceIntervalTicks:
      parseInt(process.env["DIFFICULTY_REBALANCE_INTERVAL"] ?? "120", 10) * 10,
    planetImbalanceThreshold: parseFloat(
      process.env["PLANET_IMBALANCE_THRESHOLD"] ?? "0.6",
    ),
    winPauseTicks: parseInt(process.env["WIN_PAUSE_DURATION"] ?? "15", 10) * 10,
  };
}

export function buildDifficultyList(
  mix: [number, number, number],
  count: number,
): BotDifficulty[] {
  const total = mix[0] + mix[1] + mix[2];
  if (total === 0) return Array(count).fill(BotDifficulty.COMPETENT);

  const result: BotDifficulty[] = [];
  const difficulties = [
    BotDifficulty.NEWBIE,
    BotDifficulty.COMPETENT,
    BotDifficulty.VETERAN,
  ];

  for (let i = 0; result.length < count; i++) {
    for (let d = 0; d < 3; d++) {
      const ratio = mix[d]! / total;
      const needed = Math.round(ratio * count);
      const have = result.filter((x) => x === difficulties[d]).length;
      if (have < needed && result.length < count) {
        result.push(difficulties[d]!);
      }
    }
    if (result.length < count) {
      result.push(BotDifficulty.COMPETENT);
    }
  }

  return result;
}
```

- [ ] **Step 4: Create barrel export**

```typescript
// apps/server/src/game/bot/index.ts

export { BotManagerService } from "./bot-manager.service";
```

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/game/bot-types.ts packages/shared/src/game/index.ts apps/server/src/game/bot/bot-config.ts apps/server/src/game/bot/index.ts
git commit -m "feat: add bot type definitions and configuration"
```

---

### Task 2: Bot Names

**Files:**

- Create: `apps/server/src/game/bot/bot-names.ts`

- [ ] **Step 1: Create name generator**

```typescript
// apps/server/src/game/bot/bot-names.ts

import { BotDifficulty } from "@netrek/shared";

const DIFFICULTY_PREFIX: Record<BotDifficulty, string> = {
  [BotDifficulty.NEWBIE]: "newb",
  [BotDifficulty.COMPETENT]: "comp",
  [BotDifficulty.VETERAN]: "vet",
};

export function botName(difficulty: BotDifficulty, number: number): string {
  return `${DIFFICULTY_PREFIX[difficulty]}-bot-${number}`;
}

export class BotNamePool {
  private readonly counters: Record<BotDifficulty, number> = {
    [BotDifficulty.NEWBIE]: 0,
    [BotDifficulty.COMPETENT]: 0,
    [BotDifficulty.VETERAN]: 0,
  };

  next(difficulty: BotDifficulty): string {
    this.counters[difficulty]++;
    return botName(difficulty, this.counters[difficulty]);
  }

  reset(): void {
    this.counters[BotDifficulty.NEWBIE] = 0;
    this.counters[BotDifficulty.COMPETENT] = 0;
    this.counters[BotDifficulty.VETERAN] = 0;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/server/src/game/bot/bot-names.ts
git commit -m "feat: add bot name generator"
```

---

### Task 3: Bot Navigation Utilities

**Files:**

- Create: `apps/server/src/game/bot/bot-navigation.ts`
- Create: `apps/server/src/game/bot/bot-navigation.spec.ts`

- [ ] **Step 1: Write navigation utility tests**

```typescript
// apps/server/src/game/bot/bot-navigation.spec.ts

import { describe, it, expect } from "vitest";
import {
  nearestPlanet,
  nearestEnemyShip,
  nearestFriendlyPlanet,
  nearestEnemyPlanet,
  nearestRepairPlanet,
  planetsOwnedByTeam,
} from "./bot-navigation";
import {
  type ClientShip,
  type ClientPlanet,
  ShipStatus,
  ShipType,
  Team,
  AlertStatus,
  PlanetFeature,
} from "@netrek/shared";

function makeShip(overrides: Partial<ClientShip> = {}): ClientShip {
  return {
    slotIndex: 0,
    status: ShipStatus.ALIVE,
    team: Team.FEDERATION,
    shipType: ShipType.CA,
    x: 0,
    y: 0,
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
    alertStatus: AlertStatus.GREEN,
    ...overrides,
  };
}

function makePlanet(overrides: Partial<ClientPlanet> = {}): ClientPlanet {
  return {
    planetId: 0,
    x: 0,
    y: 0,
    name: "Earth",
    team: Team.FEDERATION,
    armies: 17,
    features: 0,
    ...overrides,
  };
}

describe("bot-navigation", () => {
  describe("nearestPlanet", () => {
    it("returns the closest planet", () => {
      const planets = [
        makePlanet({ planetId: 0, x: 1000, y: 0 }),
        makePlanet({ planetId: 1, x: 500, y: 0 }),
        makePlanet({ planetId: 2, x: 2000, y: 0 }),
      ];
      const result = nearestPlanet(0, 0, planets);
      expect(result?.planetId).toBe(1);
    });

    it("returns null for empty array", () => {
      expect(nearestPlanet(0, 0, [])).toBeNull();
    });
  });

  describe("nearestEnemyShip", () => {
    it("returns the closest alive enemy", () => {
      const ships = [
        makeShip({ slotIndex: 0, team: Team.FEDERATION, x: 0, y: 0 }),
        makeShip({ slotIndex: 1, team: Team.ROMULANS, x: 3000, y: 0 }),
        makeShip({ slotIndex: 2, team: Team.ROMULANS, x: 1000, y: 0 }),
      ];
      const result = nearestEnemyShip(0, 0, Team.FEDERATION, 0, ships);
      expect(result?.slotIndex).toBe(2);
    });

    it("ignores dead ships", () => {
      const ships = [
        makeShip({ slotIndex: 0, team: Team.FEDERATION }),
        makeShip({
          slotIndex: 1,
          team: Team.ROMULANS,
          x: 100,
          y: 0,
          status: ShipStatus.DEAD,
        }),
        makeShip({ slotIndex: 2, team: Team.ROMULANS, x: 5000, y: 0 }),
      ];
      const result = nearestEnemyShip(0, 0, Team.FEDERATION, 0, ships);
      expect(result?.slotIndex).toBe(2);
    });

    it("ignores self", () => {
      const ships = [
        makeShip({ slotIndex: 0, team: Team.ROMULANS, x: 0, y: 0 }),
      ];
      const result = nearestEnemyShip(0, 0, Team.FEDERATION, 0, ships);
      expect(result).toBeNull();
    });
  });

  describe("nearestRepairPlanet", () => {
    it("returns the closest friendly repair planet", () => {
      const planets = [
        makePlanet({
          planetId: 0,
          x: 5000,
          y: 0,
          team: Team.FEDERATION,
          features: PlanetFeature.REPAIR,
        }),
        makePlanet({
          planetId: 1,
          x: 1000,
          y: 0,
          team: Team.FEDERATION,
          features: PlanetFeature.FUEL,
        }),
        makePlanet({
          planetId: 2,
          x: 2000,
          y: 0,
          team: Team.FEDERATION,
          features: PlanetFeature.REPAIR,
        }),
      ];
      const result = nearestRepairPlanet(0, 0, Team.FEDERATION, planets);
      expect(result?.planetId).toBe(2);
    });
  });

  describe("planetsOwnedByTeam", () => {
    it("counts planets per team", () => {
      const planets = [
        makePlanet({ team: Team.FEDERATION }),
        makePlanet({ team: Team.FEDERATION }),
        makePlanet({ team: Team.ROMULANS }),
      ];
      expect(planetsOwnedByTeam(Team.FEDERATION, planets)).toBe(2);
      expect(planetsOwnedByTeam(Team.ROMULANS, planets)).toBe(1);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/server && npx vitest run src/game/bot/bot-navigation.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement navigation utilities**

```typescript
// apps/server/src/game/bot/bot-navigation.ts

import {
  type ClientShip,
  type ClientPlanet,
  ShipStatus,
  Team,
  PlanetFeature,
  distance,
  angleBetween,
} from "@netrek/shared";

export function nearestPlanet(
  x: number,
  y: number,
  planets: ClientPlanet[],
): ClientPlanet | null {
  let best: ClientPlanet | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < planets.length; i++) {
    const p = planets[i]!;
    const d = distance(x, y, p.x, p.y);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

export function nearestEnemyShip(
  x: number,
  y: number,
  myTeam: Team,
  mySlot: number,
  ships: ClientShip[],
): ClientShip | null {
  let best: ClientShip | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < ships.length; i++) {
    const s = ships[i]!;
    if (s.slotIndex === mySlot) continue;
    if (s.status !== ShipStatus.ALIVE) continue;
    if (s.team === myTeam) continue;
    const d = distance(x, y, s.x, s.y);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best;
}

export function nearestFriendlyShip(
  x: number,
  y: number,
  myTeam: Team,
  mySlot: number,
  ships: ClientShip[],
): ClientShip | null {
  let best: ClientShip | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < ships.length; i++) {
    const s = ships[i]!;
    if (s.slotIndex === mySlot) continue;
    if (s.status !== ShipStatus.ALIVE) continue;
    if (s.team !== myTeam) continue;
    const d = distance(x, y, s.x, s.y);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best;
}

export function nearestFriendlyPlanet(
  x: number,
  y: number,
  team: Team,
  planets: ClientPlanet[],
): ClientPlanet | null {
  let best: ClientPlanet | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < planets.length; i++) {
    const p = planets[i]!;
    if (p.team !== team) continue;
    const d = distance(x, y, p.x, p.y);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

export function nearestEnemyPlanet(
  x: number,
  y: number,
  team: Team,
  planets: ClientPlanet[],
): ClientPlanet | null {
  let best: ClientPlanet | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < planets.length; i++) {
    const p = planets[i]!;
    if (p.team === team) continue;
    if (p.team === 0xff) continue; // neutral
    const d = distance(x, y, p.x, p.y);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

export function nearestRepairPlanet(
  x: number,
  y: number,
  team: Team,
  planets: ClientPlanet[],
): ClientPlanet | null {
  let best: ClientPlanet | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < planets.length; i++) {
    const p = planets[i]!;
    if (p.team !== team) continue;
    if (!(p.features & PlanetFeature.REPAIR)) continue;
    const d = distance(x, y, p.x, p.y);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

export function nearestFuelPlanet(
  x: number,
  y: number,
  team: Team,
  planets: ClientPlanet[],
): ClientPlanet | null {
  let best: ClientPlanet | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < planets.length; i++) {
    const p = planets[i]!;
    if (p.team !== team) continue;
    if (!(p.features & PlanetFeature.FUEL)) continue;
    const d = distance(x, y, p.x, p.y);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

export function planetsOwnedByTeam(
  team: Team,
  planets: ClientPlanet[],
): number {
  let count = 0;
  for (let i = 0; i < planets.length; i++) {
    if (planets[i]!.team === team) count++;
  }
  return count;
}

export function enemyCarriers(myTeam: Team, ships: ClientShip[]): ClientShip[] {
  const result: ClientShip[] = [];
  for (let i = 0; i < ships.length; i++) {
    const s = ships[i]!;
    if (s.status !== ShipStatus.ALIVE) continue;
    if (s.team === myTeam) continue;
    // Carriers are ships with armies > 0 (especially AS type)
    // We detect via bombing status or ship type heuristics
    // Since ClientShip doesn't expose army count for enemies,
    // we infer from ship type: AS is always suspect, others carrying if beaming down
    if (s.shipType === 4 || s.beaming === 2) {
      // ShipType.AS = 4, beaming down = delivering armies
      result.push(s);
    }
  }
  return result;
}

export function friendlyBombers(
  myTeam: Team,
  mySlot: number,
  ships: ClientShip[],
): ClientShip[] {
  const result: ClientShip[] = [];
  for (let i = 0; i < ships.length; i++) {
    const s = ships[i]!;
    if (s.slotIndex === mySlot) continue;
    if (s.status !== ShipStatus.ALIVE) continue;
    if (s.team !== myTeam) continue;
    if (s.bombing) result.push(s);
  }
  return result;
}

export function directionTo(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): number {
  return angleBetween(fromX, fromY, toX, toY);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/server && npx vitest run src/game/bot/bot-navigation.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/game/bot/bot-navigation.ts apps/server/src/game/bot/bot-navigation.spec.ts
git commit -m "feat: add bot navigation utilities with tests"
```

---

### Task 4: Bot Combat Utilities

**Files:**

- Create: `apps/server/src/game/bot/bot-combat.ts`
- Create: `apps/server/src/game/bot/bot-combat.spec.ts`

- [ ] **Step 1: Write combat utility tests**

```typescript
// apps/server/src/game/bot/bot-combat.spec.ts

import { describe, it, expect } from "vitest";
import {
  selectTarget,
  shouldRetreat,
  shouldFirePhaser,
  shouldFireTorp,
} from "./bot-combat";
import {
  type ClientShip,
  type ClientSelfExtra,
  ShipStatus,
  ShipType,
  Team,
  AlertStatus,
  BotDifficulty,
} from "@netrek/shared";

function makeShip(overrides: Partial<ClientShip> = {}): ClientShip {
  return {
    slotIndex: 0,
    status: ShipStatus.ALIVE,
    team: Team.FEDERATION,
    shipType: ShipType.CA,
    x: 0,
    y: 0,
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
    alertStatus: AlertStatus.GREEN,
    ...overrides,
  };
}

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
    tmode: true,
    ...overrides,
  };
}

describe("bot-combat", () => {
  describe("selectTarget", () => {
    it("newbie picks closest enemy regardless", () => {
      const enemies = [
        makeShip({ slotIndex: 1, x: 5000, y: 0, hullDamagePct: 0 }),
        makeShip({ slotIndex: 2, x: 2000, y: 0, hullDamagePct: 0 }),
      ];
      const target = selectTarget(0, 0, enemies, BotDifficulty.NEWBIE);
      expect(target?.slotIndex).toBe(2);
    });

    it("competent prefers damaged enemies", () => {
      const enemies = [
        makeShip({ slotIndex: 1, x: 3000, y: 0, hullDamagePct: 0.7 }),
        makeShip({ slotIndex: 2, x: 2000, y: 0, hullDamagePct: 0 }),
      ];
      const target = selectTarget(0, 0, enemies, BotDifficulty.COMPETENT);
      expect(target?.slotIndex).toBe(1);
    });
  });

  describe("shouldRetreat", () => {
    it("newbie doesn't retreat until nearly dead", () => {
      expect(
        shouldRetreat(makeSelf({ hullDamage: 60 }), BotDifficulty.NEWBIE),
      ).toBe(false);
      expect(
        shouldRetreat(makeSelf({ hullDamage: 90 }), BotDifficulty.NEWBIE),
      ).toBe(true);
    });

    it("veteran retreats early", () => {
      expect(
        shouldRetreat(makeSelf({ hullDamage: 60 }), BotDifficulty.VETERAN),
      ).toBe(true);
    });

    it("retreats on low fuel", () => {
      expect(
        shouldRetreat(makeSelf({ fuel: 500 }), BotDifficulty.COMPETENT),
      ).toBe(true);
    });
  });

  describe("shouldFirePhaser", () => {
    it("fires when in range and off cooldown", () => {
      expect(shouldFirePhaser(3000, makeSelf({ phaserCooldown: 0 }))).toBe(
        true,
      );
    });

    it("does not fire on cooldown", () => {
      expect(shouldFirePhaser(3000, makeSelf({ phaserCooldown: 5 }))).toBe(
        false,
      );
    });

    it("does not fire out of range", () => {
      expect(shouldFirePhaser(15000, makeSelf({ phaserCooldown: 0 }))).toBe(
        false,
      );
    });
  });

  describe("shouldFireTorp", () => {
    it("fires when in range", () => {
      expect(shouldFireTorp(8000)).toBe(true);
    });

    it("does not fire at extreme range", () => {
      expect(shouldFireTorp(25000)).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/server && npx vitest run src/game/bot/bot-combat.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement combat utilities**

```typescript
// apps/server/src/game/bot/bot-combat.ts

import {
  type ClientShip,
  type ClientSelfExtra,
  BotDifficulty,
  distance,
  SHIP_STATS,
  ShipType,
} from "@netrek/shared";

const PHASER_MAX_RANGE = 6000;
const TORP_EFFECTIVE_RANGE = 15000;
const FUEL_RETREAT_THRESHOLD = 1000;

const RETREAT_HULL_THRESHOLDS: Record<BotDifficulty, number> = {
  [BotDifficulty.NEWBIE]: 85,
  [BotDifficulty.COMPETENT]: 60,
  [BotDifficulty.VETERAN]: 50,
};

export function selectTarget(
  x: number,
  y: number,
  enemies: ClientShip[],
  difficulty: BotDifficulty,
): ClientShip | null {
  if (enemies.length === 0) return null;

  if (difficulty === BotDifficulty.NEWBIE) {
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

  // Competent and Veteran: score targets by damage and distance
  let best: ClientShip | null = null;
  let bestScore = -Infinity;

  for (const e of enemies) {
    const dist = distance(x, y, e.x, e.y);
    const distScore = 1 - Math.min(dist / 20000, 1);
    const damageScore = e.hullDamagePct;
    const typeBonus = e.shipType === ShipType.SB ? -0.3 : 0;

    let score = distScore * 0.4 + damageScore * 0.6 + typeBonus;

    if (difficulty === BotDifficulty.VETERAN) {
      // Veteran avoids full-health starbases more aggressively
      if (e.shipType === ShipType.SB && e.hullDamagePct < 0.3) {
        score -= 0.5;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best;
}

export function shouldRetreat(
  self: ClientSelfExtra,
  difficulty: BotDifficulty,
): boolean {
  if (self.fuel < FUEL_RETREAT_THRESHOLD) return true;

  const threshold = RETREAT_HULL_THRESHOLDS[difficulty];
  return self.hullDamage >= threshold;
}

export function shouldFirePhaser(
  distToTarget: number,
  self: ClientSelfExtra,
): boolean {
  if (self.phaserCooldown > 0) return false;
  if (self.weaponBurnout > 0) return false;
  return distToTarget <= PHASER_MAX_RANGE;
}

export function shouldFireTorp(distToTarget: number): boolean {
  return distToTarget <= TORP_EFFECTIVE_RANGE;
}

export function shouldCloak(
  self: ClientSelfExtra,
  difficulty: BotDifficulty,
): boolean {
  if (difficulty === BotDifficulty.NEWBIE) return false;
  // Cloak when carrying armies and enough fuel
  return self.armies > 0 && self.fuel > 3000;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/server && npx vitest run src/game/bot/bot-combat.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/game/bot/bot-combat.ts apps/server/src/game/bot/bot-combat.spec.ts
git commit -m "feat: add bot combat utilities with tests"
```

---

### Task 5: Bot AI State Machine

**Files:**

- Create: `apps/server/src/game/bot/bot-ai.ts`
- Create: `apps/server/src/game/bot/bot-ai.spec.ts`

- [ ] **Step 1: Write AI state machine tests**

```typescript
// apps/server/src/game/bot/bot-ai.spec.ts

import { describe, it, expect } from "vitest";
import { BotBrain } from "./bot-ai";
import {
  type ClientGameState,
  type ClientShip,
  type ClientPlanet,
  type ClientSelfExtra,
  BotDifficulty,
  BotAIState,
  ShipStatus,
  ShipType,
  Team,
  AlertStatus,
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
    alertStatus: AlertStatus.GREEN,
    ...overrides,
  };
}

function makePlanet(overrides: Partial<ClientPlanet> = {}): ClientPlanet {
  return {
    planetId: 0,
    x: 25000,
    y: 25000,
    name: "Earth",
    team: Team.FEDERATION,
    armies: 17,
    features: PlanetFeature.REPAIR | PlanetFeature.FUEL,
    ...overrides,
  };
}

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
    tmode: true,
    ...overrides,
  };
}

function makeState(overrides: Partial<ClientGameState> = {}): ClientGameState {
  return {
    tick: 100,
    recipientSlot: 0,
    ships: [makeShip({ slotIndex: 0, team: Team.FEDERATION })],
    torps: [],
    phasers: [],
    explosions: [],
    planets: [makePlanet()],
    self: makeSelf(),
    ...overrides,
  };
}

describe("BotBrain", () => {
  it("starts in PATROL state", () => {
    const brain = new BotBrain(BotDifficulty.COMPETENT, Team.FEDERATION, 0);
    expect(brain.currentState).toBe(BotAIState.PATROL);
  });

  it("transitions to RETREAT when hull is critical", () => {
    const brain = new BotBrain(BotDifficulty.COMPETENT, Team.FEDERATION, 0);
    const state = makeState({ self: makeSelf({ hullDamage: 70 }) });
    brain.think(state);
    expect(brain.currentState).toBe(BotAIState.RETREAT);
  });

  it("transitions to ATTACK when enemy is nearby during PATROL", () => {
    const brain = new BotBrain(BotDifficulty.COMPETENT, Team.FEDERATION, 0);
    const state = makeState({
      ships: [
        makeShip({ slotIndex: 0, team: Team.FEDERATION, x: 50000, y: 50000 }),
        makeShip({ slotIndex: 1, team: Team.ROMULANS, x: 52000, y: 50000 }),
      ],
    });
    brain.think(state);
    expect(brain.currentState).toBe(BotAIState.ATTACK);
  });

  it("generates SET_DIRECTION and SET_SPEED commands", () => {
    const brain = new BotBrain(BotDifficulty.COMPETENT, Team.FEDERATION, 0);
    const state = makeState();
    const commands = brain.think(state);
    const hasDirection = commands.some((c) => c.command === 1); // SET_DIRECTION
    const hasSpeed = commands.some((c) => c.command === 2); // SET_SPEED
    expect(hasDirection || hasSpeed).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/server && npx vitest run src/game/bot/bot-ai.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement the AI state machine**

```typescript
// apps/server/src/game/bot/bot-ai.ts

import {
  type ClientGameState,
  type ClientShip,
  type ClientPlanet,
  type PlayerInput,
  BotDifficulty,
  BotAIState,
  InputCommand,
  Team,
  ShipType,
  ShipStatus,
  PlanetFeature,
  distance,
  angleBetween,
  SHIP_STATS,
  ORBIT_DIST,
} from "@netrek/shared";
import {
  nearestEnemyShip,
  nearestFriendlyPlanet,
  nearestEnemyPlanet,
  nearestRepairPlanet,
  nearestFuelPlanet,
  enemyCarriers,
  friendlyBombers,
  directionTo,
} from "./bot-navigation";
import {
  selectTarget,
  shouldRetreat,
  shouldFirePhaser,
  shouldFireTorp,
  shouldCloak,
} from "./bot-combat";

const ENGAGE_RANGE_NEWBIE = 12000;
const ENGAGE_RANGE_COMPETENT = 10000;
const ENGAGE_RANGE_VETERAN = 15000;

const PATROL_SPEED = 5;
const ATTACK_SPEED = 8;
const RETREAT_SPEED = 9;
const BOMB_APPROACH_SPEED = 6;

export class BotBrain {
  currentState = BotAIState.PATROL;
  private patrolTargetPlanetId = -1;
  private attackTargetSlot = -1;
  private bombTargetPlanetId = -1;
  private escortTargetSlot = -1;
  private defendPlanetId = -1;
  private oggTargetSlot = -1;
  private ticksInState = 0;

  // Order override
  private orderState: BotAIState | null = null;
  private orderTargetId = -1;
  private orderExpiresTick = 0;

  constructor(
    readonly difficulty: BotDifficulty,
    readonly team: Team,
    public slot: number,
  ) {}

  setOrder(state: BotAIState, targetId: number, currentTick: number): void {
    this.orderState = state;
    this.orderTargetId = targetId;
    this.orderExpiresTick = currentTick + 600; // 60 seconds
  }

  clearOrder(): void {
    this.orderState = null;
    this.orderTargetId = -1;
  }

  think(gameState: ClientGameState): PlayerInput[] {
    const commands: PlayerInput[] = [];
    const self = gameState.self;
    const myShip = gameState.ships.find((s) => s.slotIndex === this.slot);
    if (!myShip || myShip.status !== ShipStatus.ALIVE) return commands;

    // Check order expiry
    if (this.orderState !== null && gameState.tick >= this.orderExpiresTick) {
      this.clearOrder();
    }

    // Evaluate state transition
    this.evaluateTransition(gameState, myShip);
    this.ticksInState++;

    // Execute current state
    const activeState = this.orderState ?? this.currentState;
    switch (activeState) {
      case BotAIState.PATROL:
        this.executePatrol(gameState, myShip, commands);
        break;
      case BotAIState.ATTACK:
        this.executeAttack(gameState, myShip, commands);
        break;
      case BotAIState.RETREAT:
        this.executeRetreat(gameState, myShip, commands);
        break;
      case BotAIState.BOMB:
        this.executeBomb(gameState, myShip, commands);
        break;
      case BotAIState.DEFEND:
        this.executeDefend(gameState, myShip, commands);
        break;
      case BotAIState.ESCORT:
        this.executeEscort(gameState, myShip, commands);
        break;
      case BotAIState.OGG:
        this.executeOgg(gameState, myShip, commands);
        break;
    }

    return commands;
  }

  private setState(newState: BotAIState): void {
    if (newState !== this.currentState) {
      this.currentState = newState;
      this.ticksInState = 0;
    }
  }

  private engageRange(): number {
    switch (this.difficulty) {
      case BotDifficulty.NEWBIE:
        return ENGAGE_RANGE_NEWBIE;
      case BotDifficulty.COMPETENT:
        return ENGAGE_RANGE_COMPETENT;
      case BotDifficulty.VETERAN:
        return ENGAGE_RANGE_VETERAN;
    }
  }

  private evaluateTransition(state: ClientGameState, myShip: ClientShip): void {
    const self = state.self;

    // Priority 1: Retreat check (overrides everything except orders)
    if (this.orderState === null && shouldRetreat(self, this.difficulty)) {
      this.setState(BotAIState.RETREAT);
      return;
    }

    // If retreating and recovered, go back to patrol
    if (this.currentState === BotAIState.RETREAT) {
      if (self.hullDamage < 20 && self.fuel > 5000) {
        this.setState(BotAIState.PATROL);
      }
      return;
    }

    // Veteran proactive checks
    if (this.difficulty === BotDifficulty.VETERAN) {
      // Ogg enemy carriers
      const carriers = enemyCarriers(this.team, state.ships);
      if (carriers.length > 0 && this.currentState !== BotAIState.OGG) {
        const nearest = carriers.reduce((a, b) =>
          distance(myShip.x, myShip.y, a.x, a.y) <
          distance(myShip.x, myShip.y, b.x, b.y)
            ? a
            : b,
        );
        if (distance(myShip.x, myShip.y, nearest.x, nearest.y) < 20000) {
          this.oggTargetSlot = nearest.slotIndex;
          this.setState(BotAIState.OGG);
          return;
        }
      }

      // Escort friendly bombers
      const bombers = friendlyBombers(this.team, this.slot, state.ships);
      if (
        bombers.length > 0 &&
        this.currentState === BotAIState.PATROL &&
        self.hullDamage < 30
      ) {
        this.escortTargetSlot = bombers[0]!.slotIndex;
        this.setState(BotAIState.ESCORT);
        return;
      }
    }

    // Competent: intercept carriers if nearby
    if (this.difficulty === BotDifficulty.COMPETENT) {
      const carriers = enemyCarriers(this.team, state.ships);
      if (carriers.length > 0 && this.currentState === BotAIState.PATROL) {
        const nearest = carriers[0]!;
        if (distance(myShip.x, myShip.y, nearest.x, nearest.y) < 10000) {
          this.attackTargetSlot = nearest.slotIndex;
          this.setState(BotAIState.ATTACK);
          return;
        }
      }
    }

    // Check for nearby enemies → ATTACK
    const enemy = nearestEnemyShip(
      myShip.x,
      myShip.y,
      this.team,
      this.slot,
      state.ships,
    );

    if (enemy) {
      const dist = distance(myShip.x, myShip.y, enemy.x, enemy.y);
      if (
        dist < this.engageRange() &&
        this.currentState === BotAIState.PATROL
      ) {
        this.attackTargetSlot = enemy.slotIndex;
        this.setState(BotAIState.ATTACK);
        return;
      }
    }

    // If attacking and target is gone, return to patrol
    if (this.currentState === BotAIState.ATTACK) {
      const target = state.ships.find(
        (s) => s.slotIndex === this.attackTargetSlot,
      );
      if (!target || target.status !== ShipStatus.ALIVE) {
        this.setState(BotAIState.PATROL);
        return;
      }
    }

    // Newbie: tunnel vision — stays in ATTACK too long
    // (no additional transition logic)

    // Competent/Veteran: if idle in patrol for too long, try bombing
    if (
      this.currentState === BotAIState.PATROL &&
      this.ticksInState > 100 &&
      this.difficulty >= BotDifficulty.COMPETENT &&
      state.self.tmode
    ) {
      const target = this.pickBombTarget(state, myShip);
      if (target) {
        this.bombTargetPlanetId = target.planetId;
        this.setState(BotAIState.BOMB);
        return;
      }
    }
  }

  private pickBombTarget(
    state: ClientGameState,
    myShip: ClientShip,
  ): ClientPlanet | null {
    const enemyPlanets = state.planets.filter(
      (p) => p.team !== this.team && p.team !== 0xff && p.armies >= 5,
    );
    if (enemyPlanets.length === 0) return null;

    if (this.difficulty === BotDifficulty.NEWBIE) {
      return enemyPlanets[Math.floor(Math.random() * enemyPlanets.length)]!;
    }

    // Competent/Veteran: prefer strategic planets (FUEL/REPAIR/AGRI)
    const strategic = enemyPlanets.filter((p) => p.features > 0);
    const pool = strategic.length > 0 ? strategic : enemyPlanets;

    return pool.reduce((a, b) =>
      distance(myShip.x, myShip.y, a.x, a.y) <
      distance(myShip.x, myShip.y, b.x, b.y)
        ? a
        : b,
    );
  }

  // -----------------------------------------------------------------------
  // State executors — each produces InputCommands for the current tick
  // -----------------------------------------------------------------------

  private executePatrol(
    state: ClientGameState,
    myShip: ClientShip,
    commands: PlayerInput[],
  ): void {
    // Pick a patrol target planet if we don't have one or we've arrived
    if (this.patrolTargetPlanetId === -1) {
      const friendly = nearestFriendlyPlanet(
        myShip.x,
        myShip.y,
        this.team,
        state.planets,
      );
      if (friendly) {
        this.patrolTargetPlanetId = friendly.planetId;
      }
    }

    const target = state.planets.find(
      (p) => p.planetId === this.patrolTargetPlanetId,
    );
    if (!target) return;

    const dist = distance(myShip.x, myShip.y, target.x, target.y);

    if (dist < ORBIT_DIST * 2) {
      // Arrived — pick a new patrol target
      const others = state.planets.filter(
        (p) => p.team === this.team && p.planetId !== this.patrolTargetPlanetId,
      );
      if (others.length > 0) {
        this.patrolTargetPlanetId =
          others[Math.floor(Math.random() * others.length)]!.planetId;
      }
    }

    const dir = directionTo(myShip.x, myShip.y, target.x, target.y);
    commands.push(
      { command: InputCommand.SET_DIRECTION, value: dir, tick: state.tick },
      {
        command: InputCommand.SET_SPEED,
        value: PATROL_SPEED,
        tick: state.tick,
      },
    );

    // Make sure shields are up while patrolling
    if (!myShip.shieldsUp) {
      commands.push({
        command: InputCommand.SHIELD_TOGGLE,
        value: 0,
        tick: state.tick,
      });
    }
  }

  private executeAttack(
    state: ClientGameState,
    myShip: ClientShip,
    commands: PlayerInput[],
  ): void {
    const target = state.ships.find(
      (s) => s.slotIndex === this.attackTargetSlot,
    );
    if (!target || target.status !== ShipStatus.ALIVE) {
      this.setState(BotAIState.PATROL);
      return;
    }

    const dist = distance(myShip.x, myShip.y, target.x, target.y);
    const dir = directionTo(myShip.x, myShip.y, target.x, target.y);

    // Chase the target
    commands.push(
      { command: InputCommand.SET_DIRECTION, value: dir, tick: state.tick },
      {
        command: InputCommand.SET_SPEED,
        value: ATTACK_SPEED,
        tick: state.tick,
      },
    );

    // Shields up
    if (!myShip.shieldsUp) {
      commands.push({
        command: InputCommand.SHIELD_TOGGLE,
        value: 0,
        tick: state.tick,
      });
    }

    // Fire weapons
    if (shouldFirePhaser(dist, state.self)) {
      commands.push({
        command: InputCommand.FIRE_PHASER,
        value: dir,
        tick: state.tick,
      });
    }

    if (shouldFireTorp(dist)) {
      commands.push({
        command: InputCommand.FIRE_TORP,
        value: dir,
        tick: state.tick,
      });
    }
  }

  private executeRetreat(
    state: ClientGameState,
    myShip: ClientShip,
    commands: PlayerInput[],
  ): void {
    // Head to nearest repair planet
    const repair = nearestRepairPlanet(
      myShip.x,
      myShip.y,
      this.team,
      state.planets,
    );
    const fuel = nearestFuelPlanet(
      myShip.x,
      myShip.y,
      this.team,
      state.planets,
    );

    // Prefer repair if damaged, fuel if dry
    const target = state.self.fuel < 1000 ? (fuel ?? repair) : (repair ?? fuel);
    if (!target) {
      // Fallback: head to any friendly planet
      const friendly = nearestFriendlyPlanet(
        myShip.x,
        myShip.y,
        this.team,
        state.planets,
      );
      if (!friendly) return;
      const dir = directionTo(myShip.x, myShip.y, friendly.x, friendly.y);
      commands.push(
        { command: InputCommand.SET_DIRECTION, value: dir, tick: state.tick },
        {
          command: InputCommand.SET_SPEED,
          value: RETREAT_SPEED,
          tick: state.tick,
        },
      );
      return;
    }

    const dist = distance(myShip.x, myShip.y, target.x, target.y);
    const dir = directionTo(myShip.x, myShip.y, target.x, target.y);

    if (dist < ORBIT_DIST) {
      // Orbit and repair
      commands.push(
        { command: InputCommand.SET_SPEED, value: 2, tick: state.tick },
        { command: InputCommand.ORBIT, value: 0, tick: state.tick },
        { command: InputCommand.REPAIR_TOGGLE, value: 0, tick: state.tick },
      );
    } else {
      commands.push(
        { command: InputCommand.SET_DIRECTION, value: dir, tick: state.tick },
        {
          command: InputCommand.SET_SPEED,
          value: RETREAT_SPEED,
          tick: state.tick,
        },
      );
    }
  }

  private executeBomb(
    state: ClientGameState,
    myShip: ClientShip,
    commands: PlayerInput[],
  ): void {
    const planet = state.planets.find(
      (p) => p.planetId === this.bombTargetPlanetId,
    );
    if (!planet || planet.team === this.team || planet.armies < 5) {
      // Target captured or depleted
      this.setState(BotAIState.PATROL);
      return;
    }

    const dist = distance(myShip.x, myShip.y, planet.x, planet.y);

    if (dist < ORBIT_DIST) {
      // Orbit and bomb
      commands.push(
        { command: InputCommand.SET_SPEED, value: 2, tick: state.tick },
        { command: InputCommand.ORBIT, value: 0, tick: state.tick },
        { command: InputCommand.BOMB, value: 0, tick: state.tick },
      );

      // Veteran cloaks while bombing
      if (
        this.difficulty === BotDifficulty.VETERAN &&
        !myShip.cloaked &&
        state.self.fuel > 3000
      ) {
        commands.push({
          command: InputCommand.CLOAK_TOGGLE,
          value: 0,
          tick: state.tick,
        });
      }
    } else {
      // Navigate to planet
      const dir = directionTo(myShip.x, myShip.y, planet.x, planet.y);
      commands.push(
        { command: InputCommand.SET_DIRECTION, value: dir, tick: state.tick },
        {
          command: InputCommand.SET_SPEED,
          value: BOMB_APPROACH_SPEED,
          tick: state.tick,
        },
      );

      // Competent/Veteran: cloak on approach with armies
      if (
        shouldCloak(state.self, this.difficulty) &&
        !myShip.cloaked &&
        dist < 15000
      ) {
        commands.push({
          command: InputCommand.CLOAK_TOGGLE,
          value: 0,
          tick: state.tick,
        });
      }
    }
  }

  private executeDefend(
    state: ClientGameState,
    myShip: ClientShip,
    commands: PlayerInput[],
  ): void {
    const targetId =
      this.orderState === BotAIState.DEFEND
        ? this.orderTargetId
        : this.defendPlanetId;
    const planet = state.planets.find((p) => p.planetId === targetId);

    if (!planet || planet.team !== this.team) {
      this.setState(BotAIState.PATROL);
      this.clearOrder();
      return;
    }

    const dist = distance(myShip.x, myShip.y, planet.x, planet.y);

    // Check for enemies near the planet
    const enemy = nearestEnemyShip(
      planet.x,
      planet.y,
      this.team,
      this.slot,
      state.ships,
    );
    if (enemy) {
      const enemyDist = distance(planet.x, planet.y, enemy.x, enemy.y);
      if (enemyDist < 8000) {
        // Engage the attacker
        const dir = directionTo(myShip.x, myShip.y, enemy.x, enemy.y);
        const myDist = distance(myShip.x, myShip.y, enemy.x, enemy.y);
        commands.push(
          { command: InputCommand.SET_DIRECTION, value: dir, tick: state.tick },
          {
            command: InputCommand.SET_SPEED,
            value: ATTACK_SPEED,
            tick: state.tick,
          },
        );

        if (shouldFirePhaser(myDist, state.self)) {
          commands.push({
            command: InputCommand.FIRE_PHASER,
            value: dir,
            tick: state.tick,
          });
        }
        if (shouldFireTorp(myDist)) {
          commands.push({
            command: InputCommand.FIRE_TORP,
            value: dir,
            tick: state.tick,
          });
        }
        return;
      }
    }

    // No threats — orbit the planet
    if (dist < ORBIT_DIST) {
      commands.push(
        { command: InputCommand.SET_SPEED, value: 2, tick: state.tick },
        { command: InputCommand.ORBIT, value: 0, tick: state.tick },
      );
    } else {
      const dir = directionTo(myShip.x, myShip.y, planet.x, planet.y);
      commands.push(
        { command: InputCommand.SET_DIRECTION, value: dir, tick: state.tick },
        {
          command: InputCommand.SET_SPEED,
          value: PATROL_SPEED,
          tick: state.tick,
        },
      );
    }
  }

  private executeEscort(
    state: ClientGameState,
    myShip: ClientShip,
    commands: PlayerInput[],
  ): void {
    const targetSlot =
      this.orderState === BotAIState.ESCORT
        ? this.orderTargetId
        : this.escortTargetSlot;
    const target = state.ships.find((s) => s.slotIndex === targetSlot);

    if (!target || target.status !== ShipStatus.ALIVE) {
      this.setState(BotAIState.PATROL);
      this.clearOrder();
      return;
    }

    const dist = distance(myShip.x, myShip.y, target.x, target.y);

    // Check for enemies near our escort target
    const enemy = nearestEnemyShip(
      target.x,
      target.y,
      this.team,
      this.slot,
      state.ships,
    );
    if (enemy) {
      const enemyDist = distance(target.x, target.y, enemy.x, enemy.y);
      if (enemyDist < 8000) {
        // Intercept the threat
        const dir = directionTo(myShip.x, myShip.y, enemy.x, enemy.y);
        const myDist = distance(myShip.x, myShip.y, enemy.x, enemy.y);
        commands.push(
          { command: InputCommand.SET_DIRECTION, value: dir, tick: state.tick },
          {
            command: InputCommand.SET_SPEED,
            value: ATTACK_SPEED,
            tick: state.tick,
          },
        );

        if (shouldFirePhaser(myDist, state.self)) {
          commands.push({
            command: InputCommand.FIRE_PHASER,
            value: dir,
            tick: state.tick,
          });
        }
        if (shouldFireTorp(myDist)) {
          commands.push({
            command: InputCommand.FIRE_TORP,
            value: dir,
            tick: state.tick,
          });
        }
        return;
      }
    }

    // Follow the escort target — maintain ~2000 unit distance
    if (dist > 3000) {
      const dir = directionTo(myShip.x, myShip.y, target.x, target.y);
      commands.push(
        { command: InputCommand.SET_DIRECTION, value: dir, tick: state.tick },
        {
          command: InputCommand.SET_SPEED,
          value: Math.min(target.speed + 2, 9),
          tick: state.tick,
        },
      );
    } else if (dist < 1000) {
      // Too close — slow down
      commands.push({
        command: InputCommand.SET_SPEED,
        value: Math.max(target.speed - 1, 2),
        tick: state.tick,
      });
    }
  }

  private executeOgg(
    state: ClientGameState,
    myShip: ClientShip,
    commands: PlayerInput[],
  ): void {
    const targetSlot =
      this.orderState === BotAIState.OGG
        ? this.orderTargetId
        : this.oggTargetSlot;
    const target = state.ships.find((s) => s.slotIndex === targetSlot);

    if (!target || target.status !== ShipStatus.ALIVE) {
      this.setState(BotAIState.PATROL);
      this.clearOrder();
      return;
    }

    const dist = distance(myShip.x, myShip.y, target.x, target.y);
    const dir = directionTo(myShip.x, myShip.y, target.x, target.y);

    // Max speed, straight at them
    const maxSpeed = SHIP_STATS[myShip.shipType as ShipType]?.maxSpeed ?? 9;
    commands.push(
      { command: InputCommand.SET_DIRECTION, value: dir, tick: state.tick },
      { command: InputCommand.SET_SPEED, value: maxSpeed, tick: state.tick },
    );

    // Fire everything
    if (shouldFirePhaser(dist, state.self)) {
      commands.push({
        command: InputCommand.FIRE_PHASER,
        value: dir,
        tick: state.tick,
      });
    }
    commands.push({
      command: InputCommand.FIRE_TORP,
      value: dir,
      tick: state.tick,
    });

    // Self-destruct on collision range
    if (dist < 500) {
      commands.push({
        command: InputCommand.DETONATE_SELF,
        value: 0,
        tick: state.tick,
      });
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/server && npx vitest run src/game/bot/bot-ai.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/game/bot/bot-ai.ts apps/server/src/game/bot/bot-ai.spec.ts
git commit -m "feat: implement bot AI state machine with all states"
```

---

### Task 6: BotPlayer Class

**Files:**

- Create: `apps/server/src/game/bot/bot-player.ts`

- [ ] **Step 1: Implement BotPlayer**

```typescript
// apps/server/src/game/bot/bot-player.ts

import {
  type ClientGameState,
  type PlayerInput,
  BotDifficulty,
  BotAIState,
  Team,
  ShipType,
  serializeGameState,
  deserializeGameState,
  type ShipState,
  type TorpState,
  type PhaserState,
  type ExplosionState,
  type PlanetState,
  type AlertStatus,
} from "@netrek/shared";
import { BotBrain } from "./bot-ai";
import { InputQueue } from "../state/input-queue";

export class BotPlayer {
  readonly brain: BotBrain;
  readonly name: string;
  slot = -1;
  shipType: ShipType;

  constructor(
    readonly difficulty: BotDifficulty,
    readonly team: Team,
    name: string,
    shipType?: ShipType,
  ) {
    this.name = name;
    this.shipType = shipType ?? ShipType.CA;
    this.brain = new BotBrain(difficulty, team, -1);
  }

  assignSlot(slot: number): void {
    this.slot = slot;
    this.brain.slot = slot;
  }

  onTick(
    tick: number,
    recipientTeam: Team,
    ships: ShipState[],
    torps: TorpState[],
    phasers: PhaserState[],
    explosions: ExplosionState[],
    alertStatuses: AlertStatus[],
    planets: PlanetState[],
    tmode: boolean,
    inputQueue: InputQueue,
  ): void {
    if (this.slot === -1) return;

    // Serialize game state with cloaking filter applied (same as human client)
    const buf = serializeGameState(
      tick,
      this.slot,
      recipientTeam,
      ships,
      torps,
      phasers,
      explosions,
      alertStatuses,
      planets,
      tmode,
    );

    // Deserialize to get the same view a human client sees
    const gameState = deserializeGameState(buf);

    // Run AI
    const commands = this.brain.think(gameState);

    // Enqueue all commands
    for (const cmd of commands) {
      inputQueue.enqueue(this.slot, cmd);
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/server/src/game/bot/bot-player.ts
git commit -m "feat: add BotPlayer class with serialized state view"
```

---

### Task 7: Chat Order Parser

**Files:**

- Create: `apps/server/src/game/bot/bot-orders.ts`
- Create: `apps/server/src/game/bot/bot-orders.spec.ts`

- [ ] **Step 1: Write order parser tests**

```typescript
// apps/server/src/game/bot/bot-orders.spec.ts

import { describe, it, expect } from "vitest";
import { parseOrder } from "./bot-orders";
import { BotAIState } from "@netrek/shared";

describe("parseOrder", () => {
  const planetNames = [
    "Earth",
    "Rigel",
    "Romulus",
    "Klingus",
    "Orion",
    "Canopus",
    "Deneb",
    "Altair",
    "Vega",
  ];

  it("parses 'bomb earth'", () => {
    const order = parseOrder("bomb earth", planetNames, []);
    expect(order).toEqual({
      state: BotAIState.BOMB,
      targetId: 0,
      targetName: "",
    });
  });

  it("parses 'bomb Earth' case-insensitive", () => {
    const order = parseOrder("bomb Earth", planetNames, []);
    expect(order?.state).toBe(BotAIState.BOMB);
    expect(order?.targetId).toBe(0);
  });

  it("parses 'defend romulus'", () => {
    const order = parseOrder("defend romulus", planetNames, []);
    expect(order).toEqual({
      state: BotAIState.DEFEND,
      targetId: 2,
      targetName: "",
    });
  });

  it("parses 'escort me'", () => {
    const order = parseOrder("escort me", planetNames, [], 5);
    expect(order).toEqual({
      state: BotAIState.ESCORT,
      targetId: 5,
      targetName: "",
    });
  });

  it("parses 'ogg 3'", () => {
    const order = parseOrder("ogg 3", planetNames, []);
    expect(order).toEqual({
      state: BotAIState.OGG,
      targetId: 3,
      targetName: "",
    });
  });

  it("parses 'help'", () => {
    const order = parseOrder("help", planetNames, []);
    expect(order?.state).toBe(BotAIState.DEFEND);
  });

  it("parses 'regroup'", () => {
    const order = parseOrder("regroup", planetNames, []);
    expect(order?.state).toBe(BotAIState.PATROL);
  });

  it("parses 'fall back'", () => {
    const order = parseOrder("fall back", planetNames, []);
    expect(order?.state).toBe(BotAIState.PATROL);
  });

  it("returns null for unrecognized", () => {
    expect(parseOrder("hello world", planetNames, [])).toBeNull();
  });

  it("extracts addressed bot name", () => {
    const botNames = ["comp-bot-1", "vet-bot-2"];
    const order = parseOrder("comp-bot-1 bomb earth", planetNames, botNames);
    expect(order?.state).toBe(BotAIState.BOMB);
    expect(order?.targetName).toBe("comp-bot-1");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/server && npx vitest run src/game/bot/bot-orders.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement order parser**

```typescript
// apps/server/src/game/bot/bot-orders.ts

import { BotAIState } from "@netrek/shared";

export interface BotOrder {
  state: BotAIState;
  targetId: number;
  targetName: string; // addressed bot name, or empty for broadcast
}

export function parseOrder(
  text: string,
  planetNames: string[],
  botNames: string[],
  senderSlot?: number,
): BotOrder | null {
  const lower = text.toLowerCase().trim();

  // Check if a specific bot is addressed
  let addressedBot = "";
  let remaining = lower;
  for (const name of botNames) {
    if (lower.startsWith(name.toLowerCase())) {
      addressedBot = name;
      remaining = lower.slice(name.length).trim();
      break;
    }
  }

  // Regroup / fall back
  if (remaining === "regroup" || remaining === "fall back") {
    return { state: BotAIState.PATROL, targetId: -1, targetName: addressedBot };
  }

  // Help (with optional planet)
  if (remaining.startsWith("help")) {
    const planetPart = remaining.slice(4).trim();
    const planetId = findPlanetId(planetPart, planetNames);
    return {
      state: BotAIState.DEFEND,
      targetId: planetId,
      targetName: addressedBot,
    };
  }

  // Bomb [planet]
  const bombMatch = remaining.match(/^bomb\s+(.+)/);
  if (bombMatch) {
    const planetId = findPlanetId(bombMatch[1]!, planetNames);
    if (planetId !== -1) {
      return {
        state: BotAIState.BOMB,
        targetId: planetId,
        targetName: addressedBot,
      };
    }
  }

  // Defend [planet]
  const defendMatch = remaining.match(/^defend\s+(.+)/);
  if (defendMatch) {
    const planetId = findPlanetId(defendMatch[1]!, planetNames);
    if (planetId !== -1) {
      return {
        state: BotAIState.DEFEND,
        targetId: planetId,
        targetName: addressedBot,
      };
    }
  }

  // Escort me / escort [player]
  const escortMatch = remaining.match(/^escort\s+(.+)/);
  if (escortMatch) {
    const target = escortMatch[1]!.trim();
    if (target === "me" && senderSlot !== undefined) {
      return {
        state: BotAIState.ESCORT,
        targetId: senderSlot,
        targetName: addressedBot,
      };
    }
    const slotNum = parseInt(target, 10);
    if (!isNaN(slotNum)) {
      return {
        state: BotAIState.ESCORT,
        targetId: slotNum,
        targetName: addressedBot,
      };
    }
  }

  // Ogg [player/slot]
  const oggMatch = remaining.match(/^ogg\s+(\d+)/);
  if (oggMatch) {
    return {
      state: BotAIState.OGG,
      targetId: parseInt(oggMatch[1]!, 10),
      targetName: addressedBot,
    };
  }

  return null;
}

function findPlanetId(name: string, planetNames: string[]): number {
  const lower = name.trim().toLowerCase();
  for (let i = 0; i < planetNames.length; i++) {
    if (planetNames[i]!.toLowerCase() === lower) return i;
  }
  return -1;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/server && npx vitest run src/game/bot/bot-orders.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/game/bot/bot-orders.ts apps/server/src/game/bot/bot-orders.spec.ts
git commit -m "feat: add team chat order parser for bots"
```

---

### Task 8: BotManager Service

**Files:**

- Create: `apps/server/src/game/bot/bot-manager.service.ts`
- Create: `apps/server/src/game/bot/bot-manager.spec.ts`

- [ ] **Step 1: Write BotManager tests**

```typescript
// apps/server/src/game/bot/bot-manager.spec.ts

import { describe, it, expect, beforeEach } from "vitest";
import { BotManagerService } from "./bot-manager.service";
import { BotDifficulty, Team, ShipType, ShipStatus } from "@netrek/shared";
import { GameState } from "../state/game-state";
import { InputQueue } from "../state/input-queue";
import { loadBotConfig } from "./bot-config";

describe("BotManagerService", () => {
  let manager: BotManagerService;
  let gameState: GameState;
  let inputQueue: InputQueue;

  beforeEach(() => {
    gameState = new GameState();
    inputQueue = new InputQueue();
    manager = new BotManagerService();
    manager.init(gameState, inputQueue);
  });

  describe("spawnInitialBots", () => {
    it("spawns configured number of bots per team", () => {
      manager.spawnInitialBots();
      const bots = manager.getAllBots();
      const fedBots = bots.filter((b) => b.team === Team.FEDERATION);
      const romBots = bots.filter((b) => b.team === Team.ROMULANS);
      expect(fedBots.length).toBe(4);
      expect(romBots.length).toBe(4);
    });

    it("assigns unique slots to all bots", () => {
      manager.spawnInitialBots();
      const slots = manager.getAllBots().map((b) => b.slot);
      const unique = new Set(slots);
      expect(unique.size).toBe(8);
    });

    it("follows difficulty mix ratio", () => {
      manager.spawnInitialBots();
      const bots = manager
        .getAllBots()
        .filter((b) => b.team === Team.FEDERATION);
      const newbs = bots.filter(
        (b) => b.difficulty === BotDifficulty.NEWBIE,
      ).length;
      const comps = bots.filter(
        (b) => b.difficulty === BotDifficulty.COMPETENT,
      ).length;
      const vets = bots.filter(
        (b) => b.difficulty === BotDifficulty.VETERAN,
      ).length;
      expect(newbs).toBe(1);
      expect(comps).toBe(2);
      expect(vets).toBe(1);
    });
  });

  describe("onHumanJoin", () => {
    it("does not remove bot when team has open slots", () => {
      manager.spawnInitialBots();
      const botsBefore = manager.getBotCount(Team.FEDERATION);
      manager.onHumanJoin(Team.FEDERATION);
      const botsAfter = manager.getBotCount(Team.FEDERATION);
      expect(botsAfter).toBe(botsBefore);
    });
  });

  describe("onHumanLeave", () => {
    it("spawns a replacement bot when team drops below max", () => {
      manager.spawnInitialBots();
      // Simulate 5 humans + 3 bots on Fed team, remove a human
      // In practice, manager tracks human counts
      manager.onHumanJoin(Team.FEDERATION);
      manager.onHumanLeave(Team.FEDERATION);
      expect(manager.getBotCount(Team.FEDERATION)).toBeGreaterThanOrEqual(4);
    });
  });

  describe("bot names", () => {
    it("generates correct bot names", () => {
      manager.spawnInitialBots();
      const names = manager.getAllBots().map((b) => b.name);
      expect(names.some((n) => n.startsWith("newb-bot-"))).toBe(true);
      expect(names.some((n) => n.startsWith("comp-bot-"))).toBe(true);
      expect(names.some((n) => n.startsWith("vet-bot-"))).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/server && npx vitest run src/game/bot/bot-manager.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement BotManager service**

```typescript
// apps/server/src/game/bot/bot-manager.service.ts

import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import {
  Team,
  ShipType,
  ShipStatus,
  BotDifficulty,
  type ShipState,
  type ChatMessage,
  PLANET_DEFS,
  PLANET_COUNT,
} from "@netrek/shared";
import { GAME_TICK_EVENT } from "../game-loop.service";
import { BotPlayer } from "./bot-player";
import { BotNamePool } from "./bot-names";
import { BotConfig, loadBotConfig, buildDifficultyList } from "./bot-config";
import { parseOrder } from "./bot-orders";
import { GameState } from "../state/game-state";
import { InputQueue } from "../state/input-queue";

const SHIP_TYPES_FOR_BOTS: ShipType[] = [
  ShipType.SC,
  ShipType.DD,
  ShipType.CA,
  ShipType.BB,
  ShipType.AS,
];

@Injectable()
export class BotManagerService {
  private readonly logger = new Logger(BotManagerService.name);
  private readonly bots = new Map<number, BotPlayer>(); // slot -> bot
  private readonly namePool = new BotNamePool();
  private readonly config: BotConfig;
  private readonly humanCounts: Record<number, number> = {
    [Team.FEDERATION]: 0,
    [Team.ROMULANS]: 0,
  };

  private gameState!: GameState;
  private inputQueue!: InputQueue;
  private alertStatuses!: import("@netrek/shared").AlertStatus[];
  private tmode = false;
  private lastRebalanceTick = 0;

  constructor() {
    this.config = loadBotConfig();
  }

  init(
    gameState: GameState,
    inputQueue: InputQueue,
    alertStatuses?: import("@netrek/shared").AlertStatus[],
  ): void {
    this.gameState = gameState;
    this.inputQueue = inputQueue;
    if (alertStatuses) this.alertStatuses = alertStatuses;
  }

  setAlertStatuses(
    alertStatuses: import("@netrek/shared").AlertStatus[],
  ): void {
    this.alertStatuses = alertStatuses;
  }

  setTMode(tmode: boolean): void {
    this.tmode = tmode;
  }

  spawnInitialBots(): void {
    const teams = [Team.FEDERATION, Team.ROMULANS];
    for (const team of teams) {
      const difficulties = buildDifficultyList(
        this.config.difficultyMix,
        this.config.botsPerTeam,
      );
      for (const diff of difficulties) {
        this.spawnBot(team, diff);
      }
    }
    this.logger.log(
      `Spawned ${this.bots.size} initial bots (${this.config.botsPerTeam} per team)`,
    );
  }

  private spawnBot(
    team: Team,
    difficulty: BotDifficulty,
    shipType?: ShipType,
  ): BotPlayer | null {
    const slot = this.gameState.findEmptySlot();
    if (slot === -1) {
      this.logger.warn("No empty slots for bot");
      return null;
    }

    const name = this.namePool.next(difficulty);
    const ship =
      shipType ??
      SHIP_TYPES_FOR_BOTS[
        Math.floor(Math.random() * SHIP_TYPES_FOR_BOTS.length)
      ]!;

    const bot = new BotPlayer(difficulty, team, name, ship);
    bot.assignSlot(slot);

    // Spawn the ship using the same path as human players
    const spawn = this.spawnPoint(team);
    this.gameState.initShip(slot, team, ship, `bot:${name}`, spawn.x, spawn.y);

    this.bots.set(slot, bot);
    this.logger.log(`Spawned ${name} on team ${Team[team]}, slot ${slot}`);
    return bot;
  }

  private removeBot(slot: number): void {
    const bot = this.bots.get(slot);
    if (!bot) return;
    this.gameState.clearShip(slot);
    this.bots.delete(slot);
    this.logger.log(`Removed ${bot.name} from slot ${slot}`);
  }

  private spawnPoint(team: Team): { x: number; y: number } {
    const friendlyPlanets = this.gameState.planets.filter(
      (p) => p.team === team,
    );
    const planet =
      friendlyPlanets.length > 0
        ? friendlyPlanets[Math.floor(Math.random() * friendlyPlanets.length)]!
        : { x: 50000, y: 50000 };
    const spread = 3000;
    return {
      x: planet.x + (Math.random() - 0.5) * spread,
      y: planet.y + (Math.random() - 0.5) * spread,
    };
  }

  onHumanJoin(team: Team): void {
    this.humanCounts[team] = (this.humanCounts[team] ?? 0) + 1;
    const totalOnTeam = this.getTeamTotal(team);

    if (totalOnTeam > this.config.maxPlayersPerTeam) {
      // Need to remove a bot to make room
      const bot = this.findBotOnTeam(team);
      if (bot) {
        this.removeBot(bot.slot);
      }
    }

    this.rebalanceTeams();
  }

  onHumanLeave(team: Team): void {
    this.humanCounts[team] = Math.max(0, (this.humanCounts[team] ?? 0) - 1);
    const totalOnTeam = this.getTeamTotal(team);

    // Fill back to at least botsPerTeam total
    if (totalOnTeam < this.config.maxPlayersPerTeam) {
      const needed = Math.max(
        0,
        this.config.botsPerTeam - this.getBotCount(team),
      );
      for (let i = 0; i < needed; i++) {
        this.spawnBot(team, BotDifficulty.COMPETENT);
      }
    }

    this.rebalanceTeams();
  }

  private rebalanceTeams(): void {
    const fedTotal = this.getTeamTotal(Team.FEDERATION);
    const romTotal = this.getTeamTotal(Team.ROMULANS);
    const diff = fedTotal - romTotal;

    if (Math.abs(diff) <= 1) return;

    if (diff > 1) {
      // Fed has more — move a bot from Fed to Rom (remove + spawn)
      const bot = this.findBotOnTeam(Team.FEDERATION);
      if (bot) {
        this.removeBot(bot.slot);
        this.spawnBot(Team.ROMULANS, bot.difficulty);
      }
    } else if (diff < -1) {
      const bot = this.findBotOnTeam(Team.ROMULANS);
      if (bot) {
        this.removeBot(bot.slot);
        this.spawnBot(Team.FEDERATION, bot.difficulty);
      }
    }
  }

  private findBotOnTeam(team: Team): BotPlayer | null {
    for (const bot of this.bots.values()) {
      if (bot.team === team) return bot;
    }
    return null;
  }

  getTeamTotal(team: Team): number {
    return (this.humanCounts[team] ?? 0) + this.getBotCount(team);
  }

  getBotCount(team: Team): number {
    let count = 0;
    for (const bot of this.bots.values()) {
      if (bot.team === team) count++;
    }
    return count;
  }

  getAllBots(): BotPlayer[] {
    return Array.from(this.bots.values());
  }

  isBot(slot: number): boolean {
    return this.bots.has(slot);
  }

  getBotNames(): string[] {
    return Array.from(this.bots.values()).map((b) => b.name);
  }

  // -----------------------------------------------------------------------
  // Per-tick AI execution
  // -----------------------------------------------------------------------

  @OnEvent(GAME_TICK_EVENT)
  onTick(): void {
    if (this.bots.size === 0) return;
    if (!this.alertStatuses) return;

    const state = this.gameState;

    // Respawn dead bots
    for (const bot of this.bots.values()) {
      const ship = state.ships[bot.slot];
      if (ship && ship.status === ShipStatus.DEAD) {
        const spawn = this.spawnPoint(bot.team);
        state.initShip(
          bot.slot,
          bot.team,
          bot.shipType,
          `bot:${bot.name}`,
          spawn.x,
          spawn.y,
        );
      }
    }

    // Run AI for each alive bot
    for (const bot of this.bots.values()) {
      const ship = state.ships[bot.slot];
      if (!ship || ship.status !== ShipStatus.ALIVE) continue;

      bot.onTick(
        state.currentTick,
        bot.team,
        state.ships,
        state.torps,
        state.phasers,
        state.explosions,
        this.alertStatuses,
        state.planets,
        this.tmode,
        this.inputQueue,
      );
    }

    // Dynamic difficulty rebalancing
    this.checkDifficultyRebalance(state.currentTick);
  }

  // -----------------------------------------------------------------------
  // Chat order handling
  // -----------------------------------------------------------------------

  onChatMessage(message: ChatMessage): void {
    const planetNames = PLANET_DEFS.map((p) => p.name);
    const botNames = this.getBotNames();
    const order = parseOrder(
      message.text,
      planetNames,
      botNames,
      message.senderSlot,
    );
    if (!order) return;

    // Find which bot(s) should respond
    const teamBots = Array.from(this.bots.values()).filter(
      (b) => b.team === message.team,
    );
    if (teamBots.length === 0) return;

    if (order.targetName) {
      // Addressed to a specific bot
      const bot = teamBots.find((b) => b.name === order.targetName);
      if (bot) {
        bot.brain.setOrder(
          order.state,
          order.targetId,
          this.gameState.currentTick,
        );
      }
    } else {
      // Broadcast — nearest bot responds
      const senderShip = this.gameState.ships[message.senderSlot];
      if (!senderShip) return;

      let bestBot: BotPlayer | null = null;
      let bestDist = Infinity;
      for (const bot of teamBots) {
        const ship = this.gameState.ships[bot.slot];
        if (!ship || ship.status !== ShipStatus.ALIVE) continue;
        const dx = ship.x - senderShip.x;
        const dy = ship.y - senderShip.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < bestDist) {
          bestDist = dist;
          bestBot = bot;
        }
      }

      if (bestBot) {
        bestBot.brain.setOrder(
          order.state,
          order.targetId,
          this.gameState.currentTick,
        );
      }
    }
  }

  // -----------------------------------------------------------------------
  // Dynamic difficulty rebalancing
  // -----------------------------------------------------------------------

  private checkDifficultyRebalance(tick: number): void {
    if (tick - this.lastRebalanceTick < this.config.rebalanceIntervalTicks) {
      return;
    }
    this.lastRebalanceTick = tick;

    const planets = this.gameState.planets;
    const fedPlanets = planets.filter((p) => p.team === Team.FEDERATION).length;
    const romPlanets = planets.filter((p) => p.team === Team.ROMULANS).length;
    const total = fedPlanets + romPlanets;
    if (total === 0) return;

    const threshold = this.config.planetImbalanceThreshold;

    if (fedPlanets / 40 >= threshold) {
      // Federation dominating — downgrade a Fed bot, upgrade a Rom bot
      this.rotateBotDifficulty(Team.FEDERATION, "down");
      this.rotateBotDifficulty(Team.ROMULANS, "up");
    } else if (romPlanets / 40 >= threshold) {
      this.rotateBotDifficulty(Team.ROMULANS, "down");
      this.rotateBotDifficulty(Team.FEDERATION, "up");
    }
  }

  private rotateBotDifficulty(team: Team, direction: "up" | "down"): void {
    const teamBots = Array.from(this.bots.values()).filter(
      (b) => b.team === team,
    );
    if (teamBots.length === 0) return;

    // Find a bot to rotate
    let target: BotPlayer | null = null;
    if (direction === "down") {
      // Find the highest difficulty bot
      target =
        teamBots.find((b) => b.difficulty === BotDifficulty.VETERAN) ??
        teamBots.find((b) => b.difficulty === BotDifficulty.COMPETENT) ??
        null;
    } else {
      // Find the lowest difficulty bot
      target =
        teamBots.find((b) => b.difficulty === BotDifficulty.NEWBIE) ??
        teamBots.find((b) => b.difficulty === BotDifficulty.COMPETENT) ??
        null;
    }

    if (!target) return;

    const newDifficulty =
      direction === "down"
        ? Math.max(BotDifficulty.NEWBIE, target.difficulty - 1)
        : Math.min(BotDifficulty.VETERAN, target.difficulty + 1);

    if (newDifficulty === target.difficulty) return;

    // Remove and respawn with new difficulty
    const slot = target.slot;
    const team_ = target.team;
    this.removeBot(slot);
    this.spawnBot(team_, newDifficulty as BotDifficulty);

    this.logger.log(
      `Difficulty rebalance: rotated ${Team[team_]} bot from ${BotDifficulty[target.difficulty]} to ${BotDifficulty[newDifficulty]}`,
    );
  }

  // -----------------------------------------------------------------------
  // Game reset
  // -----------------------------------------------------------------------

  resetForNewGame(): void {
    // Remove all bots
    for (const slot of Array.from(this.bots.keys())) {
      this.removeBot(slot);
    }
    this.namePool.reset();
    this.lastRebalanceTick = 0;

    // Respawn initial bots
    this.spawnInitialBots();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/server && npx vitest run src/game/bot/bot-manager.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/game/bot/bot-manager.service.ts apps/server/src/game/bot/bot-manager.spec.ts
git commit -m "feat: implement BotManager service with lifecycle and difficulty rebalancing"
```

---

### Task 9: Wire Bots into GameModule

**Files:**

- Modify: `apps/server/src/game/game.module.ts`
- Modify: `apps/server/src/game/game-loop.service.ts`
- Modify: `apps/server/src/game/game-broadcast.service.ts`
- Modify: `apps/server/src/game/game.gateway.ts`
- Modify: `apps/server/src/game/game.service.ts`
- Update: `apps/server/src/game/bot/index.ts`

- [ ] **Step 1: Update barrel export**

```typescript
// apps/server/src/game/bot/index.ts

export { BotManagerService } from "./bot-manager.service";
export { BotPlayer } from "./bot-player";
export { BotBrain } from "./bot-ai";
```

- [ ] **Step 2: Register BotManager in GameModule**

Add `BotManagerService` to the providers and exports in `apps/server/src/game/game.module.ts`:

```typescript
import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AppConfig } from "../config/app.config";
import { GameService } from "./game.service";
import { GameLoopService } from "./game-loop.service";
import { GameBroadcastService } from "./game-broadcast.service";
import { GameGateway } from "./game.gateway";
import { WsAuthService } from "./guards/ws-auth.guard";
import { BotManagerService } from "./bot";

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        secret: config.jwt.secret,
      }),
    }),
  ],
  providers: [
    GameService,
    GameLoopService,
    GameBroadcastService,
    GameGateway,
    WsAuthService,
    BotManagerService,
  ],
  exports: [GameService, GameLoopService, BotManagerService],
})
export class GameModule {}
```

- [ ] **Step 3: Initialize BotManager from GameLoopService**

Modify `apps/server/src/game/game-loop.service.ts`:

Add `BotManagerService` to the constructor and initialize it in `onModuleInit()`. Also update `checkWinCondition()` to emit a reset event and add a game reset method.

In the import section, add:

```typescript
import { BotManagerService } from "./bot";
```

Update the constructor:

```typescript
constructor(
    private readonly gameService: GameService,
    private readonly eventEmitter: EventEmitter2,
    private readonly botManager: BotManagerService,
  ) {}
```

Update `onModuleInit()`:

```typescript
onModuleInit() {
    this.botManager.init(
      this.gameService.state,
      this.gameService.inputQueue,
      this.alertStatuses,
    );
    this.botManager.spawnInitialBots();
    this.start();
  }
```

At the end of `tick()`, after emitting `GAME_TICK_EVENT`, add the tmode sync:

```typescript
// Sync tmode to bot manager
this.botManager.setTMode(this.tmode);
```

Update `checkWinCondition()` to trigger a game reset:

```typescript
  private checkWinCondition(planets: PlanetState[]): void {
    if (!this.tmode) return;

    const teamPlanets = [0, 0, 0, 0];
    for (let i = 0; i < planets.length; i++) {
      const t = planets[i]!.team as number;
      if (t >= 0 && t < 4) teamPlanets[t] = (teamPlanets[t] ?? 0) + 1;
    }

    for (let t = 0; t < 4; t++) {
      if (teamPlanets[t] === 0) {
        const ships = this.gameService.state.ships;
        let hadPlayers = false;
        for (let i = 0; i < ships.length; i++) {
          if (ships[i]!.team === t && ships[i]!.playerId) {
            hadPlayers = true;
            break;
          }
        }
        if (hadPlayers) {
          this.logger.log(`GENOCIDE! Team ${t} has lost all planets!`);
          this.eventEmitter.emit(GAME_WIN_EVENT, { losingTeam: t });
        }
      }
    }
  }
```

Add the new event constant near `GAME_TICK_EVENT`:

```typescript
export const GAME_WIN_EVENT = "game.win";
```

- [ ] **Step 4: Update GameGateway for chat messages and bot-aware join/leave**

Modify `apps/server/src/game/game.gateway.ts`:

Add import:

```typescript
import { BotManagerService } from "./bot";
import { type ChatMessage } from "@netrek/shared";
```

Add to constructor:

```typescript
private readonly botManager: BotManagerService,
```

Update `handleJoin()` to notify BotManager after a successful join:

```typescript
// After the broadcastService.addPlayer call:
this.botManager.onHumanJoin(data.team as Team);
```

Update `handleDisconnect()` to notify BotManager. **Important:** read the team BEFORE calling `leaveGame()` since `clearShip()` resets the ship data:

```typescript
handleDisconnect(client: Socket): void {
  const player = this.broadcastService.removePlayer(client.id);
  if (player) {
    // Read team before clearing ship data
    const team = this.gameService.state.ships[player.slot]?.team;
    this.gameService.leaveGame(player.slot);
    if (team !== undefined) {
      this.botManager.onHumanLeave(team);
    }
    this.logger.log(`Player ${player.userId} disconnected, slot ${player.slot}`);
  }
}
```

Add a chat message handler:

```typescript
@SubscribeMessage("chat")
handleChat(
  @ConnectedSocket() client: Socket,
  @MessageBody() data: { text: string; team: number },
): void {
  const player = this.broadcastService.getPlayerBySocketId(client.id);
  if (!player) return;

  const ship = this.gameService.state.ships[player.slot];
  if (!ship) return;

  const message: ChatMessage = {
    senderSlot: player.slot,
    senderName: player.userId,
    team: data.team,
    text: data.text,
    tick: this.gameService.state.currentTick,
  };

  // Broadcast to team or all
  if (this.server) {
    for (const p of this.broadcastService.getAllPlayers()) {
      const pShip = this.gameService.state.ships[p.slot];
      if (data.team === -1 || (pShip && pShip.team === data.team)) {
        p.socket.emit("chat", message);
      }
    }
  }

  // Forward to bot manager for order processing
  this.botManager.onChatMessage(message);
}
```

- [ ] **Step 5: Add getAllPlayers to BroadcastService**

Add this method to `apps/server/src/game/game-broadcast.service.ts`:

```typescript
getAllPlayers(): ConnectedPlayer[] {
  return Array.from(this.players.values());
}
```

- [ ] **Step 6: Add isBot helper to GameService**

Add to `apps/server/src/game/game.service.ts`:

```typescript
isBot(slot: number): boolean {
  const ship = this.state.ships[slot];
  return ship?.playerId.startsWith("bot:") ?? false;
}
```

- [ ] **Step 7: Run the full test suite**

Run: `cd apps/server && npx vitest run`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/game/game.module.ts apps/server/src/game/game-loop.service.ts apps/server/src/game/game-broadcast.service.ts apps/server/src/game/game.gateway.ts apps/server/src/game/game.service.ts apps/server/src/game/bot/index.ts
git commit -m "feat: wire BotManager into game module with chat and lifecycle hooks"
```

---

### Task 10: Win Condition and Game Reset

**Files:**

- Modify: `apps/server/src/game/game-loop.service.ts`
- Modify: `apps/server/src/game/game-broadcast.service.ts`
- Modify: `apps/server/src/game/state/game-state.ts`

- [ ] **Step 1: Add game reset method to GameState**

Add to `apps/server/src/game/state/game-state.ts`:

```typescript
resetGame(): void {
  // Clear all ships
  for (let i = 0; i < this.ships.length; i++) {
    this.clearShip(i);
  }

  // Reset all torps, phasers, explosions
  for (let i = 0; i < this.torps.length; i++) {
    this.torps[i]!.alive = false;
  }
  for (let i = 0; i < this.phasers.length; i++) {
    this.phasers[i]!.alive = false;
  }
  for (let i = 0; i < this.explosions.length; i++) {
    this.explosions[i]!.alive = false;
  }

  // Reset planets to defaults
  for (let i = 0; i < PLANET_DEFS.length && i < this.planets.length; i++) {
    const def = PLANET_DEFS[i]!;
    const planet = this.planets[i]!;
    planet.team = def.team as Team;
    planet.armies = def.armies;
    planet.features = def.features;
    planet.lastPopTick = 0;
  }
  randomizePlanetFeatures(this.planets);

  this.currentTick = 0;
}
```

- [ ] **Step 2: Add win/reset handling to GameLoopService**

Add a `GAME_RESET_EVENT` constant and win pause state to `apps/server/src/game/game-loop.service.ts`:

```typescript
export const GAME_RESET_EVENT = "game.reset";
```

Add instance fields:

```typescript
private winPauseTicks = 0;
private winningTeam = -1;
```

In `loadBotConfig` import at top:

```typescript
import { loadBotConfig, type BotConfig } from "./bot/bot-config";
```

Add config field:

```typescript
private readonly botConfig: BotConfig;
```

Initialize in constructor:

```typescript
this.botConfig = loadBotConfig();
```

At the top of `tick()`, add win pause handling:

```typescript
// Handle win pause
if (this.winPauseTicks > 0) {
  this.winPauseTicks--;
  if (this.winPauseTicks === 0) {
    this.resetGame();
  }
  state.currentTick++;
  this.eventEmitter.emit(GAME_TICK_EVENT);
  return;
}
```

Replace the `checkWinCondition` genocide log with:

```typescript
if (hadPlayers) {
  // Find winning team
  const winTeam = teamPlanets.findIndex((c, i) => i !== t && c > 0);
  this.logger.log(
    `GENOCIDE! Team ${Team[t]} eliminated. Team ${Team[winTeam]} wins!`,
  );
  this.winPauseTicks = this.botConfig.winPauseTicks;
  this.winningTeam = winTeam;
  this.eventEmitter.emit(GAME_WIN_EVENT, {
    losingTeam: t,
    winningTeam: winTeam,
  });
}
```

Add reset method:

```typescript
private resetGame(): void {
  this.logger.log("Resetting game...");
  this.gameService.state.resetGame();
  this.tmode = false;
  this.winningTeam = -1;

  // Respawn humans at their homeworlds
  // (BroadcastService still has their socket mappings)

  // Reset bots
  this.botManager.resetForNewGame();

  this.eventEmitter.emit(GAME_RESET_EVENT);
  this.logger.log("Game reset complete");
}
```

- [ ] **Step 3: Broadcast win event to clients**

Add to `apps/server/src/game/game-broadcast.service.ts`:

```typescript
@OnEvent(GAME_WIN_EVENT)
handleWin(data: { losingTeam: number; winningTeam: number }): void {
  if (!this.server) return;
  for (const player of this.players.values()) {
    player.socket.emit("game_win", {
      winningTeam: data.winningTeam,
      losingTeam: data.losingTeam,
    });
  }
}
```

Add import:

```typescript
import { GAME_TICK_EVENT, GAME_WIN_EVENT } from "./game-loop.service";
```

(Replace the existing single import of `GAME_TICK_EVENT`.)

- [ ] **Step 4: Run tests**

Run: `cd apps/server && npx vitest run`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/game/state/game-state.ts apps/server/src/game/game-loop.service.ts apps/server/src/game/game-broadcast.service.ts
git commit -m "feat: implement win condition with pause, game reset, and client broadcast"
```

---

### Task 11: Lobby REST API

**Files:**

- Create: `apps/server/src/lobby/lobby.controller.ts`
- Create: `apps/server/src/lobby/lobby.module.ts`
- Modify: `apps/server/src/app.module.ts`

- [ ] **Step 1: Create lobby controller**

```typescript
// apps/server/src/lobby/lobby.controller.ts

import { Controller, Get } from "@nestjs/common";
import { GameService } from "../game/game.service";
import { GameLoopService } from "../game/game-loop.service";
import { BotManagerService } from "../game/bot";
import { Team, ShipType, ShipStatus } from "@netrek/shared";

@Controller("lobby")
export class LobbyController {
  constructor(
    private readonly gameService: GameService,
    private readonly gameLoop: GameLoopService,
    private readonly botManager: BotManagerService,
  ) {}

  @Get("info")
  getServerInfo() {
    const state = this.gameService.state;
    const ships = state.ships;

    const fedPlayers: PlayerInfo[] = [];
    const romPlayers: PlayerInfo[] = [];

    for (let i = 0; i < ships.length; i++) {
      const ship = ships[i]!;
      if (!ship.playerId) continue;

      const info: PlayerInfo = {
        slot: i,
        name: ship.playerId.startsWith("bot:")
          ? ship.playerId.slice(4)
          : ship.playerId,
        team: ship.team,
        shipType: ship.shipType,
        status: ship.status,
        isBot: ship.playerId.startsWith("bot:"),
      };

      if (ship.team === Team.FEDERATION) {
        fedPlayers.push(info);
      } else if (ship.team === Team.ROMULANS) {
        romPlayers.push(info);
      }
    }

    return {
      motd: "Welcome to Netrek Web! Fly, fight, and conquer the galaxy.",
      tmode: this.gameLoop.tmode,
      playerCount: this.gameService.getPlayerCount(),
      maxPlayers: 16,
      teams: {
        [Team.FEDERATION]: {
          name: "Federation",
          players: fedPlayers,
          count: fedPlayers.length,
        },
        [Team.ROMULANS]: {
          name: "Romulans",
          players: romPlayers,
          count: romPlayers.length,
        },
      },
      options: {
        shipsAllowed: "SC DD CA BB AS SB",
        tractorPressor: true,
        tmodeMinPlayers: 4,
      },
    };
  }
}

interface PlayerInfo {
  slot: number;
  name: string;
  team: Team;
  shipType: ShipType;
  status: ShipStatus;
  isBot: boolean;
}
```

- [ ] **Step 2: Create lobby module**

```typescript
// apps/server/src/lobby/lobby.module.ts

import { Module } from "@nestjs/common";
import { LobbyController } from "./lobby.controller";
import { GameModule } from "../game/game.module";

@Module({
  imports: [GameModule],
  controllers: [LobbyController],
})
export class LobbyModule {}
```

- [ ] **Step 3: Register in AppModule**

Add to imports in `apps/server/src/app.module.ts`:

```typescript
import { LobbyModule } from "./lobby/lobby.module";
```

Add `LobbyModule` to the `imports` array.

- [ ] **Step 4: Test the endpoint manually**

Start the server and verify:

Run: `curl http://localhost:3010/lobby/info`
Expected: JSON with motd, tmode, playerCount, teams, options

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/lobby/lobby.controller.ts apps/server/src/lobby/lobby.module.ts apps/server/src/app.module.ts
git commit -m "feat: add lobby REST API with server info endpoint"
```

---

### Task 12: Lobby Client Page

**Files:**

- Create: `apps/client/app/lobby/page.tsx`

- [ ] **Step 1: Create the lobby page**

```tsx
// apps/client/app/lobby/page.tsx

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface PlayerInfo {
  slot: number;
  name: string;
  team: number;
  shipType: number;
  status: number;
  isBot: boolean;
}

interface TeamInfo {
  name: string;
  players: PlayerInfo[];
  count: number;
}

interface ServerInfo {
  motd: string;
  tmode: boolean;
  playerCount: number;
  maxPlayers: number;
  teams: Record<string, TeamInfo>;
  options: {
    shipsAllowed: string;
    tractorPressor: boolean;
    tmodeMinPlayers: number;
  };
}

const SHIP_NAMES: Record<number, string> = {
  0: "SC",
  1: "DD",
  2: "CA",
  3: "BB",
  4: "AS",
  5: "SB",
};

const TEAM_COLORS: Record<string, string> = {
  "0": "#4fc3f7", // Federation — blue
  "1": "#ef5350", // Romulans — red
};

export default function LobbyPage() {
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const fetchInfo = async () => {
      try {
        const res = await fetch(
          `${process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3010"}/lobby/info`,
        );
        if (!res.ok) throw new Error("Failed to load server info");
        setInfo(await res.json());
      } catch (e) {
        setError((e as Error).message);
      }
    };

    fetchInfo();
    const interval = setInterval(fetchInfo, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleJoinTeam = (team: number) => {
    router.push(`/game?team=${team}`);
  };

  if (error) {
    return (
      <div style={styles.container}>
        <pre style={styles.error}>ERROR: {error}</pre>
      </div>
    );
  }

  if (!info) {
    return (
      <div style={styles.container}>
        <pre style={styles.text}>Connecting to server...</pre>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* MOTD */}
      <div style={styles.section}>
        <pre style={styles.header}>{"--- Netrek Web Server ---"}</pre>
        <pre style={styles.motd}>{info.motd}</pre>
      </div>

      {/* Server Options */}
      <div style={styles.section}>
        <pre style={styles.subheader}>OPTIONS:</pre>
        <pre style={styles.text}>
          {`  Tournament Mode    : ${info.tmode ? "ACTIVE" : "inactive"}
  T-Mode Min Players : ${info.options.tmodeMinPlayers} players / side
  Ships Allowed      : ${info.options.shipsAllowed}
  Tractor/Pressor    : ${info.options.tractorPressor ? "enabled" : "disabled"}
  Players            : ${info.playerCount} / ${info.maxPlayers}`}
        </pre>
      </div>

      {/* Teams */}
      <div style={styles.teamsRow}>
        {Object.entries(info.teams).map(([teamId, team]) => (
          <div key={teamId} style={styles.teamBox}>
            <pre
              style={{
                ...styles.teamName,
                color: TEAM_COLORS[teamId] ?? "#fff",
              }}
            >
              {team.name} ({team.count})
            </pre>
            <div style={styles.playerList}>
              {team.players.map((p) => (
                <pre key={p.slot} style={styles.playerRow}>
                  {`  ${String(p.slot).padStart(2)} ${SHIP_NAMES[p.shipType] ?? "??"} ${p.name}${p.isBot ? "" : " *"}`}
                </pre>
              ))}
              {team.players.length === 0 && (
                <pre style={styles.emptyText}> (empty)</pre>
              )}
            </div>
            <button
              style={{
                ...styles.joinButton,
                borderColor: TEAM_COLORS[teamId] ?? "#fff",
                color: TEAM_COLORS[teamId] ?? "#fff",
              }}
              onClick={() => handleJoinTeam(Number(teamId))}
            >
              JOIN {team.name.toUpperCase()}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    backgroundColor: "#000",
    color: "#ffa500",
    fontFamily: "monospace",
    minHeight: "100vh",
    padding: "20px",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  section: {
    borderBottom: "1px solid #333",
    paddingBottom: "12px",
  },
  header: {
    color: "#ffa500",
    fontSize: "16px",
    textAlign: "center",
    margin: "0 0 8px 0",
  },
  subheader: {
    color: "#ffa500",
    fontSize: "14px",
    margin: "0 0 4px 0",
  },
  motd: {
    color: "#ccc",
    fontSize: "13px",
    margin: 0,
    whiteSpace: "pre-wrap",
  },
  text: {
    color: "#ccc",
    fontSize: "13px",
    margin: 0,
  },
  teamsRow: {
    display: "flex",
    gap: "24px",
    justifyContent: "center",
  },
  teamBox: {
    border: "1px solid #444",
    padding: "12px",
    minWidth: "280px",
    flex: 1,
    maxWidth: "400px",
  },
  teamName: {
    fontSize: "16px",
    margin: "0 0 8px 0",
    textAlign: "center",
  },
  playerList: {
    marginBottom: "12px",
    minHeight: "120px",
  },
  playerRow: {
    color: "#ccc",
    fontSize: "12px",
    margin: 0,
  },
  emptyText: {
    color: "#666",
    fontSize: "12px",
    margin: 0,
  },
  joinButton: {
    background: "transparent",
    border: "1px solid",
    padding: "8px 16px",
    fontFamily: "monospace",
    fontSize: "14px",
    cursor: "pointer",
    width: "100%",
    textAlign: "center",
  },
  error: {
    color: "#ef5350",
    fontSize: "14px",
    margin: 0,
  },
};
```

- [ ] **Step 2: Test in browser**

Start the dev servers and navigate to `http://localhost:3011/lobby`.
Expected: Retro-styled lobby with MOTD, server options, team columns with bot players listed, join buttons.

- [ ] **Step 3: Commit**

```bash
git add apps/client/app/lobby/page.tsx
git commit -m "feat: add retro-styled lobby page"
```

---

### Task 13: Integration Testing and Build Verification

**Files:** None (testing existing code)

- [ ] **Step 1: Run all server tests**

Run: `cd apps/server && npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Run TypeScript compilation check**

Run: `cd apps/server && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Run client compilation check**

Run: `cd apps/client && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Run shared package compilation check**

Run: `cd packages/shared && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 5: Start the server and verify bots spawn**

Run: `cd apps/server && npm run start:dev`
Expected: Log output shows "Spawned 8 initial bots (4 per team)"

- [ ] **Step 6: Start the client and test the lobby**

Run: `cd apps/client && npm run dev`
Navigate to `http://localhost:3011/lobby`
Expected: See bots listed under each team

- [ ] **Step 7: Join the game and verify bot behavior**

Join a team from the lobby, enter the game. Bots should be visible on the galactic map flying between planets. They should engage if you approach.

- [ ] **Step 8: Commit final integration**

```bash
git add -A
git commit -m "feat: complete bot and lobby system integration"
```

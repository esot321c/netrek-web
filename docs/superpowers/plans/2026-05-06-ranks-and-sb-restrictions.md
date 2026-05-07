# Ranks & Starbase Restrictions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add rank progression (DI-based), wire game stats, gate Starbase behind rank/planets/cooldown/one-per-team, show rank in player list, and wire client refit key.

**Architecture:** Pure rank functions in shared package. SessionStats service in game server accumulates stat deltas, feeds stat reporter and rank computation. GameService validates 4 SB gates at respawn and refit. Backend recalculates rank on stat ingest. Client shows rank in roster and SB restrictions in respawn UI.

**Tech Stack:** TypeScript, NestJS (server + backend), Prisma ORM, Next.js (client), Socket.IO, vitest (tests)

---

### Task 1: Rank Definitions in Shared Package

**Files:**

- Create: `packages/shared/src/game/ranks.ts`
- Modify: `packages/shared/src/game/index.ts`

- [ ] **Step 1: Create `ranks.ts` with rank definitions and pure functions**

```typescript
// packages/shared/src/game/ranks.ts

export interface RankDef {
  readonly title: string;
  readonly abbrev: string;
  readonly diThreshold: number;
}

export const RANK_DEFS: readonly RankDef[] = [
  { title: "Ensign", abbrev: "Ens", diThreshold: 0 },
  { title: "Lieutenant", abbrev: "Lt", diThreshold: 2 },
  { title: "Lt. Commander", abbrev: "LtC", diThreshold: 6 },
  { title: "Commander", abbrev: "Cdr", diThreshold: 12 },
  { title: "Captain", abbrev: "Cpt", diThreshold: 20 },
  { title: "Fl. Captain", abbrev: "FCp", diThreshold: 30 },
  { title: "Commodore", abbrev: "Com", diThreshold: 45 },
  { title: "Rear Admiral", abbrev: "RAd", diThreshold: 65 },
  { title: "Admiral", abbrev: "Adm", diThreshold: 90 },
] as const;

export const SB_MIN_RANK = 3; // Commander

export function calculateDI(stats: {
  planetsTaken: number;
  armiesBombed: number;
  kills: number;
}): number {
  return stats.planetsTaken + stats.armiesBombed / 10 + stats.kills / 4;
}

export function rankForDI(di: number): number {
  let rank = 0;
  for (let i = RANK_DEFS.length - 1; i >= 0; i--) {
    if (di >= RANK_DEFS[i]!.diThreshold) {
      rank = i;
      break;
    }
  }
  return rank;
}

export function rankTitle(rank: number): string {
  return RANK_DEFS[rank]?.title ?? "Ensign";
}

export function rankAbbrev(rank: number): string {
  return RANK_DEFS[rank]?.abbrev ?? "Ens";
}
```

- [ ] **Step 2: Export from shared index**

Add this line to `packages/shared/src/game/index.ts`:

```typescript
export * from "./ranks";
```

- [ ] **Step 3: Build shared package**

Run: `npx turbo build --filter=@netrek/shared`
Expected: Success, no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/game/ranks.ts packages/shared/src/game/index.ts
git commit -m "feat(shared): add rank definitions and DI calculation"
```

---

### Task 2: Add `rank` to RosterEntry

**Files:**

- Modify: `packages/shared/src/game/chat-types.ts`

- [ ] **Step 1: Add rank field to RosterEntry**

In `packages/shared/src/game/chat-types.ts`, add `rank` to the `RosterEntry` interface:

```typescript
export interface RosterEntry {
  name: string;
  team: number;
  shipType: number;
  kills: number;
  rank: number;
}
```

- [ ] **Step 2: Build shared package**

Run: `npx turbo build --filter=@netrek/shared`
Expected: Build succeeds. Downstream packages that construct `RosterEntry` will fail until they add `rank` — that's expected and fixed in later tasks.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/game/chat-types.ts
git commit -m "feat(shared): add rank to RosterEntry"
```

---

### Task 3: Wire Stat Events in Game Loop

**Files:**

- Modify: `apps/server/src/game/game-loop.service.ts`
- Modify: `apps/server/src/registration/stat-reporter.service.ts`

The `StatReporterService` already has `recordKill()`, `recordDeath()`, `recordPlanetTaken()`, `recordArmiesBombed()`, `recordArmiesBeamed()` methods and pushes to backend every 60 seconds. The problem is the game loop never calls them. We need to inject `StatReporterService` into `GameLoopService` and call the record methods at the right points.

- [ ] **Step 1: Add StatReporterService to GameLoopService constructor**

In `apps/server/src/game/game-loop.service.ts`, add the import and constructor injection. The stat reporter is in `apps/server/src/registration/stat-reporter.service.ts`.

Add to imports at top of file:

```typescript
import { StatReporterService } from "../registration/stat-reporter.service";
```

Add to constructor parameters (GameLoopService already has a constructor — add `statReporter` as a new parameter):

```typescript
private readonly statReporter: StatReporterService,
```

- [ ] **Step 2: Record kills and deaths in `checkDeaths()`**

Find the section in `checkDeaths()` where `GAME_KILL_EVENT` is emitted. After the emit, add stat recording. The killer's playerId is on `ships[lastDamagedBySlot]`, the victim's playerId is on `ship.playerId`. Only record for human players (playerId does not start with `"bot:"`).

After the line that emits the kill event, add:

```typescript
if (!ship.playerId.startsWith("bot:")) {
  this.statReporter.recordDeath(ship.playerId);
}
if (
  ship.lastDamagedBySlot >= 0 &&
  ships[ship.lastDamagedBySlot] &&
  !ships[ship.lastDamagedBySlot]!.playerId.startsWith("bot:")
) {
  this.statReporter.recordKill(ships[ship.lastDamagedBySlot]!.playerId);
}
```

- [ ] **Step 3: Record armies bombed in `updateBombing()`**

Find the section in `updateBombing()` where `planet.armies--` occurs (an army is killed by bombing). After that line, add:

```typescript
if (!ship.playerId.startsWith("bot:")) {
  this.statReporter.recordArmiesBombed(ship.playerId, 1);
}
```

- [ ] **Step 4: Record armies beamed and planets taken in `updateBeaming()`**

In `updateBeaming()`, there are two branches:

For beam-up (army transferred from planet to ship), after `ship.armies++`, add:

```typescript
if (!ship.playerId.startsWith("bot:")) {
  this.statReporter.recordArmiesBeamed(ship.playerId, 1);
}
```

For planet capture (when `planet.team = ship.team` is set), add:

```typescript
if (!ship.playerId.startsWith("bot:")) {
  this.statReporter.recordPlanetTaken(ship.playerId);
}
```

- [ ] **Step 5: Register StatReporterService in GameModule providers**

In `apps/server/src/game/game.module.ts`, import and add `StatReporterService` to providers (check if it's already registered in another module — it's in the registration module, so it may need to be exported from there or moved to a shared provider).

Check the module structure. If `StatReporterService` is provided by `RegistrationModule`, ensure `RegistrationModule` exports it and `GameModule` imports `RegistrationModule`. Alternatively, register `StatReporterService` directly in `GameModule` if there's no circular dependency.

- [ ] **Step 6: Build and verify**

Run: `npx turbo build --filter=@netrek/server`
Expected: Success.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/game/game-loop.service.ts apps/server/src/game/game.module.ts
git commit -m "feat(server): wire kill/death/bomb/beam stats to stat reporter"
```

---

### Task 4: Backend Rank Recalculation on Stat Ingest

**Files:**

- Modify: `apps/backend/src/stats/stats.service.ts`

- [ ] **Step 1: Import rank functions**

Add to imports in `apps/backend/src/stats/stats.service.ts`:

```typescript
import { calculateDI, rankForDI } from "@netrek/shared";
```

- [ ] **Step 2: Add rank recalculation after upsert**

After the upsert in the `ingest()` method's for-loop, fetch the updated stats and recalculate rank:

```typescript
const updated = await this.prisma.playerStats.findUnique({
  where: { userId_serverId: { userId: p.userId, serverId: scope } },
});
if (updated) {
  const di = calculateDI({
    planetsTaken: updated.planetsTaken,
    armiesBombed: updated.armiesBombed,
    kills: updated.totalKills,
  });
  const newRank = rankForDI(di);
  if (newRank !== updated.rank) {
    await this.prisma.playerStats.update({
      where: { userId_serverId: { userId: p.userId, serverId: scope } },
      data: { rank: newRank },
    });
  }
}
```

- [ ] **Step 3: Build backend**

Run: `npx turbo build --filter=@netrek/backend`
Expected: Success.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/stats/stats.service.ts
git commit -m "feat(backend): recalculate rank from DI on stat ingest"
```

---

### Task 5: SB Restrictions in GameService

**Files:**

- Modify: `apps/server/src/game/game.service.ts`
- Modify: `apps/server/src/game/game-events.ts`

- [ ] **Step 1: Add SB constants and respawn result type**

Add to `apps/server/src/game/game.service.ts` imports:

```typescript
import {
  Team,
  ShipType,
  ShipStatus,
  PLANET_DEFS,
  SB_MIN_RANK,
  calculateDI,
  rankForDI,
} from "@netrek/shared";
```

Add above the class definition:

```typescript
const SB_COOLDOWN_TICKS = 18000; // 30 minutes at 10Hz
const SB_MIN_PLANETS = 5;

export interface RespawnResult {
  ok: boolean;
  reason?: string;
  cooldownRemainingSec?: number;
}
```

- [ ] **Step 2: Add SB cooldown tracking and token stats storage**

Add fields to the `GameService` class:

```typescript
private readonly sbCooldownExpiresTick: Record<number, number> = {
  [Team.FEDERATION]: 0,
  [Team.ROMULANS]: 0,
};

private readonly playerTokenStats = new Map<number, {
  totalKills: number;
  planetsTaken: number;
  armiesBombed: number;
  rank: number;
}>();

private readonly playerSessionStats = new Map<number, {
  kills: number;
  planetsTaken: number;
  armiesBombed: number;
}>();
```

- [ ] **Step 3: Add methods to store token stats and record session stats**

```typescript
setPlayerTokenStats(slot: number, stats: {
  totalKills: number;
  planetsTaken: number;
  armiesBombed: number;
  rank: number;
}): void {
  this.playerTokenStats.set(slot, { ...stats });
  this.playerSessionStats.set(slot, { kills: 0, planetsTaken: 0, armiesBombed: 0 });
}

recordSessionKill(slot: number): void {
  const s = this.playerSessionStats.get(slot);
  if (s) s.kills++;
}

recordSessionPlanetTaken(slot: number): void {
  const s = this.playerSessionStats.get(slot);
  if (s) s.planetsTaken++;
}

recordSessionArmiesBombed(slot: number): void {
  const s = this.playerSessionStats.get(slot);
  if (s) s.armiesBombed++;
}

getEffectiveRank(slot: number): number {
  const token = this.playerTokenStats.get(slot);
  const session = this.playerSessionStats.get(slot);
  if (!token) return 0;
  const di = calculateDI({
    planetsTaken: token.planetsTaken + (session?.planetsTaken ?? 0),
    armiesBombed: token.armiesBombed + (session?.armiesBombed ?? 0),
    kills: token.totalKills + (session?.kills ?? 0),
  });
  return rankForDI(di);
}

startSbCooldown(team: Team): void {
  this.sbCooldownExpiresTick[team] =
    this.state.currentTick + SB_COOLDOWN_TICKS;
}

clearPlayerStats(slot: number): void {
  this.playerTokenStats.delete(slot);
  this.playerSessionStats.delete(slot);
}
```

- [ ] **Step 4: Replace `respawn()` with SB gate checks**

Replace the existing `respawn` method:

```typescript
respawn(slot: number, shipType: ShipType): RespawnResult {
  const ship = this.state.ships[slot];
  if (!ship || !ship.playerId) return { ok: false };

  // Check no in-flight torps
  for (let i = 0; i < this.state.torps.length; i++) {
    if (this.state.torps[i]!.alive && this.state.torps[i]!.ownerSlot === slot) {
      return { ok: false, reason: "torps" };
    }
  }

  // SB gates
  if (shipType === ShipType.SB) {
    const sbCheck = this.checkSbGates(slot, ship.team);
    if (!sbCheck.ok) return sbCheck;
  }

  const spawn = this.spawnPoint(ship.team);
  this.state.initShip(slot, ship.team, shipType, ship.playerId, spawn.x, spawn.y);
  this.logger.log(`Player ${ship.playerId} respawned as ${ShipType[shipType]}`);
  return { ok: true };
}

private checkSbGates(slot: number, team: Team): RespawnResult {
  // Gate 1: Rank
  const rank = this.getEffectiveRank(slot);
  if (rank < SB_MIN_RANK) {
    return { ok: false, reason: "rank" };
  }

  // Gate 2: One per team
  for (const s of this.state.ships) {
    if (
      s.team === team &&
      s.shipType === ShipType.SB &&
      s.status !== ShipStatus.DEAD &&
      s.playerId !== ""
    ) {
      return { ok: false, reason: "sb_active" };
    }
  }

  // Gate 3: Team planets
  let teamPlanets = 0;
  for (const p of this.state.planets) {
    if (p.team === team) teamPlanets++;
  }
  if (teamPlanets < SB_MIN_PLANETS) {
    return { ok: false, reason: "planets" };
  }

  // Gate 4: Cooldown
  const cooldownExpires = this.sbCooldownExpiresTick[team] ?? 0;
  if (this.state.currentTick < cooldownExpires) {
    const remainingTicks = cooldownExpires - this.state.currentTick;
    return {
      ok: false,
      reason: "sb_cooldown",
      cooldownRemainingSec: Math.ceil(remainingTicks / 10),
    };
  }

  return { ok: true };
}
```

- [ ] **Step 5: Add `checkSbGates` to `tryRefit` in game-loop.service.ts**

In `apps/server/src/game/game-loop.service.ts`, in the `tryRefit()` method, before `ship.refitTicks = REFIT_TICKS`, add SB gate check:

```typescript
if (shipTypeValue === ShipType.SB) {
  const sbCheck = this.gameService.checkSbGates(
    this.gameService.state.ships.indexOf(ship),
    ship.team,
  );
  if (!sbCheck.ok) return;
}
```

Make `checkSbGates` public so `GameLoopService` can call it. Change `private checkSbGates` to `checkSbGates` in `game.service.ts`.

- [ ] **Step 6: Add SB death cooldown trigger in game loop**

In `checkDeaths()` in `game-loop.service.ts`, when a ship dies and its `shipType === ShipType.SB`, start the cooldown:

```typescript
if (ship.shipType === ShipType.SB) {
  this.gameService.startSbCooldown(ship.team);
}
```

- [ ] **Step 7: Reset cooldowns on game reset**

In the game reset method (search for `resetForNewGame` or `resetGame` in game-loop.service.ts), add:

```typescript
this.gameService.sbCooldownExpiresTick[Team.FEDERATION] = 0;
this.gameService.sbCooldownExpiresTick[Team.ROMULANS] = 0;
```

Make `sbCooldownExpiresTick` public for this.

- [ ] **Step 8: Build and verify**

Run: `npx turbo build --filter=@netrek/server`
Expected: Success.

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/game/game.service.ts apps/server/src/game/game-loop.service.ts
git commit -m "feat(server): add SB restrictions (rank, one-per-team, planets, cooldown)"
```

---

### Task 6: Gateway Returns Rejection Reason + Store Token Stats

**Files:**

- Modify: `apps/server/src/game/game.gateway.ts`

- [ ] **Step 1: Update handleRespawn to return RespawnResult**

Replace the `handleRespawn` method:

```typescript
@SubscribeMessage("respawn")
handleRespawn(
  @ConnectedSocket() client: Socket,
  @MessageBody() data: { shipType: number },
): RespawnResult {
  const player = this.broadcastService.getPlayerBySocketId(client.id);
  if (!player) return { ok: false };

  if (data.shipType < ShipType.SC || data.shipType > ShipType.SB) {
    return { ok: false };
  }

  return this.gameService.respawn(player.slot, data.shipType as ShipType);
}
```

Import `RespawnResult` from `../game.service` (or wherever it's exported).

- [ ] **Step 2: Store token stats on connection**

In `handleConnection`, after `client.data["payload"] = payload`, add:

```typescript
this.gameService.setPlayerTokenStats(slot, {
  totalKills: payload.stats?.totalKills ?? 0,
  planetsTaken: payload.stats?.planetsTaken ?? 0,
  armiesBombed: payload.stats?.armiesBombed ?? 0,
  rank: payload.stats?.rank ?? 0,
});
```

- [ ] **Step 3: Clear token stats on disconnect**

In `handleDisconnect`, after removing the player, add:

```typescript
if (player) {
  this.gameService.clearPlayerStats(player.slot);
}
```

- [ ] **Step 4: Build and verify**

Run: `npx turbo build --filter=@netrek/server`
Expected: Success.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/game/game.gateway.ts
git commit -m "feat(server): return respawn rejection reasons, store token stats"
```

---

### Task 7: Rank in Roster and Player List

**Files:**

- Modify: `apps/server/src/game/game-broadcast.service.ts`
- Modify: `apps/client/components/player-list-panel.tsx`

- [ ] **Step 1: Include rank in roster**

In `apps/server/src/game/game-broadcast.service.ts`, update `getRoster()`. For human players, get the effective rank from `GameService`. For bots, assign rank by difficulty.

Import `rankForDI`, `calculateDI`, and `BotDifficulty` from `@netrek/shared`.

In the human player loop (where `roster[player.slot]` is set), add `rank`:

```typescript
roster[player.slot] = {
  name: player.username,
  team: ship.team,
  shipType: ship.shipType,
  kills: ship.kills,
  rank: this.gameService.getEffectiveRank(player.slot),
};
```

In the bot names loop, add rank based on a simple mapping:

```typescript
const BOT_RANKS: Record<string, number> = {};
// We don't have difficulty info here, so default bots to rank 0 (Ensign)
roster[slot] = {
  name,
  team: ship.team,
  shipType: ship.shipType,
  kills: ship.kills,
  rank: 0,
};
```

- [ ] **Step 2: Update player list to show rank abbreviation**

In `apps/client/components/player-list-panel.tsx`, import `rankAbbrev` from `@netrek/shared` and replace the hardcoded rank:

Change:

```typescript
const rank = "Ens";
```

To:

```typescript
const rank = rankAbbrev(entry?.rank ?? 0);
```

Add import at top:

```typescript
import { rankAbbrev } from "@netrek/shared";
```

- [ ] **Step 3: Build all**

Run: `npx turbo build --filter=@netrek/shared --filter=@netrek/server --filter=@netrek/client`
Expected: Success.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/game/game-broadcast.service.ts apps/client/components/player-list-panel.tsx
git commit -m "feat: show player rank in roster and player list"
```

---

### Task 8: Client Respawn UI with SB Restrictions

**Files:**

- Modify: `apps/client/lib/game/socket.ts`
- Modify: `apps/client/components/game-canvas.tsx`

- [ ] **Step 1: Update sendRespawn to handle response**

In `apps/client/lib/game/socket.ts`, change `sendRespawn` to use a callback and return the server response:

```typescript
export function sendRespawn(
  shipType: number,
  callback: (result: {
    ok: boolean;
    reason?: string;
    cooldownRemainingSec?: number;
  }) => void,
): void {
  if (!socket) return;
  socket.emit("respawn", { shipType }, callback);
}
```

- [ ] **Step 2: Update game-canvas.tsx to handle rejection**

In `apps/client/components/game-canvas.tsx`, update the `handleRespawn` function and add state for rejection:

Add state:

```typescript
const [respawnReject, setRespawnReject] = useState<{
  reason: string;
  cooldownRemainingSec?: number;
} | null>(null);
```

Update handleRespawn:

```typescript
const handleRespawn = (shipType: number) => {
  sendRespawn(shipType, (result) => {
    if (result.ok) {
      respawnedAt.current = Date.now();
      setRespawnReject(null);
      setPhase("playing");
    } else {
      setRespawnReject({
        reason: result.reason ?? "unknown",
        cooldownRemainingSec: result.cooldownRemainingSec,
      });
    }
  });
};
```

- [ ] **Step 3: Update the respawn ship selector UI**

In the respawn overlay in `game-canvas.tsx`, add SB restriction display. Modify the SB button to check `respawnReject` and show the reason. Also add a status line below the buttons:

After the ship buttons map, add:

```typescript
{respawnReject && (
  <p style={{
    color: "#ff4444",
    fontFamily: "monospace",
    fontSize: 12,
    marginTop: 8,
  }}>
    {respawnReject.reason === "rank" && "Requires Commander rank to pilot Starbase"}
    {respawnReject.reason === "sb_active" && "Starbase already active on your team"}
    {respawnReject.reason === "planets" && "Team needs 5+ planets for Starbase"}
    {respawnReject.reason === "sb_cooldown" &&
      `Starbase cooldown: ${Math.floor((respawnReject.cooldownRemainingSec ?? 0) / 60)}:${String((respawnReject.cooldownRemainingSec ?? 0) % 60).padStart(2, "0")}`}
    {respawnReject.reason === "torps" && "Wait for torpedoes to resolve"}
  </p>
)}
```

- [ ] **Step 4: Build client**

Run: `npx turbo build --filter=@netrek/client`
Expected: Success.

- [ ] **Step 5: Commit**

```bash
git add apps/client/lib/game/socket.ts apps/client/components/game-canvas.tsx
git commit -m "feat(client): show SB restriction reasons in respawn UI"
```

---

### Task 9: Wire Client Refit Key

**Files:**

- Modify: `apps/client/lib/game/input.ts`
- Modify: `apps/client/components/game-canvas.tsx`

- [ ] **Step 1: Split `r` and `R` key bindings**

In `apps/client/lib/game/input.ts`, find the case for `"r"` and `"R"` (currently both send `REPAIR_TOGGLE`). Change to:

```typescript
    case "r":
      e.preventDefault();
      sendInput(InputCommand.REFIT, 0);
      break;
    case "R":
      e.preventDefault();
      sendInput(InputCommand.REPAIR_TOGGLE, 0);
      break;
```

Note: `InputCommand.REFIT` sends value 0 as a "start refit" signal. The actual ship type selection needs a UI. For now, sending REFIT with value 0 does nothing server-side (tryRefit validates shipTypeValue). We need to let the player pick a ship type.

The simplest approach: `r` opens a refit overlay (same ship selector as respawn) when the player is orbiting homeworld. The selected ship type is sent as `InputCommand.REFIT` with the ship type as value.

- [ ] **Step 2: Add refit state to game-canvas**

Add state for refit mode in `game-canvas.tsx`:

```typescript
const [showRefit, setShowRefit] = useState(false);
```

Expose a callback from input.ts. In the `handlePanelKeys` function in the useEffect, add:

```typescript
if (e.key === "r") {
  setShowRefit((v) => !v);
}
```

Remove the `"r"` case from the main input handler (since it's now handled in handlePanelKeys for the overlay toggle), and the refit command will be sent when the player clicks a ship button in the refit overlay.

- [ ] **Step 3: Add refit overlay UI**

Add a refit overlay similar to the respawn overlay, but shown while alive. Place it after the help overlay in the JSX:

```typescript
{showRefit && phase === "playing" && (
  <Overlay>
    <div style={{ textAlign: "center" }}>
      <h2 style={{ color: "#fff", marginBottom: 20, fontFamily: "monospace" }}>
        REFIT — Select Ship (orbit homeworld)
      </h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
        {SHIPS.map((ship) => (
          <button
            key={ship.type}
            onClick={() => {
              sendInput(InputCommand.REFIT, ship.type);
              setShowRefit(false);
            }}
            style={{
              background: "#222",
              color: "#fff",
              border: "1px solid #444",
              padding: "6px 24px",
              fontFamily: "monospace",
              fontSize: 14,
              cursor: "pointer",
              width: 200,
            }}
          >
            [{ship.key}] {ship.name}
          </button>
        ))}
      </div>
      <p style={{ color: "#555", fontFamily: "monospace", fontSize: 12, marginTop: 12 }}>
        Press r to cancel
      </p>
    </div>
  </Overlay>
)}
```

Import `sendInput` from `@/lib/game/input` (or directly use the socket send). Ensure `InputCommand` is imported from `@netrek/shared`.

- [ ] **Step 4: Add refit to help overlay**

In the help overlay, add a row in the appropriate section:

```typescript
<HelpRow k="r" desc="Refit ship (orbit homeworld)" />
```

- [ ] **Step 5: Build and verify**

Run: `npx turbo build --filter=@netrek/client`
Expected: Success.

- [ ] **Step 6: Commit**

```bash
git add apps/client/lib/game/input.ts apps/client/components/game-canvas.tsx
git commit -m "feat(client): add refit key (r) with ship selector overlay"
```

---

### Task 10: Wire Session Stats to GameService for Rank Updates

**Files:**

- Modify: `apps/server/src/game/game-loop.service.ts`

The game loop already calls `statReporter.recordKill()` etc. (from Task 3). Now we also need to update `gameService.recordSessionKill()` etc. so that in-game rank computation works.

- [ ] **Step 1: Add session stat recording alongside stat reporter calls**

In `checkDeaths()`, alongside the `statReporter.recordKill()` call, add:

```typescript
if (ship.lastDamagedBySlot >= 0) {
  this.gameService.recordSessionKill(ship.lastDamagedBySlot);
}
```

(Session stats track by slot, not userId, so no bot check needed — bots don't have token stats so `getEffectiveRank` returns 0 for them anyway.)

In `updateBombing()`, alongside the `statReporter.recordArmiesBombed()` call:

```typescript
this.gameService.recordSessionArmiesBombed(/* slot index of the bombing ship */);
```

In `updateBeaming()`, at planet capture:

```typescript
this.gameService.recordSessionPlanetTaken(/* slot index */);
```

- [ ] **Step 2: Build and verify**

Run: `npx turbo build --filter=@netrek/server`
Expected: Success.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/game/game-loop.service.ts
git commit -m "feat(server): update session stats for in-game rank progression"
```

---

### Task 11: Full Build Verification

**Files:** None (verification only)

- [ ] **Step 1: Build all packages**

Run: `npx turbo build`
Expected: All packages build successfully.

- [ ] **Step 2: Run existing tests**

Run: `npx turbo test` (or the project's test command)
Expected: All existing tests pass. New features don't break existing behavior.

- [ ] **Step 3: Manual smoke test**

Start the server and client. Verify:

1. Player list shows "Ens" for all players (default rank)
2. Attempting to respawn as SB returns a rejection with reason "rank"
3. Refit overlay opens with `r` key, closes with `r` again
4. `R` (shift) still toggles repair mode
5. Bot kills/deaths don't cause crashes in stat recording

- [ ] **Step 4: Commit any fixes**

If any build or test issues are found, fix and commit.

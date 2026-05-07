# Ranks & Starbase Restrictions — Design Spec

## Goal

Add a rank progression system based on cumulative DI (Destruction Index), gate Starbase access behind rank/team/cooldown requirements, and wire game stats so ranks actually progress.

## Scope

This spec covers:

1. Rank definitions and DI formula (shared package)
2. Stat wiring (game server → stat reporter → backend)
3. Backend rank recalculation on stat ingest
4. SB restrictions (4 gates) with server enforcement
5. Rank in roster and player list display
6. In-game rank updates without reconnecting

This spec does NOT cover: SB docking, plasma torpedoes, stats UI pages, or respawn delay.

---

## 1. Rank Definitions

Nine ranks, defined in `packages/shared/src/game/ranks.ts`:

| Rank | Title         | Abbreviation | DI Threshold |
| ---- | ------------- | ------------ | ------------ |
| 0    | Ensign        | Ens          | 0            |
| 1    | Lieutenant    | Lt           | 2            |
| 2    | Lt. Commander | LtC          | 6            |
| 3    | Commander     | Cdr          | 12           |
| 4    | Captain       | Cpt          | 20           |
| 5    | Fl. Captain   | FCp          | 30           |
| 6    | Commodore     | Com          | 45           |
| 7    | Rear Admiral  | RAd          | 65           |
| 8    | Admiral       | Adm          | 90           |

Commander (rank 3, DI 12) is the minimum rank to pilot a Starbase.

### DI Formula

```
DI = planetsTaken + (armiesBombed / 10) + (kills / 4)
```

Cumulative, never decreases. No hours-played divisor.

### Shared Functions

- `calculateDI(stats: { planetsTaken: number; armiesBombed: number; kills: number }): number`
- `rankForDI(di: number): number` — returns rank index (0-8)
- `RANK_DEFS: Array<{ title: string; abbrev: string; diThreshold: number }>` — the table above
- `rankTitle(rank: number): string`
- `rankAbbrev(rank: number): string`

All pure functions, no side effects. Exported from `@netrek/shared`.

---

## 2. Stat Wiring

### Problem

The `StatReporterService` exists and pushes to the backend every 60 seconds, but kill/death events from the game loop are not being recorded.

### Solution

Add a `SessionStats` class in the game server that accumulates per-slot deltas:

```typescript
interface SlotStats {
  kills: number;
  deaths: number;
  planetsTaken: number;
  armiesBombed: number;
  armiesBeamed: number;
  secondsPlayed: number;
}
```

**Event sources → SessionStats:**

| Game Event                                                                     | Stat Field             |
| ------------------------------------------------------------------------------ | ---------------------- |
| `GAME_KILL_EVENT` (killer side)                                                | `kills++`              |
| `GAME_KILL_EVENT` (victim side)                                                | `deaths++`             |
| Planet capture (in `updateBeaming`, when `planet.team` changes to `ship.team`) | `planetsTaken++`       |
| Bomb tick (in `updateBombing`, each army killed)                               | `armiesBombed++`       |
| Beam up tick (in `updateBeaming`, each army transferred)                       | `armiesBeamed++`       |
| Per-tick for connected players                                                 | `secondsPlayed += 0.1` |

The `SessionStats` is an `@Injectable()` service, injected into both the game loop (to record events) and the stat reporter (to read and reset deltas). It is also injected into `GameBroadcastService` to compute effective rank for the roster.

The stat reporter reads the `SessionStats` map on each 60-second push, sends the deltas to the backend, and resets the deltas to zero.

### Standalone Mode

When no backend URL is configured, stats accumulate in `SessionStats` for the session. The game server computes rank locally using the DI formula so ranks can update mid-game. Nothing persists after the server restarts.

---

## 3. Backend Rank Recalculation

On stat ingest (`POST /stats/ingest`), after updating `PlayerStats` totals, the backend recalculates:

```typescript
const di = calculateDI({
  planetsTaken: stats.planetsTaken,
  armiesBombed: stats.armiesBombed,
  kills: stats.totalKills,
});
stats.rank = rankForDI(di);
```

The next game token issued for this player will carry the updated rank.

---

## 4. Starbase Restrictions

Four gates checked in order at respawn time. The first failing gate is returned as the rejection reason.

### Gate 1: Rank

Player must be Commander (rank 3+).

**Source of rank**: The game server computes the player's current rank from:

- Initial stats from game token (`payload.stats`)
- Plus session stats accumulated during the current game

This means a player who reaches Commander mid-game can grab SB immediately without reconnecting.

### Gate 2: One Per Team

No alive ship with `shipType === ShipType.SB` may exist on the player's team. Checked against `gameState.ships`.

An SB that is currently EXPLODING still counts as blocking — the new SB can only be claimed after the explosion finishes and the ship transitions to DEAD.

### Gate 3: Team Planets

The player's team must own >= 5 planets. Checked against `gameState.planets`.

### Gate 4: Team Cooldown

A 30-minute team-wide cooldown starts when a team's SB dies (transitions to DEAD status). Tracked as `sbCooldownExpiresTick` per team on the game server.

- Cooldown duration: 18000 ticks (30 minutes at 10Hz)
- Cleared on game reset
- Per-team, not per-player: if the SB pilot disconnects and someone else wants SB, the cooldown still applies

### Server Response

`respawn()` returns `{ ok: boolean; reason?: string }`. Current reasons:

- `"rank"` — insufficient rank
- `"sb_active"` — team already has an SB
- `"planets"` — team owns < 5 planets
- `"sb_cooldown"` — SB cooldown active (include `cooldownRemainingSec` in response)
- `"torps"` — existing reason: in-flight torps

### Client Handling

The respawn UI receives the rejection and displays the SB button accordingly:

- Greyed out with reason text below it
- If cooldown, show countdown timer (updated locally, no server polling needed — client knows the remaining seconds from the rejection response)
- Client can re-request respawn as SB; the server re-checks all gates each time

---

## 5. Roster & Player List

### Roster Changes

Add `rank: number` to `RosterEntry` in `chat-types.ts`. The `getRoster()` method in `GameBroadcastService` includes the rank:

- For human players: compute from game token stats + session stats
- For bots: assign based on difficulty (NEWBIE=0 Ensign, COMPETENT=2 Lt.Commander, VETERAN=4 Captain)

### Player List Display

Replace the hardcoded `"Ens"` in `player-list-panel.tsx` with `rankAbbrev(entry.rank)`.

---

## 6. In-Game Rank Updates

When session stats change (kill, planet take, etc.), the game server recomputes the player's effective rank:

```
effectiveRank = rankForDI(calculateDI(tokenStats + sessionStats))
```

This is included in the periodic roster broadcast (already happens every 5 seconds). No special event needed — the roster update naturally propagates rank changes to all clients.

---

## Files Modified

| File                                             | Change                                                |
| ------------------------------------------------ | ----------------------------------------------------- |
| `packages/shared/src/game/ranks.ts`              | NEW — rank definitions, DI formula, helper functions  |
| `packages/shared/src/game/index.ts`              | Export ranks module                                   |
| `packages/shared/src/game/chat-types.ts`         | Add `rank` to `RosterEntry`                           |
| `apps/server/src/game/state/session-stats.ts`    | NEW — per-slot stat accumulation                      |
| `apps/server/src/game/game-loop.service.ts`      | Emit stat events for kills, planets, bombing, beaming |
| `apps/server/src/game/stat-reporter.service.ts`  | Read SessionStats, include kill/death deltas          |
| `apps/server/src/game/game.service.ts`           | SB gate checks in `respawn()`, SB cooldown tracking   |
| `apps/server/src/game/game-broadcast.service.ts` | Include rank in roster                                |
| `apps/server/src/game/game.gateway.ts`           | Return rejection reason from respawn handler          |
| `apps/backend/src/stats/stats.service.ts`        | Recalculate rank on ingest                            |
| `apps/client/components/player-list-panel.tsx`   | Show rank abbreviation from roster                    |
| `apps/client/components/game-canvas.tsx`         | Handle respawn rejection, show SB restrictions in UI  |

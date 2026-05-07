# UX & Polish for Beta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add stats visibility (profile page + lobby badge), respawn delay, and missing sound effects so the game feels complete for beta playtesting.

**Architecture:** Backend `GET /stats/me` endpoint exposes player stats via existing JWT auth. Client profile page and lobby badge consume this endpoint using shared rank functions for DI/rank display. Respawn delay is server-enforced via `deathTick` on `ShipState`, with client countdown UI. Sound triggers are added to existing `processSounds()` frame-diff system.

**Tech Stack:** TypeScript, NestJS (backend), Next.js (client), Prisma ORM, Web Audio API, Socket.IO

---

### Task 1: Backend `GET /stats/me` Endpoint

**Files:**

- Modify: `apps/backend/src/stats/stats.controller.ts`
- Modify: `apps/backend/src/stats/stats.service.ts`

- [ ] **Step 1: Add `getMyStats()` method to StatsService**

In `apps/backend/src/stats/stats.service.ts`, add a new method after `getPlayerStats()`:

```typescript
  async getMyStats(userId: string) {
    const stats = await this.prisma.playerStats.findUnique({
      where: { userId_serverId: { userId, serverId: "official" } },
    });
    if (!stats) {
      return {
        totalKills: 0,
        totalDeaths: 0,
        totalWins: 0,
        totalLosses: 0,
        planetsTaken: 0,
        armiesBombed: 0,
        armiesBeamed: 0,
        secondsPlayed: 0,
        rank: 0,
      };
    }
    return stats;
  }
```

- [ ] **Step 2: Add `GET /stats/me` endpoint to StatsController**

In `apps/backend/src/stats/stats.controller.ts`, add imports and the new endpoint.

Add to imports:

```typescript
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { User } from "../auth/decorators/user.decorator";
import { AuthUser } from "../auth/types/jwt.types";
```

Add the endpoint after the existing `getLeaderboard` method:

```typescript
  @Get("me")
  @UseGuards(JwtAuthGuard)
  getMyStats(@User() user: AuthUser) {
    return this.statsService.getMyStats(user.id);
  }
```

**Important:** This endpoint must be defined BEFORE any parameterized routes like `GET :serverId` to avoid NestJS routing conflicts. Place it after `getLeaderboard` but confirm there are no wildcard param routes that would match "me".

- [ ] **Step 3: Build backend**

Run: `npx turbo build --filter=@netrek/backend`
Expected: Success.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/stats/stats.controller.ts apps/backend/src/stats/stats.service.ts
git commit -m "feat(backend): add GET /stats/me endpoint for player stats"
```

---

### Task 2: Stats Profile Page

**Files:**

- Create: `apps/client/app/profile/page.tsx`

- [ ] **Step 1: Create the profile page**

Create `apps/client/app/profile/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api/client";
import { calculateDI, rankForDI, rankTitle, RANK_DEFS } from "@netrek/shared";

interface PlayerStats {
  totalKills: number;
  totalDeaths: number;
  totalWins: number;
  totalLosses: number;
  planetsTaken: number;
  armiesBombed: number;
  armiesBeamed: number;
  secondsPlayed: number;
  rank: number;
}

export default function ProfilePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/auth/signin");
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    apiFetch<PlayerStats>("/stats/me")
      .then(setStats)
      .catch((e) => setError((e as Error).message));
  }, [user]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-900">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (!user) return null;

  const di = stats
    ? calculateDI({
        planetsTaken: stats.planetsTaken,
        armiesBombed: stats.armiesBombed,
        kills: stats.totalKills,
      })
    : 0;
  const currentRank = stats ? rankForDI(di) : 0;
  const nextRank = currentRank < RANK_DEFS.length - 1 ? currentRank + 1 : null;
  const nextThreshold =
    nextRank !== null ? RANK_DEFS[nextRank]!.diThreshold : null;
  const currentThreshold = RANK_DEFS[currentRank]!.diThreshold;
  const progressPct =
    nextThreshold !== null && nextThreshold > currentThreshold
      ? ((di - currentThreshold) / (nextThreshold - currentThreshold)) * 100
      : 100;

  const kd =
    stats && stats.totalDeaths > 0
      ? (stats.totalKills / stats.totalDeaths).toFixed(2)
      : stats
        ? stats.totalKills.toFixed(2)
        : "0.00";

  const hours = stats ? Math.floor(stats.secondsPlayed / 3600) : 0;
  const minutes = stats ? Math.floor((stats.secondsPlayed % 3600) / 60) : 0;

  return (
    <div className="min-h-screen bg-gray-900 text-gray-300">
      <div className="mx-auto max-w-2xl px-4 py-10">
        <a
          href="/lobby"
          className="text-sm text-gray-500 hover:text-yellow-500 transition-colors"
        >
          &larr; Back to Lobby
        </a>

        <div className="mt-6 rounded border border-gray-700 bg-gray-800/50 p-6 font-mono">
          <h1 className="text-lg text-yellow-400 mb-4">PLAYER PROFILE</h1>

          <div className="text-gray-100 text-lg">{user.name}</div>
          <div className="text-gray-400 text-sm">
            Rank: {rankTitle(currentRank)} ({currentRank})
          </div>
          <div className="text-gray-400 text-sm">DI: {di.toFixed(2)}</div>

          {error && (
            <div className="mt-4 text-red-400 text-sm">
              Failed to load stats: {error}
            </div>
          )}

          {/* Progress bar */}
          {nextRank !== null && nextThreshold !== null && (
            <div className="mt-4">
              <div className="text-gray-500 text-xs mb-1">
                Progress to {rankTitle(nextRank)}
              </div>
              <div className="h-4 bg-gray-700 rounded overflow-hidden">
                <div
                  className="h-full bg-yellow-500"
                  style={{ width: `${Math.min(progressPct, 100)}%` }}
                />
              </div>
              <div className="text-gray-500 text-xs mt-1">
                {di.toFixed(1)} / {nextThreshold}
              </div>
            </div>
          )}

          {/* Career stats */}
          {stats && (
            <div className="mt-6">
              <h2 className="text-yellow-400 text-sm mb-2">CAREER STATS</h2>
              <div className="border-t border-gray-700 pt-2 space-y-1 text-sm">
                <StatRow label="Kills" value={stats.totalKills.toString()} />
                <StatRow label="Deaths" value={stats.totalDeaths.toString()} />
                <StatRow label="K/D Ratio" value={kd} />
                <StatRow
                  label="Planets Taken"
                  value={stats.planetsTaken.toString()}
                />
                <StatRow
                  label="Armies Bombed"
                  value={stats.armiesBombed.toString()}
                />
                <StatRow
                  label="Armies Beamed"
                  value={stats.armiesBeamed.toString()}
                />
                <StatRow label="Time Played" value={`${hours}h ${minutes}m`} />
                <StatRow label="Games Won" value={stats.totalWins.toString()} />
                <StatRow
                  label="Games Lost"
                  value={stats.totalLosses.toString()}
                />
              </div>
            </div>
          )}

          {/* Rank ladder */}
          <div className="mt-6">
            <h2 className="text-yellow-400 text-sm mb-2">RANK LADDER</h2>
            <div className="border-t border-gray-700 pt-2 space-y-1 text-sm">
              {RANK_DEFS.map((def, i) => {
                const achieved = i <= currentRank;
                const isCurrent = i === currentRank;
                return (
                  <div
                    key={i}
                    className={`flex items-center gap-2 ${isCurrent ? "text-yellow-400" : achieved ? "text-green-500" : "text-gray-600"}`}
                  >
                    <span className="w-4">
                      {isCurrent ? "►" : achieved ? "✓" : " "}
                    </span>
                    <span className="w-32">{def.title}</span>
                    <span>{def.diThreshold} DI</span>
                    {isCurrent && (
                      <span className="text-gray-500 ml-2">&larr; YOU</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex">
      <span className="text-gray-500 w-40">{label}:</span>
      <span className="text-gray-300">{value}</span>
    </div>
  );
}
```

- [ ] **Step 2: Build client**

Run: `npx turbo build --filter=@netrek/client`
Expected: Success. The `/profile` route should appear in the build output.

- [ ] **Step 3: Commit**

```bash
git add apps/client/app/profile/page.tsx
git commit -m "feat(client): add stats profile page with rank ladder"
```

---

### Task 3: Stats Badge in Lobby

**Files:**

- Create: `apps/client/components/stats-badge.tsx`
- Modify: `apps/client/app/lobby/[id]/page.tsx`

- [ ] **Step 1: Create the stats badge component**

Create `apps/client/components/stats-badge.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import { calculateDI, rankAbbrev, rankForDI } from "@netrek/shared";
import Link from "next/link";

interface PlayerStats {
  totalKills: number;
  totalDeaths: number;
  planetsTaken: number;
  armiesBombed: number;
}

export default function StatsBadge({ username }: { username: string }) {
  const [stats, setStats] = useState<PlayerStats | null>(null);

  useEffect(() => {
    apiFetch<PlayerStats>("/stats/me")
      .then(setStats)
      .catch(() => {});
  }, []);

  if (!stats) return null;

  const di = calculateDI({
    planetsTaken: stats.planetsTaken,
    armiesBombed: stats.armiesBombed,
    kills: stats.totalKills,
  });
  const rank = rankForDI(di);
  const kd =
    stats.totalDeaths > 0
      ? (stats.totalKills / stats.totalDeaths).toFixed(2)
      : stats.totalKills.toFixed(2);

  return (
    <Link href="/profile">
      <div className="rounded border border-gray-700 bg-gray-800/50 px-3 py-2 font-mono text-sm hover:border-yellow-600 transition-colors cursor-pointer">
        <div className="text-gray-200">
          {rankAbbrev(rank)} {username}
        </div>
        <div className="text-gray-500 text-xs">
          DI: {di.toFixed(2)} | K/D: {kd}
        </div>
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: Add stats badge to the lobby page**

In `apps/client/app/lobby/[id]/page.tsx`, add the import at the top:

```typescript
import StatsBadge from "@/components/stats-badge";
```

In the JSX, add the badge after the "Back to Server Browser" link (after line 128's closing `</a>`) and before the `fetchError` block:

```tsx
{
  /* Stats badge */
}
{
  user && (
    <div className="mt-4">
      <StatsBadge username={user.name} />
    </div>
  );
}
```

- [ ] **Step 3: Build client**

Run: `npx turbo build --filter=@netrek/client`
Expected: Success.

- [ ] **Step 4: Commit**

```bash
git add apps/client/components/stats-badge.tsx apps/client/app/lobby/[id]/page.tsx
git commit -m "feat(client): add stats badge to lobby page"
```

---

### Task 4: Add `deathTick` to ShipState

**Files:**

- Modify: `packages/shared/src/game/types.ts`
- Modify: `packages/shared/src/game/constants.ts`
- Modify: `apps/server/src/game/state/game-state.ts`

- [ ] **Step 1: Add `RESPAWN_DELAY_TICKS` constant**

In `packages/shared/src/game/constants.ts`, add after the existing `EXPLOSION_DURATION_TICKS` line (line 63):

```typescript
export const RESPAWN_DELAY_TICKS = 30; // 3 seconds at 10Hz
```

- [ ] **Step 2: Add `deathTick` to ShipState interface**

In `packages/shared/src/game/types.ts`, after `explodeTicks: number;` (line 177), add:

```typescript
deathTick: number;
```

- [ ] **Step 3: Initialize `deathTick` in game-state.ts**

In `apps/server/src/game/state/game-state.ts`, in the `createShip()` function, after `explodeTicks: 0,` (line 62), add:

```typescript
    deathTick: 0,
```

In the `initShip()` method, after `ship.explodeTicks = 0;` (line 203), add:

```typescript
ship.deathTick = 0;
```

- [ ] **Step 4: Build shared and server**

Run: `npx turbo build --filter=@netrek/shared --filter=@netrek/server`
Expected: Success.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/game/types.ts packages/shared/src/game/constants.ts apps/server/src/game/state/game-state.ts
git commit -m "feat(shared): add deathTick to ShipState and RESPAWN_DELAY_TICKS constant"
```

---

### Task 5: Server-Side Respawn Delay

**Files:**

- Modify: `apps/server/src/game/game-loop.service.ts`
- Modify: `apps/server/src/game/game.service.ts`

- [ ] **Step 1: Set `deathTick` when ship transitions to DEAD**

In `apps/server/src/game/game-loop.service.ts`, in `updateExplosions()`, when `ship.status` is set to `ShipStatus.DEAD` (line 1462), add the death tick recording.

Change:

```typescript
ship.status = ShipStatus.DEAD;
```

To:

```typescript
ship.status = ShipStatus.DEAD;
ship.deathTick = state.currentTick;
```

- [ ] **Step 2: Add respawn delay check in GameService**

In `apps/server/src/game/game.service.ts`, add `RESPAWN_DELAY_TICKS` to the import from `@netrek/shared`:

```typescript
import {
  Team,
  ShipType,
  ShipStatus,
  PLANET_DEFS,
  SB_MIN_RANK,
  calculateDI,
  rankForDI,
  RESPAWN_DELAY_TICKS,
} from "@netrek/shared";
```

In the `respawn()` method, after the torp check block (after line 118 — the closing `}` of the for-loop), add the delay check before the SB gates:

```typescript
// Check respawn delay
if (ship.deathTick > 0) {
  const elapsed = this.state.currentTick - ship.deathTick;
  if (elapsed < RESPAWN_DELAY_TICKS) {
    const remainingTicks = RESPAWN_DELAY_TICKS - elapsed;
    return {
      ok: false,
      reason: "respawn_delay",
      remainingSec: remainingTicks / 10,
    };
  }
}
```

Note: The `RespawnResult` interface needs a `remainingSec` field. Currently it has `cooldownRemainingSec`. We need to add `remainingSec` as an optional field.

In the `RespawnResult` interface (around line 17-21), add:

```typescript
export interface RespawnResult {
  ok: boolean;
  reason?: string;
  cooldownRemainingSec?: number;
  remainingSec?: number;
}
```

- [ ] **Step 3: Build server**

Run: `npx turbo build --filter=@netrek/server`
Expected: Success.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/game/game-loop.service.ts apps/server/src/game/game.service.ts
git commit -m "feat(server): enforce 3-second respawn delay after death"
```

---

### Task 6: Client Respawn Delay Countdown

**Files:**

- Modify: `apps/client/components/game-canvas.tsx`

- [ ] **Step 1: Add countdown state and timer**

In `apps/client/components/game-canvas.tsx`, add state for the countdown near the other state declarations (after `respawnReject` state):

```typescript
const [respawnCountdown, setRespawnCountdown] = useState<number>(0);
```

- [ ] **Step 2: Start countdown when entering dead phase**

In the `onState` callback, where `setPhase("dead")` is called, also start the countdown:

Change:

```typescript
setPhase("dead");
setRespawnReject(null);
```

To:

```typescript
setPhase("dead");
setRespawnReject(null);
setRespawnCountdown(3);
```

- [ ] **Step 3: Tick down the countdown**

Add a useEffect after the main useEffect that decrements the countdown:

```typescript
useEffect(() => {
  if (respawnCountdown <= 0) return;
  const timer = setTimeout(() => {
    setRespawnCountdown((v) => Math.max(0, v - 1));
  }, 1000);
  return () => clearTimeout(timer);
}, [respawnCountdown]);
```

- [ ] **Step 4: Update handleRespawn to handle respawn_delay rejection**

The existing `handleRespawn` already handles rejections. The server now returns `reason: "respawn_delay"` with `remainingSec`. Update the `handleRespawn` function to also handle this — when the server sends back `respawn_delay`, update the countdown from the server's `remainingSec`:

In the rejection branch of `handleRespawn`, after setting `setRespawnReject(...)`, also update countdown if it's a delay rejection:

```typescript
sendRespawn(shipType, (result) => {
  if (result.ok) {
    respawnedAt.current = Date.now();
    setRespawnReject(null);
    setRespawnCountdown(0);
    setPhase("playing");
  } else if (result.reason === "respawn_delay") {
    setRespawnCountdown(Math.ceil(result.remainingSec ?? 0));
  } else {
    setRespawnReject({
      reason: result.reason ?? "unknown",
      cooldownRemainingSec: result.cooldownRemainingSec,
    });
  }
});
```

Update the `sendRespawn` callback type to include `remainingSec`. The socket.ts `sendRespawn` callback type already accepts any extra fields from the server, so this should work. But verify the callback type in `socket.ts` includes `remainingSec`:

In `apps/client/lib/game/socket.ts`, update the callback parameter type:

```typescript
export function sendRespawn(
  shipType: number,
  callback?: (result: {
    ok: boolean;
    reason?: string;
    cooldownRemainingSec?: number;
    remainingSec?: number;
  }) => void,
): void {
```

- [ ] **Step 5: Disable ship buttons during countdown and show timer**

In the respawn overlay JSX, disable the ship buttons when countdown > 0. Modify the button's `disabled` prop and `onClick`:

Change each ship button:

```tsx
<button
  key={ship.type}
  onClick={() => handleRespawn(ship.type)}
  disabled={respawnCountdown > 0}
  style={{
    background: respawnCountdown > 0 ? "#111" : "#222",
    color: respawnCountdown > 0 ? "#555" : "#fff",
    border: "1px solid #444",
    padding: "6px 24px",
    fontFamily: "monospace",
    fontSize: 14,
    cursor: respawnCountdown > 0 ? "not-allowed" : "pointer",
    width: 200,
  }}
>
  [{ship.key}] {ship.name}
</button>
```

Add a countdown display above the buttons. Before the ship buttons container div, add:

```tsx
{
  respawnCountdown > 0 && (
    <p
      style={{
        color: "#ffff00",
        fontFamily: "monospace",
        fontSize: 16,
        marginBottom: 12,
      }}
    >
      Respawn in {respawnCountdown}...
    </p>
  );
}
```

- [ ] **Step 6: Build client**

Run: `npx turbo build --filter=@netrek/client`
Expected: Success.

- [ ] **Step 7: Commit**

```bash
git add apps/client/components/game-canvas.tsx apps/client/lib/game/socket.ts
git commit -m "feat(client): add 3-second respawn countdown with disabled buttons"
```

---

### Task 7: Tractor Beam Sound

**Files:**

- Modify: `apps/client/lib/game/sound.ts`

- [ ] **Step 1: Add `nt_tractor` to SOUNDS array and tracking variable**

In `apps/client/lib/game/sound.ts`, add `"nt_tractor"` to the SOUNDS array (after `"nt_red_alert"`):

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
] as const;
```

Add a tracking variable after `let prevAlertStatus = AlertStatus.GREEN;` (line 16):

```typescript
let prevTractoring = false;
```

- [ ] **Step 2: Add tractor beam sound trigger in processSounds()**

At the end of `processSounds()`, before the closing brace, after the alert status change block, add:

```typescript
// --- Tractor beam start (own ship only) ---
if (myShip.tractoring && !prevTractoring) {
  play("nt_tractor", 0.5);
}
prevTractoring = myShip.tractoring;
```

Note: This must be inside the `if (myShip)` block that already wraps the shield and alert logic.

- [ ] **Step 3: Reset tracking in resetSound()**

In `resetSound()`, add:

```typescript
prevTractoring = false;
```

- [ ] **Step 4: Build client**

Run: `npx turbo build --filter=@netrek/client`
Expected: Success. Note: The `nt_tractor.wav` file does not exist in `apps/client/public/sounds/` yet. The sound loading fails silently (the `loadSound` function catches errors), so the code will work but no sound will play until the WAV file is provided.

- [ ] **Step 5: Commit**

```bash
git add apps/client/lib/game/sound.ts
git commit -m "feat(client): wire tractor beam sound trigger"
```

---

### Task 8: Enter Ship Sound

**Files:**

- Modify: `apps/client/components/game-canvas.tsx`
- Modify: `apps/client/lib/game/sound.ts`

- [ ] **Step 1: Export a `playSound` function from sound.ts**

In `apps/client/lib/game/sound.ts`, the `play()` function is currently private. Add a public wrapper that game-canvas can call:

After `resumeAudio()`, add:

```typescript
export function playSound(name: string, volume = 0.5): void {
  play(name as SoundName, volume);
}
```

- [ ] **Step 2: Play enter ship sound on join**

In `apps/client/components/game-canvas.tsx`, add `playSound` to the sound imports:

```typescript
import {
  initSound,
  resumeAudio,
  processSounds,
  resetSound,
  playSound,
} from "@/lib/game/sound";
```

In the `onJoined` callback (around line 142), add the sound:

Change:

```typescript
onJoined((data) => {
  setMySlot(data.slot);
  setPhase("playing");
});
```

To:

```typescript
onJoined((data) => {
  setMySlot(data.slot);
  setPhase("playing");
  playSound("nt_enter_ship", 0.6);
});
```

- [ ] **Step 3: Build client**

Run: `npx turbo build --filter=@netrek/client`
Expected: Success.

- [ ] **Step 4: Commit**

```bash
git add apps/client/lib/game/sound.ts apps/client/components/game-canvas.tsx
git commit -m "feat(client): play enter ship sound on game join"
```

---

### Task 9: Full Build Verification

**Files:** None (verification only)

- [ ] **Step 1: Build all packages**

Run: `npx turbo build`
Expected: All packages build successfully.

- [ ] **Step 2: Verify no type errors**

Run: `npx turbo build --filter=@netrek/shared --filter=@netrek/server --filter=@netrek/backend --filter=@netrek/client`
Expected: 4/4 tasks successful, 0 errors.

- [ ] **Step 3: Manual smoke test checklist**

Start the server and client. Verify:

1. `/profile` page loads and shows rank ladder, career stats, progress bar
2. Lobby page shows stats badge with rank abbreviation, DI, and K/D
3. Clicking stats badge navigates to `/profile`
4. After dying, ship buttons are disabled for 3 seconds with countdown "Respawn in 3... 2... 1..."
5. Trying to click a disabled button during countdown does nothing
6. After countdown, clicking a ship button respawns normally
7. Tractor beam activation plays sound (if WAV file exists)
8. Joining the game plays the enter ship sound

- [ ] **Step 4: Commit any fixes**

If any build or test issues are found, fix and commit.

# UX & Polish for Beta — Design Spec

## Goal

Add stats visibility (profile page + lobby badge), respawn delay, and missing sound effects to make the game feel complete for beta playtesting.

## Dependencies

- Ranks spec must be implemented first (stats pages display rank and DI).

---

## 1. Stats Profile Page

### Route: `/profile`

Accessible from the lobby navigation. Shows the authenticated player's lifetime stats and rank.

### Layout

```
┌──────────────────────────────────────┐
│  PLAYER PROFILE                      │
│                                      │
│  djgrahammorley                      │
│  Rank: Commander (3)                 │
│  DI: 14.50                           │
│                                      │
│  ┌─ Progress to Captain ──────────┐  │
│  │ ████████████░░░░░░░░░  14.5/20 │  │
│  └────────────────────────────────┘  │
│                                      │
│  CAREER STATS                        │
│  ─────────────────────────────       │
│  Kills:          58                  │
│  Deaths:         32                  │
│  K/D Ratio:      1.81               │
│  Planets Taken:  12                  │
│  Armies Bombed:  45                  │
│  Armies Beamed:  28                  │
│  Time Played:    3h 22m             │
│  Games Won:      5                  │
│  Games Lost:     3                  │
│                                      │
│  RANK LADDER                         │
│  ─────────────────────────────       │
│  ✓ Ensign          0 DI             │
│  ✓ Lieutenant      2 DI             │
│  ✓ Lt. Commander   6 DI             │
│  ► Commander      12 DI  ← YOU      │
│    Captain        20 DI             │
│    Fl. Captain    30 DI             │
│    Commodore      45 DI             │
│    Rear Admiral   65 DI             │
│    Admiral        90 DI             │
└──────────────────────────────────────┘
```

### Data Source

Backend API endpoint: `GET /stats/me` (authenticated via existing JWT session cookie, same auth as other backend routes). Returns the player's `PlayerStats` for the "official" server scope. The shared `calculateDI()` and `rankForDI()` functions are used client-side for display calculations (progress bar, next rank threshold).

### Styling

Monospace font, dark background, matching the game's retro aesthetic. Use the existing `@netrek/ui` components where possible (card, progress bar).

---

## 2. Stats Badge in Lobby

### Location

On the server browser / lobby page, show a compact stats summary for the logged-in player. Positioned in the header or sidebar.

### Layout

```
┌────────────────────────┐
│ Cdr djgrahammorley     │
│ DI: 14.50 | K/D: 1.81  │
└────────────────────────┘
```

One line: rank abbreviation + username. Second line: DI and K/D ratio. Clicking it navigates to `/profile`.

### Data Source

Same `GET /stats/me` endpoint, fetched on lobby page load. Cached in React state — no polling.

---

## 3. Respawn Delay

### Problem

Currently players respawn instantly after death, allowing rapid suicide tactics and reducing the penalty for dying.

### Mechanics

**Delay:** 3 seconds (30 ticks) after ship transitions to DEAD before the player can respawn.

**Server enforcement:** `respawn()` checks `ship.deathTick` against `currentTick`. If fewer than 30 ticks have elapsed, reject with reason `"respawn_delay"` and include `remainingSec` in the response.

**Client UX:** The respawn ship selector appears immediately on death (so the player can choose their ship) but the buttons are disabled for 3 seconds with a countdown: "Respawn in 3... 2... 1..."

**Implementation:**

- Add `deathTick: number` to `ShipState` (set when ship dies in `checkDeaths()`)
- Check `currentTick - ship.deathTick >= 30` in `respawn()`
- Client receives `{ ok: false, reason: "respawn_delay", remainingSec: 2.1 }` and shows countdown

---

## 4. Missing Sound Effects

### Tractor Beam Sound

The sound `nt_tractor` is already loaded but never triggered. Wire it to play when the local player's ship starts tractoring (`tractoring` transitions from false to true in state).

### Enter Ship Sound

The sound `nt_enter_ship` is already loaded but never triggered. Play it when the player first joins the game (on the `"joined"` socket event).

### Implementation

Both sounds just need trigger points added in `sound.ts`'s `processSounds()` function (tractor) and in `game-canvas.tsx` (enter ship — on the `onJoined` callback).

---

## Files Modified

| File                                         | Change                                          |
| -------------------------------------------- | ----------------------------------------------- |
| `apps/client/app/profile/page.tsx`           | NEW — stats profile page                        |
| `apps/client/app/lobby/[id]/page.tsx`        | Add stats badge component                       |
| `apps/client/components/stats-badge.tsx`     | NEW — compact stats display for lobby           |
| `apps/backend/src/stats/stats.controller.ts` | Add `GET /stats/me` endpoint                    |
| `apps/backend/src/stats/stats.service.ts`    | Add method to fetch player's own stats          |
| `apps/server/src/game/game.service.ts`       | Check respawn delay, set deathTick              |
| `apps/server/src/game/game-loop.service.ts`  | Set deathTick when ship dies                    |
| `apps/server/src/game/state/game-state.ts`   | Add deathTick to ShipState init                 |
| `apps/client/components/game-canvas.tsx`     | Respawn countdown UI, enter ship sound trigger  |
| `apps/client/lib/game/sound.ts`              | Wire tractor beam and enter ship sound triggers |

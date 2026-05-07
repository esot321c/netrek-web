# Gameplay: SB Docking, Warp-to-SB & Plasma Torpedoes — Design Spec

## Goal

Implement three missing gameplay systems: starbase docking (repair/refuel at friendly SB), warp-to-SB convenience mechanic, and plasma torpedoes (heavy tracking projectiles).

## Dependencies

- Ranks spec must be implemented first (SB restrictions gate who can pilot SB, which must exist before docking matters).

---

## 1. Starbase Docking

### Overview

Ships can dock at their team's starbase for accelerated repair and refueling. Docking is a voluntary action: fly within docking range of your team's SB and issue the dock command.

### Mechanics

**Docking conditions (all must be true):**

- Ship is within docking range of a friendly SB (900 game units — same as `ORBIT_DIST`)
- Ship is on the same team as the SB
- Ship is not an SB itself (SBs cannot dock at SBs)
- Ship is alive
- SB is alive
- SB has < 4 ships docked (max 4 simultaneous dockers, per original Netrek)

**Docking state:**

- Add `dockedAt: number` to `ShipState` (-1 = not docked, otherwise the SB's slot index)
- Add `dockedShips: number[]` to `ShipState` (array of slot indices docked at this SB, empty for non-SBs)
- Docked ship's position is locked to the SB's position (moves with it)
- Docked ship's speed is forced to 0

**Undocking:**

- Player issues any movement command (set speed > 0, set direction, or explicit undock command)
- Player fires any weapon
- SB dies → all docked ships are force-undocked
- Docked ship dies → removed from SB's dockedShips

**Benefits while docked:**

- Shield repair: 5x normal rate (stacks with repair mode, so repair mode + docked = 20x)
- Fuel recharge: 12x normal rate (only if SB has fuel to share — SB fuel decreases proportionally)
- Hull repair follows normal rules (shields must be down)

**Input command:** Add `InputCommand.DOCK = 18` — toggles dock/undock when in range of friendly SB.

**Client state:** Add `docked: boolean` to `ClientShip` so the renderer can show docked ships attached to the SB.

### Tractor/Pressor Interaction

Per the spec: "Docking at starbase breaks tractor/pressor." When a ship docks:

- Clear any active tractor beam on the docking ship
- Clear any active pressor beam on the docking ship
- Do NOT break tractor/pressor beams targeting the docking ship from enemies

---

## 2. Warp-to-SB

### Overview

Not a special command — this is the existing lock-on mechanic applied to players. In classic Netrek, you lock onto a player slot (including your SB) and set max warp. The ship auto-navigates to the locked target.

### Current State

Lock-on already exists for planets (`InputCommand.LOCK`). The client sends a lock command with a planet index. Need to extend this to support locking onto player slots.

### Mechanics

**Lock types:**

- `LockType.NONE = 0` (existing)
- `LockType.PLANET = 1` (existing)
- `LockType.PLAYER = 2` (new)

**When locked onto a player:**

- Ship auto-adjusts direction toward the locked player's current position each tick
- Speed is NOT auto-set — player controls speed manually (set max warp for fastest approach)
- Lock breaks when: target dies, target cloaks, player manually changes direction, player issues new lock

**Input:** Extend `InputCommand.LOCK` to accept player slot indices. The `value` field encodes: `lockType << 8 | targetId`. This distinguishes planet lock (type 1, target = planet index) from player lock (type 2, target = slot index).

**Client interaction:**

- `l` key (existing): locks to nearest planet or player — unchanged
- `L` key (shift+l): locks onto your team's SB regardless of distance. If no friendly SB exists, does nothing. This is the primary way players warp to SB for docking.
- Galaxy map click: clicking on a planet or ship icon on the galaxy map locks onto that entity. This gives players a way to lock onto anything visible on the map, not just nearby entities.

**Auto-dock:** When a ship locked onto a friendly SB arrives within docking range, it does NOT auto-dock. The player must explicitly press the dock key. This prevents accidental docking during combat near the SB.

---

## 3. Plasma Torpedoes

### Overview

Heavy, slow-moving torpedoes that track their target slightly, deal splash damage on explosion, and can be shot down. Available to DD, CA, BB, and SB with 2+ kills.

### Mechanics

**Firing requirements:**

- Ship type: DD, CA, BB, or SB (not SC or AS)
- Kills >= 2
- Not cloaked or uncloaking
- Fuel >= plasma fuel cost
- Weapon temp below burnout threshold
- Max 1 plasma in flight per ship at a time

**Plasma stats (defined in shared constants):**

| Stat                  | Value                                                         |
| --------------------- | ------------------------------------------------------------- |
| Speed                 | 5 (game units per tick — slower than regular torps)           |
| Damage                | 150 (at center of blast)                                      |
| Splash radius         | 1500 game units                                               |
| Splash damage falloff | Linear: `damage * (1 - dist/splashRadius)`                    |
| Fuel cost             | 2000                                                          |
| Weapon heat           | 50                                                            |
| Lifetime              | 60 ticks (6 seconds)                                          |
| Turn rate             | 4 (direction units per tick, toward target — slight tracking) |
| Max active per ship   | 1                                                             |

**Tracking behavior:**

- On fire, the plasma locks onto the nearest enemy ship within 6000 game units
- Each tick, the plasma adjusts its direction toward the target by up to `turnRate` direction units
- If the target dies or cloaks, the plasma continues in a straight line (loses tracking)
- Tracking is imperfect — the turn rate is slow enough that fast ships can dodge

**Splash damage:**

- When a plasma expires or hits a ship, it explodes
- All ships within splash radius take damage (including friendly ships and the firer)
- Damage decreases linearly with distance from explosion center

**Counterplay:**

- Enemy phaser hit destroys the plasma (phaser must hit within a small collision radius, ~200 GU)
- Ship collision with the plasma triggers explosion (ship takes full damage)
- Regular torpedo hit destroys the plasma
- Detonation (`d` key) works on plasma within det range, same as regular torps

**State:**

Add `PlasmaState` to shared types:

```typescript
interface PlasmaState {
  alive: boolean;
  ownerSlot: number;
  team: Team;
  x: number;
  y: number;
  direction: number;
  targetSlot: number; // -1 if lost tracking
  ticksRemaining: number;
}
```

Add a `plasmas` array to `GameState` (max 16 — one per possible player slot).

**Binary protocol:** Add plasma to the serialized game state. Each plasma is: alive(1) + x(2) + y(2) + ownerSlot(1) + team(1) = 7 bytes. With 16 max, that's 112 bytes — minimal overhead.

**Rendering:** Plasma appears as a larger glowing dot (3-4px vs 1-2px for regular torps), team-colored, with a pulsing effect.

**Input command:** Add `InputCommand.FIRE_PLASMA = 19`. Value = direction (same as FIRE_TORP). Client fires with a new keybind — `f` key (classic Netrek binding).

**Sound:** New sound effect for plasma fire and plasma explosion (distinct from regular torp sounds). Can reuse explosion sound at higher volume for beta if no asset available.

---

## Files Modified

| File                                        | Change                                                                                                                                               |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/game/types.ts`         | Add `PlasmaState`, `LockType.PLAYER`, `InputCommand.DOCK`, `InputCommand.FIRE_PLASMA`, `dockedAt`/`dockedShips` to ShipState, `docked` to ClientShip |
| `packages/shared/src/game/constants.ts`     | Plasma constants, docking constants (max dockers, repair/fuel multipliers)                                                                           |
| `packages/shared/src/game/protocol.ts`      | Serialize/deserialize plasma state and docked flag                                                                                                   |
| `apps/server/src/game/game-loop.service.ts` | Docking update logic, plasma movement/tracking/collision, player lock auto-direction, undock on movement                                             |
| `apps/server/src/game/game.service.ts`      | Initialize plasmas array                                                                                                                             |
| `apps/server/src/game/state/game-state.ts`  | Add plasmas array, docking fields to ship init                                                                                                       |
| `apps/client/lib/game/input.ts`             | `f` key for plasma fire, dock key, extend `l` lock to include players                                                                                |
| `apps/client/lib/game/renderer.ts`          | Render plasma as larger glowing dot, render docked ships attached to SB                                                                              |
| `apps/client/lib/game/sound.ts`             | Plasma fire and explosion sounds                                                                                                                     |
| `apps/client/components/game-canvas.tsx`    | Add `f` and dock key to help overlay                                                                                                                 |

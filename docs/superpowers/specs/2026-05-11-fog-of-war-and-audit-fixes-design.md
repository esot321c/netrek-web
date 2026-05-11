# Fog of War & Spec Audit Fixes

## 1. Planet Fog of War

### Overview

Planet information is no longer global. Each team maintains its own knowledge of the galaxy, updated only when friendly ships are within scan range of a planet. This creates information asymmetry that rewards scouting.

### Visibility States

Each planet has one of three visibility states per team:

- **Fresh** — A friendly ship is currently within scan range. True planet state (owner, armies, features) is shown. Solid border on galactic map.
- **Stale** — Was scanned at some point but no friendly ship is currently in range. Last-known state is shown. Dashed border on galactic map.
- **Unknown** — Never scanned by this team. Grey circle with "?" on both tactical and galactic. No owner/army/feature info.

### Scan Range

~33,000 GU (GALAXY_WIDTH / 3), matching the approximate tactical view radius. If you can see a planet on your tactical display, you're scanning it.

### Server: TeamPlanetKnowledge

New per-team knowledge array tracked in game state:

```typescript
interface PlanetKnowledge {
  team: number; // last-known owner
  armies: number; // last-known army count
  features: number; // last-known feature flags
  lastScannedTick: number; // -1 = never scanned
}
```

Storage: `knownPlanets: PlanetKnowledge[4][40]` (4 teams x 40 planets).

Each tick, for each alive friendly ship, mark all planets within scan range as scanned — copy true state into that team's knowledge array and set `lastScannedTick` to current tick.

### Initial State

At game start, each team knows their own 10 starting planets (set to fresh with true values). The other 30 planets start as unknown (`lastScannedTick = -1`).

### Protocol Change

Currently planets are 4 bytes each: `planetId, team, armies, features`.

Add 1 byte for visibility status:

- `0` = unknown
- `1` = stale (scanned before, not currently in range)
- `2` = fresh (currently in scan range)

New format: 5 bytes per planet. Total overhead: +40 bytes per state packet.

When visibility is unknown, send `team=0xFF, armies=0, features=0`.
When visibility is stale or fresh, send the team's last-known values.

### Client Rendering

**Galactic map:**

- Unknown: grey fill, "?" label, no feature icons
- Stale: normal team color but dashed border, show last-known info
- Fresh: solid border, true info (as today)

**Tactical view:**

- Unknown: grey circle, "?" label
- Stale/Fresh: render normally with last-known or true info (you're not close enough to scan, but you know what it looked like)

### Bot Consideration

Bots already receive serialized game state through the same protocol pipeline. They will automatically get fog-of-war-filtered state — no special handling needed. Bot AI that references planet state will naturally work with known information only.

---

## 2. Spec Audit Fixes

These are discrepancies found comparing our implementation against the original Netrek mechanics.

### 2.1 Torpedo Splash Damage — Team Awareness (HIGH)

**Bug:** Splash damage hits all non-firer ships indiscriminately.

**Fix:** Track explosion cause on each torp (impact, wall, enemy-det, self-det):

- **Impact with enemy:** splash damages everyone except firer (current behavior, correct)
- **Wall hit:** splash damages enemies only, not firer's teammates
- **Enemy detonation:** splash does NOT damage detonator's teammates, but CAN damage firer's teammates
- **Self detonate (abort):** no explosion, torp just disappears (current behavior, correct)

Add a `deathCause` field to torp state when it explodes, and use it in `explodeTorp()` to filter splash targets.

### 2.2 Phaser Lock on Cloaked Ships (HIGH)

**Bug:** Phasers that hit cloaked ships don't reveal the target's exact position.

**Fix:** When a phaser hits a cloaked enemy, the phaser endpoint (x2, y2) in the serialized state should show the target's true position (not fuzzed). This is the "phaser lock" mechanic — the phaser line segment snaps to the exact cloaked position, briefly revealing where the ship is.

Implementation: the phaser x2/y2 is already set to the target's position at fire time. The issue is that the client's interpolation might not show this if the cloaked ship position is fuzzed. The fix is: in `serializeGameState`, when writing phasers, if the phaser hit a cloaked ship, write the true target position for x2/y2 regardless of cloaking fuzz. Add a `hitCloaked` flag or `targetSlot` to PhaserState so the serializer knows.

### 2.3 Starbase Phaser Cooldown (MEDIUM)

**Bug:** SB uses the same 10-tick (1 second) phaser cooldown as all other ships.

**Fix:** Add per-ship-type phaser cooldown to SHIP_STATS. SB gets a faster cooldown (e.g., 5 ticks = 0.5 seconds). All other ships stay at 10 ticks.

### 2.4 Repair Mode Multiplier (MEDIUM)

**Bug:** `physics.ts` applies 4x multiplier for repair mode. Spec says 2x.

**Fix:** Change the repair mode multiplier from 4 to 2 in `updateRepair()`. The orbit (4x) and dock (5x) multipliers are handled separately and are correct.

### 2.5 Refit at Starbase (MEDIUM)

**Bug:** Refit only allowed at homeworld. Spec allows refit while docked at friendly starbase.

**Fix:** In the refit validation, also allow refit when `ship.dockedAt >= 0` and the starbase is on the same team.

### 2.6 Starbase Cannot Orbit Foreign Planets (MEDIUM)

**Bug:** `tryOrbit()` has no ship-type check preventing SB from orbiting enemy/neutral planets.

**Fix:** In `tryOrbit()`, if ship is SB and the nearest planet is not owned by the ship's team, reject the orbit.

### 2.7 Starbase Death 30-Minute Cooldown (MEDIUM)

**Bug:** `SB_COOLDOWN_TICKS` constant exists but is never triggered when an SB dies.

**Fix:** In the death handler (`checkDeaths`), when a dying ship is an SB, call `startSbCooldown(ship.team)`.

### 2.8 Assault Ship Bombing Distribution (LOW)

**Bug:** AS bombs 2/3/4/5 at 50/30/10/10%. Spec says 0/2/3/4.

**Fix:** Change the AS bombing roll to: 0 (50%), 2 (30%), 3 (10%), 4 (10%).

### 2.9 Torpedo Hit Radius (LOW)

**Bug:** `TORP_HIT_RADIUS = 250` but shield visual is drawn at 520 GU. Spec says torps hit "about shield radius."

**Fix:** Increase `TORP_HIT_RADIUS` to 520 to match the visual shield radius.

# Bot AI Redesign: Situational Assessment + Task Queue

## Problem

The current bot AI is a flat priority list re-evaluated every tick with no memory.
Bots thrash between states, clump on the same targets, fire torpedoes straight at
current positions (missing moving targets), never use tractor/pressor, spam weapons
until burnout, and have no continuity between tasks. The result is bots that feel
like target dummies rather than participants in a Netrek game.

## Goal

Bots that think clearly and respond to changing game state. When a bot spawns, it
assesses the situation, picks a useful job, commits to it, handles interrupts
(combat, damage) as sub-tasks, then resumes or re-assesses. Games with only bots
should progress meaningfully -- planets change hands, teams push and retreat, the
economy moves.

Bots don't need to be geniuses. They need to be dynamic enough that the game feels
alive.

## Architecture

Three cooperating layers replace the current `BotBrain.think()` flat priority scan:

```
+---------------------------------------------+
|  Assessor  (every 10-20 ticks / 1-2 sec)    |
|  Scans game state -> scored mission candidates|
|  "What's happening? What does the team need?" |
+----------------------+-----------------------+
                       | assigns highest-scoring mission
+----------------------v-----------------------+
|  Mission Layer  (every tick)                  |
|  Executes current mission (escort, bomb...)   |
|  Handles interrupts: combat, damage, orders   |
|  Decides: continue, resume, or re-assess      |
+----------------------+-----------------------+
                       | when engaged in combat
+----------------------v-----------------------+
|  Combat Module  (every tick, during fights)   |
|  Torp leading, evasion, tractor/pressor,      |
|  shield management, engagement/disengage      |
+----------------------------------------------+
```

Output is still `PlayerInput[]`. Nothing changes downstream -- `BotPlayer`,
`BotManagerService`, input queue, tick events all stay the same.

### What changes

- `BotBrain` internals: `thinkRole()` + state dispatch replaced by Assessor +
  Mission + Combat layers.
- `bot-combat.ts`: expanded with torp leading, det logic, tractor/pressor,
  shield toggling, speed variation, fuel/temp awareness.
- `bot-navigation.ts`: minor additions (cluster detection, threat assessment
  helpers).

### What stays the same

- `BotPlayer`, `BotManagerService`, `bot-config.ts`, `bot-orders.ts`,
  `bot-names.ts` -- untouched or minimally changed.
- `PlayerInput` contract, `InputQueue`, tick event system.
- Difficulty = decision quality, never aim scatter or reaction delays.

---

## Layer 1: Situational Assessor

Runs every 15 ticks (~1.5 seconds) by default. Also re-runs early on trigger
events (see below). Produces a list of scored mission candidates. The highest
score wins.

### Inputs scanned

| Signal                                                      | What it tells the bot              |
| ----------------------------------------------------------- | ---------------------------------- |
| Friendly planets under attack (enemy ships near them)       | Defensive pressure                 |
| Enemy planets with high armies (from planet knowledge)      | Bombing targets                    |
| Friendly carriers (teammates beaming up or carrying armies) | Escort opportunities               |
| Enemy carriers (enemies carrying armies)                    | OGG targets                        |
| Concentrated enemy presence (cluster of enemies in an area) | Threat zones                       |
| Friendly ship density near me                               | Am I alone or supported?           |
| Team planet count differential                              | Winning or losing territory?       |
| My resource state (fuel, hull, weapon temp)                 | Can I fight or do I need resupply? |
| Pending chat orders                                         | Weighted suggestion, not a command |
| What other bots on my team are already doing                | Deduplication                      |

### Output: scored mission candidates

```
[
  { mission: ESCORT, target: slot 3, score: 85 },
  { mission: BOMB, target: planet 14, score: 60 },
  { mission: DEFEND, target: planet 2, score: 55 },
  { mission: PATROL, zone: "frontline", score: 20 },
]
```

Scoring is weighted arithmetic, not utility curves. Each signal adds or subtracts
from a base score. Easy to tune, easy to log. Exact weights are implementation
tuning -- the spec defines which signals feed into which missions, not the precise
numbers. Weights should be extracted as named constants for easy adjustment.

### Chat orders affect scoring, not control flow

A chat order adds a bonus (e.g., +40) to the relevant mission candidate. If the
bot is already doing something worth 85, a chat-boosted mission scoring 70 still
loses. If the bot is patrolling (20), the order easily wins. Orders feel responsive
without overriding good judgment.

### Team deduplication

The assessor checks what missions other bots on the team are running. Duplicate
assignments (two bots escorting the same carrier, three bots bombing when only one
is needed) get penalized. Unserved needs get boosted. This makes bots spread out
naturally.

### Re-assessment triggers

The assessor normally runs on its timer, but also re-runs early when:

- Current mission target dies or becomes invalid
- Bot takes heavy damage (hull drops below threshold since last assessment)
- A new chat order arrives
- Bot finishes a mission (delivered armies, planet captured)
- Bot exits combat and the original mission may be stale

---

## Layer 2: Mission Layer

Holds a current mission and executes it tick-by-tick. Knows how to pause for
combat and resume afterward.

### Mission lifecycle

```
Assessor assigns mission
        |
        v
   EXECUTING ---- enemy engages ----> COMBAT (sub-behavior)
        |                                  |
        |                            fight ends
        |                                  |
        |<--- should I resume? <-----------+
        |         |
        |    yes: resume mission where I left off
        |    no:  trigger early re-assessment
        |
   mission complete / target invalid
        |
        v
   trigger re-assessment
```

### Resume logic

When combat ends, the mission layer checks:

- Is the mission target still valid? (ship alive, planet still enemy-owned, etc.)
- Am I in good enough shape to continue? (fuel, hull, weapon temp)
- Has the situation changed enough to warrant re-assessment?

If target is valid and resources are okay: resume. Otherwise: trigger re-assessment.

### Mission types

#### ESCORT(ship)

Follow escortee at 2000-3000 distance. Match general heading. Engage enemies that
threaten the escortee (within engagement range of them, not just of the bot).
Position between escortee and nearest threat when possible.

If escortee dies or drops all armies: mission invalid, re-assess.

#### BOMB(planet)

Navigate to enemy planet. Orbit, shields down, bomb. Cloak while bombing if veteran
and fuel allows. If planet is depleted, check if it's takeable (low armies, bot has
kills). If not, re-assess for next bomb target or different mission.

Note: bots use whatever ship type they spawned with. Ship selection is a spawn-time
decision in bot-manager, not a per-mission decision. Refitting is out of scope.

#### TAKE(planet)

Three phases with distinct behavior:

**Pickup phase:**

- Navigate to friendly planet with armies >= BEAM_MIN_ARMIES.
- Orbit, shields down, beam up.
- Only carry what's needed: `min(capacity, target.armies + 1)`. Don't overload.

**Transit phase:**

- Travel to target planet. Shields up. Do NOT cloak yet -- save fuel.
- Stay aware of threats. If an ogger approaches:
  - Fast/committed ogger: slow down, turn perpendicular, buttorp. Use pressor
    to push them away. Fight if necessary -- the bot has weapons.
  - Slow/cloaked ogger: maintain speed, adjust heading, let them burn fuel.
  - Outnumbered: evade toward friendlies.

**Approach + Drop phase:**

- When close to target planet (~1 screen away), NOW cloak.
- Reduce speed for orbit approach.
- Orbit, beam down. Det incoming torps. If plasma incoming, shields up briefly
  then resume beaming.
- When done: shields up, warp 6+, head toward friendlies.

Army count decision: Don't carry more than needed. Carrying 2-4 for a quick take
is better than loading 10 and becoming a high-value ogg target. If the team has
plenty of armies, carry a bit more. If armies are scarce, conserve.

#### DEFEND(planet)

Orbit or patrol near friendly planet. Don't fire wildly at approaching cloakers --
wait for them to commit, then engage. Conserve fuel. Alert teammates (other bot
assessors detect the threat).

If defending alone against multiple enemies: delay, don't try to kill. Stay alive,
lob torps, look threatening. The goal is to buy time for reinforcements.

#### OGG(ship)

Intercept enemy carrier at high speed. Time the approach -- best when target is
distracted (dogfighting, beaming). Cloak for approach, uncloak close, tractor +
phaser + torps. Self-destruct if close enough for explosion damage.

Don't just rush in at max warp from across the map. Get into position first, then
strike when the moment is right. Veterans assess whether the target has noticed
them (changing heading away = spotted, continuing course = unaware).

#### RESUPPLY

First-class mission replacing the old hardcoded RETREAT. The bot weighs three
options:

1. **Passive repair (shields down, keep moving):** Hull repairs slowly. No fuel
   cost. Good when damage is light, no nearby enemies, and the bot can keep
   doing something useful.

2. **Active repair (R mode, stop dead):** 2x repair speed. But the ship stops.
   Only viable when no enemies are within scan range heading toward the bot.
   Check before committing. If an enemy appears, leave repair mode immediately.

3. **Planet repair:** Fastest repair rate. But costs travel time. The bot
   calculates: time to reach repair planet + time to repair there vs. time to
   passive-repair in place. If planet is close and damage is heavy, go there.
   If planet is far and damage is moderate, passive repair.

Fuel resupply follows the same distance/time logic for fuel planets.

The assessor scores RESUPPLY on a gradient, not a binary threshold. A bot at 40%
hull scores RESUPPLY at ~70, but a nearby carrier about to die might score OGG
at 80. The bot makes a judgment call, not a panic override.

Emergency interrupt: if the bot takes a sudden large hit (e.g., drops 30%+ hull in
a short window), trigger an immediate re-assessment regardless of timer.

#### PATROL(zone)

The "nothing better to do" mission. Push toward frontline enemy territory. Engage
targets of opportunity. Different bots patrol different zones (spread by slot
index or assigned zone).

After spawning, a bot in PATROL should be quickly re-assessed into something
useful. PATROL is the default, not the steady state.

---

## Layer 3: Combat Module

Runs every tick when the bot detects an active engagement. Operates as a
sub-behavior within whatever mission is active.

### Entry/exit

- **Enter combat** when: enemy within engagement range AND actively threatening
  (firing, closing to phaser range, or we need to fight for our mission).
- **Exit combat** when: no enemies in range for ~20 ticks (2 seconds). Avoids
  thrashing in and out during a running fight.

### Core combat behaviors

#### Torp leading

Fire at where the enemy will be, not where they are. Calculate based on enemy
heading + speed + torp travel time. This is the single biggest improvement --
current bots fire at current position and miss everything.

Difficulty scaling:

- NEWBIE: fires at current position (no lead)
- COMPETENT: leads at ~50% of ideal offset
- VETERAN: full lead calculation

#### Torp discipline

Track how many torps the bot currently has in flight. Don't fire if 5+ are out
(fuel waste, heat buildup). Fire in bursts of 3-5, then pause. Det own torps that
have clearly missed to free up slots for re-fire.

Difficulty scaling:

- NEWBIE: fires whenever able, no tracking
- COMPETENT: limits to 5 in flight
- VETERAN: 3-4 in flight, dets missed torps to re-fire

#### Det enemy torps

When enemy torps are incoming and can't be dodged (too close, too many), det them
for reduced damage. Also det to create holes in torp streams to dodge through.

Difficulty scaling:

- NEWBIE: never dets
- COMPETENT: dets when multiple torps are within close range
- VETERAN: tactical det -- creates holes, dets before impact

#### Speed variation

Constant speed = predictable = easy torp target. Vary speed to make leading
difficult. BUT: ships have acceleration curves. Changing speed every tick means
the ship never reaches any speed. Changes happen on a 20-40 tick (2-4 second)
cycle:

- Hold speed for 20-40 ticks (commit, let ship accelerate)
- Switch to a different speed
- Occasionally burst to high speed for repositioning
- Drop to low speed for tight dodging

Difficulty scaling:

- NEWBIE: constant speed
- COMPETENT: changes speed every 30-40 ticks between 2-3 values
- VETERAN: active pattern with 20-30 tick holds, burst/dodge cycles

#### Direction changes (jinking)

Same timing constraint as speed: ships have turn rates. A direction change every
tick means the ship barely turns. Commit to a heading for 15-30 ticks, then change.
Perpendicular dodges relative to incoming torps.

#### Tractor/pressor

- **Tractor** a fleeing enemy to hold them in weapons range. Release when they
  explode or when fuel gets low (tractor costs 20 fuel/tick + engine heat).
- **Pressor** a close enemy to push them away (avoid explosion damage, create
  distance). Pressor oggers.
- **Pressor off teammates/planets** for speed boost when fleeing (advanced,
  veteran only).

Difficulty scaling:

- NEWBIE: never uses tractor/pressor
- COMPETENT: pressors enemies that get too close
- VETERAN: full tractor (hold fleeing targets) + pressor (push away oggers,
  create distance)

#### Shield management

- Default: shields up during combat.
- If no torps are incoming and no enemy is within phaser range, drop shields
  briefly (5-10 ticks) to allow hull repair. Raise before next impact.
- Never drop shields in a close-range brawl.
- When retreating from combat: shields up until clear, then shields down for
  passive repair.

Difficulty scaling:

- NEWBIE: shields always up
- COMPETENT: drops shields when clearly safe
- VETERAN: active toggling during combat lulls

#### Fuel awareness

- If fuel drops below ~30% of max, disengage. Don't fire torps (expensive).
  Phaser only if target is close.
- If fuel drops below ~15%, stop firing entirely. Shields down if safe. Head
  toward nearest fuel planet or friendly ship/starbase.
- A bot that runs out of fuel in enemy territory is dead. Disengage early.

#### Weapon temperature awareness

- If weapon temp exceeds ~70% of max, stop firing torps (high heat per shot).
  Switch to phaser-only.
- If weapon temp exceeds ~90%, stop firing entirely. Let it cool.
- Never fire into burnout. The old bots spam until burnout then sit useless.

#### Engagement range management

Maintain 3000-6000 game units from target during combat (within phaser range but
not collision range). If closer: pressor or fly away. If further: close in. Circle
the target rather than flying straight at them.

---

## Difficulty Scaling Summary

Difficulty is decision quality only. No artificial aim scatter, no reaction delays,
no handicaps.

| Behavior          | NEWBIE                     | COMPETENT         | VETERAN                             |
| ----------------- | -------------------------- | ----------------- | ----------------------------------- |
| Torp aim          | Current position           | 50% lead          | Full lead                           |
| Torp discipline   | No limit                   | 5 in flight       | 3-4, dets misses                    |
| Det usage         | Never                      | Defensive         | Tactical                            |
| Speed variation   | Constant                   | Moderate (30-40t) | Active (20-30t)                     |
| Tractor/pressor   | Never                      | Pressor only      | Full                                |
| Shield toggle     | Always up                  | Safe moments      | Active management                   |
| Fuel management   | Ignores                    | Retreats when low | Conserves, disengages early         |
| Weapon temp       | Ignores                    | Stops at burnout  | Stops at 70%                        |
| Target selection  | Closest                    | Distance + damage | Distance + damage + strategic value |
| Assessment        | Simplistic (fewer signals) | Most signals      | All signals + deduplication         |
| Cloaker detection | Doesn't watch              | Reacts when close | Watches galactic, anticipates       |

---

## Integration Points

### BotBrain public API (unchanged)

```typescript
think(gameState: ClientGameState): PlayerInput[]
setOrder(state: BotAIState, targetId: number, currentTick: number): void
clearOrder(): void
```

`think()` internally delegates to assessor -> mission -> combat layers instead of
the flat `thinkRole()` + `dispatchState()`.

### BotManagerService changes

Minimal. The manager still calls `bot.onTick()` which calls `brain.think()`. The
only new requirement: bots need to know what other bots on their team are doing
(for deduplication). This can be a simple shared structure:

```typescript
interface TeamBotState {
  slot: number;
  currentMission: MissionType;
  missionTargetId: number;
}
```

The manager passes an array of `TeamBotState` for the bot's team into `think()`,
or the bots share a reference to a team-level mission registry.

### Chat orders

Orders flow into the assessor as a scoring bonus, not a direct state override.
The `setOrder()` method stores the order; the assessor reads it and factors it
into scoring. If the order's mission scores highest, the bot follows it. If the
bot is doing something clearly more valuable, it doesn't.

### New InputCommands used

- `DETONATE` -- det enemy torps (already exists in InputCommand enum)
- `TRACTOR` -- engage tractor beam on target
- `PRESSOR` -- engage pressor beam on target

These commands already exist in the protocol. The current bots just never use them.

---

## File Structure

New/modified files:

```
apps/server/src/game/bot/
  bot-ai.ts          -- gutted and rebuilt: Assessor + Mission + Combat layers
  bot-combat.ts      -- expanded: torp leading, det, tractor/pressor, shield mgmt
  bot-navigation.ts  -- minor additions: cluster detection, threat helpers
  bot-player.ts      -- minor: pass team bot state into think()
  bot-manager.service.ts -- minor: maintain team mission registry, pass to bots

  bot-ai.spec.ts     -- rewritten for new architecture
  bot-combat.spec.ts  -- expanded for new combat behaviors
```

No changes to shared package types, constants, or protocol. No changes to client.
No changes to game loop or input processing.

---

## What "good enough" looks like

A game with only bots should:

- Have planets change hands over the course of 10-20 minutes
- Show bots doing different things (some bombing, some escorting, some defending)
- Have bots react to enemy pushes (if enemies are bombing, bots should defend)
- Have dogfights that last more than 1-2 seconds (bots dodge, manage resources)
- Not have bots sitting idle, stuck in loops, or all clumped on one target
- Not have bots die with full fuel and zero kills because they burned everything
  on 8-torp salvos at empty space

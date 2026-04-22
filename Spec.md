# Netrek Web: Game Specification

Browser-based clone of Bronco (Vanilla) Netrek. Faithful to the original mechanics with modernized UX for chat, voice, and onboarding. Two-team play (8v8), with bot backfill for low population games.

## 1. Galaxy and Map

- 40 planets on a square 2D map (100,000 x 100,000 game units)
- 4 quadrants of 10 planets each, assigned to Federation, Romulans, Klingons, Orions
- Only 2 teams active per match; the other 2 quadrants are "third space"
- Each team starts with 10 planets; one is the homeworld (Earth, Romulus, Klingus, Orion)
- Planet attributes (a planet may have zero, one, or multiple):
  - **Agricultural (AGRI)**: faster army growth
  - **Repair**: faster shield/hull repair for orbiting friendlies
  - **Fuel**: faster refueling for orbiting friendlies

### Army Growth

- Each planet gets a chance to pop armies roughly every 40 seconds
- Normal planets: 10% chance to pop 1-3 armies; 5% bonus chance of +1 army when below 4
- Agricultural planets: additional 20% chance to pop 1 army; guaranteed pop of 1 when below 4
- Planets can lose armies to plague (random event)

## 2. Win Conditions

- **Genocide**: capture all enemy planets
- **Tournament Mode (T-Mode)**: activates when both teams have 4+ players (including bots if configured). Bombing and planet capture only possible in T-Mode
- **Timed mode** (optional, for organized play): 90 minutes, win condition of 11-8 planet count, 30-minute sudden death overtime if tied

## 3. Server Tick Rate

- 10 ticks per second (100ms per tick)
- All game logic resolves per tick on the server

## 4. Ship Movement

- Ships steer like boats: always move in the direction they face
- Direction is 0-255 (256 discrete headings)
- Turning rate depends on ship type and current speed; each extra warp halves turn rate
- Acceleration and deceleration rates are ship-dependent
- Ships pass through each other without collision
- Ships bounce off galaxy walls without damage
- Hostile planets deal steady damage to nearby ships, scaling with planet army count (per 10 armies)

## 5. Ship Types

Galaxy class (GA) is excluded from Bronco; not implemented.

### Stats Table

| Stat             | SC   | DD   | CA    | BB    | AS   | SB    |
| ---------------- | ---- | ---- | ----- | ----- | ---- | ----- |
| Max Speed        | 12   | 10   | 9     | 8     | 8    | 2     |
| Cruise Speed     | 8    | 7    | 6     | 4     | 8    | 2     |
| Combat Speed     | 6    | 5    | 4     | 3     | 4    | 2     |
| Shields          | 75   | 85   | 100   | 130   | 80   | 500   |
| Hull             | 75   | 85   | 100   | 130   | 200  | 600   |
| Fuel             | 5000 | 7000 | 10000 | 14000 | 6000 | 60000 |
| Max Armies       | 2    | 5    | 10    | 6     | 20   | 25    |
| Armies/Kill      | 2    | 1.67 | 2     | 2     | 3    | N/A   |
| Torp Speed       | 16   | 14   | 12    | 12    | 16   | 14    |
| Torp Damage      | 25   | 30   | 40    | 40    | 30   | 30    |
| Phaser Damage    | 75   | 85   | 100   | 105   | 80   | 120   |
| Max Phaser Range | 4500 | 5100 | 6000  | 6300  | 4800 | 7200  |
| Shield Cost/tick | 2    | 3    | 3     | 3     | 3    | 6     |
| Tractor Strength | 2000 | 2500 | 3000  | 3700  | 2500 | 8000  |
| Tractor Range    | 0.7  | 0.9  | 1.0   | 1.2   | 0.7  | 1.5   |

### Ship Roles

- **Scout (SC)**: fast, fragile. Bombing, harassment, scouting. Key: S
- **Destroyer (DD)**: faster than CA, weaker. Specialty planet-taking. Key: D
- **Cruiser (CA)**: the default. Balanced all-rounder, heart of the game. Key: C
- **Battleship (BB)**: slow, heavily armed/armored. Point defense, firepower. Key: B
- **Assault Ship (AS)**: planet capture specialist. Tough hull, high army capacity, fuel-efficient cloaking. Key: A
- **Starbase (SB)**: slow fortress. One per team. Requires 5+ owned planets. 30-minute rebuild timer on death. Requires Commander rank. Other ships can dock for refueling. Key: O

## 6. Weapons

### Phasers

- Instantaneous hitscan, cannot be dodged
- Fire rate: once per second (starbases faster)
- Damage drops off linearly with distance: `damage * (1 - dist / maxRange)`
- Range is proportional to base phaser damage
- Fuel cost: 7x point-blank damage for SC/DD/CA; higher for BB/AS/SB
- Hitting a cloaked ship reveals their exact position ("phaser lock")

### Torpedoes

- Projectiles traveling at fixed speed (ship-dependent)
- Wobble randomly during flight; expire after random distance
- Explode on: impact with enemy ship (at shield radius), galaxy wall, or enemy detonation
- Explosion damages all nearby ships except the firer
- Splash damage formula: `damage * (2000 - dist) / 1650`
- Detonation by enemy: no damage to detonator's teammates; can damage firer's teammates
- Fuel cost: 7x damage for SC/DD/CA; higher for BB/AS/SB

### Plasma Torpedoes

- Require 2+ kills and DD, CA, or BB hull
- Fire forward from ship (starbases fire in any direction, short range)
- Track target slightly
- Damage everyone nearby on explosion, including the firer
- Can be destroyed by enemy phaser hit or ship impact

### Detonation

- Player action to explode nearby enemy torpedoes prematurely
- Costs 100 fuel per use
- Heats weapons by 20 (internal units) regardless of whether anything detonated
- Damage to detonator: `torp_damage * (2000 - dist) / 1650`
- At max det range (1600), this is ~24.2% of nominal damage

## 7. Temperature System

### Engine Temperature

- Rises by: speed (warp level) per tick, +5/tick while tractor/pressor active
- Cooling rates per tick: SC=8, DD=7, CA/BB/AS/SB=6
- Overheat threshold: 100 (SB has higher tolerance on some servers)
- When over threshold: 1/40 chance per tick of burnout
- Burnout duration: 100 + random(0-149) ticks (10-25 seconds)
- Burnout effect: locked to warp 1, no tractor/pressor, can still steer and orbit

### Weapon Temperature

- Rises when firing weapons; each weapon type has a per-ship heat cost
- Same overheat mechanics as engine temp (threshold 100, 1/40 per tick, 10-25s lockout)
- Lockout disables all weapons and detonation
- SB max weapon temp: 130

## 8. Cloaking

- Costs fuel per tick (ship-dependent)
- Cannot fire weapons or use tractor/pressor while cloaked
- Can: bomb, beam armies, toggle shields, detonate torpedoes, repair
- Uncloak time: 0.7 seconds (7 ticks)
- Weapons locked until fully uncloaked
- Tractor/pressor available immediately on uncloak start
- Cloaked ships appear as "??" on enemy galactic map with random position offset
- Conditions for complete invisibility (no ?? shown):
  - Out of yellow-alert range (1/7 galaxy width) from all enemies
  - Not orbiting hostile or third-race planet
  - T-Mode active

## 9. Shields and Repair

- Shields absorb damage before hull
- Dashboard shows shield integrity (decreasing) and hull damage (increasing)
- Hull damage reduces maximum warp speed
- Repair rates (per tick, ship-dependent base rate):
  - Shields: repair constantly at base rate
  - Hull: repairs at half shield rate, only when shields are down
  - Repair mode (toggle): 2x rate
  - Orbiting friendly repair planet: 4x rate (stacks with repair mode)
  - Docked at starbase: 5x rate (stacks with repair mode)
- Fuel regeneration (per tick, ship-dependent recharge rate):
  - Normal: 2x recharge
  - Orbiting friendly fuel planet: 8x recharge
  - Docked at starbase (if SB has fuel): 12x recharge

## 10. Tractor and Pressor Beams

- Tractor pulls target toward you and you toward target
- Pressor pushes target away from you and you away from target
- Neither changes warp speed of either ship
- Force depends on ship mass and tractor strength, not distance
- Cost: 200 fuel/second
- Can pull ships out of orbit (interrupts bombing/beaming/fueling)
- Will not grab cloaked ships
- Maintains lock if target cloaks after grab
- Docking at starbase breaks tractor/pressor

## 11. Armies, Bombing, and Beaming

### Kill Economy

- Kill awarded on enemy ship destruction: 1.0 + 0.1*(victim's kills) + 0.1*(victim's armies)
- 0.25 kills for capturing a planet
- 0.02 kills per army bombed
- Kills reset to 0 on death
- Army carry capacity: (kills \* armies_per_kill), capped at ship max

### Bombing

- Must orbit enemy planet with 5+ armies
- Requires shields down
- Server rolls every 0.5 seconds:
  - Normal ships: 0 (50%), 1 (30%), 2 (10%), 3 (10%)
  - Assault Ship: 0 (50%), 2 (30%), 3 (10%), 4 (10%)
- Can fire weapons while bombing (if uncloaked)
- Raising shields interrupts bombing

### Beaming

- Beam up: from friendly planet with 5+ armies, requires kills for capacity
- Beam down: to enemy planet to capture
- Rate: 1 army per 0.8 seconds
- Requires shields down
- Cannot beam and bomb simultaneously
- Raising shields interrupts beaming
- One friendly army kills one enemy army on beam-down
- Planet captured when all enemy armies eliminated and friendly army present

## 12. Refitting

- Location: homeworld orbit or docked at own starbase
- Requirements: 75%+ shields, 75%+ fuel, 75%- hull damage, no armies aboard
- Freezes ship for 5 seconds (50 ticks)
- Refitting to same ship type is valid: resets hull damage and engine temp to 0

## 13. Death and Respawn

- On death: choose new ship, appear near homeworld
- Must wait for in-flight torpedoes to resolve before respawning
- Ship explosion damages nearby ships:
  - SB: 200 damage
  - SC: 75 damage
  - All others: 100 damage
  - Beyond 350 distance: damage \* (3000 - dist) / 2650
- Ships that quit (disconnect) do not explode

## 14. Scoring and Ranks

- Detailed scoring system (DI rating, offense/defense/bombing/planet stats) to be implemented per original Netrek documentation
- Rank progression based on accumulated stats
- Commander rank required to pilot Starbase
- Rank and ratings do not affect gameplay other than SB access

## 15. Messaging and Communication

### Text Chat

- Channels: Team, All, Individual (by player slot)
- Quick-chat macro system with configurable bindings
- Visual indicator for unread messages
- Chat panel visible during gameplay without obscuring tactical view

### Voice Chat

- Team-only voice via WebRTC (LiveKit)
- Push-to-talk (default and only mode)
- Per-player mute controls
- One voice room per team per match
- WebSocket server handles signaling

## 16. Alert Status

- Determined by distance to nearest enemy ship
- Green: no enemies nearby
- Yellow: enemy within 1/7 galaxy width
- Red: enemy very close
- Shown on HUD; useful for detecting cloaked enemies

## 17. War/Peace Settings

- Players can set Hostile or Peace with each non-team race
- Peace with a race: can use their planet resources, cannot bomb/beam their planets
- Hostile to Peace: no penalty
- Peace to Hostile: 10-second system freeze
- War state: Hostile becomes War after hitting an enemy; cannot reset to Peace until death

## 18. Client Display

### Tactical View

- Zoomed-in view centered on player's ship
- Shows nearby ships, torpedoes, planets, phasers, explosions
- Mouse cursor determines direction for steering and weapons

### Galactic View

- Full galaxy map showing all known ship positions and planet ownership
- Cloaked enemies shown as "??" with offset (or hidden entirely per cloaking rules)
- Planet info: owner, army count (if known), facilities

### HUD

- Ship status: shields, hull, fuel, weapon temp, engine temp
- Speed indicator
- Army count
- Kill count
- Alert status (Green/Yellow/Red)
- Messages area

## 19. Visual Style

- Retro aesthetic faithful to the original Netrek look
- Clean vector lines on dark background
- Pixel-snapped rendering (no antialiasing)
- Small render canvas scaled up with CSS `image-rendering: pixelated` for chunky pixel look
- Ship sprites as simple geometric shapes (diamonds/triangles with team colors)
- Planets as circles with team color fill and facility icons
- Torpedoes as small dots, phasers as lines, plasma as larger glowing dots
- Explosions as expanding circles

## 20. Bot System

- Bots are server-side virtual players submitting inputs through the same interface as real players
- Bot manager spawns/despawns based on lobby configuration
- Bots receive the same filtered game state a real client would (no cheating on cloaked positions)
- AI architecture: state machine with states PATROL, ATTACK, BOMB, ESCORT, DEFEND, OGG, RETREAT
- Transitions based on game state: team planet count, nearby threats, army availability, fuel/health
- Tactical layer: heuristic dodging, phaser/torp timing, det usage, tractor usage
- Intentional imprecision: randomized reaction delays, aim scatter, decision noise
- Difficulty tiers: casual (backfill), competitive (practice), and potentially adjustable via config
- Bots are visually distinguishable from human players (name prefix or icon)

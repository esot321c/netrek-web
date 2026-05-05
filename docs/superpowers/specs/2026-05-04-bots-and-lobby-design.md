# Bots & Lobby System Design

## Overview

Server-side AI players (bots) that keep the game populated and competitive, plus a simple lobby system for players to join. Bots use the same input/output interfaces as human players — no cheating, no artificial handicaps.

## Bot Architecture (Approach C: Input Injection + Filtered State)

### BotManager (Server Service)

Owns the bot lifecycle:

- Spawns bots on server start to fill teams to baseline headcount (4 per team)
- Adds bots to open slots as the game grows toward 8v8
- Only removes a bot when a human needs a slot and the team is full (8 players)
- Redistributes bots across teams to keep total team sizes balanced when humans pick teams freely
- When a human leaves, spawns a bot if the team drops below its target

### BotPlayer (Per-Bot Instance)

Each bot is a BotPlayer instance:

- Assigned a player slot (0-15) like any human
- Receives filtered game state from BroadcastService each tick — same deserialized binary view a human client gets, including cloaking fuzz for enemy ships
- Runs AI decision logic per tick, produces InputCommand values
- Enqueues inputs directly into the InputQueue for its slot — no socket, no network overhead
- No access to raw authoritative game state

## Population Rules

- Server starts: 4 bots per team (4v4 baseline)
- Humans join: take open slots alongside bots, game grows toward 8v8
- Team full (8 players): next human joining that team causes one bot to yield its slot
- Humans leave: bot fills in if team has capacity
- Team balancing: humans choose teams freely. Bots redistribute (one drops from overpopulated team, one spawns on underpopulated team) to keep total team sizes even
- Example: 6 humans + 2 bots vs 5 humans + 3 bots — both teams at 8

## Difficulty Presets

Difficulty affects only decision-making quality. All bots use the same ship stats, weapons, physics, and input interface. No aim scatter, no reaction delays, no stat handicaps.

### Newbie

- Chases nearest enemy regardless of situation — gets baited into traps
- Poor fuel/energy management — runs dry in fights, forgets to refuel
- Doesn't check hull before picking fights, overcommits and dies
- Bombs random planets instead of strategic ones
- Ignores army carriers — doesn't recognize ogg threats
- Gets tunnel vision — stays in ATTACK too long, ignores team needs
- Follows team chat orders but sometimes picks the wrong target or planet

### Competent

- Picks reasonable targets — prefers damaged enemies, avoids full-health starbases
- Manages fuel and hull — disengages around 30-40% hull to refuel/repair
- Recognizes army carriers and shifts to intercept
- Bombs planets with strategic value (fuel/repair/agri)
- Basic coordination — will escort if asked, defends planets under attack
- Follows team chat orders reliably

### Veteran

- Reads the game — recognizes bombing runs, ogg setups, defensive gaps
- Oggs enemy carriers proactively, escorts friendly bombers without being asked
- Excellent resource management — always has fuel for a fight, retreats early enough to survive
- Prioritizes high-value planets, coordinates with other bots for multi-planet pushes
- Defends key infrastructure planets (fuel/repair)
- Responds to team chat orders immediately and interprets intent well

## Dynamic Difficulty Balancing

Bots gradually adjust to prevent blowouts without punishing a good team:

- Every 2 minutes, server checks planet count imbalance
- If one team holds 24+ of 40 planets (60%), one bot rotates out:
  - Winning team: one bot replaced by a lower difficulty bot
  - Losing team: one bot replaced by a higher difficulty bot
- One bot at a time — gradual, not instant
- After a game reset, bots return to baseline difficulty distribution

### Baseline Difficulty Mix

When bots spawn fresh (server start or game reset), the 4 bots per team are distributed:

- 1 newb-bot
- 2 comp-bots
- 1 vet-bot

This gives a balanced feel — not too easy, not too punishing for a solo tester.

## AI State Machine

All difficulty levels have access to all states. Difficulty determines the quality of state transitions — when the bot recognizes it should switch, and how well it executes.

### States

- **PATROL** — cruise between friendly/neutral planets, scan for enemies
- **ATTACK** — engage a nearby enemy (chase, fire torps/phasers)
- **BOMB** — orbit enemy planet, bomb armies
- **ESCORT** — follow a friendly carrier/bomber, protect them
- **DEFEND** — park near a friendly planet under threat
- **OGG** — suicide rush an enemy carrier loaded with armies
- **RETREAT** — flee when low on hull/fuel, head to repair planet

### Transition Logic

Each tick, the bot evaluates its filtered game state and decides whether to stay in its current state or transition. Factors include:

- Own hull/fuel/temperature status
- Nearby enemies and their threat level
- Nearby planets and their strategic value
- Friendly ships and their activities (carriers bombing, escorts needed)
- Team chat orders (override current state)
- Current objective completion (planet already captured, target destroyed)

## Team Chat Orders

Bots listen to their own team's chat for natural commands — the same phrases humans would use with each other.

### Supported Intents

- **"bomb [planet]"** — switch to BOMB, target that planet
- **"escort me" / "escort [player]"** — switch to ESCORT, follow the named player
- **"defend [planet]"** — switch to DEFEND, park near that planet
- **"ogg [player/slot]"** — switch to OGG, rush the target
- **"help" / "help [planet]"** — nearest available bot goes to DEFEND
- **"regroup" / "fall back"** — bots in ATTACK/BOMB disengage and return to friendly space

### Order Handling

- Multiple bots hear the order — the best positioned one responds
- If addressed by name ("comp-bot-1 bomb earth"), only that bot responds
- Bots acknowledge with a short team chat message ("comp-bot-1: bombing Earth")
- Orders override current AI state but bot reverts to autonomous behavior when the order becomes irrelevant (planet captured, target dead)
- Difficulty affects compliance quality: Newbie sometimes picks the wrong target, Veteran follows orders and makes smart ancillary decisions (refuels first if low)

## Bot Names

Format: `{difficulty}-bot-{number}`

- `newb-bot-1`, `newb-bot-2`, ...
- `comp-bot-1`, `comp-bot-2`, ...
- `vet-bot-1`, `vet-bot-2`, ...

The "bot" in the name is sufficient identification — no additional `[BOT]` tag needed in the player list.

## Server Configuration

The following values are configurable without code changes (e.g. environment variables or a config file):

| Setting                         | Default | Description                                          |
| ------------------------------- | ------- | ---------------------------------------------------- |
| `BOTS_PER_TEAM`                 | 4       | Baseline bot count per team on server start          |
| `MAX_PLAYERS_PER_TEAM`          | 8       | Maximum players (human + bot) per team               |
| `BOT_DIFFICULTY_MIX`            | `1:2:1` | Ratio of newb:comp:vet bots at baseline              |
| `DIFFICULTY_REBALANCE_INTERVAL` | 120s    | How often to check planet imbalance for bot rotation |
| `PLANET_IMBALANCE_THRESHOLD`    | 0.6     | Fraction of planets triggering difficulty rotation   |
| `WIN_PAUSE_DURATION`            | 15s     | Seconds to show win screen before game reset         |

## Lobby & Server System

### Server Model

- Single persistent game server (North America)
- Always running — players drop in and out
- If all 16 human slots fill, server spins up a second instance on the same host
- Future: Europe and Asia servers if population warrants

### Lobby Screen

Retro terminal style matching the classic Netrek aesthetic:

- **MOTD** — server news and welcome message
- **Server info** — player count, T-Mode status, server options (ships allowed, tractor/pressor enabled, etc.)
- **Team picker** — shows teams with current player counts, player picks freely
- **Player list** — all connected players with name, ship type, team, stats (bots listed alongside humans)

### Join Flow

1. Player connects, sees lobby screen with MOTD and server info
2. Player picks team (free choice, bots redistribute to balance)
3. Player picks ship type
4. Player enters game

## Win Condition & Game Reset

- Win by genocide: capture all enemy planets (requires T-Mode — 4+ players per team, bots count toward this threshold)
- "Federation Wins!" (or appropriate team) broadcast to all players
- 10-15 second pause for players to see the result
- Server resets: planets to default positions/teams/armies, ships respawn at homeworlds, scores persist for the session
- Humans stay connected, no need to reconnect
- Bots respawn at baseline difficulty (4 per team)

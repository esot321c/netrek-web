# Chat, Player List, Macros & Documentation

**Date:** 2026-05-05
**Branch:** feature/bots-and-lobby
**Status:** Approved

## Overview

Add the classic Netrek bottom-panel UI: a player list (left) and chat area (right) with personal/team/all messaging, kill announcements, macro system, and typing line. Also add documentation pages to the website for the default keymap and macro reference.

The tactical view, galactic map, and dashboard are out of scope — they already work.

## Layout

The existing bottom panel (140px, currently a placeholder) is replaced with two side-by-side panels matching the classic Netrek screenshot layout:

```
┌─────────────────────┬─────────────────────┐
│                     │                     │
│   Tactical View     │   Galactic Map      │
│                     │                     │
├─────────────────────┼─────────────────────┤
│                     │  Typing line        │
│   Player List       │  Personal messages  │
│   (table)           │  Team messages      │
│                     │  All messages       │
│                     │  Kill announcements │
└─────────────────────┴─────────────────────┘
```

### Player List (bottom-left)

Monospace table with columns:

| Column | Width     | Content                                                                            |
| ------ | --------- | ---------------------------------------------------------------------------------- |
| No     | 2 chars   | Slot number (0-15)                                                                 |
| Ty     | 3 chars   | Team letter + slot digit (e.g., `Fe3`, `Ro5`)                                      |
| Rank   | ~8 chars  | Player rank — placeholder "Ens" (Ensign) for all until rank formula is implemented |
| Name   | ~16 chars | Player display name                                                                |
| Kills  | 5 chars   | Current kill count (e.g., `2.30`)                                                  |
| Login  | remainder | Username                                                                           |

- Rows are team-colored
- All players shown (alive, dead, exploding) — dead players dimmed
- Updates every tick from cached roster + live game state
- Header row with column labels

### Chat Area (bottom-right)

Stacked vertically, each section is a small scrolling region:

1. **Typing line** (top, 1 line) — shows current input with mode prefix: `[TEAM]`, `[ALL]`, `[->Fe3]`
2. **Personal messages** — DMs sent/received, newest at bottom
3. **Team messages** — your team's chat
4. **All messages** — global chat
5. **Kill announcements** (bottom, 1 line) — most recent kill, e.g., `Fe3 (CA) was killed by Ro5 (DD)`

Messages are formatted as: `Fe3->TEAM: bomb earth` with team-colored sender prefix.

Each section (personal, team, all) shows the ~3-4 most recent messages with scrollback. Kill announcement line shows only the latest kill.

## Chat System

### Message Types

| Type     | Destination                  | Server routing                              |
| -------- | ---------------------------- | ------------------------------------------- |
| Team     | All players on sender's team | Existing: `team` field in chat payload      |
| All      | Every player                 | Existing: `team = -1`                       |
| Personal | One specific player          | **New:** `targetSlot` field in chat payload |

### Keyboard-Driven Input Flow (matches original Netrek)

1. Press `m` — typing line shows `Send to: `
2. Press destination key:
   - `T` = team message
   - `A` = all message
   - `0-9`, `a-f` = personal message to that player slot
3. Typing line shows prefix (e.g., `[TEAM] _`)
4. Type message text
5. **Enter** sends the message
6. **Escape** cancels and exits typing mode

While in typing mode, all game keyboard inputs are suppressed — keypresses go to the message buffer only. Mouse inputs for game control remain active.

Clicking in the typing line area also focuses it (shows `Send to: ` prompt if not already in typing mode).

### Server Changes for Chat

**Extended chat payload:**

```typescript
// Client → Server
interface ChatPayload {
  text: string;
  team: number; // Team enum for team chat, -1 for all
  targetSlot?: number; // For personal messages — specific player slot
}
```

**Personal message routing:** When `targetSlot` is set, server delivers only to:

- The recipient (if connected)
- The sender (echo, so they see their own message)

The `ChatMessage` type gains an optional `targetSlot` field so the client can distinguish personal messages from team/all.

## Kill Announcements

### Server: New `"kill"` Event

Emitted from `checkDeaths()` in `game-loop.service.ts` whenever a ship is destroyed. The game loop already tracks `lastDamagedBySlot` for kill credit — we emit the event right after setting `ShipStatus.EXPLODING`.

```typescript
interface KillEvent {
  killerSlot: number; // -1 if self-destruct / planet damage / no attribution
  killerName: string; // from roster
  killerShipType: number; // ShipType enum
  killerTeam: number; // Team enum
  victimSlot: number;
  victimName: string;
  victimShipType: number;
  victimTeam: number;
  armiesLost: number; // armies the victim was carrying
  tick: number;
}
```

Broadcast to all connected players via `socket.emit("kill", event)`.

The gateway (or broadcast service) needs access to player names from the roster to populate killer/victim names.

### Client Display

- Single line at the bottom of the chat area
- Format: `Fe3 (CA) was killed by Ro5 (DD) [+3 armies]`
- If self-destruct or no killer attribution: `Fe3 (CA) was destroyed`
- Shows most recent kill only; previous kills scroll away or fade

## Player Roster

### New `"roster"` Event

The client needs player names, but the binary protocol doesn't transmit them (and shouldn't — names don't belong in the 10Hz hot path).

**Server emits `"roster"` (JSON) on:**

- Player join (after slot allocation)
- Player leave (after slot cleanup)
- Bot spawn/despawn

**Payload:**

```typescript
interface RosterEntry {
  name: string;
  team: number;
  shipType: number;
}

// Server → Client
type RosterEvent = Record<number, RosterEntry>; // keyed by slot number
```

Broadcast to all connected players. The client caches this and uses it for:

- Player list table (name column)
- Chat display (sender names)
- Kill announcement names
- Macro `%` variable substitutions that reference other players

## Macro System

### Activation

- Press `X` to enter macro mode
- Press the macro key (e.g., `b`) to fire the macro
- If the macro has a preset destination, it sends immediately
- If the macro has no destination (`dest: null`), the typing line shows `Send to: ` and the user presses a destination key (same flow as `m`)

### Storage

Macros stored in `localStorage` under key `netrek-macros`. Format:

```typescript
interface MacroDef {
  dest: "T" | "A" | null; // T=team, A=all, null=prompt user
  text: string; // message template with % substitutions
}

type MacroMap = Record<string, MacroDef>; // keyed by single character
```

### Default Macros

Ship with these defaults (user can override via localStorage, macro editor is a future feature):

| Key | Dest | Text                                    |
| --- | ---- | --------------------------------------- |
| `b` | T    | `bombing %l`                            |
| `e` | T    | `need escort to %l, carrying %a`        |
| `f` | T    | `%T%c carrying %a armies, headed to %l` |
| `h` | T    | `help at %l!`                           |
| `1` | T    | `I need fuel!  %f%% fuel left`          |
| `2` | T    | `I need repair!  %d%% damage`           |
| `3` | T    | `ogg %p`                                |
| `4` | T    | `defending %l`                          |
| `5` | A    | `good game!`                            |

### Substitution Variables

Implemented in a `expandMacro(template, gameState, mySlot, roster)` function in the shared or client package.

| Variable | Expands to                                                                                |
| -------- | ----------------------------------------------------------------------------------------- |
| `%a`     | Armies carried by sender                                                                  |
| `%d`     | Sender damage percentage                                                                  |
| `%s`     | Sender shield percentage                                                                  |
| `%f`     | Sender fuel percentage                                                                    |
| `%w`     | Sender weapon temperature percentage                                                      |
| `%e`     | Sender engine temperature percentage                                                      |
| `%W`     | `1` if weapon-temped, `0` if not                                                          |
| `%E`     | `1` if engine-temped, `0` if not                                                          |
| `%k`     | Sender's kill count                                                                       |
| `%S`     | Sender two-character ship type (SC, DD, CA, BB, AS, SB)                                   |
| `%T`     | Sender team ID character (F, R, K, O)                                                     |
| `%o`     | Sender three-letter team name (Fed, Rom, Kli, Ori)                                        |
| `%c`     | Sender slot digit character                                                               |
| `%i`     | Sender player name                                                                        |
| `%l`     | Name of planet nearest to sender                                                          |
| `%n`     | Armies on nearest planet                                                                  |
| `%t`     | Team character of nearest planet                                                          |
| `%z`     | Three-letter team name of nearest planet                                                  |
| `%p`     | Nearest enemy player ID (e.g., `Ro5`)                                                     |
| `%u`     | Nearest enemy player full name                                                            |
| `%g`     | Nearest friendly player ID                                                                |
| `%b`     | Nearest planet name (to sender) — same as `%l` since we use ship position for all lookups |
| `%%`     | Literal `%` character                                                                     |

Variables that depend on mouse position (like the original `%p` at-mouse) use the sender's ship position instead, since macros fire instantly without mouse context.

### Deferred (not in this scope)

- Conditional expressions (`%?%n>4%{...%!...%}`)
- Single-key macros (`singleMacro` config)
- Macro editor UI
- Custom keymap remapping

## Server Implementation Details

### Where kill events are emitted

In `game-loop.service.ts`, inside `checkDeaths()`, after the line that sets `ship.status = ShipStatus.EXPLODING`:

1. Build the `KillEvent` object using `ship`, `ships[ship.lastDamagedBySlot]`, and the roster
2. Emit via `EventEmitter2` as a new `GAME_KILL_EVENT`
3. `GameBroadcastService` listens for `GAME_KILL_EVENT` and broadcasts to all connected players

### Where roster events are emitted

In `GameGateway`:

- After `handleConnection()` succeeds and slot is allocated
- After `handleDisconnect()` cleans up the slot
- After bot manager spawns/despawns bots

The broadcast service builds the roster snapshot from `gameState.ships` + a name lookup (stored when players connect via the token's `username` field).

### Player name storage

`GameBroadcastService.addPlayer()` currently stores `{ socket, slot, userId }`. Extend `ConnectedPlayer` to include `username` (sourced from the JWT payload). Bot names come from `BotPlayer.name`.

Build a `getRoster()` method that iterates all active ships and returns `Record<number, RosterEntry>`.

## Client Implementation Details

### New files

- `apps/client/lib/game/chat.ts` — Chat state management: message buffers (personal, team, all, kills), typing mode state machine, macro expansion, roster cache
- `apps/client/components/chat-panel.tsx` — React component for the chat area (typing line, message sections, kill line)
- `apps/client/components/player-list-panel.tsx` — React component for the richer player list table
- `apps/client/lib/game/macros.ts` — Macro definitions, localStorage persistence, `expandMacro()` function

### Modified files

- `apps/client/components/game-canvas.tsx` — Replace bottom panel placeholder with `ChatPanel` + `PlayerListPanel`. Wire up new socket events.
- `apps/client/lib/game/socket.ts` — Add `onChat()`, `onKill()`, `onRoster()` callbacks. Add `sendChat()` function.
- `apps/client/lib/game/input.ts` — Add typing mode: when active, suppress game keys, route to chat buffer. Handle `m` key (start message), `X` key (macro mode), Enter/Escape.
- `apps/server/src/game/game-loop.service.ts` — Emit kill events from `checkDeaths()`.
- `apps/server/src/game/game.gateway.ts` — Handle personal messages (`targetSlot`), emit roster on join/leave. Store username from JWT payload.
- `apps/server/src/game/game-broadcast.service.ts` — Extend `ConnectedPlayer` with `username`. Add `getRoster()`. Listen for kill events, broadcast to clients.
- `packages/shared/src/game/bot-types.ts` — Add optional `targetSlot` to `ChatMessage`.

### Input state machine

```
IDLE ──(m)──> DEST_PROMPT ──(T/A/0-9)──> TYPING ──(Enter)──> send & IDLE
                                              │
                                          (Escape)──> IDLE

IDLE ──(X)──> MACRO_WAIT ──(key)──> expand macro
                                        │
                                  (has dest) ──> send & IDLE
                                  (no dest) ──> DEST_PROMPT ──(T/A/0-9)──> send & IDLE
```

Game keys are only processed when input state is `IDLE`.

## Documentation Pages

### New routes in the client app

- `/docs/keymap` — Default Netrek keyboard commands reference
- `/docs/macros` — Macro system reference (how to use, substitution variables, default macros)

### Keymap page content

The full default command table as provided by the original Netrek documentation:

**Lowercase commands:**
| Key | Action |
|-----|--------|
| a | (unbound) |
| b | Bomb Planet |
| c | Cloak/uncloak |
| d | Detonate enemy Torp |
| e | Toggle docking permission (SB only) |
| f | Plasma torpedo |
| h | Help window |
| i | Information |
| k | Set course (at mouse) |
| l | Lock onto object (at mouse) |
| m | Start sending message |
| o | Orbit |
| p | Phasers |
| q | Quit game quickly |
| r | Refit |
| s | Shields |
| t | Torpedo |
| w | Change war declaration |
| x | Beam down |
| y | Pressor beam |
| z | Beam up |

**Uppercase commands:**
| Key | Action |
|-----|--------|
| B | Cycle Galactic Map Planet Displays |
| D | Detonate your own Torps |
| E | Send generic distress call |
| F | Send "armies carried" report |
| H | (unbound) |
| I | More Info |
| K | (unbound) |
| L | Players list |
| M | Toggle Message Log |
| N | Toggle Long/Short Planet Names (Tactical) |
| O | Options Window |
| P | Planet Window |
| Q | Quit but read MOTD first |
| R | Enter Repair mode (speed=0, no shields) |
| S | Toggle Stats Window |
| T | Tractor Beam |
| U | Rank Window |
| V | Cycle Tactical Planet Display Options |
| X | Enter Macro Mode |

**Number keys:**
| Key | Action | Shift | Action |
|-----|--------|-------|--------|
| 0 | Stop | ) | Warp 10 |
| 1 | Warp 1 | ! | Warp 11 |
| 2 | Warp 2 | @ | Warp 12 |
| 3 | Warp 3 | # | (unbound) |
| 4 | Warp 4 | $ | Tractor/pressor off |
| 5 | Warp 5 | % | Maximum warp |
| 6 | Warp 6 | ^ | Pressor beam ON |
| 7 | Warp 7 | & | Read netrekrc settings |
| 8 | Warp 8 | \* | Send in Robot / transwarp to SB |
| 9 | Warp 9 | ( | (unbound) |

**Special keys:**
| Key | Action | Shift | Action |
|-----|--------|-------|--------|
| - | Request partial update | \_ | Tractor beam ON |
| = | Request full update (UDP) | + | Toggle UDP control window |
| [ | Shields down | { | Cloak ON |
| ] | Shields up | } | Cloak OFF |
| ; | Lock onto Planet or Starbase | : | Read netrekrc settings |
| , | Toggle Ping Stats | < | Decrease Warp by one |
| . | (unbound) | > | Increase Warp by one |
| / | Toggle Lag window options | ? | Cycle Message window options |
| Space | Turn off extra windows | | |

Note: Not all original commands are implemented in the web version. The keymap page should indicate which commands are active and which are planned.

### Macros page content

- How macro mode works (`X` + key)
- The destination system (T, A, slot numbers)
- Complete substitution variable reference table
- Default macro list
- Note that conditional expressions are planned but not yet implemented

### Navigation

- Link from the lobby page (sidebar or header)
- Link from the in-game help overlay (`h` key) — add "Full docs: /docs/keymap"
- Simple static pages, monospace styling consistent with game aesthetic

## What This Spec Does NOT Cover

- Custom keymap remapping UI
- Macro editor UI
- Conditional macro expressions (`%?...%{...%!...%}`)
- Single-key macros
- Chat message history persistence
- Message log toggle (`M` key)
- Distress calls (`E` key — sends a structured status report)
- War declarations (`w` key)
- Rank calculation formula (player list shows rank, but the formula is TBD)

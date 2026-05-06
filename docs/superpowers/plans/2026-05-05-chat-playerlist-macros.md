# Chat, Player List, Macros & Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the classic Netrek bottom-panel UI with chat (personal/team/all), kill announcements, player list table, macro system, and documentation pages.

**Architecture:** Server emits new JSON events (`roster`, `kill`) alongside existing binary state. Client adds a chat state module (message buffers, typing state machine) and macro expansion. The bottom panel placeholder is replaced with two React components: PlayerListPanel (left) and ChatPanel (right). Input module gains a typing mode that suppresses game keys during message composition.

**Tech Stack:** TypeScript, NestJS (server), Next.js/React (client), Socket.IO, localStorage (macros)

---

## File Map

### New files

| File                                           | Responsibility                                                                           |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `packages/shared/src/game/chat-types.ts`       | `KillEvent`, `RosterEntry` interfaces, team/ship name lookup constants                   |
| `apps/client/lib/game/chat.ts`                 | Chat state: message buffers (personal/team/all/kill), roster cache, typing state machine |
| `apps/client/lib/game/macros.ts`               | Macro definitions, localStorage persistence, `expandMacro()`                             |
| `apps/client/components/chat-panel.tsx`        | React component: typing line, message sections, kill line                                |
| `apps/client/components/player-list-panel.tsx` | React component: roster table with team colors                                           |
| `apps/client/app/docs/keymap/page.tsx`         | Documentation page: default keyboard commands                                            |
| `apps/client/app/docs/macros/page.tsx`         | Documentation page: macro system reference                                               |

### Modified files

| File                                              | Changes                                                                                              |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `packages/shared/src/game/index.ts`               | Add `export * from "./chat-types"`                                                                   |
| `packages/shared/src/game/bot-types.ts`           | Add optional `targetSlot` to `ChatMessage`                                                           |
| `apps/server/src/game/game-broadcast.service.ts`  | Extend `ConnectedPlayer` with `username`, add `getRoster()`, `broadcastRoster()`, handle kill events |
| `apps/server/src/game/game.gateway.ts`            | Pass `username` to `addPlayer()`, handle `targetSlot` in chat, emit roster on join/leave             |
| `apps/server/src/game/game-loop.service.ts`       | Export `GAME_KILL_EVENT`, emit kill events from `checkDeaths()`                                      |
| `apps/server/src/game/bot/bot-manager.service.ts` | Call `broadcastRoster()` on bot spawn/despawn                                                        |
| `apps/client/lib/game/socket.ts`                  | Add `onChat()`, `onKill()`, `onRoster()` callbacks, `sendChat()`                                     |
| `apps/client/lib/game/input.ts`                   | Typing mode state machine, `m`/`X`/Enter/Escape keys, suppress game keys while typing                |
| `apps/client/components/game-canvas.tsx`          | Replace bottom panel placeholder, wire up new socket events, remove old `PlayerList`                 |

---

## Task 1: Shared Types — KillEvent, RosterEntry, Chat Constants

**Files:**

- Create: `packages/shared/src/game/chat-types.ts`
- Modify: `packages/shared/src/game/index.ts`
- Modify: `packages/shared/src/game/bot-types.ts`

- [ ] **Step 1: Create `chat-types.ts` with shared interfaces and lookup constants**

```typescript
// packages/shared/src/game/chat-types.ts

export interface KillEvent {
  killerSlot: number;
  killerName: string;
  killerShipType: number;
  killerTeam: number;
  victimSlot: number;
  victimName: string;
  victimShipType: number;
  victimTeam: number;
  armiesLost: number;
  tick: number;
}

export interface RosterEntry {
  name: string;
  team: number;
  shipType: number;
}

export type RosterMap = Record<number, RosterEntry>;

export const TEAM_CHARS = ["F", "R", "K", "O"] as const;
export const TEAM_NAMES_SHORT = ["Fed", "Rom", "Kli", "Ori"] as const;
export const TEAM_NAMES_FULL = [
  "Federation",
  "Romulans",
  "Klingons",
  "Orions",
] as const;
export const SHIP_NAMES = ["SC", "DD", "CA", "BB", "AS", "SB"] as const;

export function formatPlayerTag(team: number, slot: number): string {
  return `${TEAM_NAMES_SHORT[team] ?? "??"}${slot.toString(16)}`;
}
```

- [ ] **Step 2: Add `targetSlot` to `ChatMessage` in `bot-types.ts`**

In `packages/shared/src/game/bot-types.ts`, add `targetSlot` to the `ChatMessage` interface:

```typescript
export interface ChatMessage {
  senderSlot: number;
  senderName: string;
  team: number; // Team enum, -1 for all-chat
  text: string;
  tick: number;
  targetSlot?: number; // for personal messages
}
```

- [ ] **Step 3: Export from shared index**

In `packages/shared/src/game/index.ts`, add:

```typescript
export * from "./chat-types";
```

- [ ] **Step 4: Build shared package to verify**

Run: `cd packages/shared && pnpm build`
Expected: Compiles with no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/game/chat-types.ts packages/shared/src/game/index.ts packages/shared/src/game/bot-types.ts
git commit -m "feat(shared): add KillEvent, RosterEntry types and chat constants"
```

---

## Task 2: Server — Roster Broadcasting

**Files:**

- Modify: `apps/server/src/game/game-broadcast.service.ts`
- Modify: `apps/server/src/game/game.gateway.ts`

- [ ] **Step 1: Extend `ConnectedPlayer` with `username` and add roster methods**

In `apps/server/src/game/game-broadcast.service.ts`:

1. Add import for `RosterEntry` and `RosterMap`:

```typescript
import {
  serializeGameState,
  type RosterEntry,
  type RosterMap,
} from "@netrek/shared";
```

2. Extend the `ConnectedPlayer` interface:

```typescript
interface ConnectedPlayer {
  socket: Socket;
  slot: number;
  userId: string;
  username: string;
}
```

3. Update `addPlayer()` to accept and store `username`:

```typescript
addPlayer(
  socketId: string,
  socket: Socket,
  slot: number,
  userId: string,
  username: string,
): void {
  this.players.set(socketId, { socket, slot, userId, username });
}
```

4. Add `getPlayerBySlot()`:

```typescript
getPlayerBySlot(slot: number): ConnectedPlayer | undefined {
  for (const player of this.players.values()) {
    if (player.slot === slot) return player;
  }
  return undefined;
}
```

5. Add `getRoster()` and `broadcastRoster()`:

```typescript
getRoster(): RosterMap {
  const roster: RosterMap = {};
  const state = this.gameService.state;
  for (const player of this.players.values()) {
    const ship = state.ships[player.slot];
    if (ship && ship.playerId) {
      roster[player.slot] = {
        name: player.username,
        team: ship.team,
        shipType: ship.shipType,
      };
    }
  }
  return roster;
}

broadcastRoster(): void {
  const roster = this.getRoster();
  for (const player of this.players.values()) {
    player.socket.emit("roster", roster);
  }
}
```

- [ ] **Step 2: Update gateway to pass `username` and emit roster**

In `apps/server/src/game/game.gateway.ts`:

1. Update `handleConnection()` — pass `payload.username` to `addPlayer()` and call `broadcastRoster()` after join:

Change:

```typescript
this.broadcastService.addPlayer(client.id, client, slot, payload.sub);
```

To:

```typescript
this.broadcastService.addPlayer(
  client.id,
  client,
  slot,
  payload.sub,
  payload.username,
);
```

Then after `client.emit("joined", { slot });`, add:

```typescript
this.broadcastService.broadcastRoster();
```

2. Update `handleDisconnect()` — call `broadcastRoster()` after removing the player. After the `this.logger.log(...)` line inside the `if (player)` block, add:

```typescript
this.broadcastService.broadcastRoster();
```

3. Update `handleChat()` — use `username` instead of `userId` for `senderName`, and handle `targetSlot` for personal messages.

Replace the entire `handleChat` method:

```typescript
@SubscribeMessage("chat")
handleChat(
  @ConnectedSocket() client: Socket,
  @MessageBody() data: { text: string; team: number; targetSlot?: number },
): void {
  const player = this.broadcastService.getPlayerBySocketId(client.id);
  if (!player) return;

  const ship = this.gameService.state.ships[player.slot];
  if (!ship) return;

  const message: ChatMessage = {
    senderSlot: player.slot,
    senderName: player.username,
    team: data.team,
    text: data.text,
    tick: this.gameService.state.currentTick,
    targetSlot: data.targetSlot,
  };

  if (this.server) {
    if (data.targetSlot !== undefined && data.targetSlot >= 0) {
      // Personal message — deliver to recipient + echo to sender
      const recipient = this.broadcastService.getPlayerBySlot(data.targetSlot);
      if (recipient) {
        recipient.socket.emit("chat", message);
      }
      if (player.slot !== data.targetSlot) {
        player.socket.emit("chat", message);
      }
    } else {
      for (const p of this.broadcastService.getAllPlayers()) {
        const pShip = this.gameService.state.ships[p.slot];
        if (data.team === -1 || (pShip && pShip.team === data.team)) {
          p.socket.emit("chat", message);
        }
      }
    }
  }

  this.botManager.onChatMessage(message);
}
```

- [ ] **Step 3: Build server to verify**

Run: `cd apps/server && pnpm build`
Expected: Compiles with no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/game/game-broadcast.service.ts apps/server/src/game/game.gateway.ts
git commit -m "feat(server): roster broadcasting and personal message routing"
```

---

## Task 3: Server — Kill Event Broadcasting

**Files:**

- Modify: `apps/server/src/game/game-loop.service.ts`
- Modify: `apps/server/src/game/game-broadcast.service.ts`

- [ ] **Step 1: Export `GAME_KILL_EVENT` and emit kill events from `checkDeaths()`**

In `apps/server/src/game/game-loop.service.ts`:

1. Add the export constant next to the existing event constants (around line 88):

```typescript
export const GAME_KILL_EVENT = "game.kill";
```

2. Add `KillEvent` to the import from `@netrek/shared`:

```typescript
import {
  // ... existing imports ...
  type KillEvent,
} from "@netrek/shared";
```

3. In `checkDeaths()`, right after `ship.status = ShipStatus.EXPLODING;` (line 1342) and before `ship.explodeTicks = EXPLOSION_DURATION_TICKS;`, capture the kill info and emit. The `armies` field hasn't been zeroed yet at this point (that happens at line 1356), so we can read it:

Insert this block right after `ship.status = ShipStatus.EXPLODING;`:

```typescript
// Emit kill event for chat announcements
const armiesLost = ship.armies;
const killerSlot = ship.lastDamagedBySlot;
const killerShip = killerSlot >= 0 ? ships[killerSlot] : undefined;
this.eventEmitter.emit(GAME_KILL_EVENT, {
  killerSlot: killerSlot,
  killerName: killerShip?.playerId ?? "",
  killerShipType: killerShip?.shipType ?? 0,
  killerTeam: killerShip?.team ?? 0,
  victimSlot: ship.slotIndex,
  victimName: ship.playerId,
  victimShipType: ship.shipType,
  victimTeam: ship.team,
  armiesLost,
  tick: state.currentTick,
} satisfies KillEvent);
```

Note: `killerName` uses `playerId` here (which is the userId). The broadcast service will replace it with the display username from the roster before sending to clients.

- [ ] **Step 2: Handle kill events in `GameBroadcastService`**

In `apps/server/src/game/game-broadcast.service.ts`:

1. Add `GAME_KILL_EVENT` to the import:

```typescript
import {
  GameLoopService,
  GAME_TICK_EVENT,
  GAME_WIN_EVENT,
  GAME_KILL_EVENT,
} from "./game-loop.service";
```

2. Add `KillEvent` to the `@netrek/shared` import:

```typescript
import {
  serializeGameState,
  type RosterEntry,
  type RosterMap,
  type KillEvent,
} from "@netrek/shared";
```

3. Add the kill event handler method:

```typescript
@OnEvent(GAME_KILL_EVENT)
handleKill(event: KillEvent): void {
  // Resolve display names from roster
  const killerPlayer = event.killerSlot >= 0
    ? this.getPlayerBySlot(event.killerSlot)
    : undefined;
  const victimPlayer = this.getPlayerBySlot(event.victimSlot);

  const resolved: KillEvent = {
    ...event,
    killerName: killerPlayer?.username ?? event.killerName,
    victimName: victimPlayer?.username ?? event.victimName,
  };

  for (const player of this.players.values()) {
    player.socket.emit("kill", resolved);
  }
}
```

- [ ] **Step 3: Build server to verify**

Run: `cd apps/server && pnpm build`
Expected: Compiles with no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/game/game-loop.service.ts apps/server/src/game/game-broadcast.service.ts
git commit -m "feat(server): emit kill events from checkDeaths for chat announcements"
```

---

## Task 4: Server — Roster Events from Bot Manager

**Files:**

- Modify: `apps/server/src/game/bot/bot-manager.service.ts`

- [ ] **Step 1: Emit roster updates from bot spawn/despawn and add bot names to roster**

The `BotManagerService` already has access to `GameBroadcastService` — check:

In `apps/server/src/game/bot/bot-manager.service.ts`:

1. Check if `GameBroadcastService` is injected. If not, add it to the constructor. It's likely injected already since bots interact with the game service. If it needs adding:

```typescript
import { GameBroadcastService } from "../game-broadcast.service";
```

And in the constructor:

```typescript
constructor(
  private readonly gameService: GameService,
  private readonly broadcastService: GameBroadcastService,
  // ... existing params
) {}
```

2. In `spawnBot()`, after the bot is successfully spawned and assigned a slot, call:

```typescript
this.broadcastService.broadcastRoster();
```

3. In `removeBot()`, after the bot is removed from the game, call:

```typescript
this.broadcastService.broadcastRoster();
```

4. The `getRoster()` method in `GameBroadcastService` only finds human players (those in the `players` Map). We need bot names too. Add a `botNames` Map to `GameBroadcastService`:

In `apps/server/src/game/game-broadcast.service.ts`, add:

```typescript
private readonly botNames = new Map<number, string>(); // slot -> bot name

setBotName(slot: number, name: string): void {
  this.botNames.set(slot, name);
}

removeBotName(slot: number): void {
  this.botNames.delete(slot);
}
```

Update `getRoster()` to include bots:

```typescript
getRoster(): RosterMap {
  const roster: RosterMap = {};
  const state = this.gameService.state;

  // Human players
  for (const player of this.players.values()) {
    const ship = state.ships[player.slot];
    if (ship && ship.playerId) {
      roster[player.slot] = {
        name: player.username,
        team: ship.team,
        shipType: ship.shipType,
      };
    }
  }

  // Bots
  for (const [slot, name] of this.botNames) {
    const ship = state.ships[slot];
    if (ship && ship.playerId) {
      roster[slot] = {
        name,
        team: ship.team,
        shipType: ship.shipType,
      };
    }
  }

  return roster;
}
```

5. In `bot-manager.service.ts`, call `setBotName`/`removeBotName`:

In `spawnBot()`, after `bot.assignSlot(slot)`:

```typescript
this.broadcastService.setBotName(slot, bot.name);
```

In `removeBot()`, before or after `this.gameService.leaveGame(slot)`:

```typescript
this.broadcastService.removeBotName(slot);
```

- [ ] **Step 2: Build server to verify**

Run: `cd apps/server && pnpm build`
Expected: Compiles with no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/game/bot/bot-manager.service.ts apps/server/src/game/game-broadcast.service.ts
git commit -m "feat(server): broadcast roster on bot spawn/despawn"
```

---

## Task 5: Client — Socket Event Handlers

**Files:**

- Modify: `apps/client/lib/game/socket.ts`

- [ ] **Step 1: Add chat, kill, and roster callbacks and sendChat function**

In `apps/client/lib/game/socket.ts`:

1. Add imports:

```typescript
import {
  deserializeGameState,
  serializeInput,
  InputCommand,
  type ClientGameState,
  type ChatMessage,
  type KillEvent,
  type RosterMap,
} from "@netrek/shared";
```

2. Add callback variables alongside the existing ones:

```typescript
let chatCallback: ((msg: ChatMessage) => void) | null = null;
let killCallback: ((event: KillEvent) => void) | null = null;
let rosterCallback: ((roster: RosterMap) => void) | null = null;
```

3. In the `connect()` function, after the existing `socket.on("joined", ...)` handler, add:

```typescript
socket.on("chat", (msg: ChatMessage) => {
  chatCallback?.(msg);
});

socket.on("kill", (event: KillEvent) => {
  killCallback?.(event);
});

socket.on("roster", (roster: RosterMap) => {
  rosterCallback?.(roster);
});
```

4. Add registration functions:

```typescript
export function onChat(cb: (msg: ChatMessage) => void): void {
  chatCallback = cb;
}

export function onKill(cb: (event: KillEvent) => void): void {
  killCallback = cb;
}

export function onRoster(cb: (roster: RosterMap) => void): void {
  rosterCallback = cb;
}
```

5. Add send function:

```typescript
export function sendChat(
  text: string,
  team: number,
  targetSlot?: number,
): void {
  if (!socket) return;
  socket.emit("chat", { text, team, targetSlot });
}
```

- [ ] **Step 2: Verify the client still compiles**

Run: `cd apps/client && pnpm build`
Expected: Compiles. (No consumers of the new functions yet, but the module should parse.)

- [ ] **Step 3: Commit**

```bash
git add apps/client/lib/game/socket.ts
git commit -m "feat(client): add socket handlers for chat, kill, and roster events"
```

---

## Task 6: Client — Chat State Module

**Files:**

- Create: `apps/client/lib/game/chat.ts`

- [ ] **Step 1: Create the chat state module**

This module manages:

- Message buffers for personal, team, all, and kill channels
- The roster cache
- Typing mode state machine (IDLE → DEST_PROMPT → TYPING)

```typescript
// apps/client/lib/game/chat.ts

import type {
  ChatMessage,
  KillEvent,
  RosterMap,
  RosterEntry,
} from "@netrek/shared";
import { TEAM_NAMES_SHORT, SHIP_NAMES, formatPlayerTag } from "@netrek/shared";

// ---------------------------------------------------------------------------
// Message buffers
// ---------------------------------------------------------------------------

const MAX_MESSAGES = 50;

export interface DisplayMessage {
  text: string;
  color: string;
  timestamp: number;
}

const personalMessages: DisplayMessage[] = [];
const teamMessages: DisplayMessage[] = [];
const allMessages: DisplayMessage[] = [];
let lastKillMessage: DisplayMessage | null = null;

export function getPersonalMessages(): readonly DisplayMessage[] {
  return personalMessages;
}

export function getTeamMessages(): readonly DisplayMessage[] {
  return teamMessages;
}

export function getAllMessages(): readonly DisplayMessage[] {
  return allMessages;
}

export function getLastKillMessage(): DisplayMessage | null {
  return lastKillMessage;
}

// ---------------------------------------------------------------------------
// Team colors
// ---------------------------------------------------------------------------

const TEAM_COLORS: Record<number, string> = {
  0: "#ffff00", // Federation
  1: "#ff4444", // Romulans
  2: "#44ff44", // Klingons
  3: "#44ffff", // Orions
};

function teamColor(team: number): string {
  return TEAM_COLORS[team] ?? "#888888";
}

// ---------------------------------------------------------------------------
// Roster cache
// ---------------------------------------------------------------------------

let roster: RosterMap = {};

export function getRoster(): RosterMap {
  return roster;
}

export function updateRoster(newRoster: RosterMap): void {
  roster = newRoster;
}

export function getRosterEntry(slot: number): RosterEntry | undefined {
  return roster[slot];
}

// ---------------------------------------------------------------------------
// Incoming message handlers
// ---------------------------------------------------------------------------

function addMessage(buf: DisplayMessage[], msg: DisplayMessage): void {
  buf.push(msg);
  if (buf.length > MAX_MESSAGES) {
    buf.shift();
  }
}

export function handleChatMessage(msg: ChatMessage, mySlot: number): void {
  const entry = roster[msg.senderSlot];
  const senderTag = entry
    ? formatPlayerTag(entry.team, msg.senderSlot)
    : `?${msg.senderSlot}`;
  const color = entry ? teamColor(entry.team) : "#888888";

  if (msg.targetSlot !== undefined && msg.targetSlot >= 0) {
    // Personal message
    const recipientEntry = roster[msg.targetSlot];
    const recipientTag = recipientEntry
      ? formatPlayerTag(recipientEntry.team, msg.targetSlot)
      : `?${msg.targetSlot}`;
    const prefix =
      msg.senderSlot === mySlot
        ? `${senderTag}->${recipientTag}`
        : `${senderTag}->you`;
    addMessage(personalMessages, {
      text: `${prefix}: ${msg.text}`,
      color,
      timestamp: Date.now(),
    });
  } else if (msg.team === -1) {
    // All chat
    addMessage(allMessages, {
      text: `${senderTag}->ALL: ${msg.text}`,
      color,
      timestamp: Date.now(),
    });
  } else {
    // Team chat
    addMessage(teamMessages, {
      text: `${senderTag}->TEAM: ${msg.text}`,
      color,
      timestamp: Date.now(),
    });
  }
}

export function handleKillEvent(event: KillEvent): void {
  const victimTag = formatPlayerTag(event.victimTeam, event.victimSlot);
  const victimShip = SHIP_NAMES[event.victimShipType] ?? "??";
  let text: string;

  if (event.killerSlot >= 0) {
    const killerTag = formatPlayerTag(event.killerTeam, event.killerSlot);
    const killerShip = SHIP_NAMES[event.killerShipType] ?? "??";
    text = `${victimTag} (${victimShip}) was killed by ${killerTag} (${killerShip})`;
    if (event.armiesLost > 0) {
      text += ` [+${event.armiesLost} armies]`;
    }
  } else {
    text = `${victimTag} (${victimShip}) was destroyed`;
    if (event.armiesLost > 0) {
      text += ` [+${event.armiesLost} armies]`;
    }
  }

  lastKillMessage = {
    text,
    color: "#cccccc",
    timestamp: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Typing state machine
// ---------------------------------------------------------------------------

export enum TypingState {
  IDLE = 0,
  DEST_PROMPT = 1,
  TYPING = 2,
  MACRO_WAIT = 3,
}

export type ChatDest =
  | { type: "team"; team: number }
  | { type: "all" }
  | { type: "personal"; targetSlot: number };

let typingState: TypingState = TypingState.IDLE;
let chatDest: ChatDest | null = null;
let messageBuffer = "";

export function getTypingState(): TypingState {
  return typingState;
}

export function getChatDest(): ChatDest | null {
  return chatDest;
}

export function getMessageBuffer(): string {
  return messageBuffer;
}

export function startMessage(): void {
  typingState = TypingState.DEST_PROMPT;
  chatDest = null;
  messageBuffer = "";
}

export function startMacroMode(): void {
  typingState = TypingState.MACRO_WAIT;
  chatDest = null;
  messageBuffer = "";
}

export function selectDestination(dest: ChatDest): void {
  chatDest = dest;
  typingState = TypingState.TYPING;
  messageBuffer = "";
}

export function appendChar(ch: string): void {
  messageBuffer += ch;
}

export function deleteChar(): void {
  messageBuffer = messageBuffer.slice(0, -1);
}

export function getFinishedMessage(): { text: string; dest: ChatDest } | null {
  if (
    typingState !== TypingState.TYPING ||
    !chatDest ||
    !messageBuffer.trim()
  ) {
    return null;
  }
  return { text: messageBuffer, dest: chatDest };
}

export function cancelTyping(): void {
  typingState = TypingState.IDLE;
  chatDest = null;
  messageBuffer = "";
}

export function getTypingDisplay(): string {
  switch (typingState) {
    case TypingState.IDLE:
      return "";
    case TypingState.DEST_PROMPT:
      return "Send to: _";
    case TypingState.MACRO_WAIT:
      return "Macro: _";
    case TypingState.TYPING: {
      if (!chatDest) return "";
      let prefix: string;
      switch (chatDest.type) {
        case "team":
          prefix = "[TEAM]";
          break;
        case "all":
          prefix = "[ALL]";
          break;
        case "personal": {
          const entry = roster[chatDest.targetSlot];
          const tag = entry
            ? formatPlayerTag(entry.team, chatDest.targetSlot)
            : `?${chatDest.targetSlot}`;
          prefix = `[->${tag}]`;
          break;
        }
      }
      return `${prefix} ${messageBuffer}_`;
    }
  }
}

export function resetChat(): void {
  personalMessages.length = 0;
  teamMessages.length = 0;
  allMessages.length = 0;
  lastKillMessage = null;
  roster = {};
  typingState = TypingState.IDLE;
  chatDest = null;
  messageBuffer = "";
}
```

- [ ] **Step 2: Verify client compiles**

Run: `cd apps/client && pnpm build`
Expected: Compiles with no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/client/lib/game/chat.ts
git commit -m "feat(client): add chat state module with message buffers and typing state machine"
```

---

## Task 7: Client — Macro System

**Files:**

- Create: `apps/client/lib/game/macros.ts`

- [ ] **Step 1: Create the macro module**

```typescript
// apps/client/lib/game/macros.ts

import type { ClientGameState, RosterMap } from "@netrek/shared";
import {
  TEAM_CHARS,
  TEAM_NAMES_SHORT,
  SHIP_NAMES,
  formatPlayerTag,
} from "@netrek/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MacroDef {
  dest: "T" | "A" | null;
  text: string;
}

export type MacroMap = Record<string, MacroDef>;

// ---------------------------------------------------------------------------
// Default macros
// ---------------------------------------------------------------------------

const DEFAULT_MACROS: MacroMap = {
  b: { dest: "T", text: "bombing %l" },
  e: { dest: "T", text: "need escort to %l, carrying %a" },
  f: { dest: "T", text: "%T%c carrying %a armies, headed to %l" },
  h: { dest: "T", text: "help at %l!" },
  "1": { dest: "T", text: "I need fuel!  %f%% fuel left" },
  "2": { dest: "T", text: "I need repair!  %d%% damage" },
  "3": { dest: "T", text: "ogg %p" },
  "4": { dest: "T", text: "defending %l" },
  "5": { dest: "A", text: "good game!" },
};

const STORAGE_KEY = "netrek-macros";

// ---------------------------------------------------------------------------
// Load / save
// ---------------------------------------------------------------------------

export function loadMacros(): MacroMap {
  if (typeof window === "undefined") return { ...DEFAULT_MACROS };
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...DEFAULT_MACROS, ...JSON.parse(stored) };
    }
  } catch {
    // ignore parse errors
  }
  return { ...DEFAULT_MACROS };
}

export function saveMacros(macros: MacroMap): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(macros));
}

// ---------------------------------------------------------------------------
// Expansion
// ---------------------------------------------------------------------------

function nearestPlanet(
  state: ClientGameState,
  mySlot: number,
): { name: string; team: number; armies: number } | null {
  const myShip = state.ships.find((s) => s.slotIndex === mySlot);
  if (!myShip) return null;

  let best: (typeof state.planets)[0] | null = null;
  let bestDist = Infinity;

  for (const p of state.planets) {
    const dx = p.x - myShip.x;
    const dy = p.y - myShip.y;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }

  return best
    ? { name: best.name, team: best.team, armies: best.armies }
    : null;
}

function nearestEnemy(
  state: ClientGameState,
  mySlot: number,
  roster: RosterMap,
): { slot: number; tag: string; name: string } | null {
  const myShip = state.ships.find((s) => s.slotIndex === mySlot);
  if (!myShip) return null;

  let bestSlot = -1;
  let bestDist = Infinity;

  for (const s of state.ships) {
    if (s.slotIndex === mySlot) continue;
    if (s.status !== 0) continue;
    if (s.team === myShip.team) continue;
    const dx = s.x - myShip.x;
    const dy = s.y - myShip.y;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      bestSlot = s.slotIndex;
    }
  }

  if (bestSlot < 0) return null;
  const entry = roster[bestSlot];
  return {
    slot: bestSlot,
    tag: entry ? formatPlayerTag(entry.team, bestSlot) : `?${bestSlot}`,
    name: entry?.name ?? "unknown",
  };
}

function nearestFriendly(
  state: ClientGameState,
  mySlot: number,
  roster: RosterMap,
): { slot: number; tag: string } | null {
  const myShip = state.ships.find((s) => s.slotIndex === mySlot);
  if (!myShip) return null;

  let bestSlot = -1;
  let bestDist = Infinity;

  for (const s of state.ships) {
    if (s.slotIndex === mySlot) continue;
    if (s.status !== 0) continue;
    if (s.team !== myShip.team) continue;
    const dx = s.x - myShip.x;
    const dy = s.y - myShip.y;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      bestSlot = s.slotIndex;
    }
  }

  if (bestSlot < 0) return null;
  const entry = roster[bestSlot];
  return {
    slot: bestSlot,
    tag: entry ? formatPlayerTag(entry.team, bestSlot) : `?${bestSlot}`,
  };
}

export function expandMacro(
  template: string,
  state: ClientGameState,
  mySlot: number,
  roster: RosterMap,
): string {
  const myShip = state.ships.find((s) => s.slotIndex === mySlot);
  if (!myShip) return template;

  const myEntry = roster[mySlot];
  const planet = nearestPlanet(state, mySlot);
  const enemy = nearestEnemy(state, mySlot, roster);
  const friendly = nearestFriendly(state, mySlot, roster);

  const maxShields = 100; // normalized from shieldPct
  const shieldPct = Math.round(myShip.shieldPct * 100);
  const hullPct = Math.round(myShip.hullDamagePct * 100);
  const fuelPct = Math.round(myShip.fuelPct * 100);

  let result = "";
  let i = 0;
  while (i < template.length) {
    if (template[i] === "%" && i + 1 < template.length) {
      const code = template[i + 1]!;
      i += 2;
      switch (code) {
        case "a":
          result += state.self.armies.toString();
          break;
        case "d":
          result += hullPct.toString();
          break;
        case "s":
          result += shieldPct.toString();
          break;
        case "f":
          result += fuelPct.toString();
          break;
        case "w":
          result += Math.round((myShip.weaponTemp / 255) * 100).toString();
          break;
        case "e":
          result += Math.round((myShip.engineTemp / 255) * 100).toString();
          break;
        case "W":
          result += myShip.weaponTemp >= 255 ? "1" : "0";
          break;
        case "E":
          result += myShip.engineTemp >= 255 ? "1" : "0";
          break;
        case "k":
          result += state.self.kills.toFixed(2);
          break;
        case "S":
          result += SHIP_NAMES[myShip.shipType] ?? "??";
          break;
        case "T":
          result += TEAM_CHARS[myShip.team] ?? "?";
          break;
        case "o":
          result += TEAM_NAMES_SHORT[myShip.team] ?? "???";
          break;
        case "c":
          result += mySlot.toString(16);
          break;
        case "i":
          result += myEntry?.name ?? "unknown";
          break;
        case "l":
          result += planet?.name ?? "???";
          break;
        case "b":
          result += planet?.name ?? "???";
          break;
        case "n":
          result += planet?.armies.toString() ?? "?";
          break;
        case "t":
          result += planet ? (TEAM_CHARS[planet.team] ?? "?") : "?";
          break;
        case "z":
          result += planet ? (TEAM_NAMES_SHORT[planet.team] ?? "???") : "???";
          break;
        case "p":
          result += enemy?.tag ?? "???";
          break;
        case "u":
          result += enemy?.name ?? "unknown";
          break;
        case "g":
          result += friendly?.tag ?? "???";
          break;
        case "%":
          result += "%";
          break;
        default:
          result += "%" + code;
          break;
      }
    } else {
      result += template[i];
      i++;
    }
  }

  return result;
}
```

- [ ] **Step 2: Verify client compiles**

Run: `cd apps/client && pnpm build`
Expected: Compiles with no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/client/lib/game/macros.ts
git commit -m "feat(client): add macro system with default macros and %% variable expansion"
```

---

## Task 8: Client — Input System Typing Mode

**Files:**

- Modify: `apps/client/lib/game/input.ts`

- [ ] **Step 1: Add typing mode to the input handler**

In `apps/client/lib/game/input.ts`:

1. Add imports at the top:

```typescript
import {
  TypingState,
  getTypingState,
  startMessage,
  startMacroMode,
  selectDestination,
  appendChar,
  deleteChar,
  getFinishedMessage,
  cancelTyping,
  getRoster,
  type ChatDest,
} from "./chat";
import { loadMacros, expandMacro } from "./macros";
import { sendChat } from "./socket";
```

2. Add a callback for when chat state changes (so React can re-render):

```typescript
let chatChangeCallback: (() => void) | null = null;

export function onChatChange(cb: () => void): void {
  chatChangeCallback = cb;
}

function notifyChatChange(): void {
  chatChangeCallback?.();
}
```

3. Replace the `handleKeyDown` function entirely:

```typescript
function handleKeyDown(e: KeyboardEvent): void {
  const typingState = getTypingState();

  // --- Typing mode: route keys to chat buffer ---
  if (typingState === TypingState.DEST_PROMPT) {
    e.preventDefault();
    handleDestKey(e.key);
    notifyChatChange();
    return;
  }

  if (typingState === TypingState.MACRO_WAIT) {
    e.preventDefault();
    handleMacroKey(e.key);
    notifyChatChange();
    return;
  }

  if (typingState === TypingState.TYPING) {
    e.preventDefault();
    handleTypingKey(e);
    notifyChatChange();
    return;
  }

  // --- IDLE: normal game input ---
  if (getMySlot() < 0) return;
  if (e.ctrlKey || e.altKey || e.metaKey) return;

  // Chat keys (intercept before game keys)
  if (e.key === "m") {
    e.preventDefault();
    startMessage();
    notifyChatChange();
    return;
  }
  if (e.key === "X") {
    e.preventDefault();
    startMacroMode();
    notifyChatChange();
    return;
  }

  // Number keys 0-9 set warp speed
  if (e.key >= "0" && e.key <= "9") {
    e.preventDefault();
    sendInput(InputCommand.SET_SPEED, parseInt(e.key, 10));
    return;
  }

  switch (e.key) {
    case ")":
      e.preventDefault();
      sendInput(InputCommand.SET_SPEED, 10);
      break;
    case "!":
      e.preventDefault();
      sendInput(InputCommand.SET_SPEED, 11);
      break;
    case "@":
      e.preventDefault();
      sendInput(InputCommand.SET_SPEED, 12);
      break;
    case "%":
      e.preventDefault();
      sendInput(InputCommand.SET_SPEED, 99);
      break;
    case "s":
    case "S":
      e.preventDefault();
      sendInput(InputCommand.SHIELD_TOGGLE, 0);
      break;
    case "r":
    case "R":
      e.preventDefault();
      sendInput(InputCommand.REPAIR_TOGGLE, 0);
      break;
    case "d":
      e.preventDefault();
      sendInput(InputCommand.DETONATE, 0);
      break;
    case "D":
      e.preventDefault();
      sendInput(InputCommand.DETONATE_SELF, 0);
      break;
    case "b":
      e.preventDefault();
      sendInput(InputCommand.BOMB, 0);
      break;
    case "z":
      e.preventDefault();
      sendInput(InputCommand.BEAM_UP, 0);
      break;
    case "x":
      e.preventDefault();
      sendInput(InputCommand.BEAM_DOWN, 0);
      break;
    case "c":
      e.preventDefault();
      sendInput(InputCommand.CLOAK_TOGGLE, 0);
      break;
    case "T": {
      e.preventDefault();
      const tractorSlot = findNearestShip();
      sendInput(InputCommand.TRACTOR, tractorSlot >= 0 ? tractorSlot : 0xff);
      break;
    }
    case "y": {
      e.preventDefault();
      const pressorSlot = findNearestShip();
      sendInput(InputCommand.PRESSOR, pressorSlot >= 0 ? pressorSlot : 0xff);
      break;
    }
    case "l":
      e.preventDefault();
      lockNearestEntity();
      break;
  }
}
```

4. Add the helper functions for typing mode:

```typescript
function handleDestKey(key: string): void {
  if (key === "Escape") {
    cancelTyping();
    return;
  }
  if (key === "T" || key === "t") {
    const snap = getLatestSnapshot();
    const myShip = snap?.ships.find((s) => s.slotIndex === getMySlot());
    if (myShip) {
      selectDestination({ type: "team", team: myShip.team });
    }
    return;
  }
  if (key === "A" || key === "a") {
    selectDestination({ type: "all" });
    return;
  }
  // Slot numbers: 0-9 or a-f (hex for slots 10-15)
  const slotNum = parseInt(key, 16);
  if (!isNaN(slotNum) && slotNum >= 0 && slotNum <= 15) {
    selectDestination({ type: "personal", targetSlot: slotNum });
    return;
  }
}

function handleMacroKey(key: string): void {
  if (key === "Escape") {
    cancelTyping();
    return;
  }

  const macros = loadMacros();
  const macro = macros[key];
  if (!macro) {
    cancelTyping();
    return;
  }

  const snap = getLatestSnapshot();
  if (!snap) {
    cancelTyping();
    return;
  }

  const expanded = expandMacro(macro.text, snap, getMySlot(), getRoster());

  if (macro.dest === "T") {
    const myShip = snap.ships.find((s) => s.slotIndex === getMySlot());
    if (myShip) {
      sendChat(expanded, myShip.team);
    }
  } else if (macro.dest === "A") {
    sendChat(expanded, -1);
  } else {
    // No dest — need to prompt for one, then send the expanded text
    selectDestination({ type: "team", team: 0 }); // temp; overridden below
    // Actually we need to go to DEST_PROMPT with the expanded text buffered
    cancelTyping();
    startMessage();
    // Store the expanded text so when dest is selected it sends immediately
    setMacroPendingText(expanded);
    return;
  }

  cancelTyping();
}

// For macros with no preset destination, we buffer the expanded text
let macroPendingText: string | null = null;

function setMacroPendingText(text: string): void {
  macroPendingText = text;
}

function handleTypingKey(e: KeyboardEvent): void {
  if (e.key === "Escape") {
    macroPendingText = null;
    cancelTyping();
    return;
  }

  if (e.key === "Enter") {
    const msg = getFinishedMessage();
    if (msg) {
      sendChatFromDest(msg.text, msg.dest);
    } else if (macroPendingText) {
      // This shouldn't happen in TYPING state from macro flow, but handle anyway
      const dest = getChatDestFromState();
      if (dest) {
        sendChatFromDest(macroPendingText, dest);
      }
    }
    macroPendingText = null;
    cancelTyping();
    return;
  }

  if (e.key === "Backspace") {
    deleteChar();
    return;
  }

  // Only printable single characters
  if (e.key.length === 1) {
    appendChar(e.key);
  }
}

function getChatDestFromState(): ChatDest | null {
  // Re-import to get current state
  const { getChatDest } = require("./chat");
  return getChatDest();
}

function sendChatFromDest(text: string, dest: ChatDest): void {
  switch (dest.type) {
    case "team":
      sendChat(text, dest.team);
      break;
    case "all":
      sendChat(text, -1);
      break;
    case "personal":
      sendChat(text, -1, dest.targetSlot);
      break;
  }
}
```

Wait — the `getChatDestFromState` using `require` is not clean. Let me restructure. The `getChatDest` is already imported at the top. Let me fix:

Replace `getChatDestFromState()` with a direct import call:

```typescript
import {
  TypingState,
  getTypingState,
  startMessage,
  startMacroMode,
  selectDestination,
  appendChar,
  deleteChar,
  getFinishedMessage,
  cancelTyping,
  getRoster,
  getChatDest,
  type ChatDest,
} from "./chat";
```

Then replace the `getChatDestFromState` function with just using `getChatDest()` directly:

```typescript
function handleTypingKey(e: KeyboardEvent): void {
  if (e.key === "Escape") {
    macroPendingText = null;
    cancelTyping();
    return;
  }

  if (e.key === "Enter") {
    const msg = getFinishedMessage();
    if (msg) {
      sendChatFromDest(msg.text, msg.dest);
    }
    macroPendingText = null;
    cancelTyping();
    return;
  }

  if (e.key === "Backspace") {
    deleteChar();
    return;
  }

  if (e.key.length === 1) {
    appendChar(e.key);
  }
}
```

Also, fix the macro-with-no-dest flow. When a macro has `dest: null`, after expansion we should enter DEST_PROMPT so user picks destination, and once they do we send the expanded text immediately. We need a cleaner approach:

In `handleMacroKey`, for the `null` dest case:

```typescript
  } else {
    // No preset destination — prompt user, then send expanded text on dest selection
    macroPendingText = expanded;
    startMessage(); // goes to DEST_PROMPT
    return;
  }
```

And in `handleDestKey`, check for pending macro text. If set, send immediately after dest selection:

```typescript
function handleDestKey(key: string): void {
  if (key === "Escape") {
    macroPendingText = null;
    cancelTyping();
    return;
  }

  let dest: ChatDest | null = null;

  if (key === "T" || key === "t") {
    const snap = getLatestSnapshot();
    const myShip = snap?.ships.find((s) => s.slotIndex === getMySlot());
    if (myShip) {
      dest = { type: "team", team: myShip.team };
    }
  } else if (key === "A" || key === "a") {
    dest = { type: "all" };
  } else {
    const slotNum = parseInt(key, 16);
    if (!isNaN(slotNum) && slotNum >= 0 && slotNum <= 15) {
      dest = { type: "personal", targetSlot: slotNum };
    }
  }

  if (!dest) return;

  if (macroPendingText) {
    // Macro with no preset dest — send expanded text immediately
    sendChatFromDest(macroPendingText, dest);
    macroPendingText = null;
    cancelTyping();
  } else {
    selectDestination(dest);
  }
}
```

- [ ] **Step 2: Verify client compiles**

Run: `cd apps/client && pnpm build`
Expected: Compiles with no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/client/lib/game/input.ts
git commit -m "feat(client): add typing mode to input system with m/X/Enter/Escape keys"
```

---

## Task 9: Client — Chat Panel Component

**Files:**

- Create: `apps/client/components/chat-panel.tsx`

- [ ] **Step 1: Create the chat panel component**

```tsx
// apps/client/components/chat-panel.tsx
"use client";

import { useEffect, useRef } from "react";
import type { DisplayMessage } from "@/lib/game/chat";
import {
  getTypingDisplay,
  getPersonalMessages,
  getTeamMessages,
  getAllMessages,
  getLastKillMessage,
  getTypingState,
  TypingState,
  startMessage,
} from "@/lib/game/chat";

interface ChatPanelProps {
  chatVersion: number; // incremented on every chat state change to trigger re-render
}

export default function ChatPanel({ chatVersion }: ChatPanelProps) {
  const typingDisplay = getTypingDisplay();
  const personalMsgs = getPersonalMessages();
  const teamMsgs = getTeamMessages();
  const allMsgs = getAllMessages();
  const killMsg = getLastKillMessage();
  const typingState = getTypingState();

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        fontFamily: "monospace",
        fontSize: 11,
        color: "#aaa",
        padding: 4,
        overflow: "hidden",
        borderLeft: "1px solid #333",
        cursor: typingState === TypingState.IDLE ? "pointer" : "text",
      }}
      onClick={() => {
        if (typingState === TypingState.IDLE) {
          startMessage();
        }
      }}
    >
      {/* Typing line */}
      <div
        style={{
          color: "#ffffff",
          height: 16,
          lineHeight: "16px",
          borderBottom: "1px solid #222",
          flexShrink: 0,
          whiteSpace: "nowrap",
          overflow: "hidden",
        }}
      >
        {typingDisplay || " "}
      </div>

      {/* Personal messages */}
      <MessageSection label="Personal" messages={personalMsgs} maxVisible={3} />

      {/* Team messages */}
      <MessageSection label="Team" messages={teamMsgs} maxVisible={3} />

      {/* All messages */}
      <MessageSection label="All" messages={allMsgs} maxVisible={3} />

      {/* Kill announcements */}
      <div
        style={{
          marginTop: "auto",
          color: killMsg?.color ?? "#555",
          height: 14,
          lineHeight: "14px",
          flexShrink: 0,
          whiteSpace: "nowrap",
          overflow: "hidden",
          borderTop: "1px solid #222",
        }}
      >
        {killMsg?.text ?? " "}
      </div>
    </div>
  );
}

function MessageSection({
  label,
  messages,
  maxVisible,
}: {
  label: string;
  messages: readonly DisplayMessage[];
  maxVisible: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  const visible = messages.slice(-maxVisible);

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          color: "#555",
          fontSize: 9,
          lineHeight: "12px",
          flexShrink: 0,
        }}
      >
        {label}
      </div>
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          minHeight: 0,
        }}
      >
        {visible.map((msg, i) => (
          <div
            key={i}
            style={{
              color: msg.color,
              lineHeight: "14px",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {msg.text}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/client/components/chat-panel.tsx
git commit -m "feat(client): add ChatPanel component with typing line and message sections"
```

---

## Task 10: Client — Player List Panel Component

**Files:**

- Create: `apps/client/components/player-list-panel.tsx`

- [ ] **Step 1: Create the player list panel component**

```tsx
// apps/client/components/player-list-panel.tsx
"use client";

import type { ClientGameState } from "@netrek/shared";
import { ShipStatus } from "@netrek/shared";
import { TEAM_NAMES_SHORT, SHIP_NAMES } from "@netrek/shared";
import { getRoster } from "@/lib/game/chat";

const TEAM_COLORS: Record<number, string> = {
  0: "#ffff00", // Federation
  1: "#ff4444", // Romulans
  2: "#44ff44", // Klingons
  3: "#44ffff", // Orions
};

interface PlayerListPanelProps {
  state: ClientGameState | null;
  rosterVersion: number; // triggers re-render on roster change
}

export default function PlayerListPanel({
  state,
  rosterVersion,
}: PlayerListPanelProps) {
  if (!state) return null;

  const roster = getRoster();
  const allShips = state.ships
    .slice()
    .sort((a, b) => a.slotIndex - b.slotIndex);

  return (
    <div
      style={{
        width: "50%",
        fontFamily: "monospace",
        fontSize: 11,
        color: "#aaa",
        padding: 4,
        overflowY: "auto",
      }}
    >
      {/* Header */}
      <div
        style={{
          color: "#666",
          lineHeight: "14px",
          borderBottom: "1px solid #222",
        }}
      >
        {"No Ty   Rank     Name             Kills Login"}
      </div>

      {/* Rows */}
      {allShips.map((ship) => {
        const entry = roster[ship.slotIndex];
        const isDead = ship.status === ShipStatus.DEAD;
        const isExploding = ship.status === ShipStatus.EXPLODING;
        const baseColor = TEAM_COLORS[ship.team] ?? "#888";
        const color = isDead || isExploding ? "#444" : baseColor;

        const slotStr = ship.slotIndex.toString().padStart(2, " ");
        const teamChar = (TEAM_NAMES_SHORT[ship.team] ?? "??").slice(0, 2);
        const slotHex = ship.slotIndex.toString(16);
        const typeTag = `${teamChar}${slotHex}`;
        const rank = "Ens";
        const name = (entry?.name ?? ship.slotIndex.toString())
          .padEnd(16, " ")
          .slice(0, 16);
        const kills =
          state.ships.find((s) => s.slotIndex === ship.slotIndex) === ship
            ? "0.00"
            : "0.00";
        const login = entry?.name ?? "";

        return (
          <div
            key={ship.slotIndex}
            style={{
              color,
              lineHeight: "14px",
              whiteSpace: "pre",
            }}
          >
            {`${slotStr} ${typeTag.padEnd(4)} ${rank.padEnd(8)} ${name} ${kills.padStart(5)} ${login}`}
          </div>
        );
      })}
    </div>
  );
}
```

Note: The kills column currently shows "0.00" because `ClientShip` doesn't include kills — only `ClientSelfExtra` has kills for the local player. The player list will show kills from the roster or snapshot. For now it shows "0.00" for all players since individual kills aren't in the binary protocol. This is a known limitation — kills could be added to the roster event later.

- [ ] **Step 2: Commit**

```bash
git add apps/client/components/player-list-panel.tsx
git commit -m "feat(client): add PlayerListPanel component with team-colored roster table"
```

---

## Task 11: Client — Wire Everything into GameCanvas

**Files:**

- Modify: `apps/client/components/game-canvas.tsx`

- [ ] **Step 1: Update imports and add new socket/chat wiring**

In `apps/client/components/game-canvas.tsx`:

1. Add imports:

```typescript
import {
  connect,
  disconnect,
  onState,
  onConnect,
  onDisconnect,
  onJoined,
  onChat,
  onKill,
  onRoster,
  sendRespawn,
} from "@/lib/game/socket";
import {
  handleChatMessage,
  handleKillEvent,
  updateRoster,
  resetChat,
} from "@/lib/game/chat";
import { onChatChange } from "@/lib/game/input";
import ChatPanel from "./chat-panel";
import PlayerListPanel from "./player-list-panel";
```

2. Add state for triggering re-renders on chat/roster changes:

```typescript
const [chatVersion, setChatVersion] = useState(0);
```

3. In the `useEffect` setup block (after the existing `onJoined(...)` handler), add:

```typescript
onChat((msg) => {
  handleChatMessage(msg, getMySlot());
  setChatVersion((v) => v + 1);
});

onKill((event) => {
  handleKillEvent(event);
  setChatVersion((v) => v + 1);
});

onRoster((roster) => {
  updateRoster(roster);
  setChatVersion((v) => v + 1);
});

onChatChange(() => {
  setChatVersion((v) => v + 1);
});
```

4. Add `resetChat()` to the cleanup function, alongside `resetState()` and `resetSound()`:

```typescript
return () => {
  cancelAnimationFrame(rafRef.current);
  cleanupInput();
  window.removeEventListener("resize", handleResize);
  window.removeEventListener("keydown", handlePanelKeys);
  disconnect();
  resetState();
  resetSound();
  resetChat();
};
```

5. Replace the bottom panel placeholder. Change the entire bottom panel div (the one with `height: BOTTOM_PANEL_H`) from:

```tsx
{
  /* Bottom panel: chat area */
}
<div
  style={{
    height: BOTTOM_PANEL_H,
    borderTop: "1px solid #333",
    background: "#000000",
    display: "flex",
    fontFamily: "monospace",
    fontSize: 12,
    color: "#aaa",
  }}
>
  <div style={{ flex: 1, padding: 6, overflowY: "auto" }}>
    <div style={{ color: "#555" }}>-- Chat (not yet implemented) --</div>
    <div style={{ color: "#555", marginTop: 4 }}>
      L: player list | i: info | h: help
    </div>
    <div style={{ color: "#555" }}>
      Left: torps | Shift+Left/Middle: phasers | Right: course
    </div>
  </div>
</div>;
```

To:

```tsx
{
  /* Bottom panel: player list (left) + chat (right) */
}
<div
  style={{
    height: BOTTOM_PANEL_H,
    borderTop: "1px solid #333",
    background: "#000000",
    display: "flex",
  }}
>
  <PlayerListPanel state={snapshot} rosterVersion={chatVersion} />
  <ChatPanel chatVersion={chatVersion} />
</div>;
```

6. Remove the old `PlayerList` component definition entirely (the function `PlayerList` at the bottom of the file, roughly lines 363-401). Also remove the `showPlayerList` state and the player list rendering in the galaxy map section since it's now always shown in the bottom panel.

Remove from state:

```typescript
const [showPlayerList, setShowPlayerList] = useState(true);
```

Remove the `L` key handler from `handlePanelKeys`:

```typescript
if (e.key === "L") {
  setShowPlayerList((v) => !v);
}
```

Remove from the right panel:

```tsx
{
  /* Player list (toggled with L key) */
}
{
  showPlayerList && snapshot && <PlayerList state={snapshot} />;
}
```

Remove the entire `PlayerList` function component.

7. Guard `handlePanelKeys` against typing state — if the user is typing a chat message, panel key shortcuts (`h`, `i`) should not fire. Add to the top of `handlePanelKeys`:

```typescript
import { getTypingState, TypingState } from "@/lib/game/chat";
```

And at the start of the function:

```typescript
    function handlePanelKeys(e: KeyboardEvent) {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (getTypingState() !== TypingState.IDLE) return;
```

- [ ] **Step 2: Build client to verify**

Run: `cd apps/client && pnpm build`
Expected: Compiles with no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/client/components/game-canvas.tsx
git commit -m "feat(client): wire chat panel and player list into game canvas bottom panel"
```

---

## Task 12: Documentation — Keymap Page

**Files:**

- Create: `apps/client/app/docs/keymap/page.tsx`

- [ ] **Step 1: Create the keymap documentation page**

```tsx
// apps/client/app/docs/keymap/page.tsx

export default function KeymapPage() {
  return (
    <div
      style={{
        background: "#000",
        color: "#aaa",
        fontFamily: "monospace",
        fontSize: 13,
        padding: 32,
        minHeight: "100vh",
        maxWidth: 800,
        margin: "0 auto",
      }}
    >
      <h1 style={{ color: "#ffff00", fontSize: 20 }}>
        Netrek Default Commands
      </h1>
      <p style={{ color: "#666", marginBottom: 24 }}>
        Original Netrek keyboard bindings. Commands marked with ✓ are
        implemented in the web version.
      </p>

      <Section title="Lowercase Commands">
        <KeyTable
          rows={[
            ["b", "Bomb Planet", true],
            ["c", "Cloak/uncloak", true],
            ["d", "Detonate enemy Torp", true],
            ["e", "Toggle docking permission (SB only)", false],
            ["f", "Plasma torpedo", false],
            ["h", "Help window", true],
            ["i", "Information", true],
            ["k", "Set course (at mouse)", false],
            ["l", "Lock onto object (at mouse)", true],
            ["m", "Start sending message", true],
            ["o", "Orbit", false],
            ["p", "Phasers", false],
            ["q", "Quit game quickly", false],
            ["r", "Refit", false],
            ["s", "Shields", true],
            ["t", "Torpedo", false],
            ["w", "Change war declaration", false],
            ["x", "Beam down", true],
            ["y", "Pressor beam", true],
            ["z", "Beam up", true],
          ]}
        />
      </Section>

      <Section title="Uppercase Commands">
        <KeyTable
          rows={[
            ["D", "Detonate your own Torps", true],
            ["E", "Send generic distress call", false],
            ["F", "Send 'armies carried' report", false],
            ["L", "Players list", true],
            ["M", "Toggle Message Log", false],
            ["N", "Toggle Long/Short Planet Names", false],
            ["O", "Options Window", false],
            ["R", "Enter Repair mode", true],
            ["S", "Toggle Stats Window", false],
            ["T", "Tractor Beam", true],
            ["X", "Enter Macro Mode", true],
          ]}
        />
      </Section>

      <Section title="Number Keys">
        <KeyTable
          rows={[
            ["0-9", "Set warp speed 0-9", true],
            [")", "Warp 10", true],
            ["!", "Warp 11", true],
            ["@", "Warp 12", true],
            ["%", "Maximum warp", true],
            ["$", "Tractor/pressor off", false],
            ["^", "Pressor beam ON", false],
            ["<", "Decrease Warp by one", false],
            [">", "Increase Warp by one", false],
          ]}
        />
      </Section>

      <Section title="Mouse Controls (Web Version)">
        <KeyTable
          rows={[
            ["Left click", "Fire torpedoes", true],
            ["Shift+Left / Middle", "Fire phasers", true],
            ["Right click", "Set course", true],
          ]}
        />
      </Section>

      <Section title="Chat & Macros">
        <KeyTable
          rows={[
            ["m", "Start sending message", true],
            ["X + key", "Fire macro", true],
            ["Enter", "Send message", true],
            ["Escape", "Cancel message", true],
          ]}
        />
        <p style={{ color: "#666", marginTop: 8 }}>
          See{" "}
          <a href="/docs/macros" style={{ color: "#44ffff" }}>
            Macro Reference
          </a>{" "}
          for details.
        </p>
      </Section>

      <div style={{ marginTop: 32, color: "#555" }}>
        <a href="/lobby" style={{ color: "#44ffff" }}>
          ← Back to Lobby
        </a>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h2 style={{ color: "#ffff00", fontSize: 15, marginBottom: 8 }}>
        {title}
      </h2>
      {children}
    </div>
  );
}

function KeyTable({ rows }: { rows: [string, string, boolean][] }) {
  return (
    <table style={{ borderCollapse: "collapse", width: "100%" }}>
      <tbody>
        {rows.map(([key, desc, implemented], i) => (
          <tr key={i} style={{ borderBottom: "1px solid #111" }}>
            <td
              style={{ padding: "2px 12px 2px 0", color: "#fff", width: 120 }}
            >
              {key}
            </td>
            <td
              style={{
                padding: "2px 8px",
                color: implemented ? "#aaa" : "#555",
              }}
            >
              {desc}
            </td>
            <td
              style={{
                padding: "2px 0",
                color: implemented ? "#44ff44" : "#444",
                width: 20,
              }}
            >
              {implemented ? "✓" : ""}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/client/app/docs/keymap/page.tsx
git commit -m "docs: add keymap reference page at /docs/keymap"
```

---

## Task 13: Documentation — Macros Page

**Files:**

- Create: `apps/client/app/docs/macros/page.tsx`

- [ ] **Step 1: Create the macros documentation page**

```tsx
// apps/client/app/docs/macros/page.tsx

export default function MacrosPage() {
  return (
    <div
      style={{
        background: "#000",
        color: "#aaa",
        fontFamily: "monospace",
        fontSize: 13,
        padding: 32,
        minHeight: "100vh",
        maxWidth: 800,
        margin: "0 auto",
      }}
    >
      <h1 style={{ color: "#ffff00", fontSize: 20 }}>Netrek Macro System</h1>

      <Section title="How Macros Work">
        <p>
          Press <K>X</K> to enter macro mode, then press a macro key to send a
          pre-defined message.
        </p>
        <p>
          If the macro has a preset destination (team or all), it sends
          immediately.
        </p>
        <p>If not, you{"'"}ll be prompted to choose a destination:</p>
        <ul style={{ marginLeft: 16, marginTop: 4 }}>
          <li>
            <K>T</K> — send to your team
          </li>
          <li>
            <K>A</K> — send to all players
          </li>
          <li>
            <K>0-9</K>, <K>a-f</K> — send to a specific player slot
          </li>
        </ul>
      </Section>

      <Section title="Default Macros">
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #333" }}>
              <th
                style={{
                  textAlign: "left",
                  padding: "2px 12px 2px 0",
                  color: "#666",
                }}
              >
                Key
              </th>
              <th
                style={{ textAlign: "left", padding: "2px 8px", color: "#666" }}
              >
                Dest
              </th>
              <th
                style={{ textAlign: "left", padding: "2px 8px", color: "#666" }}
              >
                Message
              </th>
            </tr>
          </thead>
          <tbody>
            {[
              ["b", "Team", "bombing %l"],
              ["e", "Team", "need escort to %l, carrying %a"],
              ["f", "Team", "%T%c carrying %a armies, headed to %l"],
              ["h", "Team", "help at %l!"],
              ["1", "Team", "I need fuel!  %f%% fuel left"],
              ["2", "Team", "I need repair!  %d%% damage"],
              ["3", "Team", "ogg %p"],
              ["4", "Team", "defending %l"],
              ["5", "All", "good game!"],
            ].map(([key, dest, text], i) => (
              <tr key={i} style={{ borderBottom: "1px solid #111" }}>
                <td style={{ padding: "2px 12px 2px 0", color: "#fff" }}>
                  {key}
                </td>
                <td style={{ padding: "2px 8px", color: "#888" }}>{dest}</td>
                <td style={{ padding: "2px 8px", color: "#aaa" }}>{text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Substitution Variables">
        <p style={{ marginBottom: 8 }}>
          Use <K>%</K> codes in macro text. They are replaced with live game
          data when the macro fires.
        </p>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #333" }}>
              <th
                style={{
                  textAlign: "left",
                  padding: "2px 12px 2px 0",
                  color: "#666",
                }}
              >
                Code
              </th>
              <th
                style={{ textAlign: "left", padding: "2px 8px", color: "#666" }}
              >
                Expands to
              </th>
            </tr>
          </thead>
          <tbody>
            {[
              ["%a", "Armies carried"],
              ["%d", "Damage percentage"],
              ["%s", "Shield percentage"],
              ["%f", "Fuel percentage"],
              ["%w", "Weapon temperature %"],
              ["%e", "Engine temperature %"],
              ["%W", "1 if weapon-temped, 0 if not"],
              ["%E", "1 if engine-temped, 0 if not"],
              ["%k", "Kill count"],
              ["%S", "Ship type (SC, DD, CA, BB, AS, SB)"],
              ["%T", "Team character (F, R, K, O)"],
              ["%o", "Team name (Fed, Rom, Kli, Ori)"],
              ["%c", "Your slot digit"],
              ["%i", "Your player name"],
              ["%l", "Nearest planet name"],
              ["%n", "Armies on nearest planet"],
              ["%t", "Team character of nearest planet"],
              ["%z", "Team name of nearest planet"],
              ["%p", "Nearest enemy player ID"],
              ["%u", "Nearest enemy player name"],
              ["%g", "Nearest friendly player ID"],
              ["%b", "Nearest planet name (same as %l)"],
              ["%%", "Literal % character"],
            ].map(([code, desc], i) => (
              <tr key={i} style={{ borderBottom: "1px solid #111" }}>
                <td style={{ padding: "2px 12px 2px 0", color: "#44ffff" }}>
                  {code}
                </td>
                <td style={{ padding: "2px 8px" }}>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Planned Features">
        <ul style={{ marginLeft: 16 }}>
          <li>
            Conditional expressions:{" "}
            <code style={{ color: "#555" }}>
              {"%?%n>4%{bomb %l at %n%!bomb%}"}
            </code>
          </li>
          <li>Single-key macros (no X prefix)</li>
          <li>Macro editor UI</li>
          <li>Custom keymap remapping</li>
        </ul>
      </Section>

      <div style={{ marginTop: 32, color: "#555" }}>
        <a href="/docs/keymap" style={{ color: "#44ffff" }}>
          Keymap Reference
        </a>
        {" | "}
        <a href="/lobby" style={{ color: "#44ffff" }}>
          Back to Lobby
        </a>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h2 style={{ color: "#ffff00", fontSize: 15, marginBottom: 8 }}>
        {title}
      </h2>
      {children}
    </div>
  );
}

function K({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        background: "#222",
        border: "1px solid #444",
        padding: "0 4px",
        borderRadius: 2,
        color: "#fff",
        fontSize: 12,
      }}
    >
      {children}
    </span>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/client/app/docs/macros/page.tsx
git commit -m "docs: add macro system reference page at /docs/macros"
```

---

## Task 14: Add Help Overlay Link + Lobby Navigation

**Files:**

- Modify: `apps/client/components/game-canvas.tsx` (help overlay)

- [ ] **Step 1: Add doc links to the help overlay**

In `apps/client/components/game-canvas.tsx`, in the help window section (the `showHelp &&` block), add to the chat/macro section at the end of the help window, before the "Press h to close" line:

```tsx
              <div style={{ color: "#ffff00", marginTop: 8, marginBottom: 4 }}>
                Chat & Macros
              </div>
              <HelpRow k="m" desc="Start sending message" />
              <HelpRow k="X + key" desc="Fire macro" />
              <div style={{ color: "#555", marginTop: 8 }}>
                Full docs:{" "}
                <a href="/docs/keymap" target="_blank" style={{ color: "#44ffff" }}>
                  /docs/keymap
                </a>
                {" | "}
                <a href="/docs/macros" target="_blank" style={{ color: "#44ffff" }}>
                  /docs/macros
                </a>
              </div>
```

- [ ] **Step 2: Build and verify**

Run: `cd apps/client && pnpm build`
Expected: Compiles with no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/client/components/game-canvas.tsx
git commit -m "feat(client): add chat/macro keybindings to help overlay with doc links"
```

---

## Task 15: Full Build Verification

- [ ] **Step 1: Build all packages**

Run:

```bash
cd c:/Projects/web3/netrek && pnpm build
```

Expected: All packages (shared, server, client) build successfully.

- [ ] **Step 2: Fix any build errors**

If there are type errors or import issues, fix them. Common issues to check:

- Circular imports between `chat.ts` and `input.ts`
- Missing exports from shared package
- React component prop type mismatches

- [ ] **Step 3: Manual smoke test**

Start the server and client:

```bash
# Terminal 1
cd apps/server && pnpm dev

# Terminal 2
cd apps/client && pnpm dev
```

Verify:

1. Game loads, bottom panel shows player list (left) and chat area (right)
2. Bots appear in the player list with team colors
3. Press `m` then `T` — typing line shows `[TEAM]`, type a message, press Enter
4. Message appears in the team chat section
5. Press `m` then `A` — all-chat works
6. Press `X` then `b` — sends "bombing [nearest planet]" to team
7. Kill a bot (or get killed) — kill announcement appears at bottom
8. Visit `/docs/keymap` and `/docs/macros` — pages render correctly

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: resolve build issues from chat/playerlist integration"
```

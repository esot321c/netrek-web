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
    addMessage(allMessages, {
      text: `${senderTag}->ALL: ${msg.text}`,
      color,
      timestamp: Date.now(),
    });
  } else {
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

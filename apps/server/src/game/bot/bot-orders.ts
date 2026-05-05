import { BotAIState } from "@netrek/shared";

export interface BotOrder {
  state: BotAIState;
  targetId: number; // planet index or player slot
  targetName: string; // addressed bot name (empty string if broadcast to all bots)
}

/**
 * Parse a chat message into a bot order.
 *
 * @param text        The raw chat message text.
 * @param planetNames Array of planet names indexed by planetId.
 * @param botNames    Names of active bots (e.g. ["comp-bot-1", "vet-bot-2"]).
 * @param senderSlot  Slot of the message sender (used for "escort me").
 * @returns           A BotOrder if the message matches a known pattern, otherwise null.
 */
export function parseOrder(
  text: string,
  planetNames: string[],
  botNames: string[],
  senderSlot?: number,
): BotOrder | null {
  if (!text) return null;

  const normalized = text.trim();
  if (!normalized) return null;

  // Step 1: Check if the message starts with a bot name (case-insensitive).
  let targetName = "";
  let remaining = normalized;

  for (const name of botNames) {
    const prefix = name.toLowerCase();
    const msgLower = normalized.toLowerCase();
    if (msgLower.startsWith(prefix)) {
      const afterName = normalized.slice(name.length).trimStart();
      // Only strip the name if there's content following it (otherwise it's
      // just someone mentioning the bot, not issuing a command).
      if (afterName.length > 0) {
        targetName = name.toLowerCase();
        remaining = afterName;
        break;
      }
    }
  }

  // Step 2: Match the remaining text against known command patterns.
  const lower = remaining.toLowerCase();

  // "bomb [planet]"
  const bombMatch = lower.match(/^bomb\s+(.+)$/);
  if (bombMatch) {
    const planetId = findPlanetIndex(bombMatch[1]!.trim(), planetNames);
    if (planetId !== -1) {
      return { state: BotAIState.BOMB, targetId: planetId, targetName };
    }
    return null;
  }

  // "defend [planet]"
  const defendMatch = lower.match(/^defend\s+(.+)$/);
  if (defendMatch) {
    const planetId = findPlanetIndex(defendMatch[1]!.trim(), planetNames);
    if (planetId !== -1) {
      return { state: BotAIState.DEFEND, targetId: planetId, targetName };
    }
    return null;
  }

  // "escort me"
  if (lower === "escort me") {
    return {
      state: BotAIState.ESCORT,
      targetId: senderSlot ?? -1,
      targetName,
    };
  }

  // "escort [number]"
  const escortNumberMatch = lower.match(/^escort\s+(\d+)$/);
  if (escortNumberMatch) {
    return {
      state: BotAIState.ESCORT,
      targetId: parseInt(escortNumberMatch[1]!, 10),
      targetName,
    };
  }

  // "ogg [number]"
  const oggMatch = lower.match(/^ogg\s+(\d+)$/);
  if (oggMatch) {
    return {
      state: BotAIState.OGG,
      targetId: parseInt(oggMatch[1]!, 10),
      targetName,
    };
  }

  // "help" or "help [planet]"
  if (lower === "help") {
    return { state: BotAIState.DEFEND, targetId: -1, targetName };
  }
  const helpMatch = lower.match(/^help\s+(.+)$/);
  if (helpMatch) {
    const planetId = findPlanetIndex(helpMatch[1]!.trim(), planetNames);
    if (planetId !== -1) {
      return { state: BotAIState.DEFEND, targetId: planetId, targetName };
    }
    // "help" with an unrecognized planet — fall through to null
    return null;
  }

  // "regroup" or "fall back"
  if (lower === "regroup" || lower === "fall back") {
    return { state: BotAIState.PATROL, targetId: -1, targetName };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Returns the index of a planet by name (case-insensitive), or -1 if not found. */
function findPlanetIndex(name: string, planetNames: string[]): number {
  const lowerName = name.toLowerCase();
  return planetNames.findIndex((p) => p.toLowerCase() === lowerName);
}

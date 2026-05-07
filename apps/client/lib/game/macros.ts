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

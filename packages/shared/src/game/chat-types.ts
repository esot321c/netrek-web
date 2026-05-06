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

export interface RankDef {
  readonly title: string;
  readonly abbrev: string;
  readonly diThreshold: number;
}

export const RANK_DEFS: readonly RankDef[] = [
  { title: "Ensign", abbrev: "Ens", diThreshold: 0 },
  { title: "Lieutenant", abbrev: "Lt", diThreshold: 2 },
  { title: "Lt. Commander", abbrev: "LtC", diThreshold: 6 },
  { title: "Commander", abbrev: "Cdr", diThreshold: 12 },
  { title: "Captain", abbrev: "Cpt", diThreshold: 20 },
  { title: "Fl. Captain", abbrev: "FCp", diThreshold: 30 },
  { title: "Commodore", abbrev: "Com", diThreshold: 45 },
  { title: "Rear Admiral", abbrev: "RAd", diThreshold: 65 },
  { title: "Admiral", abbrev: "Adm", diThreshold: 90 },
] as const;

export const SB_MIN_RANK = 3;

export function calculateDI(stats: {
  planetsTaken: number;
  armiesBombed: number;
  kills: number;
}): number {
  return stats.planetsTaken + stats.armiesBombed / 10 + stats.kills / 4;
}

export function rankForDI(di: number): number {
  let rank = 0;
  for (let i = RANK_DEFS.length - 1; i >= 0; i--) {
    if (di >= RANK_DEFS[i]!.diThreshold) {
      rank = i;
      break;
    }
  }
  return rank;
}

export function rankTitle(rank: number): string {
  return RANK_DEFS[rank]?.title ?? "Ensign";
}

export function rankAbbrev(rank: number): string {
  return RANK_DEFS[rank]?.abbrev ?? "Ens";
}

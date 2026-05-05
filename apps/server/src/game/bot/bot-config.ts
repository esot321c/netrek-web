import { BotDifficulty } from "@netrek/shared";

export interface BotConfig {
  botsPerTeam: number;
  maxPlayersPerTeam: number;
  difficultyMix: [number, number, number]; // [newbie, competent, veteran]
  rebalanceIntervalTicks: number;
  planetImbalanceThreshold: number;
  winPauseTicks: number;
}

function parseDifficultyMix(raw: string): [number, number, number] {
  const parts = raw.split(":").map(Number);
  if (parts.length === 3 && parts.every((n) => !isNaN(n) && n >= 0)) {
    return parts as [number, number, number];
  }
  return [1, 2, 1];
}

export function loadBotConfig(): BotConfig {
  return {
    botsPerTeam: parseInt(process.env["BOTS_PER_TEAM"] ?? "4", 10),
    maxPlayersPerTeam: parseInt(process.env["MAX_PLAYERS_PER_TEAM"] ?? "8", 10),
    difficultyMix: parseDifficultyMix(
      process.env["BOT_DIFFICULTY_MIX"] ?? "1:2:1",
    ),
    rebalanceIntervalTicks:
      parseInt(process.env["DIFFICULTY_REBALANCE_INTERVAL"] ?? "120", 10) * 10,
    planetImbalanceThreshold: parseFloat(
      process.env["PLANET_IMBALANCE_THRESHOLD"] ?? "0.6",
    ),
    winPauseTicks: parseInt(process.env["WIN_PAUSE_DURATION"] ?? "15", 10) * 10,
  };
}

export function buildDifficultyList(
  mix: [number, number, number],
  count: number,
): BotDifficulty[] {
  const total = mix[0] + mix[1] + mix[2];
  if (total === 0) return Array(count).fill(BotDifficulty.COMPETENT);

  const result: BotDifficulty[] = [];
  const difficulties = [
    BotDifficulty.NEWBIE,
    BotDifficulty.COMPETENT,
    BotDifficulty.VETERAN,
  ];

  for (let i = 0; result.length < count; i++) {
    for (let d = 0; d < 3; d++) {
      const ratio = mix[d]! / total;
      const needed = Math.round(ratio * count);
      const have = result.filter((x) => x === difficulties[d]).length;
      if (have < needed && result.length < count) {
        result.push(difficulties[d]!);
      }
    }
    if (result.length < count) {
      result.push(BotDifficulty.COMPETENT);
    }
  }

  return result;
}

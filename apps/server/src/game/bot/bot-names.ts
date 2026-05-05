import { BotDifficulty } from "@netrek/shared";

const DIFFICULTY_PREFIX: Record<BotDifficulty, string> = {
  [BotDifficulty.NEWBIE]: "newb",
  [BotDifficulty.COMPETENT]: "comp",
  [BotDifficulty.VETERAN]: "vet",
};

export function botName(difficulty: BotDifficulty, number: number): string {
  return `${DIFFICULTY_PREFIX[difficulty]}-bot-${number}`;
}

export class BotNamePool {
  private readonly counters: Record<BotDifficulty, number> = {
    [BotDifficulty.NEWBIE]: 0,
    [BotDifficulty.COMPETENT]: 0,
    [BotDifficulty.VETERAN]: 0,
  };

  next(difficulty: BotDifficulty): string {
    this.counters[difficulty]++;
    return botName(difficulty, this.counters[difficulty]);
  }

  reset(): void {
    this.counters[BotDifficulty.NEWBIE] = 0;
    this.counters[BotDifficulty.COMPETENT] = 0;
    this.counters[BotDifficulty.VETERAN] = 0;
  }
}

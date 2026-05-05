export enum BotDifficulty {
  NEWBIE = 0,
  COMPETENT = 1,
  VETERAN = 2,
}

export enum BotAIState {
  PATROL = 0,
  ATTACK = 1,
  BOMB = 2,
  ESCORT = 3,
  DEFEND = 4,
  OGG = 5,
  RETREAT = 6,
}

export interface ChatMessage {
  senderSlot: number;
  senderName: string;
  team: number; // Team enum, -1 for all-chat
  text: string;
  tick: number;
}

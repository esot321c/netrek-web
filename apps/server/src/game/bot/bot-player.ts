import {
  type AlertStatus,
  type ExplosionState,
  type PhaserState,
  type PlasmaState,
  type PlanetState,
  type ShipState,
  type TorpState,
  BotDifficulty,
  Team,
  ShipType,
  serializeGameState,
  deserializeGameState,
} from "@netrek/shared";
import { BotBrain } from "./bot-ai";
import { type TeamBotState } from "./bot-types";
import { InputQueue } from "../state/input-queue";

export class BotPlayer {
  readonly brain: BotBrain;
  readonly name: string;
  slot = -1;
  shipType: ShipType;

  constructor(
    readonly difficulty: BotDifficulty,
    readonly team: Team,
    name: string,
    shipType?: ShipType,
  ) {
    this.name = name;
    this.shipType = shipType ?? ShipType.CA;
    this.brain = new BotBrain(difficulty, team, -1);
  }

  assignSlot(slot: number): void {
    this.slot = slot;
    this.brain.slot = slot;
  }

  onTick(
    tick: number,
    recipientTeam: Team,
    ships: ShipState[],
    torps: TorpState[],
    phasers: PhaserState[],
    explosions: ExplosionState[],
    plasmas: PlasmaState[],
    alertStatuses: AlertStatus[],
    planets: PlanetState[],
    tmode: boolean,
    inputQueue: InputQueue,
    planetKnowledge?: {
      team: number;
      armies: number;
      features: number;
      lastScannedTick: number;
    }[],
    currentTick = 0,
    teamBots?: TeamBotState[],
  ): void {
    if (this.slot === -1) return;

    const buf = serializeGameState(
      tick,
      this.slot,
      recipientTeam,
      ships,
      torps,
      phasers,
      explosions,
      plasmas,
      alertStatuses,
      planets,
      tmode,
      [0, 0, 0, 0],
      planetKnowledge,
      currentTick,
    );

    const gameState = deserializeGameState(buf);
    const commands = this.brain.think(gameState, teamBots ?? []);

    for (const cmd of commands) {
      inputQueue.enqueue(this.slot, cmd);
    }
  }
}

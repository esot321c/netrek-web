import {
  type AlertStatus,
  type ExplosionState,
  type PhaserState,
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
    alertStatuses: AlertStatus[],
    planets: PlanetState[],
    tmode: boolean,
    inputQueue: InputQueue,
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
      alertStatuses,
      planets,
      tmode,
    );

    const gameState = deserializeGameState(buf);
    const commands = this.brain.think(gameState);

    for (const cmd of commands) {
      inputQueue.enqueue(this.slot, cmd);
    }
  }
}

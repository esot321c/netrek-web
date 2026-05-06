import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { Server, Socket } from "socket.io";
import {
  serializeGameState,
  type RosterEntry,
  type RosterMap,
} from "@netrek/shared";
import { GameService } from "./game.service";
import {
  GameLoopService,
  GAME_TICK_EVENT,
  GAME_WIN_EVENT,
} from "./game-loop.service";

interface ConnectedPlayer {
  socket: Socket;
  slot: number;
  userId: string;
  username: string;
}

@Injectable()
export class GameBroadcastService {
  private readonly logger = new Logger(GameBroadcastService.name);
  private server: Server | null = null;
  private readonly players = new Map<string, ConnectedPlayer>();

  constructor(
    private readonly gameService: GameService,
    private readonly gameLoopService: GameLoopService,
  ) {}

  setServer(server: Server): void {
    this.server = server;
  }

  addPlayer(
    socketId: string,
    socket: Socket,
    slot: number,
    userId: string,
    username: string,
  ): void {
    this.players.set(socketId, { socket, slot, userId, username });
  }

  removePlayer(socketId: string): ConnectedPlayer | undefined {
    const player = this.players.get(socketId);
    if (player) {
      this.players.delete(socketId);
    }
    return player;
  }

  getPlayerBySocketId(socketId: string): ConnectedPlayer | undefined {
    return this.players.get(socketId);
  }

  getPlayerByUserId(userId: string): ConnectedPlayer | undefined {
    for (const player of this.players.values()) {
      if (player.userId === userId) return player;
    }
    return undefined;
  }

  getAllPlayers(): ConnectedPlayer[] {
    return Array.from(this.players.values());
  }

  getPlayerBySlot(slot: number): ConnectedPlayer | undefined {
    for (const player of this.players.values()) {
      if (player.slot === slot) return player;
    }
    return undefined;
  }

  getRoster(): RosterMap {
    const roster: RosterMap = {};
    const state = this.gameService.state;
    for (const player of this.players.values()) {
      const ship = state.ships[player.slot];
      if (ship && ship.playerId) {
        roster[player.slot] = {
          name: player.username,
          team: ship.team,
          shipType: ship.shipType,
        };
      }
    }
    return roster;
  }

  broadcastRoster(): void {
    const roster = this.getRoster();
    for (const player of this.players.values()) {
      player.socket.emit("roster", roster);
    }
  }

  @OnEvent(GAME_WIN_EVENT)
  handleWin(data: {
    losingTeam: number;
    winningTeam: number;
    type: string;
  }): void {
    for (const player of this.players.values()) {
      player.socket.emit("game_win", data);
    }
  }

  @OnEvent(GAME_TICK_EVENT)
  handleTick(): void {
    if (this.players.size === 0) return;

    const state = this.gameService.state;

    for (const player of this.players.values()) {
      const playerShip = state.ships[player.slot]!;
      const buf = serializeGameState(
        state.currentTick,
        player.slot,
        playerShip.team,
        state.ships,
        state.torps,
        state.phasers,
        state.explosions,
        this.gameLoopService.alertStatuses,
        state.planets,
        this.gameLoopService.tmode,
      );

      player.socket.volatile.emit("state", buf);
    }
  }
}

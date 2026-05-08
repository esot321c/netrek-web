import { Logger } from "@nestjs/common";
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import {
  Team,
  ShipType,
  deserializeInput,
  type ChatMessage,
} from "@netrek/shared";
import { WsAuthService, GameTokenPayload } from "./guards/ws-auth.guard";
import { GameService, RespawnResult } from "./game.service";
import { GameBroadcastService } from "./game-broadcast.service";
import { BotManagerService } from "./bot";
import { ServerConfig } from "../config/server.config";
import { StatReporterService } from "../registration/stat-reporter.service";

@WebSocketGateway({
  namespace: "/game",
  cors: {
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      callback(null, true);
    },
    credentials: true,
  },
})
export class GameGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(GameGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly wsAuth: WsAuthService,
    private readonly gameService: GameService,
    private readonly broadcastService: GameBroadcastService,
    private readonly botManager: BotManagerService,
    private readonly config: ServerConfig,
    private readonly statReporter: StatReporterService,
  ) {}

  afterInit(server: Server): void {
    this.broadcastService.setServer(server);
    this.logger.log("Game gateway initialized");
  }

  async handleConnection(client: Socket): Promise<void> {
    const payload = await this.wsAuth.validateSocket(client);
    if (!payload) {
      client.disconnect();
      return;
    }

    // Disconnect existing connection for same user
    const existing = this.broadcastService.getPlayerByUserId(payload.sub);
    if (existing) {
      existing.socket.disconnect();
      this.broadcastService.removePlayer(existing.socket.id);
      this.gameService.leaveGame(existing.slot);
    }

    // Auto-join using token payload (team + shipType come from the game token)
    const slot = this.gameService.joinGame(
      payload.sub,
      payload.team as Team,
      payload.shipType as ShipType,
    );

    if (slot < 0) {
      client.emit("error", { message: "Server full" });
      client.disconnect();
      return;
    }

    client.data["userId"] = payload.sub;
    client.data["slot"] = slot;
    client.data["payload"] = payload;
    client.data["isGuest"] = payload.isGuest === true;

    if (payload.isGuest) {
      this.statReporter.markGuest(payload.sub);
    }

    this.gameService.setPlayerTokenStats(slot, {
      totalKills: payload.stats?.totalKills ?? 0,
      planetsTaken: payload.stats?.planetsTaken ?? 0,
      armiesBombed: payload.stats?.armiesBombed ?? 0,
      rank: payload.stats?.rank ?? 0,
    });

    this.broadcastService.addPlayer(
      client.id,
      client,
      slot,
      payload.sub,
      payload.username,
    );
    this.botManager.onHumanJoin(payload.team as Team);

    client.emit("joined", { slot });
    this.broadcastService.broadcastRoster();
    this.logger.log(
      `Player ${payload.username} joined slot ${slot} (team ${payload.team})`,
    );
  }

  handleDisconnect(client: Socket): void {
    const player = this.broadcastService.removePlayer(client.id);
    if (player) {
      const team = this.gameService.state.ships[player.slot]?.team;
      this.gameService.leaveGame(player.slot);
      if (client.data["isGuest"]) {
        this.statReporter.unmarkGuest(player.userId);
      }
      this.gameService.clearPlayerStats(player.slot);
      if (team !== undefined) {
        this.botManager.onHumanLeave(team);
      }
      this.logger.log(`Player disconnected from slot ${player.slot}`);
      this.broadcastService.broadcastRoster();
    }
  }

  @SubscribeMessage("input")
  handleInput(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: Buffer | ArrayBuffer,
  ): void {
    const player = this.broadcastService.getPlayerBySocketId(client.id);
    if (!player) return;

    let ab: ArrayBuffer;
    if (data instanceof ArrayBuffer) {
      ab = data;
    } else if (ArrayBuffer.isView(data)) {
      ab = data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength,
      ) as ArrayBuffer;
    } else {
      const arr = new Uint8Array(Object.values(data as Record<string, number>));
      ab = arr.buffer;
    }
    const input = deserializeInput(ab);
    input.tick = this.gameService.state.currentTick;
    this.gameService.inputQueue.enqueue(player.slot, input);
  }

  @SubscribeMessage("respawn")
  handleRespawn(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { shipType: number },
  ): RespawnResult {
    const player = this.broadcastService.getPlayerBySocketId(client.id);
    if (!player) return { ok: false };

    if (data.shipType < ShipType.SC || data.shipType > ShipType.SB) {
      return { ok: false };
    }

    return this.gameService.respawn(player.slot, data.shipType as ShipType);
  }

  @SubscribeMessage("chat")
  handleChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { text: string; team: number; targetSlot?: number },
  ): void {
    const player = this.broadcastService.getPlayerBySocketId(client.id);
    if (!player) return;

    const ship = this.gameService.state.ships[player.slot];
    if (!ship) return;

    const message: ChatMessage = {
      senderSlot: player.slot,
      senderName: player.username,
      team: data.team,
      text: data.text,
      tick: this.gameService.state.currentTick,
      targetSlot: data.targetSlot,
    };

    if (this.server) {
      if (data.targetSlot !== undefined && data.targetSlot >= 0) {
        const recipient = this.broadcastService.getPlayerBySlot(
          data.targetSlot,
        );
        if (recipient) {
          recipient.socket.emit("chat", message);
        }
        if (player.slot !== data.targetSlot) {
          player.socket.emit("chat", message);
        }
      } else {
        for (const p of this.broadcastService.getAllPlayers()) {
          const pShip = this.gameService.state.ships[p.slot];
          if (data.team === -1 || (pShip && pShip.team === data.team)) {
            p.socket.emit("chat", message);
          }
        }
      }
    }

    this.botManager.onChatMessage(message);
  }
}

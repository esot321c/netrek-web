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
import { WsAuthService } from "./guards/ws-auth.guard";
import { GameService } from "./game.service";
import { GameBroadcastService } from "./game-broadcast.service";
import { BotManagerService } from "./bot";

@WebSocketGateway({
  namespace: "/game",
  cors: {
    origin: process.env["CORS_ORIGIN"] ?? "http://localhost:3011",
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

    // Check if player already connected
    const existing = this.broadcastService.getPlayerByUserId(payload.sub);
    if (existing) {
      this.logger.warn(
        `Player ${payload.sub} already connected, disconnecting old socket`,
      );
      existing.socket.disconnect();
      this.broadcastService.removePlayer(existing.socket.id);
      this.gameService.leaveGame(existing.slot);
    }

    // Store the userId on the socket data for later use
    client.data["userId"] = payload.sub;
    this.logger.log(`Player ${payload.sub} connected to game WS`);
  }

  handleDisconnect(client: Socket): void {
    const player = this.broadcastService.removePlayer(client.id);
    if (player) {
      const team = this.gameService.state.ships[player.slot]?.team;
      this.gameService.leaveGame(player.slot);
      if (team !== undefined) {
        this.botManager.onHumanLeave(team);
      }
      this.logger.log(
        `Player ${player.userId} disconnected, slot ${player.slot}`,
      );
    }
  }

  @SubscribeMessage("join")
  handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { team: number; shipType: number },
  ): { slot: number } | { error: string } {
    const userId = client.data["userId"] as string | undefined;
    if (!userId) {
      return { error: "Not authenticated" };
    }

    // Validate team and ship type
    if (data.team !== Team.FEDERATION && data.team !== Team.ROMULANS) {
      return { error: "Invalid team" };
    }
    if (data.shipType < ShipType.SC || data.shipType > ShipType.SB) {
      return { error: "Invalid ship type" };
    }

    const slot = this.gameService.joinGame(
      userId,
      data.team as Team,
      data.shipType as ShipType,
    );

    if (slot === -1) {
      return { error: "Game is full" };
    }

    this.broadcastService.addPlayer(client.id, client, slot, userId);
    this.botManager.onHumanJoin(data.team as Team);
    return { slot };
  }

  @SubscribeMessage("input")
  handleInput(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: Buffer | ArrayBuffer,
  ): void {
    const player = this.broadcastService.getPlayerBySocketId(client.id);
    if (!player) return;

    // Socket.IO may deliver binary as Buffer, Uint8Array, or ArrayBuffer
    let ab: ArrayBuffer;
    if (data instanceof ArrayBuffer) {
      ab = data;
    } else if (ArrayBuffer.isView(data)) {
      ab = data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength,
      ) as ArrayBuffer;
    } else {
      // Might be a plain object/array from JSON fallback — convert
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
  ): { ok: boolean } {
    const player = this.broadcastService.getPlayerBySocketId(client.id);
    if (!player) return { ok: false };

    if (data.shipType < ShipType.SC || data.shipType > ShipType.SB) {
      return { ok: false };
    }

    this.gameService.respawn(player.slot, data.shipType as ShipType);
    return { ok: true };
  }

  @SubscribeMessage("chat")
  handleChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { text: string; team: number },
  ): void {
    const player = this.broadcastService.getPlayerBySocketId(client.id);
    if (!player) return;

    const ship = this.gameService.state.ships[player.slot];
    if (!ship) return;

    const message: ChatMessage = {
      senderSlot: player.slot,
      senderName: player.userId,
      team: data.team,
      text: data.text,
      tick: this.gameService.state.currentTick,
    };

    // Broadcast to team or all
    if (this.server) {
      for (const p of this.broadcastService.getAllPlayers()) {
        const pShip = this.gameService.state.ships[p.slot];
        if (data.team === -1 || (pShip && pShip.team === data.team)) {
          p.socket.emit("chat", message);
        }
      }
    }

    // Forward to bot manager for order processing
    this.botManager.onChatMessage(message);
  }
}

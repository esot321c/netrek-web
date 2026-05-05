import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import { ServerConfig } from "../config/server.config";
import { GameService } from "../game/game.service";
import { BotManagerService } from "../game/bot";

@Injectable()
export class RegistrationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RegistrationService.name);
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly config: ServerConfig,
    private readonly gameService: GameService,
    private readonly botManager: BotManagerService,
  ) {}

  onModuleInit() {
    if (!this.config.serverId || !this.config.serverToken) {
      this.logger.warn(
        "No SERVER_ID or SERVER_TOKEN configured — running in standalone mode (no backend registration)",
      );
      return;
    }
    this.sendHeartbeat();
    this.heartbeatInterval = setInterval(() => this.sendHeartbeat(), 30_000);
    this.logger.log(
      `Registered with backend as server ${this.config.serverId}`,
    );
  }

  onModuleDestroy() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
  }

  private async sendHeartbeat() {
    try {
      const ships = this.gameService.state.ships;
      let humanCount = 0;
      let botCount = 0;
      const teamCounts: Record<
        number,
        { humanCount: number; botCount: number }
      > = {};

      for (const ship of ships) {
        if (!ship.playerId) continue;
        const isBot = ship.playerId.startsWith("bot:");
        if (isBot) botCount++;
        else humanCount++;

        if (!teamCounts[ship.team]) {
          teamCounts[ship.team] = { humanCount: 0, botCount: 0 };
        }
        if (isBot) teamCounts[ship.team]!.botCount++;
        else teamCounts[ship.team]!.humanCount++;
      }

      const teams = Object.entries(teamCounts).map(([team, counts]) => ({
        team: parseInt(team, 10),
        ...counts,
      }));

      const url = `${this.config.backendUrl}/servers/${this.config.serverId}/heartbeat`;
      await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.serverToken}`,
        },
        body: JSON.stringify({
          playerCount: humanCount,
          botCount,
          maxPlayers: 16,
          gamePhase: "playing",
          teams,
        }),
      });
    } catch (err) {
      this.logger.warn(`Heartbeat failed: ${(err as Error).message}`);
    }
  }
}

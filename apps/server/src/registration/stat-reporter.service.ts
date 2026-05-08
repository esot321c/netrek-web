import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import { ServerConfig } from "../config/server.config";
import { GameService } from "../game/game.service";

interface PlayerDeltas {
  kills: number;
  deaths: number;
  planetsTaken: number;
  armiesBombed: number;
  armiesBeamed: number;
  secondsPlayed: number;
}

@Injectable()
export class StatReporterService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StatReporterService.name);
  private reportInterval: ReturnType<typeof setInterval> | null = null;
  private deltas = new Map<string, PlayerDeltas>();
  private lastReportTick = 0;
  private guestUserIds = new Set<string>();

  constructor(
    private readonly config: ServerConfig,
    private readonly gameService: GameService,
  ) {}

  onModuleInit() {
    if (!this.config.serverId || !this.config.serverToken) return;
    this.reportInterval = setInterval(() => this.pushStats(), 60_000);
  }

  onModuleDestroy() {
    if (this.reportInterval) clearInterval(this.reportInterval);
    this.pushStats();
  }

  recordKill(userId: string) {
    this.getDelta(userId).kills++;
  }

  recordDeath(userId: string) {
    this.getDelta(userId).deaths++;
  }

  recordPlanetTaken(userId: string) {
    this.getDelta(userId).planetsTaken++;
  }

  recordArmiesBombed(userId: string, count: number) {
    this.getDelta(userId).armiesBombed += count;
  }

  recordArmiesBeamed(userId: string, count: number) {
    this.getDelta(userId).armiesBeamed += count;
  }

  markGuest(userId: string) {
    this.guestUserIds.add(userId);
  }

  unmarkGuest(userId: string) {
    this.guestUserIds.delete(userId);
  }

  private getDelta(userId: string): PlayerDeltas {
    let d = this.deltas.get(userId);
    if (!d) {
      d = {
        kills: 0,
        deaths: 0,
        planetsTaken: 0,
        armiesBombed: 0,
        armiesBeamed: 0,
        secondsPlayed: 0,
      };
      this.deltas.set(userId, d);
    }
    return d;
  }

  private async pushStats() {
    if (this.deltas.size === 0) return;

    const ticksElapsed =
      this.gameService.state.currentTick - this.lastReportTick;
    const secondsElapsed = Math.round(ticksElapsed / 10);
    this.lastReportTick = this.gameService.state.currentTick;

    const players = Array.from(this.deltas.entries())
      .filter(([userId]) => !this.guestUserIds.has(userId))
      .map(([userId, delta]) => ({
        userId,
        ...delta,
        secondsPlayed: secondsElapsed,
      }));

    this.deltas.clear();

    try {
      const url = `${this.config.backendUrl}/stats/ingest`;
      await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.serverToken}`,
        },
        body: JSON.stringify({
          serverId: this.config.serverId,
          players,
        }),
      });
      this.logger.debug(`Pushed stats for ${players.length} players`);
    } catch (err) {
      this.logger.warn(`Stat push failed: ${(err as Error).message}`);
    }
  }
}

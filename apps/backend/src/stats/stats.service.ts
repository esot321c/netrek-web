import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { IngestStatsDto } from "./dto/ingest-stats.dto";
import { ReportMatchDto } from "./dto/report-match.dto";
import { calculateDI, rankForDI } from "@netrek/shared";

@Injectable()
export class StatsService {
  private readonly logger = new Logger(StatsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ingest(dto: IngestStatsDto, isOfficial: boolean) {
    const scope = isOfficial ? "official" : dto.serverId;

    for (const p of dto.players) {
      await this.prisma.playerStats.upsert({
        where: {
          userId_serverId: { userId: p.userId, serverId: scope },
        },
        create: {
          userId: p.userId,
          serverId: scope,
          totalKills: p.kills,
          totalDeaths: p.deaths,
          planetsTaken: p.planetsTaken,
          armiesBombed: p.armiesBombed,
          armiesBeamed: p.armiesBeamed,
          secondsPlayed: p.secondsPlayed,
        },
        update: {
          totalKills: { increment: p.kills },
          totalDeaths: { increment: p.deaths },
          planetsTaken: { increment: p.planetsTaken },
          armiesBombed: { increment: p.armiesBombed },
          armiesBeamed: { increment: p.armiesBeamed },
          secondsPlayed: { increment: p.secondsPlayed },
        },
      });

      const updated = await this.prisma.playerStats.findUnique({
        where: { userId_serverId: { userId: p.userId, serverId: scope } },
      });
      if (updated) {
        const di = calculateDI({
          planetsTaken: updated.planetsTaken,
          armiesBombed: updated.armiesBombed,
          kills: updated.totalKills,
        });
        const newRank = rankForDI(di);
        if (newRank !== updated.rank) {
          await this.prisma.playerStats.update({
            where: { userId_serverId: { userId: p.userId, serverId: scope } },
            data: { rank: newRank },
          });
        }
      }
    }

    this.logger.debug(
      `Ingested stats for ${dto.players.length} players (scope: ${scope})`,
    );
  }

  async reportMatch(dto: ReportMatchDto, isOfficial: boolean) {
    const scope = isOfficial ? "official" : dto.serverId;

    const match = await this.prisma.match.create({
      data: {
        serverId: dto.serverId,
        winningTeam: dto.winningTeam,
        duration: dto.duration,
        genocide: dto.genocide ?? false,
        players: {
          create: dto.players.map((p) => ({
            userId: p.userId,
            team: p.team,
            shipType: p.shipType,
            kills: p.kills,
            deaths: p.deaths,
            planetsTaken: p.planetsTaken,
            armiesBombed: p.armiesBombed,
            armiesBeamed: p.armiesBeamed,
          })),
        },
      },
    });

    const winningTeam = dto.winningTeam;
    for (const p of dto.players) {
      const won = p.team === winningTeam;
      await this.prisma.playerStats.upsert({
        where: {
          userId_serverId: { userId: p.userId, serverId: scope },
        },
        create: {
          userId: p.userId,
          serverId: scope,
          totalWins: won ? 1 : 0,
          totalLosses: won ? 0 : 1,
        },
        update: {
          totalWins: won ? { increment: 1 } : undefined,
          totalLosses: won ? undefined : { increment: 1 },
        },
      });
    }

    this.logger.log(`Match reported: ${match.id} (official: ${isOfficial})`);
    return { matchId: match.id };
  }

  async getPlayerStats(userId: string, serverId: string) {
    return this.prisma.playerStats.findUnique({
      where: { userId_serverId: { userId, serverId } },
    });
  }

  async getMyStats(userId: string) {
    const stats = await this.prisma.playerStats.findUnique({
      where: { userId_serverId: { userId, serverId: "official" } },
    });
    if (!stats) {
      return {
        totalKills: 0,
        totalDeaths: 0,
        totalWins: 0,
        totalLosses: 0,
        planetsTaken: 0,
        armiesBombed: 0,
        armiesBeamed: 0,
        secondsPlayed: 0,
        rank: 0,
      };
    }
    return stats;
  }

  async getLeaderboard(serverId: string, limit: number = 20) {
    return this.prisma.playerStats.findMany({
      where: { serverId },
      orderBy: { totalKills: "desc" },
      take: limit,
      include: { user: { select: { username: true, avatarUrl: true } } },
    });
  }
}

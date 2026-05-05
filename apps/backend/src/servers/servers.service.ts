import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { randomBytes, createHash } from "crypto";
import { CreateServerDto } from "./dto/create-server.dto";
import { UpdateServerDto } from "./dto/update-server.dto";
import { HeartbeatDto } from "./dto/heartbeat.dto";

const MAX_SERVERS_PER_USER = 5;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

@Injectable()
export class ServersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(ownerId: string, dto: CreateServerDto) {
    const count = await this.prisma.gameServer.count({
      where: { ownerId },
    });
    if (count >= MAX_SERVERS_PER_USER) {
      throw new BadRequestException(
        `Maximum ${MAX_SERVERS_PER_USER} servers per account`,
      );
    }

    const rawToken = randomBytes(32).toString("hex");
    const server = await this.prisma.gameServer.create({
      data: {
        name: dto.name,
        ownerId,
        region: dto.region ?? "us-east",
        host: dto.host,
        maxPlayers: dto.maxPlayers ?? 16,
        serverTokenHash: hashToken(rawToken),
      },
    });

    return { id: server.id, name: server.name, serverToken: rawToken };
  }

  async findAllOnline() {
    return this.prisma.gameServer.findMany({
      where: { status: "online" },
      select: {
        id: true,
        name: true,
        region: true,
        host: true,
        maxPlayers: true,
        isOfficial: true,
        status: true,
        playerCount: true,
        botCount: true,
        gamePhase: true,
        lastHeartbeatAt: true,
      },
      orderBy: { playerCount: "desc" },
    });
  }

  async findById(id: string) {
    const server = await this.prisma.gameServer.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        ownerId: true,
        region: true,
        host: true,
        maxPlayers: true,
        isOfficial: true,
        status: true,
        playerCount: true,
        botCount: true,
        gamePhase: true,
        lastHeartbeatAt: true,
      },
    });
    if (!server) throw new NotFoundException("Server not found");
    return server;
  }

  async update(
    id: string,
    userId: string,
    isAdmin: boolean,
    dto: UpdateServerDto,
  ) {
    const server = await this.prisma.gameServer.findUnique({ where: { id } });
    if (!server) throw new NotFoundException("Server not found");
    if (server.ownerId !== userId && !isAdmin) {
      throw new ForbiddenException("Not the server owner");
    }
    if (dto.isOfficial !== undefined && !isAdmin) {
      throw new ForbiddenException("Only admins can set official status");
    }

    return this.prisma.gameServer.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.region !== undefined && { region: dto.region }),
        ...(dto.host !== undefined && { host: dto.host }),
        ...(dto.maxPlayers !== undefined && { maxPlayers: dto.maxPlayers }),
        ...(dto.isOfficial !== undefined && { isOfficial: dto.isOfficial }),
      },
    });
  }

  async remove(id: string, userId: string, isAdmin: boolean) {
    const server = await this.prisma.gameServer.findUnique({ where: { id } });
    if (!server) throw new NotFoundException("Server not found");
    if (server.ownerId !== userId && !isAdmin) {
      throw new ForbiddenException("Not the server owner");
    }
    await this.prisma.gameServer.delete({ where: { id } });
  }

  async rotateToken(id: string, userId: string) {
    const server = await this.prisma.gameServer.findUnique({ where: { id } });
    if (!server) throw new NotFoundException("Server not found");
    if (server.ownerId !== userId) {
      throw new ForbiddenException("Not the server owner");
    }

    const rawToken = randomBytes(32).toString("hex");
    await this.prisma.gameServer.update({
      where: { id },
      data: { serverTokenHash: hashToken(rawToken) },
    });

    return { serverToken: rawToken };
  }

  async validateServerToken(
    serverId: string,
    token: string,
  ): Promise<{ id: string; isOfficial: boolean } | null> {
    const server = await this.prisma.gameServer.findUnique({
      where: { id: serverId },
      select: { id: true, isOfficial: true, serverTokenHash: true },
    });
    if (!server) return null;
    if (server.serverTokenHash !== hashToken(token)) return null;
    return { id: server.id, isOfficial: server.isOfficial };
  }

  async heartbeat(serverId: string, dto: HeartbeatDto) {
    await this.prisma.gameServer.update({
      where: { id: serverId },
      data: {
        playerCount: dto.playerCount,
        botCount: dto.botCount,
        maxPlayers: dto.maxPlayers,
        gamePhase: dto.gamePhase,
        status: "online",
        lastHeartbeatAt: new Date(),
      },
    });
  }

  async markStaleServersOffline(timeoutSeconds: number) {
    const cutoff = new Date(Date.now() - timeoutSeconds * 1000);
    await this.prisma.gameServer.updateMany({
      where: {
        status: "online",
        lastHeartbeatAt: { lt: cutoff },
      },
      data: { status: "offline" },
    });
  }

  async findMyServers(userId: string) {
    return this.prisma.gameServer.findMany({
      where: { ownerId: userId },
      select: {
        id: true,
        name: true,
        region: true,
        host: true,
        maxPlayers: true,
        isOfficial: true,
        status: true,
        playerCount: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async getUsername(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { username: true },
    });
    return user?.username ?? null;
  }

  @Interval(30_000)
  async checkStaleServers() {
    await this.markStaleServersOffline(90);
  }
}

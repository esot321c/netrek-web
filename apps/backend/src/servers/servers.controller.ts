import { randomUUID } from "crypto";
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  BadRequestException,
} from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { User } from "../auth/decorators/user.decorator";
import { AuthUser } from "../auth/types/jwt.types";
import { ServersService } from "./servers.service";
import { ServerTokenGuard } from "./guards/server-token.guard";
import { CreateServerDto } from "./dto/create-server.dto";
import { UpdateServerDto } from "./dto/update-server.dto";
import { HeartbeatDto } from "./dto/heartbeat.dto";
import { JoinServerDto } from "./dto/join-server.dto";
import { GameTokenService } from "./game-token.service";
import { Role } from "generated/prisma/client";

@Controller("servers")
export class ServersController {
  constructor(
    private readonly serversService: ServersService,
    private readonly gameTokenService: GameTokenService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@User() user: AuthUser, @Body() dto: CreateServerDto) {
    return this.serversService.create(user.id, dto);
  }

  @Get()
  findAllOnline() {
    return this.serversService.findAllOnline();
  }

  @Get("mine")
  @UseGuards(JwtAuthGuard)
  findMyServers(@User() user: AuthUser) {
    return this.serversService.findMyServers(user.id);
  }

  @Get("public-key")
  getPublicKey() {
    return this.gameTokenService.getPublicKeyJwk();
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.serversService.findById(id);
  }

  @Patch(":id")
  @UseGuards(JwtAuthGuard)
  update(
    @Param("id") id: string,
    @User() user: AuthUser,
    @Body() dto: UpdateServerDto,
  ) {
    const isAdmin = user.roles.includes(Role.ADMIN);
    return this.serversService.update(id, user.id, isAdmin, dto);
  }

  @Delete(":id")
  @UseGuards(JwtAuthGuard)
  remove(@Param("id") id: string, @User() user: AuthUser) {
    const isAdmin = user.roles.includes(Role.ADMIN);
    return this.serversService.remove(id, user.id, isAdmin);
  }

  @Post(":id/heartbeat")
  @SkipThrottle()
  @UseGuards(ServerTokenGuard)
  heartbeat(@Param("id") id: string, @Body() dto: HeartbeatDto) {
    return this.serversService.heartbeat(id, dto);
  }

  @Post(":id/rotate-token")
  @UseGuards(JwtAuthGuard)
  rotateToken(@Param("id") id: string, @User() user: AuthUser) {
    return this.serversService.rotateToken(id, user.id);
  }

  @Post(":id/join")
  @UseGuards(JwtAuthGuard)
  async join(
    @Param("id") id: string,
    @User() user: AuthUser,
    @Body() dto: JoinServerDto,
  ) {
    const server = await this.serversService.findById(id);
    if (server.status !== "online") {
      throw new BadRequestException("Server is offline");
    }
    if (server.playerCount >= server.maxPlayers) {
      throw new BadRequestException("Server is full");
    }

    const stats = await this.gameTokenService.getPlayerStats(
      user.id,
      id,
      server.isOfficial,
    );

    const username =
      (await this.serversService.getUsername(user.id)) ?? "Unknown";

    const gameToken = await this.gameTokenService.signGameToken({
      sub: user.id,
      username,
      serverId: id,
      team: dto.team,
      shipType: dto.shipType,
      stats,
    });

    return { gameToken, wsUrl: server.host };
  }

  @Post(":id/join-guest")
  async joinGuest(@Param("id") id: string, @Body() dto: JoinServerDto) {
    const server = await this.serversService.findById(id);
    if (server.status !== "online") {
      throw new BadRequestException("Server is offline");
    }
    if (server.playerCount >= server.maxPlayers) {
      throw new BadRequestException("Server is full");
    }

    const guestNumber = Math.floor(Math.random() * 9000) + 1000;
    const gameToken = await this.gameTokenService.signGameToken({
      sub: `guest:${randomUUID()}`,
      username: `Guest-${guestNumber}`,
      serverId: id,
      team: dto.team,
      shipType: dto.shipType,
      isGuest: true,
      stats: {
        totalKills: 0,
        totalDeaths: 0,
        totalWins: 0,
        totalLosses: 0,
        planetsTaken: 0,
        armiesBombed: 0,
        armiesBeamed: 0,
        secondsPlayed: 0,
        rank: 0,
      },
    });

    return { gameToken, wsUrl: server.host };
  }
}

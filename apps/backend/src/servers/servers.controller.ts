import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { User } from "../auth/decorators/user.decorator";
import { AuthUser } from "../auth/types/jwt.types";
import { ServersService } from "./servers.service";
import { ServerTokenGuard } from "./guards/server-token.guard";
import { CreateServerDto } from "./dto/create-server.dto";
import { UpdateServerDto } from "./dto/update-server.dto";
import { HeartbeatDto } from "./dto/heartbeat.dto";
import { Role } from "generated/prisma/client";

@Controller("servers")
export class ServersController {
  constructor(private readonly serversService: ServersService) {}

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
  @UseGuards(ServerTokenGuard)
  heartbeat(@Param("id") id: string, @Body() dto: HeartbeatDto) {
    return this.serversService.heartbeat(id, dto);
  }

  @Post(":id/rotate-token")
  @UseGuards(JwtAuthGuard)
  rotateToken(@Param("id") id: string, @User() user: AuthUser) {
    return this.serversService.rotateToken(id, user.id);
  }
}

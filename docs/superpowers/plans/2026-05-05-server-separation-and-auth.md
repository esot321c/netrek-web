# Server Separation, Auth & Lobby Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the monolithic server into a central backend (auth, stats, server registry) and a stateless game server, connected by game tokens with asymmetric signing, with a lobby UI for browsing and joining games.

**Architecture:** Copy `apps/server` to `apps/backend`, then strip each app to its concern. Backend owns PostgreSQL + Redis, serves auth/lobby/stats APIs. Game server runs the game loop in-memory, heartbeats to backend, validates players via asymmetric JWT. Client browses games via backend REST, connects to game server WebSocket with short-lived game token.

**Tech Stack:** NestJS (both apps), Next.js (client), PostgreSQL + Prisma, Socket.IO, jose (ES256 JWT), @netrek/shared

**Spec:** `docs/superpowers/specs/2026-05-05-server-separation-and-auth-design.md`

---

## Phase A: Backend Infrastructure

### Task 1: Create apps/backend by Copying apps/server

Copy the current server app wholesale, then strip out game-specific code. This gives us a working NestJS app with auth, prisma, and config already wired up.

**Files:**

- Create: `apps/backend/` (copy of `apps/server/`)
- Modify: `apps/backend/package.json`
- Modify: `apps/backend/src/app.module.ts`
- Modify: `apps/backend/src/main.ts`
- Modify: `apps/backend/src/config/app.config.ts`
- Delete: `apps/backend/src/game/` (entire directory)
- Delete: `apps/backend/src/test/` (will recreate as needed)

- [ ] **Step 1: Copy apps/server to apps/backend**

```bash
cp -r apps/server apps/backend
```

- [ ] **Step 2: Update apps/backend/package.json**

Change the package name and remove game-specific dependencies:

```json
{
  "name": "@netrek/backend",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "nest start --watch",
    "build": "nest build",
    "start": "node dist/main",
    "lint": "eslint --max-warnings 25",
    "check-types": "tsc --noEmit",
    "test": "vitest run",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:push": "prisma db push",
    "db:reset": "prisma migrate reset"
  }
}
```

The `dependencies` stay the same for now (auth needs passport, jwt, etc.). We'll trim later if needed. The key change is the package `name`.

- [ ] **Step 3: Delete game directory from backend**

```bash
rm -rf apps/backend/src/game
rm -rf apps/backend/src/test
```

- [ ] **Step 4: Update apps/backend/src/app.module.ts**

Remove GameModule import, keep auth/prisma/lobby/config:

```typescript
import { Module } from "@nestjs/common";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { APP_GUARD } from "@nestjs/core";
import { AppConfigModule } from "./config/config.module";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { LobbyModule } from "./lobby/lobby.module";
import { AppController } from "./app.controller";

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRoot([
      { name: "short", ttl: 1000, limit: 10 },
      { name: "medium", ttl: 10000, limit: 50 },
      { name: "long", ttl: 60000, limit: 200 },
    ]),
    AuthModule,
    LobbyModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
```

- [ ] **Step 5: Update apps/backend/src/main.ts**

Remove the Socket.IO adapter setup (backend doesn't serve WebSockets for the game). Keep helmet, CORS, validation, swagger. Update the CSP `connectSrc` to remove `ws://` since the backend is REST-only:

In `main.ts`, remove these lines:

```typescript
// REMOVE: Socket.IO adapter
import { IoAdapter } from "@nestjs/platform-socket.io";
// REMOVE: app.useWebSocketAdapter(new IoAdapter(app));
```

And update CSP connectSrc to remove WebSocket URLs:

```typescript
connectSrc: ["'self'"],
```

- [ ] **Step 6: Update apps/backend/src/config/app.config.ts**

Add game token configuration. Add these properties to the AppConfig class:

```typescript
get gameToken() {
  return {
    privateKey: this.env("GAME_TOKEN_PRIVATE_KEY", ""),
    ttlSeconds: parseInt(this.env("GAME_TOKEN_TTL_SECONDS", "30"), 10),
  };
}

get serverHeartbeat() {
  return {
    timeoutSeconds: parseInt(
      this.env("SERVER_HEARTBEAT_TIMEOUT", "90"),
      10,
    ),
  };
}
```

- [ ] **Step 7: Verify backend builds**

```bash
cd apps/backend && npx tsc --noEmit
```

Fix any import errors from removed game code. The lobby module will have broken imports — that's expected, we'll rewrite it in Task 3.

- [ ] **Step 8: Temporarily stub the lobby module**

Replace `apps/backend/src/lobby/lobby.controller.ts` with a placeholder that compiles:

```typescript
import { Controller, Get } from "@nestjs/common";

@Controller("lobby")
export class LobbyController {
  @Get("info")
  getInfo() {
    return { status: "migrating to server browser" };
  }
}
```

Update `apps/backend/src/lobby/lobby.module.ts`:

```typescript
import { Module } from "@nestjs/common";
import { LobbyController } from "./lobby.controller";

@Module({
  controllers: [LobbyController],
})
export class LobbyModule {}
```

- [ ] **Step 9: Verify backend builds cleanly**

```bash
cd apps/backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add apps/backend
git commit -m "feat: scaffold apps/backend from apps/server copy"
```

---

### Task 2: Extend Prisma Schema

Add the four new models (GameServer, PlayerStats, Match, MatchPlayer) and update User relations.

**Files:**

- Modify: `apps/backend/prisma/schema.prisma`

- [ ] **Step 1: Add new models to schema.prisma**

Append after the existing Session model:

```prisma
model GameServer {
  id              String    @id @default(uuid())
  name            String
  ownerId         String
  owner           User      @relation(fields: [ownerId], references: [id])
  region          String    @default("us-east")
  host            String
  maxPlayers      Int       @default(16)
  isOfficial      Boolean   @default(false)
  serverTokenHash String
  status          String    @default("offline")
  playerCount     Int       @default(0)
  botCount        Int       @default(0)
  gamePhase       String    @default("waiting")
  lastHeartbeatAt DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  matches Match[]

  @@map("game_servers")
}

model PlayerStats {
  id            String   @id @default(uuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id])
  serverId      String
  totalKills    Int      @default(0)
  totalDeaths   Int      @default(0)
  totalWins     Int      @default(0)
  totalLosses   Int      @default(0)
  planetsTaken  Int      @default(0)
  armiesBombed  Int      @default(0)
  armiesBeamed  Int      @default(0)
  secondsPlayed Int      @default(0)
  rank          Int      @default(0)
  updatedAt     DateTime @updatedAt

  @@unique([userId, serverId])
  @@map("player_stats")
}

model Match {
  id          String     @id @default(uuid())
  serverId    String
  server      GameServer @relation(fields: [serverId], references: [id])
  winningTeam Int
  duration    Int
  genocide    Boolean    @default(false)
  playedAt    DateTime   @default(now())

  players MatchPlayer[]

  @@map("matches")
}

model MatchPlayer {
  id           String @id @default(uuid())
  matchId      String
  match        Match  @relation(fields: [matchId], references: [id])
  userId       String
  user         User   @relation(fields: [userId], references: [id])
  team         Int
  shipType     Int
  kills        Int    @default(0)
  deaths       Int    @default(0)
  planetsTaken Int    @default(0)
  armiesBombed Int    @default(0)
  armiesBeamed Int    @default(0)

  @@map("match_players")
}
```

- [ ] **Step 2: Add relations to existing User model**

In the User model, add these relation fields:

```prisma
  servers      GameServer[]
  playerStats  PlayerStats[]
  matchPlayers MatchPlayer[]
```

- [ ] **Step 3: Generate Prisma client**

```bash
cd apps/backend && npx prisma generate
```

- [ ] **Step 4: Create migration**

```bash
cd apps/backend && npx prisma migrate dev --name add_server_registry_and_stats
```

- [ ] **Step 5: Verify backend still builds**

```bash
cd apps/backend && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add apps/backend/prisma
git commit -m "feat: add GameServer, PlayerStats, Match, MatchPlayer schema"
```

---

### Task 3: Server Registry Module (Backend)

Create the servers module with registration, heartbeat, listing, and admin endpoints.

**Files:**

- Create: `apps/backend/src/servers/servers.module.ts`
- Create: `apps/backend/src/servers/servers.controller.ts`
- Create: `apps/backend/src/servers/servers.service.ts`
- Create: `apps/backend/src/servers/guards/server-token.guard.ts`
- Create: `apps/backend/src/servers/dto/create-server.dto.ts`
- Create: `apps/backend/src/servers/dto/update-server.dto.ts`
- Create: `apps/backend/src/servers/dto/heartbeat.dto.ts`
- Modify: `apps/backend/src/app.module.ts`

- [ ] **Step 1: Create DTOs**

`apps/backend/src/servers/dto/create-server.dto.ts`:

```typescript
import { IsString, IsInt, IsOptional, Min, Max, IsUrl } from "class-validator";

export class CreateServerDto {
  @IsString()
  name!: string;

  @IsString()
  @IsOptional()
  region?: string;

  @IsUrl()
  host!: string;

  @IsInt()
  @Min(2)
  @Max(16)
  @IsOptional()
  maxPlayers?: number;
}
```

`apps/backend/src/servers/dto/update-server.dto.ts`:

```typescript
import {
  IsString,
  IsBoolean,
  IsInt,
  IsOptional,
  IsUrl,
  Min,
  Max,
} from "class-validator";

export class UpdateServerDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  region?: string;

  @IsUrl()
  @IsOptional()
  host?: string;

  @IsInt()
  @Min(2)
  @Max(16)
  @IsOptional()
  maxPlayers?: number;

  @IsBoolean()
  @IsOptional()
  isOfficial?: boolean;
}
```

`apps/backend/src/servers/dto/heartbeat.dto.ts`:

```typescript
import { IsInt, IsString, IsArray, ValidateNested, Min } from "class-validator";
import { Type } from "class-transformer";

class TeamSummaryDto {
  @IsInt()
  team!: number;

  @IsInt()
  @Min(0)
  humanCount!: number;

  @IsInt()
  @Min(0)
  botCount!: number;
}

export class HeartbeatDto {
  @IsInt()
  @Min(0)
  playerCount!: number;

  @IsInt()
  @Min(0)
  botCount!: number;

  @IsInt()
  @Min(2)
  maxPlayers!: number;

  @IsString()
  gamePhase!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TeamSummaryDto)
  teams!: TeamSummaryDto[];
}
```

- [ ] **Step 2: Create servers service**

`apps/backend/src/servers/servers.service.ts`:

```typescript
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
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
}
```

- [ ] **Step 3: Create server token guard**

`apps/backend/src/servers/guards/server-token.guard.ts`:

```typescript
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import { ServersService } from "../servers.service";

@Injectable()
export class ServerTokenGuard implements CanActivate {
  constructor(private readonly serversService: ServersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers["authorization"];
    if (!authHeader?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing server token");
    }

    const token = authHeader.slice(7);
    const serverId =
      request.params.id ?? request.params.serverId ?? request.body?.serverId;
    if (!serverId) {
      throw new UnauthorizedException("Missing server ID");
    }

    const server = await this.serversService.validateServerToken(
      serverId,
      token,
    );
    if (!server) {
      throw new UnauthorizedException("Invalid server token");
    }

    request.gameServer = server;
    return true;
  }
}
```

- [ ] **Step 4: Create servers controller**

`apps/backend/src/servers/servers.controller.ts`:

```typescript
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  Req,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { AdminGuard } from "../auth/guards/admin.guard";
import { User } from "../auth/decorators/user.decorator";
import { AuthUser } from "../auth/types/jwt.types";
import { ServersService } from "./servers.service";
import { ServerTokenGuard } from "./guards/server-token.guard";
import { CreateServerDto } from "./dto/create-server.dto";
import { UpdateServerDto } from "./dto/update-server.dto";
import { HeartbeatDto } from "./dto/heartbeat.dto";
import { Role } from "generated/prisma";

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
```

- [ ] **Step 5: Create servers module**

`apps/backend/src/servers/servers.module.ts`:

```typescript
import { Module } from "@nestjs/common";
import { ServersController } from "./servers.controller";
import { ServersService } from "./servers.service";
import { PrismaModule } from "../prisma/prisma.module";
import { ServerTokenGuard } from "./guards/server-token.guard";

@Module({
  imports: [PrismaModule],
  controllers: [ServersController],
  providers: [ServersService, ServerTokenGuard],
  exports: [ServersService],
})
export class ServersModule {}
```

- [ ] **Step 6: Register ServersModule in app.module.ts**

Add to imports in `apps/backend/src/app.module.ts`:

```typescript
import { ServersModule } from "./servers/servers.module";

// In @Module imports array, add:
ServersModule,
```

- [ ] **Step 7: Add heartbeat staleness cron**

Add an `@Interval` to `ServersService` that marks stale servers offline. Add to the class:

```typescript
import { Interval } from "@nestjs/schedule";

// Add to ServersService class:
@Interval(30_000)
async checkStaleServers() {
  await this.markStaleServersOffline(90);
}
```

Also add `ScheduleModule.forRoot()` to `apps/backend/src/app.module.ts` imports and install `@nestjs/schedule`:

```bash
cd apps/backend && pnpm add @nestjs/schedule
```

```typescript
import { ScheduleModule } from "@nestjs/schedule";
// Add to imports: ScheduleModule.forRoot(),
```

- [ ] **Step 8: Verify backend builds**

```bash
cd apps/backend && npx tsc --noEmit
```

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/servers apps/backend/src/app.module.ts apps/backend/package.json
git commit -m "feat: add server registry module with CRUD, heartbeat, token auth"
```

---

### Task 4: Game Token Service (Backend)

Implement asymmetric JWT signing for game tokens. Backend signs with ES256 private key, game servers verify with the public key.

**Files:**

- Create: `apps/backend/src/servers/game-token.service.ts`
- Create: `apps/backend/src/servers/dto/join-server.dto.ts`
- Modify: `apps/backend/src/servers/servers.controller.ts`
- Modify: `apps/backend/src/servers/servers.module.ts`

- [ ] **Step 1: Install jose library**

```bash
cd apps/backend && pnpm add jose
```

- [ ] **Step 2: Create join DTO**

`apps/backend/src/servers/dto/join-server.dto.ts`:

```typescript
import { IsInt, Min, Max } from "class-validator";

export class JoinServerDto {
  @IsInt()
  @Min(0)
  @Max(3)
  team!: number;

  @IsInt()
  @Min(0)
  @Max(5)
  shipType!: number;
}
```

- [ ] **Step 3: Create game token service**

`apps/backend/src/servers/game-token.service.ts`:

```typescript
import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import { AppConfig } from "../config/app.config";
import { PrismaService } from "../prisma/prisma.service";
import * as jose from "jose";

export interface GameTokenPayload {
  sub: string;
  username: string;
  serverId: string;
  team: number;
  shipType: number;
  stats: {
    totalKills: number;
    totalDeaths: number;
    totalWins: number;
    totalLosses: number;
    planetsTaken: number;
    armiesBombed: number;
    armiesBeamed: number;
    secondsPlayed: number;
    rank: number;
  };
}

@Injectable()
export class GameTokenService implements OnModuleInit {
  private privateKey!: jose.KeyLike;
  private publicKeyJwk!: jose.JWK;
  private readonly logger = new Logger(GameTokenService.name);

  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    const pem = this.config.gameToken.privateKey;
    if (pem) {
      this.privateKey = await jose.importPKCS8(pem, "ES256");
      const publicKey = await jose.importPKCS8(pem, "ES256");
      this.publicKeyJwk = await jose.exportJWK(publicKey);
      this.logger.log("Loaded ES256 private key from config");
    } else {
      const { privateKey, publicKey } = await jose.generateKeyPair("ES256");
      this.privateKey = privateKey;
      this.publicKeyJwk = await jose.exportJWK(publicKey);
      this.logger.warn(
        "No GAME_TOKEN_PRIVATE_KEY configured — generated ephemeral key pair. Game tokens will not survive restarts.",
      );
    }
  }

  async signGameToken(payload: GameTokenPayload): Promise<string> {
    const ttl = this.config.gameToken.ttlSeconds;
    return new jose.SignJWT(payload as unknown as jose.JWTPayload)
      .setProtectedHeader({ alg: "ES256" })
      .setIssuedAt()
      .setExpirationTime(`${ttl}s`)
      .sign(this.privateKey);
  }

  getPublicKeyJwk(): jose.JWK {
    return this.publicKeyJwk;
  }

  async getPlayerStats(userId: string, serverId: string, isOfficial: boolean) {
    const scope = isOfficial ? "official" : serverId;
    const stats = await this.prisma.playerStats.findUnique({
      where: { userId_serverId: { userId, serverId: scope } },
    });
    return {
      totalKills: stats?.totalKills ?? 0,
      totalDeaths: stats?.totalDeaths ?? 0,
      totalWins: stats?.totalWins ?? 0,
      totalLosses: stats?.totalLosses ?? 0,
      planetsTaken: stats?.planetsTaken ?? 0,
      armiesBombed: stats?.armiesBombed ?? 0,
      armiesBeamed: stats?.armiesBeamed ?? 0,
      secondsPlayed: stats?.secondsPlayed ?? 0,
      rank: stats?.rank ?? 0,
    };
  }
}
```

- [ ] **Step 4: Add join endpoint and public key endpoint to controller**

Add to `apps/backend/src/servers/servers.controller.ts`:

```typescript
import { GameTokenService } from "./game-token.service";
import { JoinServerDto } from "./dto/join-server.dto";
import { BadRequestException } from "@nestjs/common";

// Add to constructor:
// private readonly gameTokenService: GameTokenService,

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

@Get("public-key")
getPublicKey() {
  return this.gameTokenService.getPublicKeyJwk();
}
```

- [ ] **Step 5: Add getUsername helper to servers service**

Add to `ServersService`:

```typescript
async getUsername(userId: string): Promise<string | null> {
  const user = await this.prisma.user.findUnique({
    where: { id: userId },
    select: { username: true },
  });
  return user?.username ?? null;
}
```

- [ ] **Step 6: Update servers module to include GameTokenService**

```typescript
import { GameTokenService } from "./game-token.service";

// Add to providers: GameTokenService,
// Add to exports: GameTokenService,
```

- [ ] **Step 7: Verify backend builds**

```bash
cd apps/backend && npx tsc --noEmit
```

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/servers apps/backend/package.json
git commit -m "feat: add game token service with ES256 asymmetric signing"
```

---

### Task 5: Stats Module (Backend)

Create the stats module for live stat ingestion and match reporting.

**Files:**

- Create: `apps/backend/src/stats/stats.module.ts`
- Create: `apps/backend/src/stats/stats.controller.ts`
- Create: `apps/backend/src/stats/stats.service.ts`
- Create: `apps/backend/src/stats/dto/ingest-stats.dto.ts`
- Create: `apps/backend/src/stats/dto/report-match.dto.ts`
- Modify: `apps/backend/src/app.module.ts`

- [ ] **Step 1: Create DTOs**

`apps/backend/src/stats/dto/ingest-stats.dto.ts`:

```typescript
import { IsString, IsArray, IsInt, ValidateNested, Min } from "class-validator";
import { Type } from "class-transformer";

class PlayerStatDeltaDto {
  @IsString()
  userId!: string;

  @IsInt()
  @Min(0)
  kills!: number;

  @IsInt()
  @Min(0)
  deaths!: number;

  @IsInt()
  @Min(0)
  planetsTaken!: number;

  @IsInt()
  @Min(0)
  armiesBombed!: number;

  @IsInt()
  @Min(0)
  armiesBeamed!: number;

  @IsInt()
  @Min(0)
  secondsPlayed!: number;
}

export class IngestStatsDto {
  @IsString()
  serverId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlayerStatDeltaDto)
  players!: PlayerStatDeltaDto[];
}
```

`apps/backend/src/stats/dto/report-match.dto.ts`:

```typescript
import {
  IsString,
  IsInt,
  IsBoolean,
  IsArray,
  ValidateNested,
  Min,
  IsOptional,
} from "class-validator";
import { Type } from "class-transformer";

class MatchPlayerDto {
  @IsString()
  userId!: string;

  @IsInt()
  team!: number;

  @IsInt()
  shipType!: number;

  @IsInt()
  @Min(0)
  kills!: number;

  @IsInt()
  @Min(0)
  deaths!: number;

  @IsInt()
  @Min(0)
  planetsTaken!: number;

  @IsInt()
  @Min(0)
  armiesBombed!: number;

  @IsInt()
  @Min(0)
  armiesBeamed!: number;
}

export class ReportMatchDto {
  @IsString()
  serverId!: string;

  @IsInt()
  winningTeam!: number;

  @IsInt()
  @Min(0)
  duration!: number;

  @IsBoolean()
  @IsOptional()
  genocide?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MatchPlayerDto)
  players!: MatchPlayerDto[];
}
```

- [ ] **Step 2: Create stats service**

`apps/backend/src/stats/stats.service.ts`:

```typescript
import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { IngestStatsDto } from "./dto/ingest-stats.dto";
import { ReportMatchDto } from "./dto/report-match.dto";

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

  async getLeaderboard(serverId: string, limit: number = 20) {
    return this.prisma.playerStats.findMany({
      where: { serverId },
      orderBy: { totalKills: "desc" },
      take: limit,
      include: { user: { select: { username: true, avatarUrl: true } } },
    });
  }
}
```

- [ ] **Step 3: Create stats controller**

`apps/backend/src/stats/stats.controller.ts`:

```typescript
import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from "@nestjs/common";
import { ServerTokenGuard } from "../servers/guards/server-token.guard";
import { StatsService } from "./stats.service";
import { IngestStatsDto } from "./dto/ingest-stats.dto";
import { ReportMatchDto } from "./dto/report-match.dto";

@Controller("stats")
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Post("ingest")
  @UseGuards(ServerTokenGuard)
  ingest(@Body() dto: IngestStatsDto, @Req() req: any) {
    const isOfficial: boolean = req.gameServer.isOfficial;
    return this.statsService.ingest(dto, isOfficial);
  }

  @Post("matches")
  @UseGuards(ServerTokenGuard)
  reportMatch(@Body() dto: ReportMatchDto, @Req() req: any) {
    const isOfficial: boolean = req.gameServer.isOfficial;
    return this.statsService.reportMatch(dto, isOfficial);
  }

  @Get("leaderboard/:serverId")
  getLeaderboard(
    @Param("serverId") serverId: string,
    @Query("limit") limit?: string,
  ) {
    return this.statsService.getLeaderboard(
      serverId,
      limit ? parseInt(limit, 10) : 20,
    );
  }
}
```

- [ ] **Step 4: Create stats module**

`apps/backend/src/stats/stats.module.ts`:

```typescript
import { Module } from "@nestjs/common";
import { StatsController } from "./stats.controller";
import { StatsService } from "./stats.service";
import { PrismaModule } from "../prisma/prisma.module";
import { ServersModule } from "../servers/servers.module";

@Module({
  imports: [PrismaModule, ServersModule],
  controllers: [StatsController],
  providers: [StatsService],
  exports: [StatsService],
})
export class StatsModule {}
```

- [ ] **Step 5: Register StatsModule in app.module.ts**

Add to `apps/backend/src/app.module.ts`:

```typescript
import { StatsModule } from "./stats/stats.module";
// Add to imports: StatsModule,
```

- [ ] **Step 6: Verify backend builds**

```bash
cd apps/backend && npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/stats apps/backend/src/app.module.ts
git commit -m "feat: add stats module with live ingestion and match reporting"
```

---

### Task 6: Slim apps/server to Game-Only

Strip auth, prisma, lobby, and common from the game server. Add lightweight config, registration service (heartbeat + stat push), and game token validation.

**Files:**

- Delete: `apps/server/src/auth/` (entire directory)
- Delete: `apps/server/src/prisma/` (entire directory)
- Delete: `apps/server/src/lobby/` (entire directory)
- Delete: `apps/server/src/common/` (entire directory)
- Delete: `apps/server/prisma/` (entire directory)
- Delete: `apps/server/src/app.controller.ts`
- Create: `apps/server/src/config/server.config.ts`
- Create: `apps/server/src/config/config.module.ts`
- Create: `apps/server/src/registration/registration.module.ts`
- Create: `apps/server/src/registration/registration.service.ts`
- Create: `apps/server/src/registration/stat-reporter.service.ts`
- Modify: `apps/server/src/app.module.ts`
- Modify: `apps/server/src/main.ts`
- Modify: `apps/server/src/game/game.module.ts`
- Modify: `apps/server/src/game/game.gateway.ts`
- Modify: `apps/server/src/game/guards/ws-auth.guard.ts`
- Modify: `apps/server/package.json`

- [ ] **Step 1: Delete backend-only code from apps/server**

```bash
rm -rf apps/server/src/auth
rm -rf apps/server/src/prisma
rm -rf apps/server/src/lobby
rm -rf apps/server/src/common
rm -rf apps/server/prisma
rm -f apps/server/src/app.controller.ts
```

- [ ] **Step 2: Create lightweight server config**

`apps/server/src/config/server.config.ts`:

```typescript
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class ServerConfig {
  constructor(private readonly config: ConfigService) {}

  private env(key: string, fallback?: string): string {
    return this.config.get<string>(key) ?? fallback ?? "";
  }

  get backendUrl(): string {
    return this.env("BACKEND_URL", "http://localhost:3012/v1");
  }

  get serverId(): string {
    return this.env("SERVER_ID");
  }

  get serverToken(): string {
    return this.env("SERVER_TOKEN");
  }

  get gameTokenPublicKey(): string {
    return this.env("GAME_TOKEN_PUBLIC_KEY");
  }

  get wsPort(): number {
    return parseInt(this.env("WS_PORT", "3013"), 10);
  }

  get publicWsUrl(): string {
    return this.env("PUBLIC_WS_URL", `ws://localhost:${this.wsPort}`);
  }

  get corsOrigin(): string {
    return this.env("CORS_ORIGIN", "http://localhost:3011");
  }
}
```

`apps/server/src/config/config.module.ts`:

```typescript
import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ServerConfig } from "./server.config";

@Global()
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  providers: [ServerConfig],
  exports: [ServerConfig],
})
export class ServerConfigModule {}
```

- [ ] **Step 3: Create registration service**

`apps/server/src/registration/registration.service.ts`:

```typescript
import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import { ServerConfig } from "../config/server.config";
import { GameService } from "../game/game.service";
import { BotManagerService } from "../game/bot/bot-manager.service";
import { Team } from "@netrek/shared";

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
```

- [ ] **Step 4: Create stat reporter service**

`apps/server/src/registration/stat-reporter.service.ts`:

```typescript
import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import { ServerConfig } from "../config/server.config";
import { GameService } from "../game/game.service";
import { ShipStatus } from "@netrek/shared";

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

    const players = Array.from(this.deltas.entries()).map(
      ([userId, delta]) => ({
        userId,
        ...delta,
        secondsPlayed: secondsElapsed,
      }),
    );

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
```

- [ ] **Step 5: Create registration module**

`apps/server/src/registration/registration.module.ts`:

```typescript
import { Module } from "@nestjs/common";
import { RegistrationService } from "./registration.service";
import { StatReporterService } from "./stat-reporter.service";

@Module({
  providers: [RegistrationService, StatReporterService],
  exports: [RegistrationService, StatReporterService],
})
export class RegistrationModule {}
```

- [ ] **Step 6: Rewrite ws-auth guard for game token validation**

`apps/server/src/game/guards/ws-auth.guard.ts`:

```typescript
import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import { ServerConfig } from "../../config/server.config";
import * as jose from "jose";
import type { Socket } from "socket.io";

export interface GameTokenPayload {
  sub: string;
  username: string;
  serverId: string;
  team: number;
  shipType: number;
  stats: {
    totalKills: number;
    totalDeaths: number;
    totalWins: number;
    totalLosses: number;
    planetsTaken: number;
    armiesBombed: number;
    armiesBeamed: number;
    secondsPlayed: number;
    rank: number;
  };
}

@Injectable()
export class WsAuthService implements OnModuleInit {
  private publicKey: jose.KeyLike | null = null;
  private readonly logger = new Logger(WsAuthService.name);

  constructor(private readonly config: ServerConfig) {}

  async onModuleInit() {
    const jwkStr = this.config.gameTokenPublicKey;
    if (jwkStr) {
      try {
        const jwk = JSON.parse(jwkStr);
        this.publicKey = await jose.importJWK(jwk, "ES256");
        this.logger.log("Loaded game token public key");
      } catch (err) {
        this.logger.error(
          `Failed to load public key: ${(err as Error).message}`,
        );
      }
    }

    if (!this.publicKey) {
      this.logger.warn(
        "No GAME_TOKEN_PUBLIC_KEY configured — will fetch from backend on first connection",
      );
    }
  }

  private async fetchPublicKey(): Promise<void> {
    try {
      const url = `${this.config.backendUrl}/servers/public-key`;
      const res = await fetch(url);
      const jwk = await res.json();
      this.publicKey = await jose.importJWK(jwk, "ES256");
      this.logger.log("Fetched game token public key from backend");
    } catch (err) {
      this.logger.error(
        `Failed to fetch public key: ${(err as Error).message}`,
      );
    }
  }

  async validateSocket(client: Socket): Promise<GameTokenPayload | null> {
    try {
      const token =
        client.handshake.auth?.token ??
        client.handshake.headers?.authorization?.replace("Bearer ", "");

      if (!token) {
        this.logger.warn("No game token in handshake");
        return null;
      }

      if (!this.publicKey) {
        await this.fetchPublicKey();
      }

      if (!this.publicKey) {
        this.logger.error("No public key available");
        return null;
      }

      const { payload } = await jose.jwtVerify(token, this.publicKey, {
        algorithms: ["ES256"],
      });

      return payload as unknown as GameTokenPayload;
    } catch (err) {
      this.logger.warn(
        `Game token validation failed: ${(err as Error).message}`,
      );
      return null;
    }
  }
}
```

- [ ] **Step 7: Update game gateway for game token auth**

Rewrite `apps/server/src/game/game.gateway.ts` to use the game token payload instead of session-based auth. The key changes:

1. `handleConnection` extracts team/shipType/userId/username from the game token instead of looking up a session
2. `handleConnection` auto-joins the player (no separate "join" event needed — the token contains team + shipType)
3. Remove the `@SubscribeMessage("join")` handler — joining happens on connect via the token
4. Keep `input`, `respawn`, and `chat` handlers

```typescript
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from "@nestjs/websockets";
import { Logger } from "@nestjs/common";
import { Server, Socket } from "socket.io";
import { WsAuthService, GameTokenPayload } from "./guards/ws-auth.guard";
import { GameService } from "./game.service";
import { GameBroadcastService } from "./game-broadcast.service";
import { BotManagerService } from "./bot/bot-manager.service";
import { deserializeInput, ChatMessage, Team, ShipType } from "@netrek/shared";
import { ServerConfig } from "../config/server.config";

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
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(GameGateway.name);

  constructor(
    private readonly wsAuth: WsAuthService,
    private readonly gameService: GameService,
    private readonly broadcast: GameBroadcastService,
    private readonly botManager: BotManagerService,
  ) {}

  afterInit(server: Server) {
    this.broadcast.setServer(server);
    this.logger.log("Game gateway initialized");
  }

  async handleConnection(client: Socket) {
    const payload = await this.wsAuth.validateSocket(client);
    if (!payload) {
      client.disconnect();
      return;
    }

    const existing = this.broadcast.getPlayerByUserId(payload.sub);
    if (existing) {
      existing.socket.disconnect();
      this.broadcast.removePlayer(existing.socket.id);
      this.gameService.leaveGame(existing.slot);
    }

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

    this.broadcast.addPlayer(client.id, client, slot, payload.sub);
    this.botManager.onHumanJoin(payload.team as Team);

    client.emit("joined", { slot });
    this.logger.log(
      `Player ${payload.username} joined slot ${slot} (team ${payload.team})`,
    );
  }

  handleDisconnect(client: Socket) {
    const player = this.broadcast.removePlayer(client.id);
    if (player) {
      const ship = this.gameService.state.ships[player.slot];
      const team = ship?.team;
      this.gameService.leaveGame(player.slot);
      if (team !== undefined) {
        this.botManager.onHumanLeave(team);
      }
      this.logger.log(`Player disconnected from slot ${player.slot}`);
    }
  }

  @SubscribeMessage("input")
  handleInput(client: Socket, data: Buffer | Uint8Array | ArrayBuffer) {
    const player = this.broadcast.getPlayerBySocketId(client.id);
    if (!player) return;

    let buf: Uint8Array;
    if (data instanceof ArrayBuffer) {
      buf = new Uint8Array(data);
    } else if (data instanceof Buffer) {
      buf = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    } else {
      buf = data;
    }

    const input = deserializeInput(buf);
    if (!input) return;
    input.tick = this.gameService.state.currentTick;
    this.gameService.inputQueue.enqueue(player.slot, input);
  }

  @SubscribeMessage("respawn")
  handleRespawn(client: Socket, payload: { shipType: number }) {
    const player = this.broadcast.getPlayerBySocketId(client.id);
    if (!player) return { ok: false };

    const shipType = payload.shipType;
    if (shipType < ShipType.SC || shipType > ShipType.SB) {
      return { ok: false };
    }

    const torps = this.gameService.state.torps;
    for (let i = player.slot * 8; i < player.slot * 8 + 8; i++) {
      if (torps[i]?.alive) return { ok: false };
    }

    this.gameService.respawn(player.slot, shipType);
    return { ok: true };
  }

  @SubscribeMessage("chat")
  handleChat(client: Socket, payload: { message: string; team: number }) {
    const player = this.broadcast.getPlayerBySocketId(client.id);
    if (!player) return;

    const ship = this.gameService.state.ships[player.slot];
    if (!ship) return;

    const msg: ChatMessage = {
      sender: player.slot,
      team: payload.team,
      message: payload.message,
      tick: this.gameService.state.currentTick,
    };

    const allPlayers = this.broadcast.getAllPlayers();
    for (const p of allPlayers) {
      if (
        payload.team === -1 ||
        p.socket.data["payload"]?.team === payload.team
      ) {
        p.socket.emit("chat", msg);
      }
    }

    this.botManager.onChatMessage(msg);
  }
}
```

- [ ] **Step 8: Update game module**

`apps/server/src/game/game.module.ts`:

```typescript
import { Module } from "@nestjs/common";
import { GameService } from "./game.service";
import { GameLoopService } from "./game-loop.service";
import { GameBroadcastService } from "./game-broadcast.service";
import { GameGateway } from "./game.gateway";
import { WsAuthService } from "./guards/ws-auth.guard";
import { BotManagerService } from "./bot/bot-manager.service";

@Module({
  providers: [
    GameService,
    GameLoopService,
    GameBroadcastService,
    GameGateway,
    WsAuthService,
    BotManagerService,
  ],
  exports: [GameService, GameLoopService, BotManagerService],
})
export class GameModule {}
```

- [ ] **Step 9: Rewrite app.module.ts**

`apps/server/src/app.module.ts`:

```typescript
import { Module } from "@nestjs/common";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { ServerConfigModule } from "./config/config.module";
import { GameModule } from "./game/game.module";
import { RegistrationModule } from "./registration/registration.module";

@Module({
  imports: [
    ServerConfigModule,
    EventEmitterModule.forRoot(),
    GameModule,
    RegistrationModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 10: Rewrite main.ts**

`apps/server/src/main.ts`:

```typescript
import { NestFactory } from "@nestjs/core";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { AppModule } from "./app.module";
import { ServerConfig } from "./config/server.config";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ServerConfig);

  app.useWebSocketAdapter(new IoAdapter(app));
  app.enableCors({
    origin: config.corsOrigin,
    credentials: true,
  });

  await app.listen(config.wsPort);
  console.log(`Game server listening on port ${config.wsPort}`);
}
bootstrap();
```

- [ ] **Step 11: Update package.json**

Remove backend-only dependencies from `apps/server/package.json`. Remove:

- `@prisma/adapter-pg`, `@prisma/client`, `prisma`
- `passport`, `passport-google-oauth20`, `passport-jwt`
- `@nestjs/passport`, `@nestjs/jwt`, `@nestjs/swagger`
- `@nestjs/throttler`
- `cookie-parser`, `helmet`
- `pg`

Add:

- `jose` (for game token verification)

Remove the `db:*` scripts.

- [ ] **Step 12: Install jose in apps/server**

```bash
cd apps/server && pnpm add jose
```

- [ ] **Step 13: Create .env.example for apps/server**

`apps/server/.env.example`:

```env
# Backend connection (omit for standalone mode)
BACKEND_URL=http://localhost:3012/v1
SERVER_ID=
SERVER_TOKEN=

# Game token verification (JSON Web Key, fetched from backend if omitted)
GAME_TOKEN_PUBLIC_KEY=

# Server
WS_PORT=3013
PUBLIC_WS_URL=ws://localhost:3013
CORS_ORIGIN=http://localhost:3011

# Bots
BOTS_PER_TEAM=4
MAX_PLAYERS_PER_TEAM=8
BOT_DIFFICULTY_MIX=1:2:1
```

- [ ] **Step 14: Create .env.example for apps/backend**

Update `apps/backend/.env.example`:

```env
DATABASE_URL=postgresql://netrek:netrek_dev@localhost:15477/netrek
REDIS_URL=redis://localhost:16377

# Auth
JWT_SECRET=change-me-to-a-random-secret-at-least-32-chars
JWT_ACCESS_TTL=2h
TOKEN_ROTATION_MINUTES=100
SESSION_TTL_DAYS=60
COOKIE_DOMAIN=

# OAuth - Google
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:3012/v1/auth/google/callback

# CORS
CORS_ORIGIN=http://localhost:3011
API_PORT=3012

# Game tokens (ES256 PEM private key — generate with: openssl ecparam -genkey -name prime256v1 -noout)
GAME_TOKEN_PRIVATE_KEY=
GAME_TOKEN_TTL_SECONDS=30
SERVER_HEARTBEAT_TIMEOUT=90
```

- [ ] **Step 15: Verify both apps build**

```bash
cd apps/backend && npx tsc --noEmit
cd apps/server && npx tsc --noEmit
```

Fix any remaining import errors.

- [ ] **Step 16: Commit**

```bash
git add apps/server apps/backend
git commit -m "feat: slim apps/server to game-only, add registration and game token auth"
```

---

## Phase B: Client UX

### Task 7: Update Client API and Socket for Multi-Server

Update the client's API client and socket module to support connecting to different game servers with game tokens.

**Files:**

- Modify: `apps/client/lib/api/client.ts`
- Modify: `apps/client/lib/game/socket.ts`
- Modify: `apps/client/components/game-canvas.tsx`

- [ ] **Step 1: Add joinServer helper to API client**

Add to `apps/client/lib/api/client.ts`:

```typescript
export async function joinServer(
  serverId: string,
  team: number,
  shipType: number,
): Promise<{ gameToken: string; wsUrl: string }> {
  return apiFetch(`/servers/${serverId}/join`, {
    method: "POST",
    body: JSON.stringify({ team, shipType }),
  });
}

export async function fetchServers() {
  return apiFetch<any[]>("/servers");
}

export async function fetchServer(id: string) {
  return apiFetch<any>(`/servers/${id}`);
}
```

- [ ] **Step 2: Update socket.ts to accept dynamic server URL and game token**

Rewrite `apps/client/lib/game/socket.ts` so `connect()` accepts a WebSocket URL and game token instead of hardcoding the API URL:

Change the `connect` function signature:

```typescript
export function connect(wsUrl: string, gameToken: string): Socket {
  if (socket) {
    socket.disconnect();
  }

  socket = io(wsUrl + "/game", {
    auth: { token: gameToken },
    transports: ["websocket"],
    autoConnect: true,
  });

  // ... rest of event handlers stay the same
}
```

Remove the hardcoded `API_URL` constant used for socket connection (keep it for any other use).

- [ ] **Step 3: Update game-canvas.tsx for new connection flow**

The game canvas currently calls `connect()` with no args and then `sendJoin()` separately. Update it to:

1. Accept `wsUrl` and `gameToken` as props (or read from URL params/context)
2. Call `connect(wsUrl, gameToken)` — the server auto-joins the player on connection
3. Listen for `"joined"` event instead of the join callback
4. Remove the ship selection UI from game-canvas (it moves to the lobby detail page)

The game-canvas should receive these as props:

```typescript
interface GameCanvasProps {
  wsUrl: string;
  gameToken: string;
}
```

And connect on mount:

```typescript
useEffect(() => {
  const sock = connect(wsUrl, gameToken);
  // Listen for "joined" event
  sock.on("joined", (data: { slot: number }) => {
    setMySlot(data.slot);
    setPhase("playing");
  });
  // ... rest of setup
  return () => disconnect();
}, [wsUrl, gameToken]);
```

- [ ] **Step 4: Commit**

```bash
git add apps/client/lib apps/client/components
git commit -m "feat: update client socket and API for multi-server game tokens"
```

---

### Task 8: Landing Page

Replace the current home page with an informational landing page.

**Files:**

- Modify: `apps/client/app/page.tsx`

- [ ] **Step 1: Rewrite the landing page**

`apps/client/app/page.tsx`:

```tsx
"use client";

import { useAuth } from "@/lib/auth-context";
import Link from "next/link";

export default function HomePage() {
  const { user } = useAuth();

  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <section className="mb-16 text-center">
        <h1 className="mb-4 text-5xl font-bold tracking-tight">Netrek</h1>
        <p className="mb-8 text-xl text-gray-400">
          Browser-based multiplayer space combat. Two teams. Forty planets.
          Total war.
        </p>
        {user ? (
          <Link
            href="/lobby"
            className="inline-block rounded bg-yellow-600 px-8 py-3 text-lg font-semibold text-black hover:bg-yellow-500"
          >
            Enter Lobby
          </Link>
        ) : (
          <Link
            href="/auth/signin"
            className="inline-block rounded bg-yellow-600 px-8 py-3 text-lg font-semibold text-black hover:bg-yellow-500"
          >
            Sign In to Play
          </Link>
        )}
      </section>

      <section className="mb-12">
        <h2 className="mb-4 text-2xl font-bold">What is Netrek?</h2>
        <p className="mb-4 text-gray-300">
          Netrek is one of the oldest team-based online games, dating back to
          1988. Two teams of up to 8 players battle for control of 40 planets
          across a galaxy map. Capture planets by bombing enemy armies and
          beaming down your own. Achieve genocide by taking all enemy planets.
        </p>
        <p className="text-gray-300">
          This is a modern browser-based recreation of the classic Bronco
          (Vanilla) Netrek experience, faithful to the original mechanics.
        </p>
      </section>

      <section className="mb-12">
        <h2 className="mb-4 text-2xl font-bold">How to Play</h2>
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="mb-2 text-lg font-semibold text-yellow-500">
              Movement
            </h3>
            <ul className="space-y-1 text-sm text-gray-300">
              <li>
                <kbd className="rounded bg-gray-700 px-1">Right click</kbd> —
                Set course
              </li>
              <li>
                <kbd className="rounded bg-gray-700 px-1">0-9</kbd> — Set speed
                (warp 0-9)
              </li>
              <li>
                <kbd className="rounded bg-gray-700 px-1">%</kbd> — Maximum
                speed
              </li>
            </ul>
          </div>
          <div>
            <h3 className="mb-2 text-lg font-semibold text-red-500">Combat</h3>
            <ul className="space-y-1 text-sm text-gray-300">
              <li>
                <kbd className="rounded bg-gray-700 px-1">Left click</kbd> —
                Fire torpedo
              </li>
              <li>
                <kbd className="rounded bg-gray-700 px-1">
                  Shift+Left / Middle click
                </kbd>{" "}
                — Fire phaser
              </li>
              <li>
                <kbd className="rounded bg-gray-700 px-1">s</kbd> — Toggle
                shields
              </li>
            </ul>
          </div>
          <div>
            <h3 className="mb-2 text-lg font-semibold text-green-500">
              Planets
            </h3>
            <ul className="space-y-1 text-sm text-gray-300">
              <li>
                <kbd className="rounded bg-gray-700 px-1">l</kbd> — Lock nearest
                (planet/ship)
              </li>
              <li>
                <kbd className="rounded bg-gray-700 px-1">b</kbd> — Bomb planet
                (in orbit, shields down)
              </li>
              <li>
                <kbd className="rounded bg-gray-700 px-1">z</kbd> — Beam up
                armies
              </li>
              <li>
                <kbd className="rounded bg-gray-700 px-1">x</kbd> — Beam down
                armies
              </li>
            </ul>
          </div>
          <div>
            <h3 className="mb-2 text-lg font-semibold text-cyan-500">
              Special
            </h3>
            <ul className="space-y-1 text-sm text-gray-300">
              <li>
                <kbd className="rounded bg-gray-700 px-1">c</kbd> — Cloak
              </li>
              <li>
                <kbd className="rounded bg-gray-700 px-1">r</kbd> — Repair
              </li>
              <li>
                <kbd className="rounded bg-gray-700 px-1">T</kbd> — Tractor beam
              </li>
              <li>
                <kbd className="rounded bg-gray-700 px-1">y</kbd> — Pressor beam
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-2xl font-bold">Ship Classes</h2>
        <div className="grid gap-3 text-sm md:grid-cols-3">
          <div className="rounded border border-gray-700 p-3">
            <span className="font-bold text-yellow-500">SC</span> — Scout. Fast,
            fragile. Good for recon.
          </div>
          <div className="rounded border border-gray-700 p-3">
            <span className="font-bold text-yellow-500">DD</span> — Destroyer.
            Balanced speed and firepower.
          </div>
          <div className="rounded border border-gray-700 p-3">
            <span className="font-bold text-yellow-500">CA</span> — Cruiser.
            Solid all-rounder.
          </div>
          <div className="rounded border border-gray-700 p-3">
            <span className="font-bold text-yellow-500">BB</span> — Battleship.
            Heavy firepower, slow.
          </div>
          <div className="rounded border border-gray-700 p-3">
            <span className="font-bold text-yellow-500">AS</span> — Assault
            Ship. Army carrier.
          </div>
          <div className="rounded border border-gray-700 p-3">
            <span className="font-bold text-yellow-500">SB</span> — Starbase.
            Team fortress. Requires rank.
          </div>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/client/app/page.tsx
git commit -m "feat: redesign landing page with game info and how-to-play"
```

---

### Task 9: Lobby — Server Browser

Create the server browser page that lists active games.

**Files:**

- Create: `apps/client/app/lobby/page.tsx` (rewrite existing)

- [ ] **Step 1: Rewrite the lobby page as a server browser**

`apps/client/app/lobby/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import Link from "next/link";

interface ServerInfo {
  id: string;
  name: string;
  region: string;
  maxPlayers: number;
  isOfficial: boolean;
  status: string;
  playerCount: number;
  botCount: number;
  gamePhase: string;
}

export default function LobbyPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/auth/signin");
      return;
    }

    let active = true;
    const poll = async () => {
      try {
        const data = await api("/servers");
        if (active) {
          setServers(data as ServerInfo[]);
          setError(null);
        }
      } catch (err) {
        if (active) setError("Failed to load servers");
      }
    };

    poll();
    const interval = setInterval(poll, 5000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [user, loading, router]);

  if (loading) return <div className="p-8 text-center">Loading...</div>;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Lobby</h1>
        <Link
          href="/settings/servers"
          className="rounded border border-gray-600 px-4 py-2 text-sm hover:bg-gray-800"
        >
          Host a Server
        </Link>
      </div>

      {error && <p className="mb-4 text-red-500">{error}</p>}

      {servers.length === 0 && !error && (
        <p className="text-gray-400">No servers online.</p>
      )}

      <div className="space-y-3">
        {servers.map((s) => (
          <Link
            key={s.id}
            href={`/lobby/${s.id}`}
            className="block rounded border border-gray-700 p-4 hover:border-gray-500 hover:bg-gray-900"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-lg font-semibold">{s.name}</span>
                {s.isOfficial ? (
                  <span className="rounded bg-yellow-700 px-2 py-0.5 text-xs font-bold text-black">
                    Official
                  </span>
                ) : (
                  <span className="rounded bg-gray-700 px-2 py-0.5 text-xs">
                    Community
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4 text-sm text-gray-400">
                <span>{s.region}</span>
                <span>
                  {s.playerCount}/{s.maxPlayers} players
                </span>
                <span
                  className={
                    s.gamePhase === "playing"
                      ? "text-green-500"
                      : "text-gray-500"
                  }
                >
                  {s.gamePhase}
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/client/app/lobby
git commit -m "feat: rewrite lobby as server browser with auto-refresh"
```

---

### Task 10: Game Detail Page — Team Selection & Join

Create the per-server detail page where players pick a team and ship, then join.

**Files:**

- Create: `apps/client/app/lobby/[id]/page.tsx`

- [ ] **Step 1: Create the game detail page**

`apps/client/app/lobby/[id]/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { joinServer } from "@/lib/api/client";
import { Team, ShipType } from "@netrek/shared";

interface ServerDetail {
  id: string;
  name: string;
  region: string;
  maxPlayers: number;
  isOfficial: boolean;
  status: string;
  playerCount: number;
  botCount: number;
  gamePhase: string;
}

const SHIP_NAMES: Record<number, string> = {
  [ShipType.SC]: "Scout",
  [ShipType.DD]: "Destroyer",
  [ShipType.CA]: "Cruiser",
  [ShipType.BB]: "Battleship",
  [ShipType.AS]: "Assault Ship",
  [ShipType.SB]: "Starbase",
};

export default function GameDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, loading } = useAuth();
  const router = useRouter();
  const [server, setServer] = useState<ServerDetail | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<number>(Team.FEDERATION);
  const [selectedShip, setSelectedShip] = useState<number>(ShipType.CA);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/auth/signin");
      return;
    }

    let active = true;
    const poll = async () => {
      try {
        const data = await api(`/servers/${id}`);
        if (active) setServer(data as ServerDetail);
      } catch {
        if (active) setError("Server not found");
      }
    };

    poll();
    const interval = setInterval(poll, 5000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [id, user, loading, router]);

  const handleJoin = async () => {
    setJoining(true);
    setError(null);
    try {
      const { gameToken, wsUrl } = await joinServer(
        id,
        selectedTeam,
        selectedShip,
      );
      const params = new URLSearchParams({
        token: gameToken,
        ws: wsUrl,
      });
      router.push(`/game/${id}?${params.toString()}`);
    } catch (err) {
      setError((err as Error).message);
      setJoining(false);
    }
  };

  if (loading) return <div className="p-8 text-center">Loading...</div>;
  if (error && !server) {
    return <div className="p-8 text-center text-red-500">{error}</div>;
  }
  if (!server) return <div className="p-8 text-center">Loading server...</div>;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold">{server.name}</h1>
          {server.isOfficial ? (
            <span className="rounded bg-yellow-700 px-2 py-0.5 text-xs font-bold text-black">
              Official
            </span>
          ) : (
            <span className="rounded bg-gray-700 px-2 py-0.5 text-xs">
              Community
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-gray-400">
          {server.region} &middot; {server.playerCount}/{server.maxPlayers}{" "}
          players &middot; {server.gamePhase}
        </p>
      </div>

      <div className="mb-8 grid gap-6 md:grid-cols-2">
        <div>
          <h2 className="mb-3 text-xl font-semibold">Team</h2>
          <div className="space-y-2">
            <button
              onClick={() => setSelectedTeam(Team.FEDERATION)}
              className={`w-full rounded border p-3 text-left ${
                selectedTeam === Team.FEDERATION
                  ? "border-yellow-500 bg-yellow-900/30"
                  : "border-gray-700 hover:border-gray-500"
              }`}
            >
              <span className="font-bold text-yellow-500">Federation</span>
            </button>
            <button
              onClick={() => setSelectedTeam(Team.ROMULANS)}
              className={`w-full rounded border p-3 text-left ${
                selectedTeam === Team.ROMULANS
                  ? "border-red-500 bg-red-900/30"
                  : "border-gray-700 hover:border-gray-500"
              }`}
            >
              <span className="font-bold text-red-500">Romulans</span>
            </button>
          </div>
        </div>

        <div>
          <h2 className="mb-3 text-xl font-semibold">Ship</h2>
          <div className="space-y-2">
            {[
              ShipType.SC,
              ShipType.DD,
              ShipType.CA,
              ShipType.BB,
              ShipType.AS,
              ShipType.SB,
            ].map((st) => (
              <button
                key={st}
                onClick={() => setSelectedShip(st)}
                className={`w-full rounded border p-2 text-left text-sm ${
                  selectedShip === st
                    ? "border-white bg-gray-800"
                    : "border-gray-700 hover:border-gray-500"
                }`}
              >
                {SHIP_NAMES[st]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <p className="mb-4 text-red-500">{error}</p>}

      <button
        onClick={handleJoin}
        disabled={joining || server.status !== "online"}
        className="w-full rounded bg-green-700 py-3 text-lg font-bold hover:bg-green-600 disabled:opacity-50"
      >
        {joining ? "Joining..." : "Join Game"}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/client/app/lobby
git commit -m "feat: add game detail page with team/ship selection and join flow"
```

---

### Task 11: Update Game Page for Multi-Server

Update the game page to read the game token and WebSocket URL from query params and pass them to the game canvas.

**Files:**

- Modify: `apps/client/app/game/[id]/page.tsx` (create new dynamic route)
- Delete: `apps/client/app/game/page.tsx` (old static route)

- [ ] **Step 1: Create dynamic game route**

Create `apps/client/app/game/[id]/page.tsx`:

```tsx
"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import GameCanvas from "@/components/game-canvas";

function GameContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const wsUrl = searchParams.get("ws");

  if (!token || !wsUrl) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-red-500">
          Missing game token. Please join from the lobby.
        </p>
      </div>
    );
  }

  return <GameCanvas wsUrl={wsUrl} gameToken={token} />;
}

export default function GamePage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center">
          Loading...
        </div>
      }
    >
      <GameContent />
    </Suspense>
  );
}
```

Move the existing `apps/client/app/game/layout.tsx` to `apps/client/app/game/[id]/layout.tsx` (same content — full-screen, no chrome).

- [ ] **Step 2: Remove old static game page**

```bash
rm apps/client/app/game/page.tsx
```

Keep the layout file if it serves the `[id]` route.

- [ ] **Step 3: Commit**

```bash
git add apps/client/app/game
git commit -m "feat: update game page for multi-server with dynamic routing"
```

---

### Task 12: Server Management Page

Create the server host management page at `/settings/servers`.

**Files:**

- Create: `apps/client/app/settings/servers/page.tsx`

- [ ] **Step 1: Create server management page**

`apps/client/app/settings/servers/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";

interface MyServer {
  id: string;
  name: string;
  region: string;
  host: string;
  maxPlayers: number;
  isOfficial: boolean;
  status: string;
  playerCount: number;
  createdAt: string;
}

export default function ServerManagementPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [servers, setServers] = useState<MyServer[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [region, setRegion] = useState("us-east");
  const [maxPlayers, setMaxPlayers] = useState(16);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/auth/signin");
      return;
    }
    loadServers();
  }, [user, loading, router]);

  const loadServers = async () => {
    try {
      const data = await api("/servers/mine");
      setServers(data as MyServer[]);
    } catch {
      setError("Failed to load servers");
    }
  };

  const handleCreate = async () => {
    setError(null);
    try {
      const result = (await api("/servers", {
        method: "POST",
        body: JSON.stringify({ name, host, region, maxPlayers }),
      })) as { id: string; serverToken: string };
      setNewToken(result.serverToken);
      setShowCreate(false);
      setName("");
      setHost("");
      loadServers();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api(`/servers/${id}`, { method: "DELETE" });
      loadServers();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleRotateToken = async (id: string) => {
    try {
      const result = (await api(`/servers/${id}/rotate-token`, {
        method: "POST",
      })) as { serverToken: string };
      setNewToken(result.serverToken);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (loading) return <div className="p-8 text-center">Loading...</div>;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 text-3xl font-bold">My Servers</h1>

      {newToken && (
        <div className="mb-6 rounded border border-yellow-600 bg-yellow-900/30 p-4">
          <p className="mb-2 font-bold text-yellow-500">
            Server Token (copy now — it won&apos;t be shown again):
          </p>
          <code className="block break-all rounded bg-black p-2 text-sm">
            {newToken}
          </code>
          <button
            onClick={() => setNewToken(null)}
            className="mt-2 text-sm text-gray-400 hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}

      {error && <p className="mb-4 text-red-500">{error}</p>}

      <div className="mb-6 space-y-3">
        {servers.map((s) => (
          <div key={s.id} className="rounded border border-gray-700 p-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-semibold">{s.name}</span>
                <span className="ml-2 text-sm text-gray-400">
                  {s.region} &middot; {s.host}
                </span>
                {s.isOfficial && (
                  <span className="ml-2 rounded bg-yellow-700 px-2 py-0.5 text-xs font-bold text-black">
                    Official
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleRotateToken(s.id)}
                  className="rounded border border-gray-600 px-3 py-1 text-xs hover:bg-gray-800"
                >
                  Rotate Token
                </button>
                <button
                  onClick={() => handleDelete(s.id)}
                  className="rounded border border-red-800 px-3 py-1 text-xs text-red-500 hover:bg-red-900/30"
                >
                  Delete
                </button>
              </div>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Status: {s.status} &middot; Players: {s.playerCount}/
              {s.maxPlayers} &middot; Created:{" "}
              {new Date(s.createdAt).toLocaleDateString()}
            </p>
          </div>
        ))}
      </div>

      {!showCreate ? (
        <button
          onClick={() => setShowCreate(true)}
          className="rounded bg-gray-800 px-4 py-2 hover:bg-gray-700"
        >
          Register New Server
        </button>
      ) : (
        <div className="rounded border border-gray-700 p-4">
          <h2 className="mb-4 text-lg font-semibold">Register Server</h2>
          <div className="space-y-3">
            <input
              type="text"
              placeholder="Server name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded border border-gray-600 bg-gray-900 p-2"
            />
            <input
              type="text"
              placeholder="WebSocket URL (e.g. wss://my-server.example.com:3013)"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              className="w-full rounded border border-gray-600 bg-gray-900 p-2"
            />
            <div className="flex gap-3">
              <select
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className="rounded border border-gray-600 bg-gray-900 p-2"
              >
                <option value="us-east">US East</option>
                <option value="us-west">US West</option>
                <option value="eu-west">EU West</option>
                <option value="asia">Asia</option>
              </select>
              <input
                type="number"
                min={2}
                max={16}
                value={maxPlayers}
                onChange={(e) => setMaxPlayers(parseInt(e.target.value, 10))}
                className="w-20 rounded border border-gray-600 bg-gray-900 p-2"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                disabled={!name || !host}
                className="rounded bg-green-700 px-4 py-2 font-semibold hover:bg-green-600 disabled:opacity-50"
              >
                Register
              </button>
              <button
                onClick={() => setShowCreate(false)}
                className="rounded border border-gray-600 px-4 py-2 hover:bg-gray-800"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/client/app/settings
git commit -m "feat: add server management page for hosting"
```

---

## Phase C: Polish & Documentation

### Task 13: Update README and Documentation

Update project documentation to reflect the new architecture.

**Files:**

- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `apps/backend/.env.example`
- Modify: `apps/server/.env.example`

- [ ] **Step 1: Update CLAUDE.md architecture section**

Update the `## Architecture` section in `CLAUDE.md` to describe the new three-app structure:

Replace the `apps/server` entry with two entries:

```markdown
**apps/backend** (`@netrek/backend`): NestJS application. Central authority. Owns PostgreSQL + Redis. Handles auth (Google OAuth, JWT sessions), user accounts, server registry, lobby/server browser API, stats storage, match history, and game token signing (ES256). REST-only — no WebSocket.

**apps/server** (`@netrek/server`): NestJS application (lightweight). Runs the authoritative game loop at 10Hz, bot manager, and WebSocket gateway. No database — game state is entirely in-memory during matches. Communicates with the backend via REST (heartbeat, stat push, match reporting). Validates player connections using short-lived game tokens signed by the backend (asymmetric ES256 — server has only the public key). Can run standalone without a backend for local development.
```

- [ ] **Step 2: Update CLAUDE.md key constraints**

Add to the `## Key Constraints` section:

```markdown
**Game token auth.** Players connect to game servers using short-lived JWTs (30s) signed by the backend with ES256. The game server verifies with the public key only — it cannot forge tokens. The game token contains userId, username, team, shipType, and player stats (for starbase eligibility).

**Backend owns all persistence.** The game server never touches the database. Stats are pushed to the backend every 60 seconds. Match results are reported at game end. The backend scopes stats by server — official servers aggregate to a shared "official" scope, community servers get their own scope.
```

- [ ] **Step 3: Update CLAUDE.md development phases**

Update Phase 3 to reflect what's been done:

```markdown
**Phase 3 (Multiplayer Infrastructure):** Server separation (backend + game server), game token auth with ES256, server registry (community + official servers), lobby/server browser, live stat tracking, match history, bots. Remaining: voice (LiveKit), matchmaking, rankings formula.
```

- [ ] **Step 4: Update README.md**

Add a section explaining how to run the three apps:

````markdown
## Development

### Prerequisites

- Node.js 20+
- pnpm 9+
- PostgreSQL
- Redis

### Setup

```bash
pnpm install
cp apps/backend/.env.example apps/backend/.env
cp apps/server/.env.example apps/server/.env
cp apps/client/.env.example apps/client/.env

# Edit apps/backend/.env with your database URL, JWT secret, and Google OAuth credentials

cd apps/backend && pnpm db:migrate
```
````

### Running

```bash
# Terminal 1: Backend (auth, lobby, stats)
cd apps/backend && pnpm dev

# Terminal 2: Game server
cd apps/server && pnpm dev

# Terminal 3: Client
cd apps/client && pnpm dev
```

The backend runs on port 3012, the game server on port 3013, and the client on port 3011.

### Standalone Mode

The game server can run without a backend for local development. Just omit `SERVER_ID` and `SERVER_TOKEN` from the `.env`. Players won't be able to join through the lobby — connect directly via the client.

````

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md apps/backend/.env.example apps/server/.env.example
git commit -m "docs: update README and CLAUDE.md for new backend/server architecture"
````

---

### Task 14: Integration Testing and Build Verification

Verify the entire system builds and the three apps can start.

**Files:** None (verification only)

- [ ] **Step 1: Build shared package**

```bash
cd packages/shared && npx tsc
```

- [ ] **Step 2: Build backend**

```bash
cd apps/backend && npx tsc --noEmit
```

- [ ] **Step 3: Build game server**

```bash
cd apps/server && npx tsc --noEmit
```

- [ ] **Step 4: Build client**

```bash
cd apps/client && npx next build
```

- [ ] **Step 5: Run existing tests**

```bash
cd apps/server && pnpm test
```

- [ ] **Step 6: Start backend and verify health endpoint**

```bash
cd apps/backend && pnpm dev &
sleep 3
curl http://localhost:3012/v1
```

- [ ] **Step 7: Start game server and verify it starts**

```bash
cd apps/server && pnpm dev &
sleep 3
# Should log "Game server listening on port 3013"
# Should log "running in standalone mode" (no backend registration without SERVER_ID)
```

- [ ] **Step 8: Verify server browser endpoint**

```bash
curl http://localhost:3012/v1/servers
# Should return [] (empty array, no servers registered yet)
```

- [ ] **Step 9: Verify public key endpoint**

```bash
curl http://localhost:3012/v1/servers/public-key
# Should return a JWK object with kty: "EC", crv: "P-256"
```

- [ ] **Step 10: Commit any fixes**

```bash
git add -A
git commit -m "fix: integration test fixes for server separation"
```

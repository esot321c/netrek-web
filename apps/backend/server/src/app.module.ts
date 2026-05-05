import { Module } from "@nestjs/common";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { APP_GUARD } from "@nestjs/core";
import { AppConfigModule } from "./config/config.module";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { GameModule } from "./game/game.module";
import { LobbyModule } from "./lobby/lobby.module";
import { AppController } from "./app.controller";

@Module({
  imports: [
    // Core infrastructure
    AppConfigModule,
    PrismaModule,
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRoot({
      throttlers: [
        { name: "short", ttl: 1000, limit: 10 },
        { name: "medium", ttl: 10000, limit: 50 },
        { name: "long", ttl: 60000, limit: 200 },
      ],
    }),

    // Auth
    AuthModule,

    // Game
    GameModule,

    // Lobby
    LobbyModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}

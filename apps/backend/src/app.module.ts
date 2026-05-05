import { Module } from "@nestjs/common";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { ScheduleModule } from "@nestjs/schedule";
import { APP_GUARD } from "@nestjs/core";
import { AppConfigModule } from "./config/config.module";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { LobbyModule } from "./lobby/lobby.module";
import { ServersModule } from "./servers/servers.module";
import { StatsModule } from "./stats/stats.module";
import { AppController } from "./app.controller";

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot({
      throttlers: [
        { name: "short", ttl: 1000, limit: 10 },
        { name: "medium", ttl: 10000, limit: 50 },
        { name: "long", ttl: 60000, limit: 200 },
      ],
    }),
    AuthModule,
    LobbyModule,
    ServersModule,
    StatsModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}

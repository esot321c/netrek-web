import { Module } from "@nestjs/common";
import { GameService } from "./game.service";
import { GameLoopService } from "./game-loop.service";
import { GameBroadcastService } from "./game-broadcast.service";
import { GameGateway } from "./game.gateway";
import { WsAuthService } from "./guards/ws-auth.guard";
import { BotManagerService } from "./bot";
import { StatReporterService } from "../registration/stat-reporter.service";

@Module({
  providers: [
    GameService,
    GameLoopService,
    GameBroadcastService,
    GameGateway,
    WsAuthService,
    BotManagerService,
    StatReporterService,
  ],
  exports: [
    GameService,
    GameLoopService,
    BotManagerService,
    StatReporterService,
  ],
})
export class GameModule {}

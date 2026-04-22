import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AppConfig } from "../config/app.config";
import { GameService } from "./game.service";
import { GameLoopService } from "./game-loop.service";
import { GameBroadcastService } from "./game-broadcast.service";
import { GameGateway } from "./game.gateway";
import { WsAuthService } from "./guards/ws-auth.guard";

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        secret: config.jwt.secret,
      }),
    }),
  ],
  providers: [
    GameService,
    GameLoopService,
    GameBroadcastService,
    GameGateway,
    WsAuthService,
  ],
  exports: [GameService, GameLoopService],
})
export class GameModule {}

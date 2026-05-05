import { Module } from "@nestjs/common";
import { LobbyController } from "./lobby.controller";
import { GameModule } from "../game/game.module";

@Module({
  imports: [GameModule],
  controllers: [LobbyController],
})
export class LobbyModule {}

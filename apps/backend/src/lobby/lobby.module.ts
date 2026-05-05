import { Module } from "@nestjs/common";
import { LobbyController } from "./lobby.controller";

@Module({
  controllers: [LobbyController],
})
export class LobbyModule {}

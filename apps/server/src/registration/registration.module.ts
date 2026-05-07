import { Module } from "@nestjs/common";
import { RegistrationService } from "./registration.service";
import { GameModule } from "../game/game.module";

@Module({
  imports: [GameModule],
  providers: [RegistrationService],
  exports: [RegistrationService],
})
export class RegistrationModule {}

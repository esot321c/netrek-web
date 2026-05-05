import { Module } from "@nestjs/common";
import { RegistrationService } from "./registration.service";
import { StatReporterService } from "./stat-reporter.service";
import { GameModule } from "../game/game.module";

@Module({
  imports: [GameModule],
  providers: [RegistrationService, StatReporterService],
  exports: [RegistrationService, StatReporterService],
})
export class RegistrationModule {}

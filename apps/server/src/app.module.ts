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

import { Module } from "@nestjs/common";
import { ServersController } from "./servers.controller";
import { ServersService } from "./servers.service";
import { GameTokenService } from "./game-token.service";
import { PrismaModule } from "../prisma/prisma.module";
import { ServerTokenGuard } from "./guards/server-token.guard";

@Module({
  imports: [PrismaModule],
  controllers: [ServersController],
  providers: [ServersService, ServerTokenGuard, GameTokenService],
  exports: [ServersService, GameTokenService],
})
export class ServersModule {}

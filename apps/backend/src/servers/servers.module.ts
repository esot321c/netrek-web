import { Module } from "@nestjs/common";
import { ServersController } from "./servers.controller";
import { ServersService } from "./servers.service";
import { PrismaModule } from "../prisma/prisma.module";
import { ServerTokenGuard } from "./guards/server-token.guard";

@Module({
  imports: [PrismaModule],
  controllers: [ServersController],
  providers: [ServersService, ServerTokenGuard],
  exports: [ServersService],
})
export class ServersModule {}

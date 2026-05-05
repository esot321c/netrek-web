import { Module } from "@nestjs/common";
import { StatsController } from "./stats.controller";
import { StatsService } from "./stats.service";
import { PrismaModule } from "../prisma/prisma.module";
import { ServersModule } from "../servers/servers.module";

@Module({
  imports: [PrismaModule, ServersModule],
  controllers: [StatsController],
  providers: [StatsService],
  exports: [StatsService],
})
export class StatsModule {}

import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from "@nestjs/common";
import { ServerTokenGuard } from "../servers/guards/server-token.guard";
import { StatsService } from "./stats.service";
import { IngestStatsDto } from "./dto/ingest-stats.dto";
import { ReportMatchDto } from "./dto/report-match.dto";

@Controller("stats")
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Post("ingest")
  @UseGuards(ServerTokenGuard)
  ingest(@Body() dto: IngestStatsDto, @Req() req: any) {
    const isOfficial: boolean = req.gameServer.isOfficial;
    return this.statsService.ingest(dto, isOfficial);
  }

  @Post("matches")
  @UseGuards(ServerTokenGuard)
  reportMatch(@Body() dto: ReportMatchDto, @Req() req: any) {
    const isOfficial: boolean = req.gameServer.isOfficial;
    return this.statsService.reportMatch(dto, isOfficial);
  }

  @Get("leaderboard/:serverId")
  getLeaderboard(
    @Param("serverId") serverId: string,
    @Query("limit") limit?: string,
  ) {
    return this.statsService.getLeaderboard(
      serverId,
      limit ? parseInt(limit, 10) : 20,
    );
  }
}

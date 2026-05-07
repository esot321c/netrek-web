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
import { SkipThrottle } from "@nestjs/throttler";
import { ServerTokenGuard } from "../servers/guards/server-token.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { User } from "../auth/decorators/user.decorator";
import { AuthUser } from "../auth/types/jwt.types";
import { StatsService } from "./stats.service";
import { IngestStatsDto } from "./dto/ingest-stats.dto";
import { ReportMatchDto } from "./dto/report-match.dto";

@Controller("stats")
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Post("ingest")
  @SkipThrottle()
  @UseGuards(ServerTokenGuard)
  ingest(@Body() dto: IngestStatsDto, @Req() req: any) {
    const isOfficial: boolean = req.gameServer.isOfficial;
    return this.statsService.ingest(dto, isOfficial);
  }

  @Post("matches")
  @SkipThrottle()
  @UseGuards(ServerTokenGuard)
  reportMatch(@Body() dto: ReportMatchDto, @Req() req: any) {
    const isOfficial: boolean = req.gameServer.isOfficial;
    return this.statsService.reportMatch(dto, isOfficial);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  getMyStats(@User() user: AuthUser) {
    return this.statsService.getMyStats(user.id);
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

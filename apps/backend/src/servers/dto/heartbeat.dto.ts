import { IsInt, IsString, IsArray, ValidateNested, Min } from "class-validator";
import { Type } from "class-transformer";

class TeamSummaryDto {
  @IsInt()
  team!: number;

  @IsInt()
  @Min(0)
  humanCount!: number;

  @IsInt()
  @Min(0)
  botCount!: number;
}

export class HeartbeatDto {
  @IsInt()
  @Min(0)
  playerCount!: number;

  @IsInt()
  @Min(0)
  botCount!: number;

  @IsInt()
  @Min(2)
  maxPlayers!: number;

  @IsString()
  gamePhase!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TeamSummaryDto)
  teams!: TeamSummaryDto[];
}

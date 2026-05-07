import { IsString, IsArray, IsInt, ValidateNested, Min } from "class-validator";
import { Type } from "class-transformer";

class PlayerStatDeltaDto {
  @IsString()
  userId!: string;

  @IsInt()
  @Min(0)
  kills!: number;

  @IsInt()
  @Min(0)
  deaths!: number;

  @IsInt()
  @Min(0)
  planetsTaken!: number;

  @IsInt()
  @Min(0)
  armiesBombed!: number;

  @IsInt()
  @Min(0)
  armiesBeamed!: number;

  @IsInt()
  @Min(0)
  secondsPlayed!: number;
}

export class IngestStatsDto {
  @IsString()
  serverId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlayerStatDeltaDto)
  players!: PlayerStatDeltaDto[];
}

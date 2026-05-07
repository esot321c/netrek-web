import {
  IsString,
  IsInt,
  IsBoolean,
  IsArray,
  ValidateNested,
  Min,
  IsOptional,
} from "class-validator";
import { Type } from "class-transformer";

class MatchPlayerDto {
  @IsString()
  userId!: string;

  @IsInt()
  team!: number;

  @IsInt()
  shipType!: number;

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
}

export class ReportMatchDto {
  @IsString()
  serverId!: string;

  @IsInt()
  winningTeam!: number;

  @IsInt()
  @Min(0)
  duration!: number;

  @IsBoolean()
  @IsOptional()
  genocide?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MatchPlayerDto)
  players!: MatchPlayerDto[];
}

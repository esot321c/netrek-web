import {
  IsString,
  IsBoolean,
  IsInt,
  IsOptional,
  IsUrl,
  Min,
  Max,
} from "class-validator";

export class UpdateServerDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  region?: string;

  @IsUrl({ require_tld: false })
  @IsOptional()
  host?: string;

  @IsInt()
  @Min(2)
  @Max(16)
  @IsOptional()
  maxPlayers?: number;

  @IsBoolean()
  @IsOptional()
  isOfficial?: boolean;
}

import { IsString, IsInt, IsOptional, Min, Max, IsUrl } from "class-validator";

export class CreateServerDto {
  @IsString()
  name!: string;

  @IsString()
  @IsOptional()
  region?: string;

  @IsUrl({ require_tld: false })
  host!: string;

  @IsInt()
  @Min(2)
  @Max(16)
  @IsOptional()
  maxPlayers?: number;
}

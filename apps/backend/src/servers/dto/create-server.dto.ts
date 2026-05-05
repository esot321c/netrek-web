import { IsString, IsInt, IsOptional, Min, Max, IsUrl } from "class-validator";

export class CreateServerDto {
  @IsString()
  name!: string;

  @IsString()
  @IsOptional()
  region?: string;

  @IsUrl()
  host!: string;

  @IsInt()
  @Min(2)
  @Max(16)
  @IsOptional()
  maxPlayers?: number;
}

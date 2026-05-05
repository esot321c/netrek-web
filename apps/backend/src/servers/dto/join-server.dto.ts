import { IsInt, Min, Max } from "class-validator";

export class JoinServerDto {
  @IsInt()
  @Min(0)
  @Max(3)
  team!: number;

  @IsInt()
  @Min(0)
  @Max(5)
  shipType!: number;
}

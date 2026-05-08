import { IsString, MinLength, MaxLength, Matches } from "class-validator";

export class UpdateUsernameDto {
  @IsString()
  @MinLength(2)
  @MaxLength(20)
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message:
      "Username can only contain letters, numbers, hyphens, and underscores",
  })
  username!: string;
}

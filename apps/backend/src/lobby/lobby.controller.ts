import { Controller, Get } from "@nestjs/common";

@Controller("lobby")
export class LobbyController {
  @Get("info")
  getInfo() {
    return { status: "migrating to server browser" };
  }
}

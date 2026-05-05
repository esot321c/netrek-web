import { Controller, Get } from "@nestjs/common";
import { GameService } from "../game/game.service";
import { GameLoopService } from "../game/game-loop.service";
import { BotManagerService } from "../game/bot";
import { Team, ShipType, ShipStatus } from "@netrek/shared";

interface PlayerInfo {
  slot: number;
  name: string;
  team: Team;
  shipType: ShipType;
  status: ShipStatus;
  isBot: boolean;
}

@Controller("lobby")
export class LobbyController {
  constructor(
    private readonly gameService: GameService,
    private readonly gameLoop: GameLoopService,
    private readonly botManager: BotManagerService,
  ) {}

  @Get("info")
  getServerInfo() {
    const state = this.gameService.state;
    const ships = state.ships;

    const fedPlayers: PlayerInfo[] = [];
    const romPlayers: PlayerInfo[] = [];

    for (let i = 0; i < ships.length; i++) {
      const ship = ships[i]!;
      if (!ship.playerId) continue;

      const info: PlayerInfo = {
        slot: i,
        name: ship.playerId.startsWith("bot:")
          ? ship.playerId.slice(4)
          : ship.playerId,
        team: ship.team,
        shipType: ship.shipType,
        status: ship.status,
        isBot: ship.playerId.startsWith("bot:"),
      };

      if (ship.team === Team.FEDERATION) {
        fedPlayers.push(info);
      } else if (ship.team === Team.ROMULANS) {
        romPlayers.push(info);
      }
    }

    return {
      motd: "Welcome to Netrek Web! Fly, fight, and conquer the galaxy.",
      tmode: this.gameLoop.tmode,
      playerCount: this.gameService.getPlayerCount(),
      maxPlayers: 16,
      teams: {
        [Team.FEDERATION]: {
          name: "Federation",
          players: fedPlayers,
          count: fedPlayers.length,
        },
        [Team.ROMULANS]: {
          name: "Romulans",
          players: romPlayers,
          count: romPlayers.length,
        },
      },
      options: {
        shipsAllowed: "SC DD CA BB AS SB",
        tractorPressor: true,
        tmodeMinPlayers: 4,
      },
    };
  }
}

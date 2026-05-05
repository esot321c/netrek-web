import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import {
  Team,
  ShipType,
  ShipStatus,
  BotDifficulty,
  type ShipState,
  type ChatMessage,
  type AlertStatus,
  PLANET_DEFS,
} from "@netrek/shared";
import { BotPlayer } from "./bot-player";
import { BotNamePool } from "./bot-names";
import { BotConfig, loadBotConfig, buildDifficultyList } from "./bot-config";
import { parseOrder } from "./bot-orders";
import { GameState } from "../state/game-state";
import { InputQueue } from "../state/input-queue";

// This constant must match the value in game-loop.service.ts
const GAME_TICK_EVENT = "game.tick";

const SHIP_TYPES_FOR_BOTS: ShipType[] = [
  ShipType.SC,
  ShipType.DD,
  ShipType.CA,
  ShipType.BB,
  ShipType.AS,
];

/** Homeworld indices in PLANET_DEFS (first planet of each team's 10) */
const HOMEWORLD_INDEX: Record<number, number> = {
  [Team.FEDERATION]: 0,
  [Team.ROMULANS]: 10,
  [Team.KLINGONS]: 20,
  [Team.ORIONS]: 30,
};

@Injectable()
export class BotManagerService {
  private readonly logger = new Logger(BotManagerService.name);
  private readonly bots = new Map<number, BotPlayer>(); // slot -> bot
  private readonly namePool = new BotNamePool();
  private readonly config: BotConfig;
  private readonly humanCounts: Record<number, number> = {
    [Team.FEDERATION]: 0,
    [Team.ROMULANS]: 0,
  };

  private gameState!: GameState;
  private inputQueue!: InputQueue;
  private alertStatuses!: AlertStatus[];
  private tmode = false;
  private lastRebalanceTick = 0;

  constructor() {
    this.config = loadBotConfig();
  }

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  init(
    gameState: GameState,
    inputQueue: InputQueue,
    alertStatuses?: AlertStatus[],
  ): void {
    this.gameState = gameState;
    this.inputQueue = inputQueue;
    if (alertStatuses) {
      this.alertStatuses = alertStatuses;
    } else {
      // Default to all GREEN if not provided
      this.alertStatuses = new Array(gameState.ships.length).fill(
        0,
      ) as AlertStatus[];
    }
  }

  setAlertStatuses(alertStatuses: AlertStatus[]): void {
    this.alertStatuses = alertStatuses;
  }

  setTMode(tmode: boolean): void {
    this.tmode = tmode;
  }

  // ---------------------------------------------------------------------------
  // Spawning
  // ---------------------------------------------------------------------------

  spawnInitialBots(): void {
    const difficulties = buildDifficultyList(
      this.config.difficultyMix,
      this.config.botsPerTeam,
    );

    for (const team of [Team.FEDERATION, Team.ROMULANS]) {
      for (const difficulty of difficulties) {
        this.spawnBot(team, difficulty);
      }
    }

    this.logger.log(
      `Spawned initial bots: ${this.bots.size} total (${this.config.botsPerTeam} per team)`,
    );
  }

  private spawnBot(
    team: Team,
    difficulty: BotDifficulty,
    shipType?: ShipType,
  ): BotPlayer | null {
    const slot = this.gameState.findEmptySlot();
    if (slot === -1) {
      this.logger.warn("No empty slot for bot spawn");
      return null;
    }

    const name = this.namePool.next(difficulty);
    const resolvedShipType =
      shipType ??
      SHIP_TYPES_FOR_BOTS[
        Math.floor(Math.random() * SHIP_TYPES_FOR_BOTS.length)
      ]!;

    const bot = new BotPlayer(difficulty, team, name, resolvedShipType);
    bot.assignSlot(slot);

    const spawn = this.spawnPoint(team);
    this.gameState.initShip(
      slot,
      team,
      resolvedShipType,
      `bot:${name}`,
      spawn.x,
      spawn.y,
    );

    this.bots.set(slot, bot);

    this.logger.debug(
      `Spawned bot ${name} (${BotDifficulty[difficulty]}) on team ${Team[team]}, slot ${slot}`,
    );

    return bot;
  }

  private removeBot(slot: number): void {
    const bot = this.bots.get(slot);
    if (!bot) return;

    this.gameState.clearShip(slot);
    this.bots.delete(slot);

    this.logger.debug(`Removed bot ${bot.name} from slot ${slot}`);
  }

  private spawnPoint(team: Team): { x: number; y: number } {
    const friendlyPlanets = this.gameState.planets.filter(
      (p) => p.team === team,
    );

    const planet =
      friendlyPlanets.length > 0
        ? friendlyPlanets[Math.floor(Math.random() * friendlyPlanets.length)]!
        : {
            x: PLANET_DEFS[HOMEWORLD_INDEX[team] ?? 0]!.x,
            y: PLANET_DEFS[HOMEWORLD_INDEX[team] ?? 0]!.y,
          };

    const spread = 3000;
    return {
      x: planet.x + (Math.random() - 0.5) * spread,
      y: planet.y + (Math.random() - 0.5) * spread,
    };
  }

  // ---------------------------------------------------------------------------
  // Human player management
  // ---------------------------------------------------------------------------

  onHumanJoin(team: Team): void {
    this.humanCounts[team] = (this.humanCounts[team] ?? 0) + 1;

    // If team total exceeds maxPlayersPerTeam, remove a bot from that team
    const total = this.getTeamTotal(team);
    if (total > this.config.maxPlayersPerTeam) {
      const bot = this.findBotOnTeam(team);
      if (bot !== null) {
        this.removeBot(bot.slot);
      }
    }

    this.rebalanceTeams();
  }

  onHumanLeave(team: Team): void {
    this.humanCounts[team] = Math.max(0, (this.humanCounts[team] ?? 0) - 1);

    // If team drops below bot baseline, spawn a replacement
    const botCount = this.getBotCount(team);
    if (botCount < this.config.botsPerTeam) {
      const difficulties = buildDifficultyList(this.config.difficultyMix, 1);
      this.spawnBot(team, difficulties[0]!);
    }

    this.rebalanceTeams();
  }

  // ---------------------------------------------------------------------------
  // Team balancing
  // ---------------------------------------------------------------------------

  private rebalanceTeams(): void {
    const fedTotal = this.getTeamTotal(Team.FEDERATION);
    const romTotal = this.getTeamTotal(Team.ROMULANS);
    const diff = Math.abs(fedTotal - romTotal);

    if (diff <= 1) return;

    // Move a bot from the larger team to the smaller team
    const largerTeam = fedTotal > romTotal ? Team.FEDERATION : Team.ROMULANS;
    const smallerTeam = fedTotal > romTotal ? Team.ROMULANS : Team.FEDERATION;

    const botToMove = this.findBotOnTeam(largerTeam);
    if (botToMove === null) return;

    const difficulty = botToMove.difficulty;
    this.removeBot(botToMove.slot);
    this.spawnBot(smallerTeam, difficulty);
  }

  private findBotOnTeam(team: Team): BotPlayer | null {
    for (const [, bot] of this.bots) {
      if (bot.team === team) {
        return bot;
      }
    }
    return null;
  }

  getTeamTotal(team: Team): number {
    return (this.humanCounts[team] ?? 0) + this.getBotCount(team);
  }

  getBotCount(team: Team): number {
    let count = 0;
    for (const [, bot] of this.bots) {
      if (bot.team === team) count++;
    }
    return count;
  }

  getAllBots(): BotPlayer[] {
    return Array.from(this.bots.values());
  }

  isBot(slot: number): boolean {
    return this.bots.has(slot);
  }

  getBotNames(): string[] {
    return Array.from(this.bots.values()).map((b) => b.name);
  }

  // ---------------------------------------------------------------------------
  // Tick handling
  // ---------------------------------------------------------------------------

  @OnEvent(GAME_TICK_EVENT)
  onTick(): void {
    if (!this.gameState) return;

    const tick = this.gameState.currentTick;

    // Respawn dead bots
    for (const [slot, bot] of this.bots) {
      const ship = this.gameState.ships[slot];
      if (!ship) continue;

      if (ship.status === ShipStatus.DEAD) {
        // Remove then respawn the bot at same team/difficulty
        const team = bot.team;
        const difficulty = bot.difficulty;
        this.bots.delete(slot);
        this.spawnBot(team, difficulty, bot.shipType);
      }
    }

    // Run bot AI for each alive bot
    for (const [slot, bot] of this.bots) {
      const ship = this.gameState.ships[slot];
      if (!ship || ship.status !== ShipStatus.ALIVE) continue;

      bot.onTick(
        tick,
        bot.team,
        this.gameState.ships,
        this.gameState.torps,
        this.gameState.phasers,
        this.gameState.explosions,
        this.alertStatuses,
        this.gameState.planets,
        this.tmode,
        this.inputQueue,
      );
    }

    this.checkDifficultyRebalance(tick);
  }

  // ---------------------------------------------------------------------------
  // Chat orders
  // ---------------------------------------------------------------------------

  onChatMessage(message: ChatMessage): void {
    if (!this.gameState) return;

    const planetNames = this.gameState.planets.map((p) => p.name);
    const botNames = this.getBotNames();

    const order = parseOrder(
      message.text,
      planetNames,
      botNames,
      message.senderSlot,
    );
    if (order === null) return;

    // Find the bot(s) to receive the order
    const targeted = order.targetName !== "";

    for (const [, bot] of this.bots) {
      // Only bots on the same team as the sender
      const senderShip = this.gameState.ships[message.senderSlot];
      if (!senderShip) continue;
      if (bot.team !== senderShip.team) continue;

      if (targeted && bot.name !== order.targetName) continue;

      bot.brain.setOrder(
        order.state,
        order.targetId,
        this.gameState.currentTick,
      );

      this.logger.debug(
        `Bot ${bot.name} received order: ${order.state} target=${order.targetId}`,
      );

      // Only address the specific bot if targeted; otherwise broadcast to all team bots
      if (targeted) break;
    }
  }

  // ---------------------------------------------------------------------------
  // Difficulty rebalancing
  // ---------------------------------------------------------------------------

  private checkDifficultyRebalance(tick: number): void {
    if (tick - this.lastRebalanceTick < this.config.rebalanceIntervalTicks)
      return;

    this.lastRebalanceTick = tick;

    const totalPlanets = this.gameState.planets.length;
    if (totalPlanets === 0) return;

    // Count planets per team
    let fedPlanets = 0;
    let romPlanets = 0;
    for (const planet of this.gameState.planets) {
      if (planet.team === Team.FEDERATION) fedPlanets++;
      else if (planet.team === Team.ROMULANS) romPlanets++;
    }

    const fedRatio = fedPlanets / totalPlanets;
    const romRatio = romPlanets / totalPlanets;

    const threshold = this.config.planetImbalanceThreshold;

    if (fedRatio >= threshold) {
      // Federation is dominating — boost Romulans bots, nerf Federation bots
      this.rotateBotDifficulty(Team.ROMULANS, "up");
      this.rotateBotDifficulty(Team.FEDERATION, "down");
    } else if (romRatio >= threshold) {
      // Romulans are dominating — boost Federation bots, nerf Romulans bots
      this.rotateBotDifficulty(Team.FEDERATION, "up");
      this.rotateBotDifficulty(Team.ROMULANS, "down");
    }
  }

  private rotateBotDifficulty(team: Team, direction: "up" | "down"): void {
    if (direction === "up") {
      // Remove the lowest-difficulty bot and replace with a higher-difficulty one
      let lowestBot: BotPlayer | null = null;
      for (const [, bot] of this.bots) {
        if (bot.team !== team) continue;
        if (lowestBot === null || bot.difficulty < lowestBot.difficulty) {
          lowestBot = bot;
        }
      }
      if (lowestBot === null) return;

      const newDifficulty = Math.min(
        BotDifficulty.VETERAN,
        lowestBot.difficulty + 1,
      ) as BotDifficulty;

      if (newDifficulty === lowestBot.difficulty) return; // Already at max

      this.logger.log(
        `Rotating bot difficulty UP for team ${Team[team]}: removing ${lowestBot.name} (${BotDifficulty[lowestBot.difficulty]}), spawning ${BotDifficulty[newDifficulty]}`,
      );
      this.removeBot(lowestBot.slot);
      this.spawnBot(team, newDifficulty);
    } else {
      // Remove the highest-difficulty bot and replace with a lower-difficulty one
      let highestBot: BotPlayer | null = null;
      for (const [, bot] of this.bots) {
        if (bot.team !== team) continue;
        if (highestBot === null || bot.difficulty > highestBot.difficulty) {
          highestBot = bot;
        }
      }
      if (highestBot === null) return;

      const newDifficulty = Math.max(
        BotDifficulty.NEWBIE,
        highestBot.difficulty - 1,
      ) as BotDifficulty;

      if (newDifficulty === highestBot.difficulty) return; // Already at min

      this.logger.log(
        `Rotating bot difficulty DOWN for team ${Team[team]}: removing ${highestBot.name} (${BotDifficulty[highestBot.difficulty]}), spawning ${BotDifficulty[newDifficulty]}`,
      );
      this.removeBot(highestBot.slot);
      this.spawnBot(team, newDifficulty);
    }
  }

  // ---------------------------------------------------------------------------
  // Game reset
  // ---------------------------------------------------------------------------

  resetForNewGame(): void {
    this.logger.log("Resetting bots for new game");

    // Remove all existing bots
    for (const slot of Array.from(this.bots.keys())) {
      this.removeBot(slot);
    }

    // Reset name pool so names start fresh
    this.namePool.reset();

    this.lastRebalanceTick = 0;

    // Spawn fresh bots
    this.spawnInitialBots();
  }
}

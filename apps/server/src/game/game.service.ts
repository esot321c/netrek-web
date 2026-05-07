import { Injectable, Logger } from "@nestjs/common";
import {
  Team,
  ShipType,
  ShipStatus,
  PLANET_DEFS,
  SB_MIN_RANK,
  calculateDI,
  rankForDI,
} from "@netrek/shared";
import { GameState } from "./state/game-state";
import { InputQueue } from "./state/input-queue";

const SB_COOLDOWN_TICKS = 18000; // 30 minutes at 10Hz
const SB_MIN_PLANETS = 5;

export interface RespawnResult {
  ok: boolean;
  reason?: string;
  cooldownRemainingSec?: number;
}

/** Homeworld indices in PLANET_DEFS (first planet of each team's 10) */
const HOMEWORLD_INDEX: Record<number, number> = {
  [Team.FEDERATION]: 0, // Earth
  [Team.ROMULANS]: 10, // Romulus
  [Team.KLINGONS]: 20, // Klingus
  [Team.ORIONS]: 30, // Orion
};

@Injectable()
export class GameService {
  private readonly logger = new Logger(GameService.name);
  readonly state = new GameState();
  readonly inputQueue = new InputQueue();

  readonly sbCooldownExpiresTick: Record<number, number> = {
    [Team.FEDERATION]: 0,
    [Team.ROMULANS]: 0,
  };

  private readonly playerTokenStats = new Map<
    number,
    {
      totalKills: number;
      planetsTaken: number;
      armiesBombed: number;
      rank: number;
    }
  >();

  private readonly playerSessionStats = new Map<
    number,
    {
      kills: number;
      planetsTaken: number;
      armiesBombed: number;
    }
  >();

  /** Spawn near a random friendly planet (preferring homeworld area). */
  private spawnPoint(team: Team): { x: number; y: number } {
    // Find friendly planets
    const friendlyPlanets = this.state.planets.filter((p) => p.team === team);

    // Pick a random friendly planet to spawn near
    const planet =
      friendlyPlanets.length > 0
        ? friendlyPlanets[Math.floor(Math.random() * friendlyPlanets.length)]!
        : {
            x: PLANET_DEFS[HOMEWORLD_INDEX[team] ?? 0]!.x,
            y: PLANET_DEFS[HOMEWORLD_INDEX[team] ?? 0]!.y,
          };

    // Spawn within 3000 units of the planet
    const spread = 3000;
    return {
      x: planet.x + (Math.random() - 0.5) * spread,
      y: planet.y + (Math.random() - 0.5) * spread,
    };
  }

  joinGame(playerId: string, team: Team, shipType: ShipType): number {
    const slot = this.state.findEmptySlot();
    if (slot === -1) {
      this.logger.warn(`No empty slots for player ${playerId}`);
      return -1;
    }

    const spawn = this.spawnPoint(team);
    this.state.initShip(slot, team, shipType, playerId, spawn.x, spawn.y);
    this.logger.log(
      `Player ${playerId} joined as ${ShipType[shipType]} on team ${Team[team]}, slot ${slot}`,
    );
    return slot;
  }

  leaveGame(slot: number): void {
    const ship = this.state.ships[slot];
    if (!ship) return;
    this.logger.log(`Player ${ship.playerId} left, slot ${slot}`);
    // Disconnected ships don't explode (per spec)
    this.state.clearShip(slot);
  }

  respawn(slot: number, shipType: ShipType): RespawnResult {
    const ship = this.state.ships[slot];
    if (!ship || !ship.playerId) return { ok: false };

    // Check no in-flight torps
    for (let i = 0; i < this.state.torps.length; i++) {
      if (
        this.state.torps[i]!.alive &&
        this.state.torps[i]!.ownerSlot === slot
      ) {
        return { ok: false, reason: "torps" };
      }
    }

    // SB gates
    if (shipType === ShipType.SB) {
      const sbCheck = this.checkSbGates(slot, ship.team);
      if (!sbCheck.ok) return sbCheck;
    }

    const spawn = this.spawnPoint(ship.team);
    this.state.initShip(
      slot,
      ship.team,
      shipType,
      ship.playerId,
      spawn.x,
      spawn.y,
    );
    this.logger.log(
      `Player ${ship.playerId} respawned as ${ShipType[shipType]}`,
    );
    return { ok: true };
  }

  setPlayerTokenStats(
    slot: number,
    stats: {
      totalKills: number;
      planetsTaken: number;
      armiesBombed: number;
      rank: number;
    },
  ): void {
    this.playerTokenStats.set(slot, { ...stats });
    this.playerSessionStats.set(slot, {
      kills: 0,
      planetsTaken: 0,
      armiesBombed: 0,
    });
  }

  recordSessionKill(slot: number): void {
    const s = this.playerSessionStats.get(slot);
    if (s) s.kills++;
  }

  recordSessionPlanetTaken(slot: number): void {
    const s = this.playerSessionStats.get(slot);
    if (s) s.planetsTaken++;
  }

  recordSessionArmiesBombed(slot: number): void {
    const s = this.playerSessionStats.get(slot);
    if (s) s.armiesBombed++;
  }

  getEffectiveRank(slot: number): number {
    const token = this.playerTokenStats.get(slot);
    const session = this.playerSessionStats.get(slot);
    if (!token) return 0;
    const di = calculateDI({
      planetsTaken: token.planetsTaken + (session?.planetsTaken ?? 0),
      armiesBombed: token.armiesBombed + (session?.armiesBombed ?? 0),
      kills: token.totalKills + (session?.kills ?? 0),
    });
    return rankForDI(di);
  }

  startSbCooldown(team: Team): void {
    this.sbCooldownExpiresTick[team] =
      this.state.currentTick + SB_COOLDOWN_TICKS;
  }

  clearPlayerStats(slot: number): void {
    this.playerTokenStats.delete(slot);
    this.playerSessionStats.delete(slot);
  }

  checkSbGates(slot: number, team: Team): RespawnResult {
    // Gate 1: Rank
    const rank = this.getEffectiveRank(slot);
    if (rank < SB_MIN_RANK) {
      return { ok: false, reason: "rank" };
    }

    // Gate 2: One per team
    for (const s of this.state.ships) {
      if (
        s.team === team &&
        s.shipType === ShipType.SB &&
        s.status !== ShipStatus.DEAD &&
        s.playerId !== ""
      ) {
        return { ok: false, reason: "sb_active" };
      }
    }

    // Gate 3: Team planets
    let teamPlanets = 0;
    for (const p of this.state.planets) {
      if (p.team === team) teamPlanets++;
    }
    if (teamPlanets < SB_MIN_PLANETS) {
      return { ok: false, reason: "planets" };
    }

    // Gate 4: Cooldown
    const cooldownExpires = this.sbCooldownExpiresTick[team] ?? 0;
    if (this.state.currentTick < cooldownExpires) {
      const remainingTicks = cooldownExpires - this.state.currentTick;
      return {
        ok: false,
        reason: "sb_cooldown",
        cooldownRemainingSec: Math.ceil(remainingTicks / 10),
      };
    }

    return { ok: true };
  }

  /** Returns count of alive players. */
  getPlayerCount(): number {
    let count = 0;
    for (let i = 0; i < this.state.ships.length; i++) {
      if (this.state.ships[i]!.status !== ShipStatus.DEAD) count++;
    }
    return count;
  }

  isBot(slot: number): boolean {
    const ship = this.state.ships[slot];
    return ship?.playerId.startsWith("bot:") ?? false;
  }
}

import { Injectable, Logger } from "@nestjs/common";
import { Team, ShipType, ShipStatus, PLANET_DEFS } from "@netrek/shared";
import { GameState } from "./state/game-state";
import { InputQueue } from "./state/input-queue";

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

  respawn(slot: number, shipType: ShipType): void {
    const ship = this.state.ships[slot];
    if (!ship || !ship.playerId) return;

    // Check no in-flight torps
    for (let i = 0; i < this.state.torps.length; i++) {
      if (
        this.state.torps[i]!.alive &&
        this.state.torps[i]!.ownerSlot === slot
      ) {
        return; // Can't respawn yet
      }
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
  }

  /** Returns count of alive players. */
  getPlayerCount(): number {
    let count = 0;
    for (let i = 0; i < this.state.ships.length; i++) {
      if (this.state.ships[i]!.status !== ShipStatus.DEAD) count++;
    }
    return count;
  }
}

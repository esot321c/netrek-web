import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import {
  TICK_MS,
  SHIP_STATS,
  SPEED_SCALE,
  TORP_HIT_RADIUS,
  TORP_LIFETIME_BASE,
  TORP_LIFETIME_VARIANCE,
  PHASER_COOLDOWN_TICKS,
  DET_FUEL_COST,
  DET_WEAPON_HEAT,
  DET_RANGE,
  EXPLOSION_DURATION_TICKS,
  EXPLOSION_OUTER_RADIUS,
  YELLOW_ALERT_DIST,
  RED_ALERT_DIST,
  ARMY_POP_INTERVAL,
  ARMY_POP_CHANCE,
  ARMY_POP_LOW_BONUS,
  ARMY_POP_LOW_THRESHOLD,
  ARMY_POP_AGRI_CHANCE,
  ARMY_POP_MAX,
  PLAGUE_CHANCE,
  PLAGUE_SCALING_THRESHOLD,
  PLAGUE_SCALING_PER_ARMY,
  PLAGUE_LOSS_PCT_MIN,
  PLAGUE_LOSS_PCT_MAX,
  PLAGUE_MIN_LOSS,
  TEAM_NEUTRAL,
  ORBIT_DIST,
  ORBIT_MAX_SPEED,
  ORBIT_RADIUS,
  ORBIT_ANGULAR_SPEED,
  BOMB_MIN_ARMIES,
  BOMB_INTERVAL,
  BEAM_MIN_ARMIES,
  BEAM_INTERVAL,
  UNCLOAK_TICKS,
  TRACTOR_FUEL_PER_TICK,
  TRACTOR_ENGINE_HEAT,
  HOSTILE_PLANET_DMG_BASE,
  HOSTILE_PLANET_DMG_PER_10,
  REFIT_TICKS,
  REFIT_MIN_SHIELD_PCT,
  REFIT_MIN_FUEL_PCT,
  REFIT_MAX_HULL_PCT,
  KILLS_PER_BOMB,
  KILLS_PER_CAPTURE,
  TMODE_MIN_PLAYERS,
  SURRENDER_PLANET_THRESHOLD,
  SURRENDER_FREEZE_PLANETS,
  SURRENDER_CLEAR_PLANETS,
  SURRENDER_TIMER_TICKS,
  MAX_DOCK_SHIPS,
  DOCK_DIST,
  DOCK_SHIELD_REPAIR_MULT,
  DOCK_FUEL_RECHARGE_MULT,
  PlanetFeature,
  ShipStatus,
  ShipType,
  AlertStatus,
  InputCommand,
  type ShipState,
  type TorpState,
  type PlanetState,
  directionToRadians,
  directionDelta,
  turnRate,
  accelerate,
  moveShip,
  moveTorp,
  TORP_ALIVE,
  TORP_WALL,
  maxWarpForHull,
  distance,
  phaserDamage,
  torpSplashDamage,
  explosionDamage,
  updateEngineTemp,
  updateWeaponTemp,
  updateFuel,
  updateRepair,
  applyDamage,
  angleBetween,
  LockType,
  MAX_PLAYERS,
  Team,
  type KillEvent,
  type PlasmaState,
  GALAXY_WIDTH,
  GALAXY_HEIGHT,
  PLASMA_SPEED,
  PLASMA_DAMAGE,
  PLASMA_SPLASH_RADIUS,
  PLASMA_FUEL_COST,
  PLASMA_HEAT,
  PLASMA_LIFETIME,
  PLASMA_TURN_RATE,
  PLASMA_MIN_KILLS,
  PLASMA_HIT_RADIUS,
  PLASMA_LOCK_RANGE,
  SCAN_RANGE,
} from "@netrek/shared";
import { GameService } from "./game.service";
import { BotManagerService } from "./bot";
import { loadBotConfig, type BotConfig } from "./bot/bot-config";
import { StatReporterService } from "../registration/stat-reporter.service";

import {
  GAME_TICK_EVENT,
  GAME_WIN_EVENT,
  GAME_RESET_EVENT,
  GAME_KILL_EVENT,
} from "./game-events";
export {
  GAME_TICK_EVENT,
  GAME_WIN_EVENT,
  GAME_RESET_EVENT,
  GAME_KILL_EVENT,
} from "./game-events";

@Injectable()
export class GameLoopService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GameLoopService.name);
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  readonly alertStatuses: AlertStatus[] = new Array(MAX_PLAYERS).fill(
    AlertStatus.GREEN,
  ) as AlertStatus[];

  /** Tournament mode — bombing/beaming only possible when active */
  tmode = false;

  private winPauseTicks = 0;
  private winningTeam = -1;

  /** Surrender timers per team (0 = inactive) */
  private readonly surrenderTimers: number[] = [0, 0, 0, 0];

  private readonly botConfig: BotConfig;

  constructor(
    private readonly gameService: GameService,
    private readonly eventEmitter: EventEmitter2,
    private readonly botManager: BotManagerService,
    private readonly statReporter: StatReporterService,
  ) {
    this.botConfig = loadBotConfig();
  }

  onModuleInit() {
    this.botManager.init(
      this.gameService.state,
      this.gameService.inputQueue,
      this.alertStatuses,
    );
    this.botManager.spawnInitialBots();
    this.start();
  }

  onModuleDestroy() {
    this.stop();
  }

  start(): void {
    if (this.intervalHandle) return;
    this.logger.log("Game loop started (10Hz)");
    this.intervalHandle = setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      this.logger.log("Game loop stopped");
    }
  }

  private tick(): void {
    const state = this.gameService.state;
    const inputQueue = this.gameService.inputQueue;

    // Handle win pause — freeze game, show results
    if (this.winPauseTicks > 0) {
      this.winPauseTicks--;
      if (this.winPauseTicks === 0) {
        this.resetGame();
      }
      state.currentTick++;
      this.eventEmitter.emit(GAME_TICK_EVENT, {
        alertStatuses: this.alertStatuses,
        tmode: this.tmode,
        surrenderTimers: this.surrenderTimers,
      });
      this.botManager.setTMode(this.tmode);
      return;
    }

    // Step 1: Process inputs
    this.processInputs(inputQueue, state.ships);

    // Step 1b: Update lock steering (before movement so desiredDirection is set)
    this.updateLock(state.ships, state.planets);

    // Step 1c: Update docking (sync positions, force-undock on SB death)
    this.updateDocking(state.ships);

    // Step 2: Update movement (orbiting ships don't move)
    this.updateMovement(state.ships);

    // Step 3: Move torpedoes and check collisions
    this.updateTorpedoes();

    // Step 3b: Move plasmas, track targets, check collisions
    this.updatePlasmas();

    // Step 4: Phaser cooldowns
    this.updatePhaserCooldowns(state.ships);

    // Step 5: Update planets (army growth)
    this.updatePlanets(state.planets, state.currentTick);

    // Step 6: Orbit validation, bombing, beaming
    this.updateOrbits(state.ships, state.planets);
    this.updateBombing(state.ships, state.planets);
    this.updateBeaming(state.ships, state.planets);

    // Step 7: Cloaking
    this.updateCloaking(state.ships);

    // Step 8: Tractor/pressor beams
    this.updateTractorPressor(state.ships);

    // Step 9: Hostile planet damage
    this.updateHostilePlanetDamage(state.ships, state.planets);

    // Step 10: Refitting
    this.updateRefitting(state.ships);

    // Step 11: Update temps, fuel, repair (with orbit bonuses)
    this.updateShipSystems(state.ships, state.planets);

    // Step 12: Check deaths and process explosions
    this.checkDeaths(state.ships);
    this.updateExplosions();

    // Step 13: Compute alert statuses
    this.computeAlertStatuses(state.ships);

    // Step 14: T-Mode check
    this.updateTMode(state.ships);

    // Step 15: Win condition check
    this.checkWinCondition(state.planets);

    // Step 16: Update planet knowledge (fog of war)
    this.updatePlanetScanning(state);

    // Step 17: Increment tick
    state.currentTick++;

    // Emit tick event for broadcast
    this.eventEmitter.emit(GAME_TICK_EVENT, {
      alertStatuses: this.alertStatuses,
      tmode: this.tmode,
      surrenderTimers: this.surrenderTimers,
    });

    this.botManager.setTMode(this.tmode);
  }

  // -------------------------------------------------------------------------
  // Step 1: Process inputs
  // -------------------------------------------------------------------------

  private processInputs(
    inputQueue: typeof this.gameService.inputQueue,
    ships: ShipState[],
  ): void {
    for (let slot = 0; slot < ships.length; slot++) {
      const ship = ships[slot]!;
      if (ship.status !== ShipStatus.ALIVE) continue;

      // Skip inputs while refitting (ship is frozen)
      if (ship.refitTicks > 0) {
        inputQueue.drain(slot);
        continue;
      }

      const { inputs, count } = inputQueue.drain(slot);
      for (let i = 0; i < count; i++) {
        const input = inputs[i]!;

        if (ship.dockedAt >= 0) {
          if (
            input.command === InputCommand.SET_SPEED ||
            input.command === InputCommand.SET_DIRECTION ||
            input.command === InputCommand.FIRE_TORP ||
            input.command === InputCommand.FIRE_PHASER ||
            input.command === InputCommand.FIRE_PLASMA
          ) {
            this.undock(ship);
          }
        }

        switch (input.command) {
          case InputCommand.SET_DIRECTION:
            ship.desiredDirection = input.value & 0xff;
            // Manual steering cancels lock and breaks orbit
            this.clearLock(ship);
            this.breakOrbit(ship);
            break;

          case InputCommand.SET_SPEED: {
            const maxWarp = maxWarpForHull(ship.shipType, ship.hullDamage);
            ship.desiredSpeed = Math.min(input.value, maxWarp);
            if (ship.repairMode) ship.repairMode = false;
            // Setting speed breaks orbit
            if (ship.desiredSpeed > ORBIT_MAX_SPEED) {
              this.breakOrbit(ship);
            }
            break;
          }

          case InputCommand.FIRE_TORP:
            // Can't fire while cloaked
            if (ship.cloaked || ship.uncloakTicks > 0) break;
            this.fireTorp(ship, input.value & 0xff);
            break;

          case InputCommand.FIRE_PHASER:
            // Can't fire while cloaked
            if (ship.cloaked || ship.uncloakTicks > 0) break;
            this.firePhaser(ship, input.value & 0xff);
            break;

          case InputCommand.SHIELD_TOGGLE: {
            const shieldVal = input.value & 0xff;
            if (shieldVal === 1) ship.shieldsUp = true;
            else if (shieldVal === 2) ship.shieldsUp = false;
            else ship.shieldsUp = !ship.shieldsUp;
            if (ship.shieldsUp) {
              ship.bombing = false;
              ship.beaming = 0;
            }
            break;
          }

          case InputCommand.REPAIR_TOGGLE:
            ship.repairMode = !ship.repairMode;
            if (ship.repairMode) {
              ship.desiredSpeed = 0;
              ship.shieldsUp = false;
            }
            break;

          case InputCommand.DETONATE:
            this.detonate(ship);
            break;

          case InputCommand.ORBIT:
            this.tryOrbit(ship);
            break;

          case InputCommand.BOMB:
            this.tryBomb(ship);
            break;

          case InputCommand.BEAM_UP:
            this.tryBeamUp(ship);
            break;

          case InputCommand.BEAM_DOWN:
            this.tryBeamDown(ship);
            break;

          case InputCommand.CLOAK_TOGGLE:
            this.toggleCloak(ship, input.value & 0xff);
            break;

          case InputCommand.TRACTOR:
            this.toggleTractor(ship, input.value);
            break;

          case InputCommand.PRESSOR:
            this.togglePressor(ship, input.value);
            break;

          case InputCommand.REFIT:
            this.tryRefit(ship, input.value);
            break;

          case InputCommand.LOCK:
            this.setLock(ship, input.value);
            break;

          case InputCommand.DETONATE_SELF:
            this.detonateSelf(ship);
            break;

          case InputCommand.DOCK:
            // Reserved for SB docking permission toggle (future)
            break;

          case InputCommand.FIRE_PLASMA:
            if (ship.cloaked || ship.uncloakTicks > 0) break;
            this.firePlasma(ship, input.value & 0xff);
            break;
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Orbit
  // -------------------------------------------------------------------------

  private tryOrbit(ship: ShipState): void {
    if (ship.orbitPlanetId >= 0 || ship.dockedAt >= 0) return;
    if (ship.speed > ORBIT_MAX_SPEED) return;

    const planets = this.gameService.state.planets;
    let bestPlanetIdx = -1;
    let bestDist = ORBIT_DIST + 1;
    for (let i = 0; i < planets.length; i++) {
      const d = distance(ship.x, ship.y, planets[i]!.x, planets[i]!.y);
      if (d < bestDist) {
        bestDist = d;
        bestPlanetIdx = i;
      }
    }

    if (ship.shipType !== ShipType.SB) {
      const ships = this.gameService.state.ships;
      let bestSbSlot = -1;
      let bestSbDist = DOCK_DIST + 1;
      for (let i = 0; i < ships.length; i++) {
        const sb = ships[i]!;
        if (
          sb.status === ShipStatus.ALIVE &&
          sb.shipType === ShipType.SB &&
          sb.team === ship.team &&
          sb.dockedShips.length < MAX_DOCK_SHIPS
        ) {
          const d = distance(ship.x, ship.y, sb.x, sb.y);
          if (d < bestSbDist) {
            bestSbDist = d;
            bestSbSlot = i;
          }
        }
      }

      if (bestSbSlot >= 0 && bestSbDist < bestDist) {
        this.dock(ship, this.gameService.state.ships[bestSbSlot]!);
        return;
      }
    }

    if (bestPlanetIdx >= 0) {
      if (
        ship.shipType === ShipType.SB &&
        this.gameService.state.planets[bestPlanetIdx]!.team !== ship.team
      ) {
        return;
      }
      this.enterOrbit(ship, bestPlanetIdx);
    }
  }

  /** Snap a ship into orbit around a planet. */
  private enterOrbit(ship: ShipState, planetIdx: number): void {
    const planet = this.gameService.state.planets[planetIdx]!;
    ship.orbitPlanetId = planetIdx;
    this.clearLock(ship);
    ship.speed = 0;
    ship.desiredSpeed = 0;
    // Set initial orbit angle based on current position relative to planet
    ship.orbitAngle = Math.atan2(ship.x - planet.x, -(ship.y - planet.y));
    // Snap to orbit radius
    ship.x = planet.x + Math.sin(ship.orbitAngle) * ORBIT_RADIUS;
    ship.y = planet.y - Math.cos(ship.orbitAngle) * ORBIT_RADIUS;
  }

  private breakOrbit(ship: ShipState): void {
    if (ship.orbitPlanetId < 0) return;
    ship.orbitPlanetId = -1;
    ship.bombing = false;
    ship.beaming = 0;
  }

  // -------------------------------------------------------------------------
  // Lock — unified planet lock + player lock
  // -------------------------------------------------------------------------

  private clearLock(ship: ShipState): void {
    ship.lockType = LockType.NONE;
    ship.lockTargetId = -1;
  }

  /** Set lock from the 'l' key. Value encodes: (lockType << 8) | targetId. */
  private setLock(ship: ShipState, value: number): void {
    const type = (value >> 8) & 0xff;
    const targetId = value & 0xff;

    if (type === LockType.PLANET) {
      const planets = this.gameService.state.planets;
      if (targetId < 0 || targetId >= planets.length) {
        this.clearLock(ship);
        return;
      }
      // If already orbiting this planet, do nothing
      if (ship.orbitPlanetId === targetId) return;
      // Break current orbit if orbiting a different planet
      this.breakOrbit(ship);
      ship.lockType = LockType.PLANET;
      ship.lockTargetId = targetId;
    } else if (type === LockType.PLAYER) {
      const ships = this.gameService.state.ships;
      if (targetId < 0 || targetId >= ships.length) {
        this.clearLock(ship);
        return;
      }
      const target = ships[targetId]!;
      // Can't lock onto yourself or dead ships
      if (
        target.slotIndex === ship.slotIndex ||
        target.status !== ShipStatus.ALIVE
      ) {
        this.clearLock(ship);
        return;
      }
      this.breakOrbit(ship);
      ship.lockType = LockType.PLAYER;
      ship.lockTargetId = targetId;
    } else {
      this.clearLock(ship);
    }
  }

  private toggleDock(ship: ShipState): void {
    if (ship.dockedAt >= 0) {
      this.undock(ship);
      return;
    }
    if (ship.shipType === ShipType.SB) return;
    const ships = this.gameService.state.ships;
    for (let i = 0; i < ships.length; i++) {
      const sb = ships[i]!;
      if (sb.status !== ShipStatus.ALIVE) continue;
      if (sb.shipType !== ShipType.SB) continue;
      if (sb.team !== ship.team) continue;
      if (sb.dockedShips.length >= MAX_DOCK_SHIPS) continue;
      const dist = distance(ship.x, ship.y, sb.x, sb.y);
      if (dist <= DOCK_DIST) {
        this.dock(ship, sb);
        return;
      }
    }
  }

  private dock(ship: ShipState, sb: ShipState): void {
    ship.dockedAt = sb.slotIndex;
    sb.dockedShips.push(ship.slotIndex);
    ship.speed = 0;
    ship.desiredSpeed = 0;
    ship.tractorTarget = -1;
    ship.pressorTarget = -1;
    if (ship.orbitPlanetId >= 0) {
      this.breakOrbit(ship);
    }
  }

  private undock(ship: ShipState): void {
    const sbSlot = ship.dockedAt;
    ship.dockedAt = -1;
    if (sbSlot >= 0) {
      const sb = this.gameService.state.ships[sbSlot]!;
      const idx = sb.dockedShips.indexOf(ship.slotIndex);
      if (idx >= 0) sb.dockedShips.splice(idx, 1);
    }
  }

  /** Each tick: steer locked ships toward their target, auto-orbit planets on arrival. */
  private updateLock(ships: ShipState[], planets: PlanetState[]): void {
    for (let i = 0; i < ships.length; i++) {
      const ship = ships[i]!;
      if (ship.status !== ShipStatus.ALIVE) continue;
      if (ship.lockType === LockType.NONE) continue;
      if (ship.orbitPlanetId >= 0) continue; // already orbiting

      if (ship.lockType === LockType.PLANET) {
        const planet = planets[ship.lockTargetId];
        if (!planet) {
          this.clearLock(ship);
          continue;
        }

        const dist = distance(ship.x, ship.y, planet.x, planet.y);

        // Close enough and slow enough — enter orbit
        if (dist <= ORBIT_DIST && ship.speed <= ORBIT_MAX_SPEED) {
          this.enterOrbit(ship, ship.lockTargetId);
          continue;
        }

        // Steer toward the planet
        ship.desiredDirection = angleBetween(
          ship.x,
          ship.y,
          planet.x,
          planet.y,
        );
      } else if (ship.lockType === LockType.PLAYER) {
        const target = ships[ship.lockTargetId];
        if (!target || target.status !== ShipStatus.ALIVE || target.cloaked) {
          this.clearLock(ship);
          continue;
        }

        const dist = distance(ship.x, ship.y, target.x, target.y);

        // Auto-dock: locked onto a friendly SB and within range
        if (
          target.shipType === ShipType.SB &&
          target.team === ship.team &&
          ship.shipType !== ShipType.SB &&
          dist <= DOCK_DIST &&
          ship.dockedAt < 0 &&
          target.dockedShips.length < MAX_DOCK_SHIPS
        ) {
          this.dock(ship, target);
          this.clearLock(ship);
          continue;
        }

        // Steer toward the player
        ship.desiredDirection = angleBetween(
          ship.x,
          ship.y,
          target.x,
          target.y,
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // Docking (sync positions, force-undock on SB death)
  // -------------------------------------------------------------------------

  private updateDocking(ships: ShipState[]): void {
    for (let i = 0; i < ships.length; i++) {
      const ship = ships[i]!;
      if (ship.dockedAt < 0) continue;
      if (ship.status !== ShipStatus.ALIVE) continue;
      const sb = ships[ship.dockedAt]!;
      if (sb.status !== ShipStatus.ALIVE) {
        this.undock(ship);
        continue;
      }
      ship.x = sb.x;
      ship.y = sb.y;
      ship.speed = 0;
      ship.desiredSpeed = 0;
    }
  }

  // -------------------------------------------------------------------------
  // Orbit validation (check ship hasn't drifted from planet)
  // -------------------------------------------------------------------------

  private updateOrbits(ships: ShipState[], planets: PlanetState[]): void {
    for (let i = 0; i < ships.length; i++) {
      const ship = ships[i]!;
      if (ship.status !== ShipStatus.ALIVE) continue;
      if (ship.orbitPlanetId < 0) continue;

      const planet = planets[ship.orbitPlanetId];
      if (!planet) {
        this.breakOrbit(ship);
        continue;
      }

      // Advance orbit angle — ship circles the planet
      ship.orbitAngle += ORBIT_ANGULAR_SPEED;
      if (ship.orbitAngle > Math.PI * 2) ship.orbitAngle -= Math.PI * 2;

      // Update position to circle around planet
      ship.x = planet.x + Math.sin(ship.orbitAngle) * ORBIT_RADIUS;
      ship.y = planet.y - Math.cos(ship.orbitAngle) * ORBIT_RADIUS;

      // Face tangent to orbit (90 degrees ahead of radial angle)
      const tangentAngle = ship.orbitAngle + Math.PI / 2;
      ship.direction = Math.round((tangentAngle / (Math.PI * 2)) * 256) & 0xff;
      ship.desiredDirection = ship.direction;
    }
  }

  // -------------------------------------------------------------------------
  // Bombing
  // -------------------------------------------------------------------------

  private tryBomb(ship: ShipState): void {
    if (ship.bombing) {
      ship.bombing = false;
      return;
    }

    if (!this.tmode) return;
    if (ship.orbitPlanetId < 0) return;

    const planet = this.gameService.state.planets[ship.orbitPlanetId];
    if (!planet) return;

    // Must be enemy planet
    if (planet.team === ship.team || (planet.team as number) === TEAM_NEUTRAL)
      return;

    if (planet.armies < BOMB_MIN_ARMIES) return;

    ship.shieldsUp = false;
    ship.bombing = true;
    ship.beaming = 0; // Can't beam and bomb simultaneously
    ship.bombCooldownTicks = BOMB_INTERVAL;
  }

  private updateBombing(ships: ShipState[], planets: PlanetState[]): void {
    for (let i = 0; i < ships.length; i++) {
      const ship = ships[i]!;
      if (ship.status !== ShipStatus.ALIVE) continue;
      if (!ship.bombing) continue;

      // Validate bombing is still valid
      if (ship.orbitPlanetId < 0 || ship.shieldsUp || !this.tmode) {
        ship.bombing = false;
        continue;
      }

      const planet = planets[ship.orbitPlanetId];
      if (
        !planet ||
        planet.team === ship.team ||
        planet.armies < BOMB_MIN_ARMIES
      ) {
        ship.bombing = false;
        continue;
      }

      // Bomb roll every BOMB_INTERVAL ticks
      ship.bombCooldownTicks--;
      if (ship.bombCooldownTicks > 0) continue;
      ship.bombCooldownTicks = BOMB_INTERVAL;

      // Roll for armies destroyed
      const roll = Math.random();
      let destroyed: number;
      if (ship.shipType === ShipType.AS) {
        // AS: 0 (50%), 2 (30%), 3 (10%), 4 (10%)
        if (roll < 0.5) destroyed = 0;
        else if (roll < 0.8) destroyed = 2;
        else if (roll < 0.9) destroyed = 3;
        else destroyed = 4;
      } else {
        // Normal: 0 (50%), 1 (30%), 2 (10%), 3 (10%)
        if (roll < 0.5) destroyed = 0;
        else if (roll < 0.8) destroyed = 1;
        else if (roll < 0.9) destroyed = 2;
        else destroyed = 3;
      }

      if (destroyed > 0) {
        const floor = BOMB_MIN_ARMIES - 1; // Can't bomb below 4
        const actual = Math.min(destroyed, planet.armies - floor);
        if (actual > 0) {
          planet.armies -= actual;
          if (!ship.playerId.startsWith("bot:")) {
            this.statReporter.recordArmiesBombed(ship.playerId, actual);
          }
          ship.kills += actual * KILLS_PER_BOMB;
          for (let a = 0; a < actual; a++) {
            this.gameService.recordSessionArmiesBombed(i);
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Beaming
  // -------------------------------------------------------------------------

  private tryBeamUp(ship: ShipState): void {
    if (ship.beaming === 1) {
      ship.beaming = 0;
      return;
    }

    if (!this.tmode) return;
    if (ship.orbitPlanetId < 0) return;

    const planet = this.gameService.state.planets[ship.orbitPlanetId];
    if (!planet) return;

    // Must be friendly planet with enough armies
    if (planet.team !== ship.team) return;
    if (planet.armies < BEAM_MIN_ARMIES) return;

    // Check army carry capacity
    const stats = SHIP_STATS[ship.shipType];
    const capacity = Math.min(
      stats.maxArmies,
      Math.floor(ship.kills * stats.armiesPerKill),
    );
    if (ship.armies >= capacity) return;

    ship.shieldsUp = false;
    ship.beaming = 1; // beam up
    ship.bombing = false;
    ship.beamCooldownTicks = BEAM_INTERVAL;
  }

  private tryBeamDown(ship: ShipState): void {
    if (ship.beaming === 2) {
      ship.beaming = 0;
      return;
    }

    if (!this.tmode) return;
    if (ship.orbitPlanetId < 0) return;
    if (ship.armies <= 0) return;

    const planet = this.gameService.state.planets[ship.orbitPlanetId];
    if (!planet) return;

    ship.shieldsUp = false;
    ship.beaming = 2; // beam down
    ship.bombing = false;
    ship.beamCooldownTicks = BEAM_INTERVAL;
  }

  private updateBeaming(ships: ShipState[], planets: PlanetState[]): void {
    for (let i = 0; i < ships.length; i++) {
      const ship = ships[i]!;
      if (ship.status !== ShipStatus.ALIVE) continue;
      if (ship.beaming === 0) continue;

      // Validate
      if (ship.orbitPlanetId < 0 || ship.shieldsUp || !this.tmode) {
        ship.beaming = 0;
        continue;
      }

      const planet = planets[ship.orbitPlanetId];
      if (!planet) {
        ship.beaming = 0;
        continue;
      }

      ship.beamCooldownTicks--;
      if (ship.beamCooldownTicks > 0) continue;
      ship.beamCooldownTicks = BEAM_INTERVAL;

      if (ship.beaming === 1) {
        // Beam up — take army from friendly planet
        if (planet.team !== ship.team || planet.armies < BEAM_MIN_ARMIES) {
          ship.beaming = 0;
          continue;
        }
        const stats = SHIP_STATS[ship.shipType];
        const capacity = Math.min(
          stats.maxArmies,
          Math.floor(ship.kills * stats.armiesPerKill),
        );
        if (ship.armies >= capacity) {
          ship.beaming = 0;
          continue;
        }
        planet.armies--;
        ship.armies++;
        if (!ship.playerId.startsWith("bot:")) {
          this.statReporter.recordArmiesBeamed(ship.playerId, 1);
        }
      } else {
        // Beam down — drop army on planet (enemy, neutral, or friendly)
        if (ship.armies <= 0) {
          ship.beaming = 0;
          continue;
        }

        ship.armies--;

        if (planet.team === ship.team) {
          // Friendly planet — reinforce
          planet.armies++;
        } else if (planet.armies > 0) {
          // Enemy/neutral — one friendly army kills one enemy army
          planet.armies--;
        } else {
          // Planet captured!
          planet.team = ship.team;
          planet.armies = 1;
          ship.kills += KILLS_PER_CAPTURE;
          if (!ship.playerId.startsWith("bot:")) {
            this.statReporter.recordPlanetTaken(ship.playerId);
          }
          this.gameService.recordSessionPlanetTaken(i);
        }

        if (ship.armies <= 0) {
          ship.beaming = 0;
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Cloaking
  // -------------------------------------------------------------------------

  private toggleCloak(ship: ShipState, mode = 0): void {
    if (mode === 1) {
      // Force cloak on
      if (ship.cloaked || ship.uncloakTicks > 0) return;
      ship.cloaked = true;
      ship.tractorTarget = -1;
      ship.pressorTarget = -1;
    } else if (mode === 2) {
      // Force cloak off
      if (!ship.cloaked) return;
      ship.cloaked = false;
      ship.uncloakTicks = UNCLOAK_TICKS;
    } else {
      // Toggle
      if (ship.cloaked) {
        ship.cloaked = false;
        ship.uncloakTicks = UNCLOAK_TICKS;
      } else {
        if (ship.uncloakTicks > 0) return;
        ship.cloaked = true;
        ship.tractorTarget = -1;
        ship.pressorTarget = -1;
      }
    }
  }

  private updateCloaking(ships: ShipState[]): void {
    for (let i = 0; i < ships.length; i++) {
      const ship = ships[i]!;
      if (ship.status !== ShipStatus.ALIVE) continue;

      // Uncloak timer countdown
      if (ship.uncloakTicks > 0) {
        ship.uncloakTicks--;
      }

      // Cloak fuel cost (AS burns half as much)
      if (ship.cloaked) {
        const stats = SHIP_STATS[ship.shipType];
        ship.fuel -= stats.cloakFuelPerTick;
        if (ship.fuel <= 0) {
          ship.fuel = 0;
          ship.cloaked = false;
          ship.uncloakTicks = UNCLOAK_TICKS;
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Tractor/Pressor beams
  // -------------------------------------------------------------------------

  private toggleTractor(ship: ShipState, targetSlot: number): void {
    if (ship.cloaked) return;
    if (ship.engineBurnoutTicks > 0) return;

    if (ship.tractorTarget >= 0) {
      // Toggle off
      ship.tractorTarget = -1;
      return;
    }

    // Also turn off pressor if active
    ship.pressorTarget = -1;

    const target = this.gameService.state.ships[targetSlot];
    if (!target || target.status !== ShipStatus.ALIVE) return;
    if (target.slotIndex === ship.slotIndex) return; // Can't tractor self
    if (target.cloaked && target.team !== ship.team) return; // Can't grab cloaked enemies

    const stats = SHIP_STATS[ship.shipType];
    const maxRange = stats.tractorRange * 6000; // tractorRange is fraction
    const dist = distance(ship.x, ship.y, target.x, target.y);
    if (dist > maxRange) return;

    ship.tractorTarget = targetSlot;
  }

  private togglePressor(ship: ShipState, targetSlot: number): void {
    if (ship.cloaked) return;
    if (ship.engineBurnoutTicks > 0) return;

    if (ship.pressorTarget >= 0) {
      // Toggle off
      ship.pressorTarget = -1;
      return;
    }

    // Also turn off tractor if active
    ship.tractorTarget = -1;

    const target = this.gameService.state.ships[targetSlot];
    if (!target || target.status !== ShipStatus.ALIVE) return;
    if (target.slotIndex === ship.slotIndex) return;
    if (target.cloaked && target.team !== ship.team) return;

    const stats = SHIP_STATS[ship.shipType];
    const maxRange = stats.tractorRange * 6000;
    const dist = distance(ship.x, ship.y, target.x, target.y);
    if (dist > maxRange) return;

    ship.pressorTarget = targetSlot;
  }

  private updateTractorPressor(ships: ShipState[]): void {
    for (let i = 0; i < ships.length; i++) {
      const ship = ships[i]!;
      if (ship.status !== ShipStatus.ALIVE) continue;

      const hasTractor = ship.tractorTarget >= 0;
      const hasPressor = ship.pressorTarget >= 0;
      if (!hasTractor && !hasPressor) continue;

      const targetSlot = hasTractor ? ship.tractorTarget : ship.pressorTarget;
      const target = ships[targetSlot];
      if (!target || target.status !== ShipStatus.ALIVE) {
        ship.tractorTarget = -1;
        ship.pressorTarget = -1;
        continue;
      }

      // Range check — break if out of range
      const stats = SHIP_STATS[ship.shipType];
      const maxRange = stats.tractorRange * 6000;
      const dist = distance(ship.x, ship.y, target.x, target.y);
      if (dist > maxRange * 1.2) {
        ship.tractorTarget = -1;
        ship.pressorTarget = -1;
        continue;
      }

      // Fuel cost
      ship.fuel -= TRACTOR_FUEL_PER_TICK;
      if (ship.fuel <= 0) {
        ship.fuel = 0;
        ship.tractorTarget = -1;
        ship.pressorTarget = -1;
        continue;
      }

      // Engine heat
      ship.engineTemp += TRACTOR_ENGINE_HEAT;

      // Apply force — move both ships
      if (dist < 1) continue; // avoid division by zero
      const dx = target.x - ship.x;
      const dy = target.y - ship.y;
      const nx = dx / dist;
      const ny = dy / dist;

      const force = stats.tractorStrength / 100; // scale force per tick

      if (hasTractor) {
        // Pull: move ship toward target, target toward ship
        ship.x += nx * force * 0.5;
        ship.y += ny * force * 0.5;
        target.x -= nx * force * 0.5;
        target.y -= ny * force * 0.5;
        // Tractor pulls out of orbit
        if (target.orbitPlanetId >= 0) this.breakOrbit(target);
      } else {
        // Push: move ship away from target, target away from ship
        ship.x -= nx * force * 0.5;
        ship.y -= ny * force * 0.5;
        target.x += nx * force * 0.5;
        target.y += ny * force * 0.5;
        if (target.orbitPlanetId >= 0) this.breakOrbit(target);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Hostile planet damage
  // -------------------------------------------------------------------------

  private updateHostilePlanetDamage(
    ships: ShipState[],
    planets: PlanetState[],
  ): void {
    for (let i = 0; i < ships.length; i++) {
      const ship = ships[i]!;
      if (ship.status !== ShipStatus.ALIVE) continue;

      for (let j = 0; j < planets.length; j++) {
        const planet = planets[j]!;
        if (planet.team === ship.team) continue;
        if ((planet.team as number) === TEAM_NEUTRAL) continue;
        if (planet.armies <= 0) continue;

        const dist = distance(ship.x, ship.y, planet.x, planet.y);
        if (dist > ORBIT_DIST * 2) continue;

        const dmg =
          HOSTILE_PLANET_DMG_BASE +
          HOSTILE_PLANET_DMG_PER_10 * Math.floor(planet.armies / 10);
        applyDamage(ship, dmg);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Refitting
  // -------------------------------------------------------------------------

  private tryRefit(ship: ShipState, shipTypeValue: number): void {
    if (ship.refitTicks > 0) return;

    // Must be at homeworld or docked at own starbase
    const homeworldIdx = ship.team * 10;
    const atHomeworld =
      ship.orbitPlanetId >= 0 && ship.orbitPlanetId === homeworldIdx;
    const dockedAtFriendlySb =
      ship.dockedAt >= 0 &&
      this.gameService.state.ships[ship.dockedAt]?.team === ship.team;
    if (!atHomeworld && !dockedAtFriendlySb) return;

    // Requirements
    const stats = SHIP_STATS[ship.shipType];
    if (ship.shieldStrength / stats.maxShields < REFIT_MIN_SHIELD_PCT) return;
    if (ship.fuel / stats.maxFuel < REFIT_MIN_FUEL_PCT) return;
    if (ship.hullDamage / stats.maxHull > REFIT_MAX_HULL_PCT) return;
    if (ship.armies > 0) return;

    // Validate ship type
    if (shipTypeValue < 0 || shipTypeValue > ShipType.SB) return;

    if (shipTypeValue === ShipType.SB) {
      const sbCheck = this.gameService.checkSbGates(ship.slotIndex, ship.team);
      if (!sbCheck.ok) return;
    }

    ship.refitTicks = REFIT_TICKS;
    ship.refitShipType = shipTypeValue;
    ship.speed = 0;
    ship.desiredSpeed = 0;
  }

  private updateRefitting(ships: ShipState[]): void {
    for (let i = 0; i < ships.length; i++) {
      const ship = ships[i]!;
      if (ship.status !== ShipStatus.ALIVE) continue;
      if (ship.refitTicks <= 0) continue;

      ship.refitTicks--;
      if (ship.refitTicks > 0) continue;

      // Complete refit
      const newType = ship.refitShipType as ShipType;
      const newStats = SHIP_STATS[newType];
      ship.shipType = newType;
      ship.hullDamage = 0;
      ship.engineTemp = 0;
      ship.shieldStrength = newStats.maxShields;
      ship.fuel = newStats.maxFuel;
      ship.refitShipType = -1;
    }
  }

  // -------------------------------------------------------------------------
  // Weapon actions
  // -------------------------------------------------------------------------

  private fireTorp(ship: ShipState, direction: number): void {
    const stats = SHIP_STATS[ship.shipType];

    // Can't fire during weapon burnout
    if (ship.weaponBurnoutTicks > 0) return;

    // Fuel check
    const fuelCost = stats.torpDamage * stats.torpFuelMultiplier;
    if (ship.fuel < fuelCost) return;

    const torp = this.gameService.state.allocateTorp(ship.slotIndex);
    if (!torp) return;

    ship.fuel -= fuelCost;
    ship.weaponTemp += stats.torpHeat;

    const rad = directionToRadians(direction);
    const torpVel = stats.torpSpeed * SPEED_SCALE;

    torp.alive = true;
    torp.x = ship.x;
    torp.y = ship.y;
    torp.dx = Math.sin(rad) * torpVel;
    torp.dy = -Math.cos(rad) * torpVel;
    torp.ownerSlot = ship.slotIndex;
    torp.team = ship.team;
    torp.damage = stats.torpDamage;
    torp.ticksRemaining =
      TORP_LIFETIME_BASE + Math.floor(Math.random() * TORP_LIFETIME_VARIANCE);
  }

  private firePlasma(ship: ShipState, direction: number): void {
    if (
      ship.shipType !== ShipType.DD &&
      ship.shipType !== ShipType.CA &&
      ship.shipType !== ShipType.BB &&
      ship.shipType !== ShipType.SB
    )
      return;

    if (ship.kills < PLASMA_MIN_KILLS) return;
    if (ship.weaponBurnoutTicks > 0) return;
    if (ship.fuel < PLASMA_FUEL_COST) return;

    const plasmas = this.gameService.state.plasmas;
    for (let i = 0; i < plasmas.length; i++) {
      if (plasmas[i]!.alive && plasmas[i]!.ownerSlot === ship.slotIndex) return;
    }

    const plasma = this.gameService.state.allocatePlasma();
    if (!plasma) return;

    ship.fuel -= PLASMA_FUEL_COST;
    ship.weaponTemp += PLASMA_HEAT;

    plasma.alive = true;
    plasma.x = ship.x;
    plasma.y = ship.y;
    plasma.direction = direction;
    plasma.ownerSlot = ship.slotIndex;
    plasma.team = ship.team;
    plasma.ticksRemaining = PLASMA_LIFETIME;

    const ships = this.gameService.state.ships;
    let bestTarget = -1;
    let bestDist = PLASMA_LOCK_RANGE;
    for (let i = 0; i < ships.length; i++) {
      const target = ships[i]!;
      if (target.status !== ShipStatus.ALIVE) continue;
      if (target.team === ship.team) continue;
      if (target.cloaked) continue;
      const dist = distance(ship.x, ship.y, target.x, target.y);
      if (dist < bestDist) {
        bestDist = dist;
        bestTarget = target.slotIndex;
      }
    }
    plasma.targetSlot = bestTarget;
  }

  private firePhaser(ship: ShipState, direction: number): void {
    const stats = SHIP_STATS[ship.shipType];

    // Cooldown and burnout check
    if (ship.phaserCooldownTicks > 0) return;
    if (ship.weaponBurnoutTicks > 0) return;

    // Fuel check
    const fuelCost = stats.phaserDamage * stats.phaserFuelMultiplier;
    if (ship.fuel < fuelCost) return;

    ship.fuel -= fuelCost;
    ship.weaponTemp += stats.phaserHeat;
    ship.phaserCooldownTicks = stats.phaserCooldownTicks;

    // Find nearest enemy in roughly that direction, within range
    const ships = this.gameService.state.ships;
    let bestTarget: ShipState | null = null;
    let bestDist = stats.maxPhaserRange;

    for (let i = 0; i < ships.length; i++) {
      const target = ships[i]!;
      if (target.slotIndex === ship.slotIndex) continue;
      if (target.status !== ShipStatus.ALIVE) continue;
      if (target.team === ship.team) continue;

      const dist = distance(ship.x, ship.y, target.x, target.y);
      if (dist > stats.maxPhaserRange) continue;

      // Check if target is roughly in the fired direction
      const targetDir = angleBetween(ship.x, ship.y, target.x, target.y);
      const delta = Math.abs(directionDelta(direction, targetDir));
      // Allow ~45 degree cone (32 direction units)
      if (delta > 32) continue;

      if (dist < bestDist) {
        bestDist = dist;
        bestTarget = target;
      }
    }

    const phaser = this.gameService.state.allocatePhaser(ship.slotIndex);
    phaser.ownerSlot = ship.slotIndex;
    phaser.team = ship.team;
    phaser.x1 = ship.x;
    phaser.y1 = ship.y;
    phaser.ticksRemaining = 3; // visual duration

    if (bestTarget) {
      phaser.x2 = bestTarget.x;
      phaser.y2 = bestTarget.y;
      const dmg = phaserDamage(
        stats.phaserDamage,
        bestDist,
        stats.maxPhaserRange,
      );
      phaser.damage = dmg;
      applyDamage(bestTarget, dmg);
      bestTarget.lastDamagedBySlot = ship.slotIndex;
    } else {
      // Miss — draw phaser line in the fired direction to max range
      const rad = directionToRadians(direction);
      phaser.x2 = ship.x + Math.sin(rad) * stats.maxPhaserRange;
      phaser.y2 = ship.y - Math.cos(rad) * stats.maxPhaserRange;
      phaser.damage = 0;
    }

    // Phaser can destroy enemy plasmas near the hit point
    const plasmaArr = this.gameService.state.plasmas;
    for (let pi = 0; pi < plasmaArr.length; pi++) {
      const p = plasmaArr[pi]!;
      if (!p.alive) continue;
      if (p.team === ship.team) continue;
      const pdist = distance(phaser.x2, phaser.y2, p.x, p.y);
      if (pdist <= PLASMA_HIT_RADIUS) {
        this.explodePlasma(p);
      }
    }
  }

  private detonate(ship: ShipState): void {
    if (ship.weaponBurnoutTicks > 0) return;
    if (ship.fuel < DET_FUEL_COST) return;

    ship.fuel -= DET_FUEL_COST;
    ship.weaponTemp += DET_WEAPON_HEAT;

    const torps = this.gameService.state.torps;
    for (let i = 0; i < torps.length; i++) {
      const torp = torps[i]!;
      if (!torp.alive) continue;
      if (torp.team === ship.team) continue; // Only det enemy torps

      const dist = distance(ship.x, ship.y, torp.x, torp.y);
      if (dist > DET_RANGE) continue;

      this.explodeTorp(torp, "enemy-det", ship.team);
    }

    // Also detonate enemy plasmas in range
    const plasmas = this.gameService.state.plasmas;
    for (let i = 0; i < plasmas.length; i++) {
      const p = plasmas[i]!;
      if (!p.alive) continue;
      if (p.team === ship.team) continue;
      const pdist = distance(ship.x, ship.y, p.x, p.y);
      if (pdist > DET_RANGE) continue;
      this.explodePlasma(p);
    }
  }

  /** Detonate own torpedoes (so player can fire more). */
  private detonateSelf(ship: ShipState): void {
    const torps = this.gameService.state.torps;
    for (let i = 0; i < torps.length; i++) {
      const torp = torps[i]!;
      if (!torp.alive) continue;
      if (torp.ownerSlot !== ship.slotIndex) continue;
      torp.alive = false;
    }
  }

  // -------------------------------------------------------------------------
  // Step 2: Movement
  // -------------------------------------------------------------------------

  private updateMovement(ships: ShipState[]): void {
    for (let i = 0; i < ships.length; i++) {
      const ship = ships[i]!;
      if (ship.status !== ShipStatus.ALIVE) continue;

      // Orbiting ships don't move (except from tractor/pressor)
      if (ship.orbitPlanetId >= 0) continue;

      // Refitting ships don't move
      if (ship.refitTicks > 0) continue;

      // Turn toward desired direction
      const maxTurn = turnRate(ship.shipType, ship.speed);
      const delta = directionDelta(ship.direction, ship.desiredDirection);
      if (delta !== 0) {
        const turn = Math.sign(delta) * Math.min(Math.abs(delta), maxTurn);
        ship.direction = (ship.direction + turn) & 0xff;
      }

      // Accelerate/decelerate
      const maxWarp = maxWarpForHull(ship.shipType, ship.hullDamage);
      const clampedDesired = Math.min(ship.desiredSpeed, maxWarp);
      ship.speed = accelerate(ship.speed, clampedDesired, ship.shipType);

      // Move
      moveShip(ship);
    }
  }

  // -------------------------------------------------------------------------
  // Step 3: Torpedoes
  // -------------------------------------------------------------------------

  private updateTorpedoes(): void {
    const state = this.gameService.state;
    const torps = state.torps;
    const ships = state.ships;

    for (let i = 0; i < torps.length; i++) {
      const torp = torps[i]!;
      if (!torp.alive) continue;

      const moveResult = moveTorp(torp);
      if (moveResult !== TORP_ALIVE) {
        if (moveResult === TORP_WALL) {
          this.explodeTorp(torp, "wall");
        } else {
          torp.alive = false;
        }
        continue;
      }

      // Check collision with enemy ships
      for (let j = 0; j < ships.length; j++) {
        const target = ships[j]!;
        if (target.status !== ShipStatus.ALIVE) continue;
        if (target.slotIndex === torp.ownerSlot) continue;
        if (target.team === torp.team) continue;

        const dist = distance(torp.x, torp.y, target.x, target.y);
        if (dist <= TORP_HIT_RADIUS) {
          this.explodeTorp(torp, "impact");
          break;
        }
      }

      // Check collision with plasmas (torps can destroy plasmas)
      if (torp.alive) {
        const plasmas = state.plasmas;
        for (let k = 0; k < plasmas.length; k++) {
          const p = plasmas[k]!;
          if (!p.alive) continue;
          if (p.team === torp.team) continue;
          const pdist = distance(torp.x, torp.y, p.x, p.y);
          if (pdist <= PLASMA_HIT_RADIUS) {
            torp.alive = false;
            this.explodePlasma(p);
            break;
          }
        }
      }
    }
  }

  private explodeTorp(
    torp: TorpState,
    cause: "impact" | "wall" | "enemy-det",
    detonatorTeam?: Team,
  ): void {
    torp.alive = false;

    const state = this.gameService.state;
    const ships = state.ships;

    for (let i = 0; i < ships.length; i++) {
      const target = ships[i]!;
      if (target.status !== ShipStatus.ALIVE) continue;
      if (target.slotIndex === torp.ownerSlot) continue;

      // Wall hit: only damages enemies of the firer
      if (cause === "wall" && target.team === torp.team) continue;
      // Enemy det: doesn't hurt detonator's teammates
      if (
        cause === "enemy-det" &&
        detonatorTeam !== undefined &&
        target.team === detonatorTeam
      )
        continue;

      const dist = distance(torp.x, torp.y, target.x, target.y);
      const dmg = torpSplashDamage(torp.damage, dist);
      if (dmg > 0) {
        applyDamage(target, dmg);
        target.lastDamagedBySlot = torp.ownerSlot;
      }
    }

    // Visual explosion
    const expl = state.allocateExplosion();
    if (expl) {
      expl.alive = true;
      expl.x = torp.x;
      expl.y = torp.y;
      expl.radius = 0;
      expl.maxRadius = 400;
      expl.ticksRemaining = 8;
    }
  }

  // -------------------------------------------------------------------------
  // Step 3b: Plasmas
  // -------------------------------------------------------------------------

  private updatePlasmas(): void {
    const state = this.gameService.state;
    const plasmas = state.plasmas;
    const ships = state.ships;

    for (let i = 0; i < plasmas.length; i++) {
      const p = plasmas[i]!;
      if (!p.alive) continue;

      p.ticksRemaining--;
      if (p.ticksRemaining <= 0) {
        this.explodePlasma(p);
        continue;
      }

      // Tracking — steer toward target
      if (p.targetSlot >= 0) {
        const target = ships[p.targetSlot]!;
        if (target.status !== ShipStatus.ALIVE || target.cloaked) {
          p.targetSlot = -1;
        } else {
          const targetDir = angleBetween(p.x, p.y, target.x, target.y);
          let diff = targetDir - p.direction;
          if (diff > 128) diff -= 256;
          if (diff < -128) diff += 256;
          if (Math.abs(diff) <= PLASMA_TURN_RATE) {
            p.direction = targetDir;
          } else {
            p.direction =
              (p.direction +
                (diff > 0 ? PLASMA_TURN_RATE : -PLASMA_TURN_RATE) +
                256) %
              256;
          }
        }
      }

      // Move
      const rad = directionToRadians(p.direction);
      const vel = PLASMA_SPEED * SPEED_SCALE;
      p.x += Math.sin(rad) * vel;
      p.y += -Math.cos(rad) * vel;

      // Out of bounds = die
      if (p.x < 0 || p.x > GALAXY_WIDTH || p.y < 0 || p.y > GALAXY_HEIGHT) {
        p.alive = false;
        continue;
      }

      // Check collision with ships
      for (let j = 0; j < ships.length; j++) {
        const target = ships[j]!;
        if (target.status !== ShipStatus.ALIVE) continue;
        if (target.slotIndex === p.ownerSlot) continue;

        const dist = distance(p.x, p.y, target.x, target.y);
        if (dist <= PLASMA_HIT_RADIUS) {
          this.explodePlasma(p);
          break;
        }
      }
    }
  }

  private explodePlasma(plasma: PlasmaState): void {
    plasma.alive = false;

    const state = this.gameService.state;
    const ships = state.ships;

    for (let i = 0; i < ships.length; i++) {
      const target = ships[i]!;
      if (target.status !== ShipStatus.ALIVE) continue;

      const dist = distance(plasma.x, plasma.y, target.x, target.y);
      if (dist > PLASMA_SPLASH_RADIUS) continue;

      const dmg = PLASMA_DAMAGE * (1 - dist / PLASMA_SPLASH_RADIUS);
      if (dmg > 0) {
        applyDamage(target, dmg);
        target.lastDamagedBySlot = plasma.ownerSlot;
      }
    }

    const expl = state.allocateExplosion();
    if (expl) {
      expl.alive = true;
      expl.x = plasma.x;
      expl.y = plasma.y;
      expl.radius = 0;
      expl.maxRadius = 800;
      expl.ticksRemaining = 12;
    }
  }

  // -------------------------------------------------------------------------
  // Step 4: Phaser cooldowns
  // -------------------------------------------------------------------------

  private updatePhaserCooldowns(ships: ShipState[]): void {
    for (let i = 0; i < ships.length; i++) {
      const ship = ships[i]!;
      if (ship.phaserCooldownTicks > 0) {
        ship.phaserCooldownTicks--;
      }
    }

    // Decay phaser visuals
    const phasers = this.gameService.state.phasers;
    for (let i = 0; i < phasers.length; i++) {
      const p = phasers[i]!;
      if (!p.alive) continue;
      p.ticksRemaining--;
      if (p.ticksRemaining <= 0) {
        p.alive = false;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Step 5: Planets (army growth)
  // -------------------------------------------------------------------------

  private updatePlanets(planets: PlanetState[], currentTick: number): void {
    for (let i = 0; i < planets.length; i++) {
      const planet = planets[i]!;

      // Neutral planets don't grow
      if ((planet.team as number) === TEAM_NEUTRAL) continue;

      // Army pop check every ARMY_POP_INTERVAL ticks
      if (currentTick - planet.lastPopTick < ARMY_POP_INTERVAL) continue;
      planet.lastPopTick = currentTick;

      const isAgri = (planet.features & PlanetFeature.AGRICULTURAL) !== 0;

      // Normal pop: 10% chance to add 1-3 armies
      if (Math.random() < ARMY_POP_CHANCE) {
        planet.armies += 1 + Math.floor(Math.random() * ARMY_POP_MAX);
      }

      // Low-army bonus: 5% extra chance of +1 when below threshold
      if (
        planet.armies < ARMY_POP_LOW_THRESHOLD &&
        Math.random() < ARMY_POP_LOW_BONUS
      ) {
        planet.armies += 1;
      }

      // Agricultural bonus: 20% chance of +1, guaranteed +1 when below threshold
      if (isAgri) {
        if (planet.armies < ARMY_POP_LOW_THRESHOLD) {
          planet.armies += 1;
        } else if (Math.random() < ARMY_POP_AGRI_CHANCE) {
          planet.armies += 1;
        }
      }

      // Plague: random army loss that scales with army count
      let plagueChance = PLAGUE_CHANCE;
      if (planet.armies > PLAGUE_SCALING_THRESHOLD) {
        plagueChance +=
          (planet.armies - PLAGUE_SCALING_THRESHOLD) * PLAGUE_SCALING_PER_ARMY;
      }
      if (Math.random() < plagueChance) {
        const lossPct =
          PLAGUE_LOSS_PCT_MIN +
          Math.random() * (PLAGUE_LOSS_PCT_MAX - PLAGUE_LOSS_PCT_MIN);
        const loss = Math.max(
          PLAGUE_MIN_LOSS,
          Math.floor(planet.armies * lossPct),
        );
        planet.armies = Math.max(1, planet.armies - loss);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Step 11: Ship systems (with orbit bonuses)
  // -------------------------------------------------------------------------

  private updateShipSystems(ships: ShipState[], planets: PlanetState[]): void {
    for (let i = 0; i < ships.length; i++) {
      const ship = ships[i]!;
      if (ship.status !== ShipStatus.ALIVE) continue;

      updateEngineTemp(ship);
      updateWeaponTemp(ship);

      // Fuel — apply orbit bonus before standard update
      if (ship.orbitPlanetId >= 0) {
        const planet = planets[ship.orbitPlanetId];
        if (
          planet &&
          planet.team === ship.team &&
          planet.features & PlanetFeature.FUEL
        ) {
          // Orbiting friendly fuel planet: 8x recharge (standard is 2x, so add 6x more)
          const stats = SHIP_STATS[ship.shipType];
          ship.fuel += stats.fuelRecharge * 6;
        }
      }
      if (ship.dockedAt >= 0) {
        const dockedStats = SHIP_STATS[ship.shipType];
        ship.fuel += dockedStats.fuelRecharge * (DOCK_FUEL_RECHARGE_MULT - 2);
      }
      updateFuel(ship);

      // Repair — orbit bonus is always +repair*4 in thousandths, independent of repair mode
      if (ship.orbitPlanetId >= 0) {
        const planet = planets[ship.orbitPlanetId];
        if (
          planet &&
          planet.team === ship.team &&
          planet.features & PlanetFeature.REPAIR
        ) {
          const stats = SHIP_STATS[ship.shipType];
          const shieldGain =
            (stats.shieldRepairRate * 4 * stats.maxShields) / 1000;
          const hullGain = (stats.hullRepairRate * 4 * stats.maxHull) / 1000;
          if (ship.shieldStrength < stats.maxShields) {
            ship.shieldStrength = Math.min(
              stats.maxShields,
              ship.shieldStrength + shieldGain,
            );
          }
          if (!ship.shieldsUp && ship.hullDamage > 0) {
            ship.hullDamage = Math.max(0, ship.hullDamage - hullGain);
          }
        }
      }
      if (ship.dockedAt >= 0) {
        const dockedStats = SHIP_STATS[ship.shipType];
        const dockShieldGain =
          (dockedStats.shieldRepairRate *
            (DOCK_SHIELD_REPAIR_MULT - 2) *
            dockedStats.maxShields) /
          1000;
        if (ship.shieldStrength < dockedStats.maxShields) {
          ship.shieldStrength = Math.min(
            dockedStats.maxShields,
            ship.shieldStrength + dockShieldGain,
          );
        }
      }
      updateRepair(ship);
    }
  }

  // -------------------------------------------------------------------------
  // Deaths and explosions
  // -------------------------------------------------------------------------

  private checkDeaths(ships: ShipState[]): void {
    const state = this.gameService.state;

    for (let i = 0; i < ships.length; i++) {
      const ship = ships[i]!;
      if (ship.status !== ShipStatus.ALIVE) continue;

      const stats = SHIP_STATS[ship.shipType];
      if (ship.hullDamage >= stats.maxHull) {
        // Award kill credit to the last ship that damaged this one
        // Kill value = 1.0 + 0.1*(victim's kills) + 0.1*(victim's armies)
        if (ship.lastDamagedBySlot >= 0) {
          const killer = ships[ship.lastDamagedBySlot];
          if (killer && killer.status === ShipStatus.ALIVE) {
            killer.kills += 1.0 + 0.1 * ship.kills + 0.1 * ship.armies;
          }
        }

        // Ship dies
        ship.status = ShipStatus.EXPLODING;

        // Force-undock all ships docked at this ship (if it's an SB)
        for (let d = ship.dockedShips.length - 1; d >= 0; d--) {
          const dockedSlot = ship.dockedShips[d]!;
          const dockedShip = ships[dockedSlot]!;
          if (dockedShip.dockedAt === ship.slotIndex) {
            dockedShip.dockedAt = -1;
          }
        }
        ship.dockedShips.length = 0;

        // Also undock this ship if it was docked somewhere
        if (ship.dockedAt >= 0) {
          this.undock(ship);
        }

        if (ship.shipType === ShipType.SB) {
          this.gameService.startSbCooldown(ship.team);
        }
        const armiesLost = ship.armies;
        const killerSlot = ship.lastDamagedBySlot;
        const killerShip = killerSlot >= 0 ? ships[killerSlot] : undefined;
        this.eventEmitter.emit(GAME_KILL_EVENT, {
          killerSlot: killerSlot,
          killerName: killerShip?.playerId ?? "",
          killerShipType: killerShip?.shipType ?? 0,
          killerTeam: killerShip?.team ?? 0,
          victimSlot: ship.slotIndex,
          victimName: ship.playerId,
          victimShipType: ship.shipType,
          victimTeam: ship.team,
          armiesLost,
          tick: state.currentTick,
        } satisfies KillEvent);
        if (!ship.playerId.startsWith("bot:")) {
          this.statReporter.recordDeath(ship.playerId);
        }
        if (
          ship.lastDamagedBySlot >= 0 &&
          ships[ship.lastDamagedBySlot] &&
          !ships[ship.lastDamagedBySlot]!.playerId.startsWith("bot:")
        ) {
          this.statReporter.recordKill(ships[ship.lastDamagedBySlot]!.playerId);
        }
        if (ship.lastDamagedBySlot >= 0) {
          this.gameService.recordSessionKill(ship.lastDamagedBySlot);
        }
        ship.explodeTicks = EXPLOSION_DURATION_TICKS;
        ship.speed = 0;
        ship.desiredSpeed = 0;
        ship.orbitPlanetId = -1;
        ship.bombing = false;
        ship.beaming = 0;
        ship.cloaked = false;
        ship.tractorTarget = -1;
        ship.pressorTarget = -1;
        ship.lockType = LockType.NONE;
        ship.lockTargetId = -1;

        // Armies on board are lost
        ship.armies = 0;
        ship.lastDamagedBySlot = -1;

        // Ship explosion damages nearby ships
        for (let j = 0; j < ships.length; j++) {
          const target = ships[j]!;
          if (target.slotIndex === ship.slotIndex) continue;
          if (target.status !== ShipStatus.ALIVE) continue;

          const dist = distance(ship.x, ship.y, target.x, target.y);
          const dmg = explosionDamage(stats.explosionDamage, dist);
          if (dmg > 0) {
            applyDamage(target, dmg);
          }
        }

        // Visual explosion
        const expl = state.allocateExplosion();
        if (expl) {
          expl.alive = true;
          expl.x = ship.x;
          expl.y = ship.y;
          expl.radius = 0;
          expl.maxRadius = EXPLOSION_OUTER_RADIUS;
          expl.ticksRemaining = EXPLOSION_DURATION_TICKS;
        }
      }
    }
  }

  private updateExplosions(): void {
    const state = this.gameService.state;

    // Ship explosion timers
    for (let i = 0; i < state.ships.length; i++) {
      const ship = state.ships[i]!;
      if (ship.status !== ShipStatus.EXPLODING) continue;
      ship.explodeTicks--;
      if (ship.explodeTicks <= 0) {
        ship.status = ShipStatus.DEAD;
        ship.deathTick = state.currentTick;
      }
    }

    // Visual explosions
    for (let i = 0; i < state.explosions.length; i++) {
      const expl = state.explosions[i]!;
      if (!expl.alive) continue;
      expl.ticksRemaining--;
      // Expand radius
      const totalTicks = EXPLOSION_DURATION_TICKS;
      const elapsed = totalTicks - expl.ticksRemaining;
      expl.radius = (elapsed / totalTicks) * expl.maxRadius;
      if (expl.ticksRemaining <= 0) {
        expl.alive = false;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Alert status
  // -------------------------------------------------------------------------

  private computeAlertStatuses(ships: ShipState[]): void {
    for (let i = 0; i < ships.length; i++) {
      const ship = ships[i]!;
      if (ship.status !== ShipStatus.ALIVE) {
        this.alertStatuses[i] = AlertStatus.GREEN;
        continue;
      }

      let minDist = Infinity;
      for (let j = 0; j < ships.length; j++) {
        const other = ships[j]!;
        if (other.slotIndex === ship.slotIndex) continue;
        if (other.status !== ShipStatus.ALIVE) continue;
        if (other.team === ship.team) continue;

        const d = distance(ship.x, ship.y, other.x, other.y);
        if (d < minDist) minDist = d;
      }

      if (minDist <= RED_ALERT_DIST) {
        this.alertStatuses[i] = AlertStatus.RED;
      } else if (minDist <= YELLOW_ALERT_DIST) {
        this.alertStatuses[i] = AlertStatus.YELLOW;
      } else {
        this.alertStatuses[i] = AlertStatus.GREEN;
      }
    }
  }

  // -------------------------------------------------------------------------
  // T-Mode
  // -------------------------------------------------------------------------

  private updateTMode(ships: ShipState[]): void {
    // Count all players per team (dead players still count — they'll respawn)
    const teamCounts = [0, 0, 0, 0];
    for (let i = 0; i < ships.length; i++) {
      const ship = ships[i]!;
      if (!ship.playerId) continue;
      teamCounts[ship.team] = (teamCounts[ship.team] ?? 0) + 1;
    }

    // T-Mode activates when at least 2 teams have TMODE_MIN_PLAYERS
    let teamsWithEnough = 0;
    for (let t = 0; t < 4; t++) {
      if (teamCounts[t]! >= TMODE_MIN_PLAYERS) teamsWithEnough++;
    }

    const wasTmode = this.tmode;
    this.tmode = teamsWithEnough >= 2;
    if (this.tmode && !wasTmode) {
      this.logger.log("T-Mode activated!");
    } else if (!this.tmode && wasTmode) {
      this.logger.log("T-Mode deactivated");
      // Stop all bombing and beaming
      for (let i = 0; i < ships.length; i++) {
        ships[i]!.bombing = false;
        ships[i]!.beaming = 0;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Planet scanning (fog of war)
  // -------------------------------------------------------------------------

  private updatePlanetScanning(state: {
    ships: ShipState[];
    planets: PlanetState[];
    planetKnowledge: {
      team: number;
      armies: number;
      features: number;
      lastScannedTick: number;
    }[][];
    currentTick: number;
  }): void {
    const ships = state.ships;
    const planets = state.planets;
    const knowledge = state.planetKnowledge;
    const tick = state.currentTick;

    for (let pi = 0; pi < planets.length; pi++) {
      const planet = planets[pi]!;
      const scannedBy = [false, false, false, false];

      for (let si = 0; si < ships.length; si++) {
        const ship = ships[si]!;
        if (ship.status !== ShipStatus.ALIVE) continue;
        const teamIdx = ship.team as number;
        if (scannedBy[teamIdx]) continue;

        const dist = distance(ship.x, ship.y, planet.x, planet.y);
        if (dist <= SCAN_RANGE) {
          scannedBy[teamIdx] = true;
        }
      }

      for (let t = 0; t < 4; t++) {
        if (!scannedBy[t]) continue;
        const k = knowledge[t]![pi]!;
        k.team = planet.team as number;
        k.armies = planet.armies;
        k.features = planet.features;
        k.lastScannedTick = tick;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Win condition
  // -------------------------------------------------------------------------

  private checkWinCondition(planets: PlanetState[]): void {
    if (!this.tmode) return;

    const teamPlanets = [0, 0, 0, 0];
    for (let i = 0; i < planets.length; i++) {
      const t = planets[i]!.team as number;
      if (t >= 0 && t < 4) teamPlanets[t] = (teamPlanets[t] ?? 0) + 1;
    }

    for (let t = 0; t < 4; t++) {
      // Only check teams that have players
      const ships = this.gameService.state.ships;
      let hadPlayers = false;
      for (let i = 0; i < ships.length; i++) {
        if (ships[i]!.team === t && ships[i]!.playerId) {
          hadPlayers = true;
          break;
        }
      }
      if (!hadPlayers) continue;

      // Genocide — team has 0 planets
      if (teamPlanets[t] === 0) {
        const winTeam = this.findWinningTeam(teamPlanets, t);
        this.triggerWin(winTeam, t, "genocide");
        return;
      }

      // Surrender timer logic
      if (teamPlanets[t]! <= SURRENDER_PLANET_THRESHOLD) {
        if (this.surrenderTimers[t] === 0) {
          // Start timer
          this.surrenderTimers[t] = SURRENDER_TIMER_TICKS;
          this.logger.log(
            `Team ${Team[t]} down to ${teamPlanets[t]} planets — 20min surrender timer started`,
          );
        } else {
          // Decrement timer
          this.surrenderTimers[t]!--;
          if (this.surrenderTimers[t]! <= 0) {
            const winTeam = this.findWinningTeam(teamPlanets, t);
            this.triggerWin(winTeam, t, "timercide");
            return;
          }
        }
      } else if (teamPlanets[t]! >= SURRENDER_CLEAR_PLANETS) {
        // Out of danger — clear timer
        if (this.surrenderTimers[t]! > 0) {
          this.logger.log(
            `Team ${Team[t]} back to ${teamPlanets[t]} planets — surrender timer cleared`,
          );
          this.surrenderTimers[t] = 0;
        }
      } else if (teamPlanets[t]! >= SURRENDER_FREEZE_PLANETS) {
        // Timer frozen (don't decrement, but don't clear either)
        // Just don't do anything — timer stays where it is
      }
    }
  }

  private findWinningTeam(teamPlanets: number[], losingTeam: number): number {
    let best = -1;
    let bestCount = 0;
    for (let t = 0; t < 4; t++) {
      if (t === losingTeam) continue;
      if ((teamPlanets[t] ?? 0) > bestCount) {
        bestCount = teamPlanets[t] ?? 0;
        best = t;
      }
    }
    return best;
  }

  private triggerWin(
    winningTeam: number,
    losingTeam: number,
    type: string,
  ): void {
    this.logger.log(
      `${type.toUpperCase()}! Team ${Team[losingTeam]} eliminated. Team ${Team[winningTeam]} wins!`,
    );
    this.winPauseTicks = this.botConfig.winPauseTicks;
    this.winningTeam = winningTeam;
    this.eventEmitter.emit(GAME_WIN_EVENT, { losingTeam, winningTeam, type });
  }

  // -------------------------------------------------------------------------
  // Game reset
  // -------------------------------------------------------------------------

  private resetGame(): void {
    this.logger.log("Resetting game...");
    this.gameService.state.resetGame();
    this.tmode = false;
    this.winningTeam = -1;
    this.surrenderTimers.fill(0);
    this.gameService.sbCooldownExpiresTick[Team.FEDERATION] = 0;
    this.gameService.sbCooldownExpiresTick[Team.ROMULANS] = 0;
    this.botManager.resetForNewGame();
    this.eventEmitter.emit(GAME_RESET_EVENT);
    this.logger.log("Game reset complete");
  }
}

import {
  type ClientShip,
  type ClientTorp,
  type ClientSelfExtra,
  type ClientGameState,
  type PlayerInput,
  BotDifficulty,
  InputCommand,
  Team,
  ShipStatus,
  distance,
  SHIP_STATS,
} from "@netrek/shared";
import {
  type CombatState,
  CombatPhase,
  COMBAT_ENGAGE_DIST,
  COMBAT_EXIT_TICKS,
  MIN_COMBAT_DIST,
  MAX_COMBAT_DIST,
  MIN_SPEED_HOLD_TICKS,
  MIN_DIR_HOLD_TICKS,
  TORP_DANGER_DIST,
  SHIELDS_DOWN_SAFE_DIST,
  NEWBIE_SHIELD_REACT_TICKS,
} from "./bot-types";
import {
  leadTarget,
  countTorpsInFlight,
  shouldFireTorpDisciplined,
  shouldFirePhaser,
  shouldDetEnemyTorps,
  shouldStopTorpTemp,
  shouldStopAllTemp,
  selectTarget,
} from "./bot-combat";
import { directionTo } from "./bot-navigation";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Create initial combat state. */
export function createCombatState(): CombatState {
  return {
    phase: CombatPhase.NONE,
    targetSlot: -1,
    ticksSinceLastThreat: 0,
    lastSpeedChangeTick: 0,
    lastDirectionChangeTick: 0,
    currentManeuverSpeed: 0,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Gather alive enemy ships visible in the game state. */
function getAliveEnemies(
  ships: ClientShip[],
  myTeam: Team,
  mySlot: number,
): ClientShip[] {
  const result: ClientShip[] = [];
  for (const s of ships) {
    if (s.slotIndex === mySlot) continue;
    if (s.team === myTeam) continue;
    if (s.status !== ShipStatus.ALIVE) continue;
    result.push(s);
  }
  return result;
}

/** Find closest enemy within a given range. */
function closestEnemyInRange(
  x: number,
  y: number,
  enemies: ClientShip[],
  range: number,
): ClientShip | null {
  let best: ClientShip | null = null;
  let bestDist = Infinity;
  for (const e of enemies) {
    const d = distance(x, y, e.x, e.y);
    if (d <= range && d < bestDist) {
      bestDist = d;
      best = e;
    }
  }
  return best;
}

/** Find nearest enemy torp that is dangerously close. */
function nearestDangerousTorp(
  x: number,
  y: number,
  torps: ClientTorp[],
  myTeam: Team,
  dangerDist: number,
): ClientTorp | null {
  if (dangerDist <= 0) return null;
  let best: ClientTorp | null = null;
  let bestDist = Infinity;
  for (const t of torps) {
    if (t.team === myTeam) continue;
    const d = distance(x, y, t.x, t.y);
    if (d <= dangerDist && d < bestDist) {
      bestDist = d;
      best = t;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Main combat update — called every tick.
 * Returns null if not in combat, or an array of PlayerInput when in combat.
 */
export function updateCombat(
  state: ClientGameState,
  mySelf: ClientShip,
  self: ClientSelfExtra,
  combat: CombatState,
  difficulty: BotDifficulty,
  myTeam: Team,
  enemyTeam: Team,
  tick: number,
): PlayerInput[] | null {
  const enemies = getAliveEnemies(state.ships, myTeam, mySelf.slotIndex);
  const nearest = closestEnemyInRange(
    mySelf.x,
    mySelf.y,
    enemies,
    COMBAT_ENGAGE_DIST,
  );

  // --- Phase transitions ---
  switch (combat.phase) {
    case CombatPhase.NONE: {
      if (nearest === null) {
        return null;
      }
      // Enter combat
      combat.phase = CombatPhase.ENGAGED;
      combat.targetSlot = nearest.slotIndex;
      combat.ticksSinceLastThreat = 0;
      break;
    }
    case CombatPhase.ENGAGED: {
      if (nearest === null) {
        // No enemies in range — start disengaging
        combat.phase = CombatPhase.DISENGAGING;
        combat.ticksSinceLastThreat = 1;
      } else {
        combat.ticksSinceLastThreat = 0;
        // Re-evaluate target
        const target = selectTarget(mySelf.x, mySelf.y, enemies, difficulty);
        if (target !== null) {
          combat.targetSlot = target.slotIndex;
        }
      }
      break;
    }
    case CombatPhase.DISENGAGING: {
      if (nearest !== null) {
        // Re-engage
        combat.phase = CombatPhase.ENGAGED;
        combat.ticksSinceLastThreat = 0;
        combat.targetSlot = nearest.slotIndex;
      } else {
        combat.ticksSinceLastThreat++;
        if (combat.ticksSinceLastThreat >= COMBAT_EXIT_TICKS) {
          // Exit combat
          combat.phase = CombatPhase.NONE;
          combat.targetSlot = -1;
          combat.ticksSinceLastThreat = 0;
          return null;
        }
      }
      break;
    }
  }

  // --- In combat: gather inputs from sub-systems ---
  const inputs: PlayerInput[] = [];

  // Find the actual target ship (may have died)
  let target: ClientShip | null = null;
  for (const e of enemies) {
    if (e.slotIndex === combat.targetSlot) {
      target = e;
      break;
    }
  }
  // If target died or left, pick a new one
  if (target === null) {
    target = selectTarget(mySelf.x, mySelf.y, enemies, difficulty);
    if (target !== null) {
      combat.targetSlot = target.slotIndex;
    }
  }

  // Shields
  const shieldInputs = combatShieldLogic(
    mySelf,
    self,
    enemies,
    difficulty,
    tick,
  );
  for (const inp of shieldInputs) inputs.push(inp);

  // Movement
  if (target !== null) {
    const moveInputs = combatMovement(
      mySelf,
      target,
      state.torps,
      combat,
      difficulty,
      tick,
      myTeam,
    );
    for (const inp of moveInputs) inputs.push(inp);
  }

  // Weapons
  if (target !== null) {
    const weaponInputs = combatWeapons(
      mySelf,
      self,
      target,
      state.torps,
      difficulty,
      tick,
    );
    for (const inp of weaponInputs) inputs.push(inp);
  }

  // Tractor / Pressor
  if (target !== null) {
    const tractorInputs = combatTractorPressor(
      mySelf,
      target,
      difficulty,
      tick,
    );
    for (const inp of tractorInputs) inputs.push(inp);
  }

  // Det enemy torps
  if (
    shouldDetEnemyTorps(mySelf.x, mySelf.y, state.torps, myTeam, difficulty)
  ) {
    inputs.push({ command: InputCommand.DETONATE, tick, value: 0 });
  }

  return inputs;
}

// ---------------------------------------------------------------------------
// Shield logic
// ---------------------------------------------------------------------------

/**
 * Shield management per difficulty.
 * NEWBIE: drops shields when no enemies on scan, slow to raise.
 * COMPETENT+: shields up during combat by default.
 */
export function combatShieldLogic(
  mySelf: ClientShip,
  _self: ClientSelfExtra,
  enemies: ClientShip[],
  difficulty: BotDifficulty,
  tick: number,
): PlayerInput[] {
  const inputs: PlayerInput[] = [];

  if (difficulty === BotDifficulty.NEWBIE) {
    // Check if any enemy is within safe distance
    let enemyNearby = false;
    for (const e of enemies) {
      if (distance(mySelf.x, mySelf.y, e.x, e.y) <= SHIELDS_DOWN_SAFE_DIST) {
        enemyNearby = true;
        break;
      }
    }

    if (enemyNearby && !mySelf.shieldsUp) {
      // Slow to raise — only raise if tick aligns with react delay
      // We use a simple modulo check to simulate delayed reaction
      if (tick % NEWBIE_SHIELD_REACT_TICKS === 0) {
        inputs.push({ command: InputCommand.SHIELD_TOGGLE, tick, value: 0 });
      }
    } else if (!enemyNearby && mySelf.shieldsUp) {
      inputs.push({ command: InputCommand.SHIELD_TOGGLE, tick, value: 0 });
    }
  } else {
    // COMPETENT / VETERAN: shields up during combat
    if (!mySelf.shieldsUp) {
      inputs.push({ command: InputCommand.SHIELD_TOGGLE, tick, value: 0 });
    }
  }

  return inputs;
}

// ---------------------------------------------------------------------------
// Combat movement
// ---------------------------------------------------------------------------

/**
 * Purposeful combat movement: speed and direction changes with hold timers.
 * Includes torp evasion for COMPETENT+.
 */
export function combatMovement(
  mySelf: ClientShip,
  target: ClientShip,
  torps: ClientTorp[],
  combat: CombatState,
  difficulty: BotDifficulty,
  tick: number,
  myTeam: Team,
): PlayerInput[] {
  const inputs: PlayerInput[] = [];
  const dist = distance(mySelf.x, mySelf.y, target.x, target.y);
  const dangerDist = TORP_DANGER_DIST[difficulty];

  // --- Torp evasion (COMPETENT+ only) ---
  const dangerTorp = nearestDangerousTorp(
    mySelf.x,
    mySelf.y,
    torps,
    myTeam,
    dangerDist,
  );
  if (dangerTorp !== null) {
    // Dodge perpendicular to the torp's approach direction
    const torpDir = directionTo(dangerTorp.x, dangerTorp.y, mySelf.x, mySelf.y);
    const dodgeDir = (torpDir + 64) & 0xff; // 90 degrees perpendicular
    inputs.push({ command: InputCommand.SET_DIRECTION, tick, value: dodgeDir });
    inputs.push({ command: InputCommand.SET_SPEED, tick, value: 7 });
    combat.lastDirectionChangeTick = tick;
    combat.lastSpeedChangeTick = tick;
    combat.currentManeuverSpeed = 7;
    return inputs;
  }

  // --- NEWBIE: constant speed 6, direct approach ---
  if (difficulty === BotDifficulty.NEWBIE) {
    const dir = directionTo(mySelf.x, mySelf.y, target.x, target.y);
    inputs.push({ command: InputCommand.SET_DIRECTION, tick, value: dir });
    inputs.push({ command: InputCommand.SET_SPEED, tick, value: 6 });
    return inputs;
  }

  // --- Speed hold timing ---
  const speedHoldTicks = MIN_SPEED_HOLD_TICKS[difficulty];
  const dirHoldTicks = MIN_DIR_HOLD_TICKS[difficulty];
  const canChangeSpeed = tick - combat.lastSpeedChangeTick >= speedHoldTicks;
  const canChangeDir = tick - combat.lastDirectionChangeTick >= dirHoldTicks;

  // --- Range-based movement ---
  if (dist < MIN_COMBAT_DIST) {
    // Too close: turn away
    if (canChangeDir) {
      const awayDir = directionTo(target.x, target.y, mySelf.x, mySelf.y);
      inputs.push({
        command: InputCommand.SET_DIRECTION,
        tick,
        value: awayDir,
      });
      combat.lastDirectionChangeTick = tick;
    }
    if (canChangeSpeed) {
      inputs.push({ command: InputCommand.SET_SPEED, tick, value: 5 });
      combat.lastSpeedChangeTick = tick;
      combat.currentManeuverSpeed = 5;
    }
  } else if (dist > MAX_COMBAT_DIST) {
    // Too far: close in
    if (canChangeDir) {
      const toDir = directionTo(mySelf.x, mySelf.y, target.x, target.y);
      inputs.push({ command: InputCommand.SET_DIRECTION, tick, value: toDir });
      combat.lastDirectionChangeTick = tick;
    }
    if (canChangeSpeed) {
      inputs.push({ command: InputCommand.SET_SPEED, tick, value: 7 });
      combat.lastSpeedChangeTick = tick;
      combat.currentManeuverSpeed = 7;
    }
  } else {
    // In range: circle strafe
    if (canChangeDir) {
      const toDir = directionTo(mySelf.x, mySelf.y, target.x, target.y);
      const strafeDir = (toDir + 48) & 0xff; // ~67 degrees offset for circling
      inputs.push({
        command: InputCommand.SET_DIRECTION,
        tick,
        value: strafeDir,
      });
      combat.lastDirectionChangeTick = tick;
    }
    if (canChangeSpeed) {
      inputs.push({ command: InputCommand.SET_SPEED, tick, value: 4 });
      combat.lastSpeedChangeTick = tick;
      combat.currentManeuverSpeed = 4;
    }
  }

  return inputs;
}

// ---------------------------------------------------------------------------
// Combat weapons
// ---------------------------------------------------------------------------

/**
 * Weapon firing logic: phasers and torps with temperature checks.
 * Uses mySelf.weaponTemp (from ClientShip), NOT self.engineTemp.
 */
export function combatWeapons(
  mySelf: ClientShip,
  self: ClientSelfExtra,
  target: ClientShip,
  torps: ClientTorp[],
  difficulty: BotDifficulty,
  tick: number,
): PlayerInput[] {
  const inputs: PlayerInput[] = [];
  const stats = SHIP_STATS[mySelf.shipType];
  const dist = distance(mySelf.x, mySelf.y, target.x, target.y);

  // Check weapon temp — use mySelf.weaponTemp (ClientShip), NOT self.engineTemp
  if (shouldStopAllTemp(mySelf.weaponTemp, stats.maxWpnTemp)) {
    return inputs; // Too hot, stop all weapons
  }

  // Phaser
  if (shouldFirePhaser(dist, self)) {
    const phaserDir = directionTo(mySelf.x, mySelf.y, target.x, target.y);
    inputs.push({
      command: InputCommand.FIRE_PHASER,
      tick,
      value: phaserDir,
    });
  }

  // Torps
  if (!shouldStopTorpTemp(mySelf.weaponTemp, stats.maxWpnTemp)) {
    const torpsInFlight = countTorpsInFlight(torps, mySelf.slotIndex);
    if (shouldFireTorpDisciplined(torpsInFlight, dist, self, difficulty)) {
      const torpDir = leadTarget(
        mySelf.x,
        mySelf.y,
        target.x,
        target.y,
        target.direction,
        target.speed,
        stats.torpSpeed,
        difficulty,
      );
      inputs.push({ command: InputCommand.FIRE_TORP, tick, value: torpDir });
    }
  }

  return inputs;
}

// ---------------------------------------------------------------------------
// Tractor / Pressor
// ---------------------------------------------------------------------------

/**
 * Tractor/pressor usage per difficulty.
 * NEWBIE: never.
 * COMPETENT+: pressor when too close.
 * VETERAN: tractor fleeing enemies.
 */
export function combatTractorPressor(
  mySelf: ClientShip,
  target: ClientShip,
  difficulty: BotDifficulty,
  tick: number,
): PlayerInput[] {
  if (difficulty === BotDifficulty.NEWBIE) return [];

  const inputs: PlayerInput[] = [];
  const stats = SHIP_STATS[mySelf.shipType];
  const dist = distance(mySelf.x, mySelf.y, target.x, target.y);
  const tractorRange = stats.tractorRange * 6000;

  // Only act within tractor range
  if (dist > tractorRange) return inputs;

  // Pressor when too close (COMPETENT+)
  if (dist < MIN_COMBAT_DIST) {
    // Don't pressor if already pressoring this target
    if (!mySelf.pressoring || mySelf.pressorTarget !== target.slotIndex) {
      inputs.push({
        command: InputCommand.PRESSOR,
        tick,
        value: target.slotIndex,
      });
    }
    return inputs;
  }

  // Tractor fleeing enemies (VETERAN only)
  if (difficulty === BotDifficulty.VETERAN) {
    // Check if target is heading away from us
    const dirToMe = directionTo(target.x, target.y, mySelf.x, mySelf.y);
    let delta = target.direction - dirToMe;
    // Normalize to -128..127
    delta = ((delta + 128 + 256) % 256) - 128;
    if (delta < 0) delta = -delta;

    // If target heading is > 64 direction units away from facing us, they're fleeing
    if (delta > 64) {
      if (!mySelf.tractoring || mySelf.tractorTarget !== target.slotIndex) {
        inputs.push({
          command: InputCommand.TRACTOR,
          tick,
          value: target.slotIndex,
        });
      }
    }
  }

  return inputs;
}

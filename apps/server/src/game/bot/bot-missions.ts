import {
  type ClientGameState,
  type ClientShip,
  type PlayerInput,
  BotDifficulty,
  InputCommand,
  Team,
  ShipStatus,
  distance,
  ORBIT_DIST,
  ORBIT_MAX_SPEED,
  SHIP_STATS,
  BEAM_MIN_ARMIES,
  PLANET_DEFS,
} from "@netrek/shared";
import { type Mission, type TakePhaseState } from "./bot-types";
import {
  nearestEnemyShip,
  nearestFriendlyPlanet,
  nearestRepairPlanet,
  nearestFuelPlanet,
  directionTo,
} from "./bot-navigation";

// ---------------------------------------------------------------------------
// MissionContext
// ---------------------------------------------------------------------------

export interface MissionContext {
  myX: number;
  myY: number;
  tick: number;
  gs: ClientGameState;
  mySelf: ClientShip;
  difficulty: BotDifficulty;
  team: Team;
  enemyTeam: Team;
  slot: number;
  mission: Mission;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function moveTo(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  speed: number,
  tick: number,
): PlayerInput[] {
  return [
    {
      command: InputCommand.SET_DIRECTION,
      value: directionTo(fromX, fromY, toX, toY),
      tick,
    },
    { command: InputCommand.SET_SPEED, value: speed, tick },
  ];
}

function moveToOrbit(
  fromX: number,
  fromY: number,
  planetX: number,
  planetY: number,
  tick: number,
): PlayerInput[] {
  const dist = distance(fromX, fromY, planetX, planetY);
  if (dist <= ORBIT_DIST * 1.2) {
    return [
      { command: InputCommand.SET_SPEED, value: ORBIT_MAX_SPEED, tick },
      { command: InputCommand.ORBIT, value: 0, tick },
    ];
  }
  const approachSpeed = dist > ORBIT_DIST * 5 ? 6 : 3;
  return moveTo(fromX, fromY, planetX, planetY, approachSpeed, tick);
}

// ---------------------------------------------------------------------------
// 1. executePatrol
// ---------------------------------------------------------------------------

export function executePatrol(ctx: MissionContext): PlayerInput[] {
  const { myX, myY, tick, gs, slot, enemyTeam, team } = ctx;
  const inputs: PlayerInput[] = [];

  // Head toward frontline enemy planets
  const targets: { x: number; y: number; score: number }[] = [];
  for (const p of gs.planets) {
    if (p.team !== enemyTeam) continue;
    const myDist = distance(myX, myY, p.x, p.y);
    if (myDist < ORBIT_DIST * 5) continue; // already here
    let minFriendlyDist = Infinity;
    for (const fp of gs.planets) {
      if (fp.team !== team) continue;
      const d = distance(p.x, p.y, fp.x, fp.y);
      if (d < minFriendlyDist) minFriendlyDist = d;
    }
    targets.push({
      x: p.x,
      y: p.y,
      score: -(minFriendlyDist * 2 + myDist),
    });
  }
  targets.sort((a, b) => b.score - a.score);

  const topN = Math.min(targets.length, 4);
  const pick = topN > 0 ? targets[slot % topN]! : null;

  if (pick) {
    const speed = 5 + (slot % 2); // 5 or 6
    inputs.push(...moveTo(myX, myY, pick.x, pick.y, speed, tick));
    return inputs;
  }

  // No visible enemy planets -- use PLANET_DEFS to push into enemy territory
  const enemyStart = enemyTeam === Team.ROMULANS ? 10 : 0;
  let nearest: { x: number; y: number } | null = null;
  let nearestDist = Infinity;
  for (let i = enemyStart; i < enemyStart + 10; i++) {
    const pd = PLANET_DEFS[i]!;
    const d = distance(myX, myY, pd.x, pd.y);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = pd;
    }
  }
  if (nearest) {
    inputs.push(...moveTo(myX, myY, nearest.x, nearest.y, 6, tick));
  }

  return inputs;
}

// ---------------------------------------------------------------------------
// 2. executeBomb
// ---------------------------------------------------------------------------

export function executeBomb(ctx: MissionContext): PlayerInput[] {
  const { myX, myY, tick, gs, mySelf, difficulty, enemyTeam, mission } = ctx;
  const inputs: PlayerInput[] = [];

  const target = gs.planets.find((p) => p.planetId === mission.targetId);
  if (!target || target.team !== enemyTeam) return [];

  // Planet already bombed down
  if (target.armies < 1) return [];

  const dist = distance(myX, myY, target.x, target.y);
  const atTarget = dist <= ORBIT_DIST * 1.2;

  if (mySelf.orbiting && atTarget) {
    // Orbiting target: bomb it. DO NOT raise shields.
    if (!mySelf.bombing) {
      inputs.push({ command: InputCommand.BOMB, value: 1, tick });
    }
  } else {
    // Navigate toward target
    // Veteran cloaks while approaching if fuel > 3000
    if (
      difficulty === BotDifficulty.VETERAN &&
      !mySelf.cloaked &&
      gs.self.fuel > 3000
    ) {
      inputs.push({ command: InputCommand.CLOAK_TOGGLE, value: 1, tick });
    }
    inputs.push(...moveToOrbit(myX, myY, target.x, target.y, tick));
  }

  return inputs;
}

// ---------------------------------------------------------------------------
// 3. executeTake
// ---------------------------------------------------------------------------

export function executeTake(
  ctx: MissionContext,
  takeState: TakePhaseState,
): PlayerInput[] {
  const { myX, myY, tick, gs, mySelf, difficulty, team, mission } = ctx;
  const inputs: PlayerInput[] = [];

  const targetPlanet = gs.planets.find((p) => p.planetId === mission.targetId);
  if (!targetPlanet || targetPlanet.team === team) return [];

  const stats = SHIP_STATS[mySelf.shipType];
  const capacity = Math.min(
    stats.maxArmies,
    Math.floor(gs.self.kills) * stats.armiesPerKill,
  );

  if (takeState.phase === "pickup") {
    // Find a friendly planet with armies >= BEAM_MIN_ARMIES
    let pickup =
      takeState.pickupPlanetId >= 0
        ? gs.planets.find((p) => p.planetId === takeState.pickupPlanetId)
        : null;
    if (!pickup || pickup.team !== team || pickup.armies < BEAM_MIN_ARMIES) {
      const fresh = nearestFriendlyPlanet(myX, myY, team, gs.planets);
      if (!fresh || fresh.armies < BEAM_MIN_ARMIES) return [];
      takeState.pickupPlanetId = fresh.planetId;
      pickup = fresh;
    }

    const distToPickup = distance(myX, myY, pickup.x, pickup.y);
    const atPickup = distToPickup <= ORBIT_DIST * 1.2;

    if (mySelf.orbiting && atPickup) {
      // DO NOT raise shields while beaming
      if (mySelf.beaming !== 1) {
        inputs.push({ command: InputCommand.BEAM_UP, value: 0, tick });
      }
      // Check if armies loaded
      if (
        gs.self.armies >= capacity ||
        gs.self.armies >= targetPlanet.armies + 1
      ) {
        takeState.phase = "transit";
      }
    } else {
      inputs.push(...moveToOrbit(myX, myY, pickup.x, pickup.y, tick));
    }

    return inputs;
  }

  if (takeState.phase === "transit") {
    // Navigate to target planet. Shields up. NO cloaking. Speed 6.
    if (!mySelf.shieldsUp) {
      inputs.push({ command: InputCommand.SHIELD_TOGGLE, value: 1, tick });
    }
    inputs.push(...moveTo(myX, myY, targetPlanet.x, targetPlanet.y, 6, tick));

    // Check if we're close enough to transition to approach
    const distToTarget = distance(myX, myY, targetPlanet.x, targetPlanet.y);
    if (distToTarget <= ORBIT_DIST * 10) {
      takeState.phase = "approach";
    }

    return inputs;
  }

  // approach / drop phase
  const distToTarget = distance(myX, myY, targetPlanet.x, targetPlanet.y);

  if (mySelf.orbiting && distToTarget <= ORBIT_DIST * 1.2) {
    // DO NOT raise shields while beaming
    if (mySelf.beaming !== 2) {
      inputs.push({ command: InputCommand.BEAM_DOWN, value: 0, tick });
    }
    // Mission complete when all armies dropped
    if (gs.self.armies === 0) return [];
  } else {
    // Cloak if fuel allows
    if (
      difficulty >= BotDifficulty.COMPETENT &&
      !mySelf.cloaked &&
      gs.self.fuel > 3000
    ) {
      inputs.push({ command: InputCommand.CLOAK_TOGGLE, value: 1, tick });
    }
    inputs.push(...moveToOrbit(myX, myY, targetPlanet.x, targetPlanet.y, tick));
  }

  return inputs;
}

// ---------------------------------------------------------------------------
// 4. executeEscort
// ---------------------------------------------------------------------------

export function executeEscort(ctx: MissionContext): PlayerInput[] {
  const { myX, myY, tick, gs, mySelf, mission } = ctx;
  const inputs: PlayerInput[] = [];

  const escortee = gs.ships.find(
    (s) => s.slotIndex === mission.targetId && s.status === ShipStatus.ALIVE,
  );
  if (!escortee) return [];

  // Shields up
  if (!mySelf.shieldsUp) {
    inputs.push({ command: InputCommand.SHIELD_TOGGLE, value: 1, tick });
  }

  const dist = distance(myX, myY, escortee.x, escortee.y);

  if (dist > 3000) {
    // Close in toward escortee
    inputs.push(...moveTo(myX, myY, escortee.x, escortee.y, 8, tick));
  } else if (dist >= 2000) {
    // Match escortee's direction, cruise speed
    inputs.push(
      { command: InputCommand.SET_DIRECTION, value: escortee.direction, tick },
      {
        command: InputCommand.SET_SPEED,
        value: Math.round(escortee.speed),
        tick,
      },
    );
  } else {
    // Too close, slow down
    inputs.push({ command: InputCommand.SET_SPEED, value: 2, tick });
  }

  return inputs;
}

// ---------------------------------------------------------------------------
// 5. executeDefend
// ---------------------------------------------------------------------------

export function executeDefend(ctx: MissionContext): PlayerInput[] {
  const { myX, myY, tick, gs, mySelf, team, mission } = ctx;
  const inputs: PlayerInput[] = [];

  const planet = gs.planets.find((p) => p.planetId === mission.targetId);
  if (!planet || planet.team !== team) return [];

  // Shields up
  if (!mySelf.shieldsUp) {
    inputs.push({ command: InputCommand.SHIELD_TOGGLE, value: 1, tick });
  }

  const dist = distance(myX, myY, planet.x, planet.y);

  if (dist > ORBIT_DIST * 3) {
    // Navigate to planet
    inputs.push(...moveTo(myX, myY, planet.x, planet.y, 6, tick));
  } else {
    // Near planet: orbit or patrol nearby at low speed
    inputs.push({ command: InputCommand.SET_SPEED, value: 3, tick });
    if (!mySelf.orbiting) {
      inputs.push(...moveToOrbit(myX, myY, planet.x, planet.y, tick));
    }
  }

  return inputs;
}

// ---------------------------------------------------------------------------
// 6. executeOgg
// ---------------------------------------------------------------------------

export function executeOgg(ctx: MissionContext): PlayerInput[] {
  const { myX, myY, tick, gs, mySelf, difficulty, mission } = ctx;
  const inputs: PlayerInput[] = [];

  const target = gs.ships.find(
    (s) => s.slotIndex === mission.targetId && s.status === ShipStatus.ALIVE,
  );
  if (!target) return [];

  const dist = distance(myX, myY, target.x, target.y);

  // Self-destruct at close range
  if (dist < 500) {
    inputs.push({ command: InputCommand.DETONATE_SELF, value: 0, tick });
    return inputs;
  }

  if (dist > 3000) {
    // Close in at high speed. Veteran cloaks on approach.
    if (
      difficulty === BotDifficulty.VETERAN &&
      !mySelf.cloaked &&
      gs.self.fuel > 3000
    ) {
      inputs.push({ command: InputCommand.CLOAK_TOGGLE, value: 1, tick });
    }
    inputs.push(...moveTo(myX, myY, target.x, target.y, 9, tick));
  } else {
    // Fire all weapons, tractor target
    inputs.push(...moveTo(myX, myY, target.x, target.y, 9, tick));

    const dirToTarget = directionTo(myX, myY, target.x, target.y);
    inputs.push({
      command: InputCommand.FIRE_PHASER,
      value: dirToTarget,
      tick,
    });
    inputs.push({
      command: InputCommand.FIRE_TORP,
      value: dirToTarget,
      tick,
    });
    if (!mySelf.tractoring) {
      inputs.push({
        command: InputCommand.TRACTOR,
        value: target.slotIndex,
        tick,
      });
    }
  }

  return inputs;
}

// ---------------------------------------------------------------------------
// 7. executeResupply
// ---------------------------------------------------------------------------

export function executeResupply(ctx: MissionContext): PlayerInput[] {
  const { myX, myY, tick, gs, mySelf, team, slot, enemyTeam } = ctx;
  const inputs: PlayerInput[] = [];

  const hullDamagePct = mySelf.hullDamagePct * 100; // 0-100
  const fuelPct = mySelf.fuelPct;

  // Check if resupply is complete
  if (hullDamagePct < 10 && fuelPct > 0.7) return [];

  // Check for nearby enemies
  const enemy = nearestEnemyShip(myX, myY, team, slot, gs.ships, enemyTeam);
  const enemyDist = enemy ? distance(myX, myY, enemy.x, enemy.y) : Infinity;
  const enemiesNearby = enemyDist < 10000;

  // If fuel is low, head to nearest fuel planet
  if (fuelPct < 0.3) {
    const fuelPlanet = nearestFuelPlanet(myX, myY, team, gs.planets);
    if (fuelPlanet) {
      if (!mySelf.shieldsUp && enemiesNearby) {
        inputs.push({ command: InputCommand.SHIELD_TOGGLE, value: 1, tick });
      }
      inputs.push(...moveTo(myX, myY, fuelPlanet.x, fuelPlanet.y, 6, tick));
      return inputs;
    }
  }

  // If repair planet is close and badly damaged, head there
  if (hullDamagePct > 50) {
    const repairPlanet = nearestRepairPlanet(myX, myY, team, gs.planets);
    if (repairPlanet) {
      const distToRepair = distance(myX, myY, repairPlanet.x, repairPlanet.y);
      if (distToRepair < 15000) {
        inputs.push(
          ...moveTo(myX, myY, repairPlanet.x, repairPlanet.y, 6, tick),
        );
        return inputs;
      }
    }
  }

  if (enemiesNearby) {
    // Passive repair: shields down, keep moving toward safe space
    if (mySelf.shieldsUp) {
      // Keep shields up with enemies nearby for safety
    }
    // Move away from enemies
    const safePlanet = nearestFriendlyPlanet(myX, myY, team, gs.planets);
    if (safePlanet) {
      inputs.push(...moveTo(myX, myY, safePlanet.x, safePlanet.y, 6, tick));
    } else {
      inputs.push({ command: InputCommand.SET_SPEED, value: 6, tick });
    }
  } else {
    // No enemies: active repair
    if (hullDamagePct > 30) {
      if (!mySelf.repairMode) {
        inputs.push({ command: InputCommand.REPAIR_TOGGLE, value: 1, tick });
      }
      inputs.push({ command: InputCommand.SET_SPEED, value: 0, tick });
    }
  }

  return inputs;
}

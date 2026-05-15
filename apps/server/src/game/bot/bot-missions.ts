import {
  type ClientGameState,
  type ClientShip,
  type ClientPlanet,
  type PlayerInput,
  BotDifficulty,
  InputCommand,
  Team,
  ShipStatus,
  distance,
  directionDelta,
  armyCapacity,
  ORBIT_DIST,
  ORBIT_MAX_SPEED,
  SHIP_STATS,
  BEAM_MIN_ARMIES,
  PLANET_DEFS,
} from "@netrek/shared";
import {
  type Mission,
  type TakePhaseState,
  TAKE_AVOID_DIST,
  TAKE_CLOAK_DIST,
  SHIELDS_DOWN_SAFE_DIST,
} from "./bot-types";
import {
  nearestEnemyShip,
  nearestFriendlyPlanet,
  nearestRepairPlanet,
  nearestFuelPlanet,
  enemiesThreateningPlanet,
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
  currentDir?: number,
): PlayerInput[] {
  const targetDir = directionTo(fromX, fromY, toX, toY);
  let finalSpeed = speed;
  if (currentDir !== undefined) {
    const headingErr = Math.abs(directionDelta(currentDir, targetDir));
    if (headingErr > 64) finalSpeed = Math.min(speed, 2);
    else if (headingErr > 32) finalSpeed = Math.min(speed, 4);
  }
  return [
    { command: InputCommand.SET_DIRECTION, value: targetDir, tick },
    { command: InputCommand.SET_SPEED, value: finalSpeed, tick },
  ];
}

function moveToOrbit(
  fromX: number,
  fromY: number,
  planetX: number,
  planetY: number,
  tick: number,
  currentDir?: number,
): PlayerInput[] {
  const dist = distance(fromX, fromY, planetX, planetY);
  if (dist <= ORBIT_DIST * 1.2) {
    return [
      { command: InputCommand.SET_SPEED, value: ORBIT_MAX_SPEED, tick },
      { command: InputCommand.ORBIT, value: 0, tick },
    ];
  }
  const approachSpeed = dist > ORBIT_DIST * 5 ? 6 : 3;
  return moveTo(
    fromX,
    fromY,
    planetX,
    planetY,
    approachSpeed,
    tick,
    currentDir,
  );
}

/**
 * Potential-field steering: attraction toward target + repulsion from enemies.
 * Produces smooth curves around enemy clusters through peaceful space.
 */
function moveToAvoidingEnemies(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  speed: number,
  tick: number,
  currentDir: number,
  ships: ClientShip[],
  team: Team,
  slot: number,
): PlayerInput[] {
  const tdx = toX - fromX;
  const tdy = toY - fromY;
  const tDist = Math.sqrt(tdx * tdx + tdy * tdy);
  if (tDist < 100)
    return moveTo(fromX, fromY, toX, toY, speed, tick, currentDir);

  let steerX = tdx / tDist;
  let steerY = tdy / tDist;

  for (const s of ships) {
    if (
      s.slotIndex === slot ||
      s.team === team ||
      s.status !== ShipStatus.ALIVE
    )
      continue;
    const edx = fromX - s.x;
    const edy = fromY - s.y;
    const eDist = Math.sqrt(edx * edx + edy * edy);
    if (eDist >= TAKE_AVOID_DIST || eDist < 1) continue;

    const proximity = 1 - eDist / TAKE_AVOID_DIST;
    const weight = proximity * proximity;
    steerX += (edx / eDist) * weight;
    steerY += (edy / eDist) * weight;
  }

  const mag = Math.sqrt(steerX * steerX + steerY * steerY);
  if (mag < 0.001)
    return moveTo(fromX, fromY, toX, toY, speed, tick, currentDir);

  const rad = Math.atan2(steerX, -steerY);
  const dir = (((rad / (2 * Math.PI)) * 256 + 256) % 256) | 0;

  let finalSpeed = speed;
  if (currentDir !== undefined) {
    const headingErr = Math.abs(directionDelta(currentDir, dir));
    if (headingErr > 64) finalSpeed = Math.min(speed, 2);
    else if (headingErr > 32) finalSpeed = Math.min(speed, 4);
  }

  return [
    { command: InputCommand.SET_DIRECTION, value: dir, tick },
    { command: InputCommand.SET_SPEED, value: finalSpeed, tick },
  ];
}

// ---------------------------------------------------------------------------
// 1. executePatrol
// ---------------------------------------------------------------------------

export function executePatrol(ctx: MissionContext): PlayerInput[] {
  const { myX, myY, tick, gs, mySelf, slot, enemyTeam, team } = ctx;
  const inputs: PlayerInput[] = [];

  if (!mySelf.shieldsUp) {
    inputs.push({ command: InputCommand.SHIELD_TOGGLE, value: 1, tick });
  }

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
    inputs.push(
      ...moveTo(myX, myY, pick.x, pick.y, speed, tick, mySelf.direction),
    );
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
    inputs.push(
      ...moveTo(myX, myY, nearest.x, nearest.y, 6, tick, mySelf.direction),
    );
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

  if (target.armies <= 4) return [];

  const dist = distance(myX, myY, target.x, target.y);
  const atTarget = dist <= ORBIT_DIST * 1.2;

  if (mySelf.orbiting && atTarget) {
    // Shields stay down while bombing (game drops them on orbit/bomb)
    if (!mySelf.bombing) {
      inputs.push({ command: InputCommand.BOMB, value: 1, tick });
    } else {
      inputs.push({ command: InputCommand.SET_SPEED, value: 0, tick });
    }
  } else {
    // Shields up while traveling
    if (!mySelf.shieldsUp) {
      inputs.push({ command: InputCommand.SHIELD_TOGGLE, value: 1, tick });
    }
    // Veteran cloaks while approaching if fuel > 3000
    if (
      difficulty === BotDifficulty.VETERAN &&
      !mySelf.cloaked &&
      gs.self.fuel > 3000
    ) {
      inputs.push({ command: InputCommand.CLOAK_TOGGLE, value: 1, tick });
    }
    inputs.push(
      ...moveToOrbit(myX, myY, target.x, target.y, tick, mySelf.direction),
    );
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
  const {
    myX,
    myY,
    tick,
    gs,
    mySelf,
    difficulty,
    team,
    enemyTeam,
    slot,
    mission,
  } = ctx;
  const inputs: PlayerInput[] = [];

  const targetPlanet = gs.planets.find((p) => p.planetId === mission.targetId);
  if (!targetPlanet || targetPlanet.team === team) return [];

  const capacity = armyCapacity(mySelf.shipType, gs.self.kills);

  // --- PICKUP: go to a friendly planet and beam up ---
  if (takeState.phase === "pickup") {
    let pickup =
      takeState.pickupPlanetId >= 0
        ? gs.planets.find((p) => p.planetId === takeState.pickupPlanetId)
        : null;

    if (!pickup || pickup.team !== team) {
      pickup = null;
      takeState.pickupPlanetId = -1;
    }

    if (!pickup) {
      const pickupMin = targetPlanet.armies + BEAM_MIN_ARMIES;
      let bestPickup: ClientPlanet | null = null;
      let bestArmies = 0;
      let bestDist = Infinity;
      for (const p of gs.planets) {
        if (p.team !== team || p.armies < pickupMin) continue;
        const d = distance(myX, myY, p.x, p.y);
        if (
          p.armies > bestArmies ||
          (p.armies === bestArmies && d < bestDist)
        ) {
          bestArmies = p.armies;
          bestDist = d;
          bestPickup = p;
        }
      }
      if (!bestPickup) {
        let richest: ClientPlanet | null = null;
        let richestArmies = 0;
        for (const p of gs.planets) {
          if (p.team !== team) continue;
          if (p.armies > richestArmies) {
            richestArmies = p.armies;
            richest = p;
          }
        }
        if (!richest) return [];
        const enemy = nearestEnemyShip(
          myX,
          myY,
          team,
          slot,
          gs.ships,
          enemyTeam,
        );
        const enemyDist = enemy
          ? distance(myX, myY, enemy.x, enemy.y)
          : Infinity;
        if (enemyDist < SHIELDS_DOWN_SAFE_DIST) {
          if (!mySelf.shieldsUp) {
            inputs.push({
              command: InputCommand.SHIELD_TOGGLE,
              value: 1,
              tick,
            });
          }
        } else if (mySelf.shieldsUp) {
          inputs.push({ command: InputCommand.SHIELD_TOGGLE, value: 2, tick });
        }
        inputs.push(
          ...moveTo(myX, myY, richest.x, richest.y, 6, tick, mySelf.direction),
        );
        return inputs;
      }
      takeState.pickupPlanetId = bestPickup.planetId;
      pickup = bestPickup;
    }

    const distToPickup = distance(myX, myY, pickup.x, pickup.y);

    if (mySelf.orbiting && distToPickup <= ORBIT_DIST * 1.2) {
      const needArmies = targetPlanet.armies + 1;
      if (gs.self.armies >= capacity || gs.self.armies >= needArmies) {
        takeState.phase = "transit";
      } else if (pickup.armies >= BEAM_MIN_ARMIES) {
        if (mySelf.beaming !== 1) {
          inputs.push({ command: InputCommand.BEAM_UP, value: 0, tick });
        } else {
          inputs.push({ command: InputCommand.SET_SPEED, value: 0, tick });
        }
      } else if (gs.self.armies > 0) {
        takeState.phase = "transit";
      } else {
        takeState.pickupPlanetId = -1;
        inputs.push({ command: InputCommand.SET_SPEED, value: 0, tick });
      }
    } else {
      const enemy = nearestEnemyShip(myX, myY, team, slot, gs.ships, enemyTeam);
      const enemyDist = enemy ? distance(myX, myY, enemy.x, enemy.y) : Infinity;
      if (enemyDist < SHIELDS_DOWN_SAFE_DIST) {
        if (!mySelf.shieldsUp) {
          inputs.push({ command: InputCommand.SHIELD_TOGGLE, value: 1, tick });
        }
      } else if (mySelf.shieldsUp) {
        inputs.push({ command: InputCommand.SHIELD_TOGGLE, value: 2, tick });
      }
      inputs.push(
        ...moveToOrbit(myX, myY, pickup.x, pickup.y, tick, mySelf.direction),
      );
    }

    if (takeState.phase === "pickup") return inputs;
    // Phase changed to "transit" — fall through to start moving immediately
  }

  // --- TRANSIT: fly to target through peaceful space, avoiding enemies ---
  if (takeState.phase === "transit") {
    if (!mySelf.shieldsUp) {
      inputs.push({ command: InputCommand.SHIELD_TOGGLE, value: 1, tick });
    }

    const distToTarget = distance(myX, myY, targetPlanet.x, targetPlanet.y);
    if (distToTarget <= TAKE_CLOAK_DIST) {
      takeState.phase = "approach";
    } else {
      inputs.push(
        ...moveToAvoidingEnemies(
          myX,
          myY,
          targetPlanet.x,
          targetPlanet.y,
          8,
          tick,
          mySelf.direction,
          gs.ships,
          team,
          slot,
        ),
      );
      return inputs;
    }
  }

  // --- APPROACH / DROP: cloak, orbit, beam down ---
  const distToTarget = distance(myX, myY, targetPlanet.x, targetPlanet.y);

  if (mySelf.orbiting && distToTarget <= ORBIT_DIST * 1.2) {
    if (mySelf.beaming !== 2) {
      inputs.push({ command: InputCommand.BEAM_DOWN, value: 0, tick });
    } else {
      inputs.push({ command: InputCommand.SET_SPEED, value: 0, tick });
    }
    if (gs.self.armies === 0) return [];
  } else {
    if (
      difficulty >= BotDifficulty.COMPETENT &&
      !mySelf.cloaked &&
      gs.self.fuel > 3000
    ) {
      inputs.push({ command: InputCommand.CLOAK_TOGGLE, value: 1, tick });
    }
    inputs.push(
      ...moveToOrbit(
        myX,
        myY,
        targetPlanet.x,
        targetPlanet.y,
        tick,
        mySelf.direction,
      ),
    );
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

  const threats = enemiesThreateningPlanet(planet, gs.ships, team, 10000);
  if (threats === 0) return [];

  if (!mySelf.shieldsUp) {
    inputs.push({ command: InputCommand.SHIELD_TOGGLE, value: 1, tick });
  }

  const dist = distance(myX, myY, planet.x, planet.y);

  if (dist > ORBIT_DIST * 3) {
    inputs.push(
      ...moveTo(myX, myY, planet.x, planet.y, 6, tick, mySelf.direction),
    );
  } else {
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

  if (!mySelf.shieldsUp) {
    inputs.push({ command: InputCommand.SHIELD_TOGGLE, value: 1, tick });
  }

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

  if (hullDamagePct < 15 && fuelPct > 0.5) return [];

  const enemy = nearestEnemyShip(myX, myY, team, slot, gs.ships, enemyTeam);
  const enemyDist = enemy ? distance(myX, myY, enemy.x, enemy.y) : Infinity;
  const enemiesNearby = enemyDist < 10000;

  // Enemies nearby: shields up, flee toward friendly space
  if (enemiesNearby) {
    if (mySelf.repairMode) {
      inputs.push({ command: InputCommand.REPAIR_TOGGLE, value: 1, tick });
    }
    if (!mySelf.shieldsUp) {
      inputs.push({ command: InputCommand.SHIELD_TOGGLE, value: 1, tick });
    }
    const safePlanet = nearestFriendlyPlanet(myX, myY, team, gs.planets);
    if (safePlanet) {
      inputs.push(
        ...moveTo(
          myX,
          myY,
          safePlanet.x,
          safePlanet.y,
          6,
          tick,
          mySelf.direction,
        ),
      );
    } else {
      inputs.push({ command: InputCommand.SET_SPEED, value: 6, tick });
    }
    return inputs;
  }

  // No enemies nearby — shields down for hull repair
  if (mySelf.shieldsUp) {
    inputs.push({ command: InputCommand.SHIELD_TOGGLE, value: 2, tick });
  }

  // Fuel critical: head to fuel planet or nearest friendly to orbit
  if (fuelPct < 0.3) {
    const fuelPlanet = nearestFuelPlanet(myX, myY, team, gs.planets);
    const target =
      fuelPlanet ?? nearestFriendlyPlanet(myX, myY, team, gs.planets);
    if (target) {
      inputs.push(
        ...moveToOrbit(myX, myY, target.x, target.y, tick, mySelf.direction),
      );
    }
    return inputs;
  }

  // Hull repair decision: planet vs repair-in-place
  if (hullDamagePct > 15) {
    const repairPlanet = nearestRepairPlanet(myX, myY, team, gs.planets);
    const distToRepair = repairPlanet
      ? distance(myX, myY, repairPlanet.x, repairPlanet.y)
      : Infinity;

    // Go to repair planet only if close enough to be worth the travel
    if (distToRepair < 10000) {
      inputs.push(
        ...moveToOrbit(
          myX,
          myY,
          repairPlanet!.x,
          repairPlanet!.y,
          tick,
          mySelf.direction,
        ),
      );
      return inputs;
    }

    // Otherwise: active repair in place (R mode, stop dead)
    if (!mySelf.repairMode) {
      inputs.push({ command: InputCommand.REPAIR_TOGGLE, value: 1, tick });
    }
    inputs.push({ command: InputCommand.SET_SPEED, value: 0, tick });
    return inputs;
  }

  // Just need fuel — head to nearest friendly planet
  const fuelPlanet = nearestFuelPlanet(myX, myY, team, gs.planets);
  const target =
    fuelPlanet ?? nearestFriendlyPlanet(myX, myY, team, gs.planets);
  if (target) {
    inputs.push(
      ...moveToOrbit(myX, myY, target.x, target.y, tick, mySelf.direction),
    );
  }

  return inputs;
}

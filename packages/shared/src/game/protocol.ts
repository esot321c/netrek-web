import {
  GALAXY_WIDTH,
  GALAXY_HEIGHT,
  SHIP_STATS,
  PLANET_DEFS,
  CLOAK_FUZZ_RANGE,
  MAX_PLASMAS,
} from "./constants";
import {
  AlertStatus,
  InputCommand,
  ShipStatus,
  Team,
  type ClientExplosion,
  type ClientGameState,
  type ClientPhaser,
  type ClientPlasma,
  type ClientPlanet,
  type ClientSelfExtra,
  type ClientShip,
  type ClientTorp,
  type PlayerInput,
  type ShipState,
  type TorpState,
  type PhaserState,
  type ExplosionState,
  type PlasmaState,
  type PlanetState,
  PlanetVisibility,
} from "./types";

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

export const MSG_GAME_STATE = 0x01;
export const MSG_PLAYER_INPUT = 0x02;

// ---------------------------------------------------------------------------
// Binary layout sizes
// ---------------------------------------------------------------------------

const HEADER_SIZE = 13; // added plasmaCount byte
const SHIP_SIZE = 19; // 17 + tractorTarget(1) + pressorTarget(1)
const TORP_SIZE = 6;
const PHASER_SIZE = 8;
const EXPLOSION_SIZE = 6;
const PLASMA_SIZE = 7; // alive(1) + x(2) + y(2) + ownerSlot(1) + team(1)
const PLANET_BINARY_SIZE = 5; // planetId(1) + team(1) + armies(1) + features(1) + visibility(1)
const SELF_EXTRA_SIZE = 18;
const INPUT_SIZE = 4;

// ---------------------------------------------------------------------------
// Coordinate scaling helpers
// ---------------------------------------------------------------------------

function gameToU16X(x: number): number {
  return Math.round(
    (Math.max(0, Math.min(GALAXY_WIDTH, x)) / GALAXY_WIDTH) * 65535,
  );
}

function gameToU16Y(y: number): number {
  return Math.round(
    (Math.max(0, Math.min(GALAXY_HEIGHT, y)) / GALAXY_HEIGHT) * 65535,
  );
}

function u16ToGameX(v: number): number {
  return (v / 65535) * GALAXY_WIDTH;
}

function u16ToGameY(v: number): number {
  return (v / 65535) * GALAXY_HEIGHT;
}

// ---------------------------------------------------------------------------
// Pack flags byte
// ---------------------------------------------------------------------------

// Flags byte layout (8 bits):
// bit 0: shieldsUp
// bit 1: repairMode
// bit 2: cloaked
// bit 3-4: alertStatus (2 bits)
// bit 5: orbiting
// bit 6: bombing
// bit 7: tractoring

// Flags2 byte layout (8 bits):
// bit 0: pressoring
// bit 1-2: beaming (0=none, 1=up, 2=down)

function packFlags(
  shieldsUp: boolean,
  repairMode: boolean,
  cloaked: boolean,
  alertStatus: AlertStatus,
  orbiting: boolean,
  bombing: boolean,
  tractoring: boolean,
): number {
  return (
    (shieldsUp ? 1 : 0) |
    (repairMode ? 2 : 0) |
    (cloaked ? 4 : 0) |
    ((alertStatus & 0x03) << 3) |
    (orbiting ? 0x20 : 0) |
    (bombing ? 0x40 : 0) |
    (tractoring ? 0x80 : 0)
  );
}

function packFlags2(
  pressoring: boolean,
  beaming: number,
  docked: boolean,
): number {
  return (pressoring ? 1 : 0) | ((beaming & 0x03) << 1) | (docked ? 0x08 : 0);
}

function unpackFlags(flags: number) {
  return {
    shieldsUp: (flags & 1) !== 0,
    repairMode: (flags & 2) !== 0,
    cloaked: (flags & 4) !== 0,
    alertStatus: ((flags >> 3) & 0x03) as AlertStatus,
    orbiting: (flags & 0x20) !== 0,
    bombing: (flags & 0x40) !== 0,
    tractoring: (flags & 0x80) !== 0,
  };
}

function unpackFlags2(flags: number) {
  return {
    pressoring: (flags & 1) !== 0,
    beaming: (flags >> 1) & 0x03,
    docked: (flags & 0x08) !== 0,
  };
}

// ---------------------------------------------------------------------------
// Serialize game state (server -> one client)
// ---------------------------------------------------------------------------

export function serializeGameState(
  tick: number,
  recipientSlot: number,
  recipientTeam: Team,
  ships: ShipState[],
  torps: TorpState[],
  phasers: PhaserState[],
  explosions: ExplosionState[],
  plasmas: PlasmaState[],
  alertStatuses: AlertStatus[],
  planets: PlanetState[],
  tmode = false,
  surrenderTimers: number[] = [0, 0, 0, 0],
  planetKnowledge?: {
    team: number;
    armies: number;
    features: number;
    lastScannedTick: number;
  }[],
  currentTick = 0,
): ArrayBuffer {
  // Count alive entities
  const aliveShips: ShipState[] = [];
  for (let i = 0; i < ships.length; i++) {
    const s = ships[i]!;
    if (s.status !== ShipStatus.DEAD) {
      aliveShips.push(s);
    }
  }

  const aliveTorps: TorpState[] = [];
  for (let i = 0; i < torps.length; i++) {
    if (torps[i]!.alive) aliveTorps.push(torps[i]!);
  }

  const alivePhasers: PhaserState[] = [];
  for (let i = 0; i < phasers.length; i++) {
    if (phasers[i]!.alive) alivePhasers.push(phasers[i]!);
  }

  const aliveExplosions: ExplosionState[] = [];
  for (let i = 0; i < explosions.length; i++) {
    if (explosions[i]!.alive) aliveExplosions.push(explosions[i]!);
  }

  const alivePlasmas: PlasmaState[] = [];
  for (let i = 0; i < plasmas.length; i++) {
    if (plasmas[i]!.alive) alivePlasmas.push(plasmas[i]!);
  }

  const totalSize =
    HEADER_SIZE +
    aliveShips.length * SHIP_SIZE +
    aliveTorps.length * TORP_SIZE +
    alivePhasers.length * PHASER_SIZE +
    aliveExplosions.length * EXPLOSION_SIZE +
    alivePlasmas.length * PLASMA_SIZE +
    planets.length * PLANET_BINARY_SIZE +
    SELF_EXTRA_SIZE;

  const buf = new ArrayBuffer(totalSize);
  const dv = new DataView(buf);
  let offset = 0;

  // Header (13 bytes)
  dv.setUint8(offset++, MSG_GAME_STATE);
  dv.setUint32(offset, tick, true);
  offset += 4;
  dv.setUint8(offset++, recipientSlot);
  dv.setUint8(offset++, aliveShips.length);
  dv.setUint16(offset, aliveTorps.length, true);
  offset += 2;
  dv.setUint8(offset++, alivePhasers.length);
  dv.setUint8(offset++, aliveExplosions.length);
  dv.setUint8(offset++, planets.length);
  dv.setUint8(offset++, alivePlasmas.length);

  // Ships
  for (let i = 0; i < aliveShips.length; i++) {
    const s = aliveShips[i]!;
    const stats = SHIP_STATS[s.shipType];
    const isCloakedEnemy =
      s.cloaked && s.team !== recipientTeam && s.slotIndex !== recipientSlot;

    // Fuzz position for cloaked enemies — stable for ~2 seconds (20 ticks)
    let sx = s.x;
    let sy = s.y;
    if (isCloakedEnemy) {
      const fuzzSeed = Math.floor(tick / 20) * 16 + s.slotIndex;
      // Simple hash to get deterministic pseudo-random offsets
      const h1 = Math.sin(fuzzSeed * 127.1) * 43758.5453;
      const h2 = Math.sin(fuzzSeed * 269.5) * 17853.2917;
      sx += (h1 - Math.floor(h1) - 0.5) * 2 * CLOAK_FUZZ_RANGE;
      sy += (h2 - Math.floor(h2) - 0.5) * 2 * CLOAK_FUZZ_RANGE;
    }

    dv.setUint8(offset++, s.slotIndex);
    dv.setUint8(offset++, s.status);
    dv.setUint8(offset++, s.team);
    dv.setUint8(offset++, s.shipType);
    dv.setUint16(offset, gameToU16X(sx), true);
    offset += 2;
    dv.setUint16(offset, gameToU16Y(sy), true);
    offset += 2;
    dv.setUint8(offset++, s.direction & 0xff);
    dv.setUint8(offset++, Math.round(s.speed * 10));
    dv.setUint8(
      offset++,
      Math.round((s.shieldStrength / stats.maxShields) * 255),
    );
    dv.setUint8(
      offset++,
      Math.min(255, Math.round((s.hullDamage / stats.maxHull) * 255)),
    );
    dv.setUint16(offset, Math.round((s.fuel / stats.maxFuel) * 65535), true);
    offset += 2;
    dv.setUint8(
      offset++,
      Math.min(255, Math.round((s.weaponTemp / stats.maxWpnTemp) * 255)),
    );
    dv.setUint8(
      offset++,
      packFlags(
        s.shieldsUp,
        s.repairMode,
        s.cloaked,
        alertStatuses[s.slotIndex] ?? AlertStatus.GREEN,
        s.orbitPlanetId >= 0,
        s.bombing,
        s.tractorTarget >= 0,
      ),
    );
    dv.setUint8(
      offset++,
      packFlags2(s.pressorTarget >= 0, s.beaming, s.dockedAt >= 0),
    );
    // Tractor/pressor target slots (0xFF = none)
    dv.setUint8(offset++, s.tractorTarget >= 0 ? s.tractorTarget : 0xff);
    dv.setUint8(offset++, s.pressorTarget >= 0 ? s.pressorTarget : 0xff);
  }

  // Torps
  for (let i = 0; i < aliveTorps.length; i++) {
    const t = aliveTorps[i]!;
    dv.setUint16(offset, gameToU16X(t.x), true);
    offset += 2;
    dv.setUint16(offset, gameToU16Y(t.y), true);
    offset += 2;
    dv.setUint8(offset++, t.ownerSlot);
    dv.setUint8(offset++, t.team);
  }

  // Phasers
  for (let i = 0; i < alivePhasers.length; i++) {
    const p = alivePhasers[i]!;
    dv.setUint8(offset++, p.ownerSlot);
    dv.setUint8(offset++, p.team);
    dv.setUint16(offset, gameToU16X(p.x2), true);
    offset += 2;
    dv.setUint16(offset, gameToU16Y(p.y2), true);
    offset += 2;
    dv.setUint8(offset++, Math.min(255, Math.round(p.damage)));
    dv.setUint8(offset++, 0); // padding
  }

  // Explosions
  for (let i = 0; i < aliveExplosions.length; i++) {
    const e = aliveExplosions[i]!;
    dv.setUint16(offset, gameToU16X(e.x), true);
    offset += 2;
    dv.setUint16(offset, gameToU16Y(e.y), true);
    offset += 2;
    dv.setUint16(offset, Math.min(65535, Math.round(e.radius)), true);
    offset += 2;
  }

  // Plasmas
  for (let i = 0; i < alivePlasmas.length; i++) {
    const p = alivePlasmas[i]!;
    dv.setUint8(offset++, 1); // alive flag
    dv.setUint16(offset, gameToU16X(p.x), true);
    offset += 2;
    dv.setUint16(offset, gameToU16Y(p.y), true);
    offset += 2;
    dv.setUint8(offset++, p.ownerSlot);
    dv.setUint8(offset++, p.team);
  }

  // Planets (5 bytes each: planetId, team, armies, features, visibility)
  for (let i = 0; i < planets.length; i++) {
    const p = planets[i]!;
    if (planetKnowledge) {
      const k = planetKnowledge[i]!;
      let vis: PlanetVisibility;
      if (k.lastScannedTick < 0) {
        vis = PlanetVisibility.UNKNOWN;
      } else if (k.lastScannedTick >= currentTick - 1) {
        vis = PlanetVisibility.FRESH;
      } else {
        vis = PlanetVisibility.STALE;
      }
      if (vis === PlanetVisibility.UNKNOWN) {
        dv.setUint8(offset++, p.planetId);
        dv.setUint8(offset++, 0xff);
        dv.setUint8(offset++, 0);
        dv.setUint8(offset++, 0);
      } else {
        dv.setUint8(offset++, p.planetId);
        dv.setUint8(offset++, k.team);
        dv.setUint8(offset++, Math.min(255, k.armies));
        dv.setUint8(offset++, k.features);
      }
      dv.setUint8(offset++, vis);
    } else {
      dv.setUint8(offset++, p.planetId);
      dv.setUint8(offset++, p.team as number);
      dv.setUint8(offset++, Math.min(255, p.armies));
      dv.setUint8(offset++, p.features);
      dv.setUint8(offset++, PlanetVisibility.FRESH);
    }
  }

  // Self extra (for the recipient's own ship)
  const self = ships[recipientSlot];
  if (self && self.status !== ShipStatus.DEAD) {
    const selfStats = SHIP_STATS[self.shipType];
    dv.setUint16(offset, Math.round(self.kills * 100), true);
    offset += 2;
    dv.setUint8(offset++, Math.min(255, self.armies));
    dv.setUint8(offset++, Math.min(255, self.phaserCooldownTicks));
    dv.setUint8(offset++, Math.min(255, self.engineBurnoutTicks));
    dv.setUint8(offset++, Math.min(255, self.weaponBurnoutTicks));
    dv.setUint8(
      offset++,
      Math.min(255, Math.round((self.engineTemp / selfStats.maxEgnTemp) * 255)),
    );
    dv.setUint16(offset, Math.round(self.fuel), true);
    offset += 2;
    // orbitPlanetId: -1 = not orbiting, use 0xFF as sentinel
    dv.setUint8(offset++, self.orbitPlanetId >= 0 ? self.orbitPlanetId : 0xff);
    // Lock state
    dv.setUint8(offset++, self.lockType);
    dv.setUint8(offset++, self.lockTargetId >= 0 ? self.lockTargetId : 0xff);
    // tmode flag
    dv.setUint8(offset++, tmode ? 1 : 0);
    // surrender timer for this player's team (ticks remaining, 0 = no timer)
    dv.setUint16(offset, surrenderTimers[recipientTeam] ?? 0, true);
    offset += 2;
    // surrender timer for the enemy team (max of all non-own teams)
    let enemySurrTimer = 0;
    for (let t = 0; t < surrenderTimers.length; t++) {
      if (t !== recipientTeam && (surrenderTimers[t] ?? 0) > enemySurrTimer) {
        enemySurrTimer = surrenderTimers[t] ?? 0;
      }
    }
    dv.setUint16(offset, enemySurrTimer, true);
    offset += 2;
  } else {
    // Zero-fill self extra
    for (let i = 0; i < SELF_EXTRA_SIZE; i++) {
      dv.setUint8(offset++, 0);
    }
  }

  return buf;
}

// ---------------------------------------------------------------------------
// Deserialize game state (client-side)
// ---------------------------------------------------------------------------

export function deserializeGameState(buffer: ArrayBuffer): ClientGameState {
  const dv = new DataView(buffer);
  let offset = 0;

  // Header (13 bytes)
  offset++; // skip messageType
  const tick = dv.getUint32(offset, true);
  offset += 4;
  const recipientSlot = dv.getUint8(offset++);
  const shipCount = dv.getUint8(offset++);
  const torpCount = dv.getUint16(offset, true);
  offset += 2;
  const phaserCount = dv.getUint8(offset++);
  const explosionCount = dv.getUint8(offset++);
  const planetCount = dv.getUint8(offset++);
  const plasmaCount = dv.getUint8(offset++);

  // Ships
  const ships: ClientShip[] = [];
  for (let i = 0; i < shipCount; i++) {
    const slotIndex = dv.getUint8(offset++);
    const status = dv.getUint8(offset++) as ShipStatus;
    const team = dv.getUint8(offset++);
    const shipType = dv.getUint8(offset++);
    const x = u16ToGameX(dv.getUint16(offset, true));
    offset += 2;
    const y = u16ToGameY(dv.getUint16(offset, true));
    offset += 2;
    const direction = dv.getUint8(offset++);
    const speed = dv.getUint8(offset++) / 10;
    const shieldPct = dv.getUint8(offset++) / 255;
    const hullDamagePct = dv.getUint8(offset++) / 255;
    const fuelPct = dv.getUint16(offset, true) / 65535;
    offset += 2;
    const weaponTemp = dv.getUint8(offset++) / 255;
    const flags = unpackFlags(dv.getUint8(offset++));
    const flags2 = unpackFlags2(dv.getUint8(offset++));
    const tractorTargetRaw = dv.getUint8(offset++);
    const tractorTarget = tractorTargetRaw === 0xff ? -1 : tractorTargetRaw;
    const pressorTargetRaw = dv.getUint8(offset++);
    const pressorTarget = pressorTargetRaw === 0xff ? -1 : pressorTargetRaw;

    ships.push({
      slotIndex,
      status,
      team,
      shipType,
      x,
      y,
      direction,
      speed,
      shieldPct,
      hullDamagePct,
      fuelPct,
      weaponTemp,
      engineTemp: 0, // from self extra if own ship
      ...flags,
      ...flags2,
      tractorTarget,
      pressorTarget,
    });
  }

  // Torps
  const torps: ClientTorp[] = [];
  for (let i = 0; i < torpCount; i++) {
    const x = u16ToGameX(dv.getUint16(offset, true));
    offset += 2;
    const y = u16ToGameY(dv.getUint16(offset, true));
    offset += 2;
    const ownerSlot = dv.getUint8(offset++);
    const torpTeam = dv.getUint8(offset++);
    torps.push({ x, y, ownerSlot, team: torpTeam });
  }

  // Phasers
  const phasers: ClientPhaser[] = [];
  for (let i = 0; i < phaserCount; i++) {
    const ownerSlot = dv.getUint8(offset++);
    const pTeam = dv.getUint8(offset++);
    const targetX = u16ToGameX(dv.getUint16(offset, true));
    offset += 2;
    const targetY = u16ToGameY(dv.getUint16(offset, true));
    offset += 2;
    const damage = dv.getUint8(offset++);
    offset++; // padding
    phasers.push({ ownerSlot, team: pTeam, targetX, targetY, damage });
  }

  // Explosions
  const explosions: ClientExplosion[] = [];
  for (let i = 0; i < explosionCount; i++) {
    const x = u16ToGameX(dv.getUint16(offset, true));
    offset += 2;
    const y = u16ToGameY(dv.getUint16(offset, true));
    offset += 2;
    const radius = dv.getUint16(offset, true);
    offset += 2;
    explosions.push({ x, y, radius });
  }

  // Plasmas
  const plasmas: ClientPlasma[] = [];
  for (let i = 0; i < plasmaCount; i++) {
    offset++; // skip alive flag
    const x = u16ToGameX(dv.getUint16(offset, true));
    offset += 2;
    const y = u16ToGameY(dv.getUint16(offset, true));
    offset += 2;
    const ownerSlot = dv.getUint8(offset++);
    const plasmaTeam = dv.getUint8(offset++);
    plasmas.push({ x, y, ownerSlot, team: plasmaTeam });
  }

  // Planets
  const planets: ClientPlanet[] = [];
  for (let i = 0; i < planetCount; i++) {
    const planetId = dv.getUint8(offset++);
    const pTeam = dv.getUint8(offset++);
    const armies = dv.getUint8(offset++);
    const features = dv.getUint8(offset++);
    const visibility = dv.getUint8(offset++) as PlanetVisibility;
    const def = PLANET_DEFS[planetId];
    planets.push({
      planetId,
      x: def?.x ?? 0,
      y: def?.y ?? 0,
      name: def?.name ?? `P${planetId}`,
      team: pTeam,
      armies,
      features,
      visibility,
    });
  }

  // Self extra (12 bytes)
  const selfKills = dv.getUint16(offset, true) / 100;
  offset += 2;
  const selfArmies = dv.getUint8(offset++);
  const phaserCooldown = dv.getUint8(offset++);
  const engineBurnout = dv.getUint8(offset++);
  const weaponBurnout = dv.getUint8(offset++);
  const engineTemp = dv.getUint8(offset++) / 255;
  const fuel = dv.getUint16(offset, true);
  offset += 2;
  const orbitPlanetRaw = dv.getUint8(offset++);
  const orbitPlanetId = orbitPlanetRaw === 0xff ? -1 : orbitPlanetRaw;
  const lockType = dv.getUint8(offset++);
  const lockTargetRaw = dv.getUint8(offset++);
  const lockTargetId = lockTargetRaw === 0xff ? -1 : lockTargetRaw;
  const tmode = dv.getUint8(offset++) !== 0;
  const surrenderTimer = dv.getUint16(offset, true);
  offset += 2;
  const enemySurrenderTimer = dv.getUint16(offset, true);
  offset += 2;

  return {
    tick,
    recipientSlot,
    ships,
    torps,
    phasers,
    explosions,
    plasmas,
    planets,
    self: {
      kills: selfKills,
      armies: selfArmies,
      phaserCooldown,
      engineBurnout,
      weaponBurnout,
      engineTemp,
      fuel,
      shieldStrength: 0,
      hullDamage: 0,
      orbitPlanetId,
      lockType,
      lockTargetId,
      tmode,
      surrenderTimer,
      enemySurrenderTimer,
    },
  };
}

// ---------------------------------------------------------------------------
// Input serialization (client -> server)
// ---------------------------------------------------------------------------

export function serializeInput(
  command: InputCommand,
  value: number,
): ArrayBuffer {
  const buf = new ArrayBuffer(INPUT_SIZE);
  const dv = new DataView(buf);
  dv.setUint8(0, MSG_PLAYER_INPUT);
  dv.setUint8(1, command);
  dv.setUint16(2, value & 0xffff, true);
  return buf;
}

export function deserializeInput(buffer: ArrayBuffer): PlayerInput {
  const dv = new DataView(buffer);
  return {
    command: dv.getUint8(1) as InputCommand,
    tick: 0, // server stamps this
    value: dv.getUint16(2, true),
  };
}

import { describe, it, expect } from "vitest";
import {
  type MissionContext,
  executePatrol,
  executeBomb,
  executeTake,
  executeEscort,
  executeDefend,
  executeOgg,
  executeResupply,
} from "./bot-missions";
import { type Mission, type TakePhaseState, MissionType } from "./bot-types";
import {
  BotDifficulty,
  InputCommand,
  Team,
  ShipType,
  ShipStatus,
  AlertStatus,
  PlanetFeature,
  PlanetVisibility,
  ORBIT_DIST,
  type ClientShip,
  type ClientPlanet,
  type ClientSelfExtra,
  type ClientGameState,
  type ClientTorp,
} from "@netrek/shared";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeShip(overrides: Partial<ClientShip> = {}): ClientShip {
  return {
    slotIndex: 0,
    status: ShipStatus.ALIVE,
    team: Team.FEDERATION,
    shipType: ShipType.CA,
    x: 50000,
    y: 50000,
    direction: 0,
    speed: 0,
    shieldPct: 1,
    hullDamagePct: 0,
    fuelPct: 1,
    weaponTemp: 0,
    engineTemp: 0,
    shieldsUp: true,
    repairMode: false,
    cloaked: false,
    orbiting: false,
    bombing: false,
    beaming: 0,
    tractoring: false,
    pressoring: false,
    tractorTarget: -1,
    pressorTarget: -1,
    alertStatus: AlertStatus.GREEN,
    docked: false,
    ...overrides,
  };
}

function makeSelf(overrides: Partial<ClientSelfExtra> = {}): ClientSelfExtra {
  return {
    kills: 0,
    armies: 0,
    phaserCooldown: 0,
    engineBurnout: 0,
    weaponBurnout: 0,
    engineTemp: 0,
    fuel: 10000,
    shieldStrength: 1000,
    hullDamage: 0,
    orbitPlanetId: -1,
    lockType: 0,
    lockTargetId: -1,
    tmode: false,
    surrenderTimer: 0,
    enemySurrenderTimer: 0,
    ...overrides,
  };
}

function makePlanet(overrides: Partial<ClientPlanet> = {}): ClientPlanet {
  return {
    planetId: 0,
    x: 20000,
    y: 20000,
    name: "TestPlanet",
    team: Team.FEDERATION,
    armies: 17,
    features: PlanetFeature.REPAIR | PlanetFeature.FUEL,
    visibility: PlanetVisibility.FRESH,
    ...overrides,
  };
}

function makeGS(overrides: Partial<ClientGameState> = {}): ClientGameState {
  return {
    tick: 100,
    recipientSlot: 0,
    ships: [],
    torps: [],
    phasers: [],
    explosions: [],
    plasmas: [],
    planets: [],
    self: makeSelf(),
    ...overrides,
  };
}

function makeMission(overrides: Partial<Mission> = {}): Mission {
  return {
    type: MissionType.PATROL,
    targetId: -1,
    score: 50,
    startTick: 0,
    ...overrides,
  };
}

function makeCtx(overrides: Partial<MissionContext> = {}): MissionContext {
  const mySelf = overrides.mySelf ?? makeShip();
  const gs = overrides.gs ?? makeGS({ ships: [mySelf] });
  return {
    myX: mySelf.x,
    myY: mySelf.y,
    tick: gs.tick,
    gs,
    mySelf,
    difficulty: BotDifficulty.COMPETENT,
    team: Team.FEDERATION,
    enemyTeam: Team.ROMULANS,
    slot: 0,
    mission: makeMission(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// executePatrol
// ---------------------------------------------------------------------------

describe("executePatrol", () => {
  it("emits SET_DIRECTION + SET_SPEED toward enemy space", () => {
    const enemyPlanet = makePlanet({
      planetId: 10,
      team: Team.ROMULANS,
      x: 20000,
      y: 20000,
    });
    const friendlyPlanet = makePlanet({
      planetId: 0,
      team: Team.FEDERATION,
      x: 50000,
      y: 80000,
    });
    const mySelf = makeShip({ x: 40000, y: 60000 });
    const gs = makeGS({
      planets: [friendlyPlanet, enemyPlanet],
      ships: [mySelf],
    });
    const ctx = makeCtx({ mySelf, gs });

    const inputs = executePatrol(ctx);
    const commands = inputs.map((i) => i.command);
    expect(commands).toContain(InputCommand.SET_DIRECTION);
    expect(commands).toContain(InputCommand.SET_SPEED);
  });

  it("uses PLANET_DEFS when no visible enemy planets", () => {
    // No enemy planets in the game state
    const mySelf = makeShip({ x: 50000, y: 50000 });
    const gs = makeGS({ planets: [], ships: [mySelf] });
    const ctx = makeCtx({ mySelf, gs });

    const inputs = executePatrol(ctx);
    const commands = inputs.map((i) => i.command);
    expect(commands).toContain(InputCommand.SET_DIRECTION);
    expect(commands).toContain(InputCommand.SET_SPEED);
  });

  it("speed is between 5 and 6", () => {
    const enemyPlanet = makePlanet({
      planetId: 10,
      team: Team.ROMULANS,
      x: 20000,
      y: 20000,
    });
    const mySelf = makeShip({ x: 50000, y: 50000 });
    const gs = makeGS({ planets: [enemyPlanet], ships: [mySelf] });
    const ctx = makeCtx({ mySelf, gs });

    const inputs = executePatrol(ctx);
    const speedCmd = inputs.find((i) => i.command === InputCommand.SET_SPEED);
    expect(speedCmd).toBeDefined();
    expect(speedCmd!.value).toBeGreaterThanOrEqual(5);
    expect(speedCmd!.value).toBeLessThanOrEqual(6);
  });
});

// ---------------------------------------------------------------------------
// executeBomb
// ---------------------------------------------------------------------------

describe("executeBomb", () => {
  it("does not emit SHIELD_TOGGLE while bombing (orbiting enemy planet)", () => {
    const enemyPlanet = makePlanet({
      planetId: 5,
      team: Team.ROMULANS,
      x: 50000,
      y: 50000,
      armies: 17,
    });
    const mySelf = makeShip({
      x: 50000,
      y: 50000,
      orbiting: true,
      bombing: false,
      shieldsUp: false,
    });
    const gs = makeGS({ planets: [enemyPlanet], ships: [mySelf] });
    const mission = makeMission({ type: MissionType.BOMB, targetId: 5 });
    const ctx = makeCtx({ mySelf, gs, mission });

    const inputs = executeBomb(ctx);
    const commands = inputs.map((i) => i.command);
    expect(commands).toContain(InputCommand.BOMB);
    expect(commands).not.toContain(InputCommand.SHIELD_TOGGLE);
  });

  it("navigates toward target when not orbiting", () => {
    const enemyPlanet = makePlanet({
      planetId: 5,
      team: Team.ROMULANS,
      x: 70000,
      y: 50000,
      armies: 17,
    });
    const mySelf = makeShip({ x: 50000, y: 50000, orbiting: false });
    const gs = makeGS({ planets: [enemyPlanet], ships: [mySelf] });
    const mission = makeMission({ type: MissionType.BOMB, targetId: 5 });
    const ctx = makeCtx({ mySelf, gs, mission });

    const inputs = executeBomb(ctx);
    const commands = inputs.map((i) => i.command);
    expect(commands).toContain(InputCommand.SET_DIRECTION);
    expect(commands).toContain(InputCommand.SET_SPEED);
  });

  it("returns empty when planet is no longer enemy", () => {
    const friendlyPlanet = makePlanet({
      planetId: 5,
      team: Team.FEDERATION,
      x: 50000,
      y: 50000,
      armies: 17,
    });
    const mySelf = makeShip({ x: 50000, y: 50000 });
    const gs = makeGS({ planets: [friendlyPlanet], ships: [mySelf] });
    const mission = makeMission({ type: MissionType.BOMB, targetId: 5 });
    const ctx = makeCtx({ mySelf, gs, mission });

    const inputs = executeBomb(ctx);
    expect(inputs).toHaveLength(0);
  });

  it("returns empty when planet armies < 1", () => {
    const enemyPlanet = makePlanet({
      planetId: 5,
      team: Team.ROMULANS,
      x: 50000,
      y: 50000,
      armies: 0,
    });
    const mySelf = makeShip({ x: 50000, y: 50000, orbiting: true });
    const gs = makeGS({ planets: [enemyPlanet], ships: [mySelf] });
    const mission = makeMission({ type: MissionType.BOMB, targetId: 5 });
    const ctx = makeCtx({ mySelf, gs, mission });

    const inputs = executeBomb(ctx);
    expect(inputs).toHaveLength(0);
  });

  it("veteran cloaks while approaching", () => {
    const enemyPlanet = makePlanet({
      planetId: 5,
      team: Team.ROMULANS,
      x: 70000,
      y: 50000,
      armies: 17,
    });
    const mySelf = makeShip({
      x: 50000,
      y: 50000,
      orbiting: false,
      cloaked: false,
    });
    const gs = makeGS({
      planets: [enemyPlanet],
      ships: [mySelf],
      self: makeSelf({ fuel: 5000 }),
    });
    const mission = makeMission({ type: MissionType.BOMB, targetId: 5 });
    const ctx = makeCtx({
      mySelf,
      gs,
      mission,
      difficulty: BotDifficulty.VETERAN,
    });

    const inputs = executeBomb(ctx);
    const commands = inputs.map((i) => i.command);
    expect(commands).toContain(InputCommand.CLOAK_TOGGLE);
  });
});

// ---------------------------------------------------------------------------
// executeTake
// ---------------------------------------------------------------------------

describe("executeTake", () => {
  it("does NOT cloak during transit phase", () => {
    const targetPlanet = makePlanet({
      planetId: 10,
      team: Team.ROMULANS,
      x: 70000,
      y: 50000,
      armies: 3,
    });
    const mySelf = makeShip({
      x: 50000,
      y: 50000,
      shieldsUp: true,
      cloaked: false,
    });
    const gs = makeGS({
      planets: [targetPlanet],
      ships: [mySelf],
      self: makeSelf({ kills: 2, armies: 5, fuel: 8000 }),
    });
    const mission = makeMission({ type: MissionType.TAKE, targetId: 10 });
    const takeState: TakePhaseState = { phase: "transit", pickupPlanetId: 0 };
    const ctx = makeCtx({
      mySelf,
      gs,
      mission,
      difficulty: BotDifficulty.VETERAN,
    });

    const inputs = executeTake(ctx, takeState);
    const commands = inputs.map((i) => i.command);
    expect(commands).not.toContain(InputCommand.CLOAK_TOGGLE);
  });

  it("beams up during pickup at friendly planet", () => {
    const friendlyPlanet = makePlanet({
      planetId: 0,
      team: Team.FEDERATION,
      x: 50000,
      y: 50000,
      armies: 17,
    });
    const targetPlanet = makePlanet({
      planetId: 10,
      team: Team.ROMULANS,
      x: 70000,
      y: 50000,
      armies: 3,
    });
    const mySelf = makeShip({
      x: 50000,
      y: 50000,
      orbiting: true,
      beaming: 0,
    });
    const gs = makeGS({
      planets: [friendlyPlanet, targetPlanet],
      ships: [mySelf],
      self: makeSelf({ kills: 2, armies: 0 }),
    });
    const mission = makeMission({ type: MissionType.TAKE, targetId: 10 });
    const takeState: TakePhaseState = { phase: "pickup", pickupPlanetId: 0 };
    const ctx = makeCtx({ mySelf, gs, mission });

    const inputs = executeTake(ctx, takeState);
    const commands = inputs.map((i) => i.command);
    expect(commands).toContain(InputCommand.BEAM_UP);
  });

  it("does NOT raise shields during pickup", () => {
    const friendlyPlanet = makePlanet({
      planetId: 0,
      team: Team.FEDERATION,
      x: 50000,
      y: 50000,
      armies: 17,
    });
    const targetPlanet = makePlanet({
      planetId: 10,
      team: Team.ROMULANS,
      x: 70000,
      y: 50000,
      armies: 3,
    });
    const mySelf = makeShip({
      x: 50000,
      y: 50000,
      orbiting: true,
      shieldsUp: false,
      beaming: 1,
    });
    const gs = makeGS({
      planets: [friendlyPlanet, targetPlanet],
      ships: [mySelf],
      self: makeSelf({ kills: 2, armies: 0 }),
    });
    const mission = makeMission({ type: MissionType.TAKE, targetId: 10 });
    const takeState: TakePhaseState = { phase: "pickup", pickupPlanetId: 0 };
    const ctx = makeCtx({ mySelf, gs, mission });

    const inputs = executeTake(ctx, takeState);
    const commands = inputs.map((i) => i.command);
    expect(commands).not.toContain(InputCommand.SHIELD_TOGGLE);
  });

  it("transitions from pickup to transit when armies loaded", () => {
    const friendlyPlanet = makePlanet({
      planetId: 0,
      team: Team.FEDERATION,
      x: 50000,
      y: 50000,
      armies: 17,
    });
    const targetPlanet = makePlanet({
      planetId: 10,
      team: Team.ROMULANS,
      x: 70000,
      y: 50000,
      armies: 3,
    });
    const mySelf = makeShip({
      x: 50000,
      y: 50000,
      orbiting: true,
    });
    const gs = makeGS({
      planets: [friendlyPlanet, targetPlanet],
      ships: [mySelf],
      // Already have enough armies loaded (4 >= armies+1 = 4)
      self: makeSelf({ kills: 2, armies: 4 }),
    });
    const mission = makeMission({ type: MissionType.TAKE, targetId: 10 });
    const takeState: TakePhaseState = { phase: "pickup", pickupPlanetId: 0 };
    const ctx = makeCtx({ mySelf, gs, mission });

    executeTake(ctx, takeState);
    expect(takeState.phase).toBe("transit");
  });

  it("returns empty when target planet is already friendly", () => {
    const targetPlanet = makePlanet({
      planetId: 10,
      team: Team.FEDERATION,
      x: 70000,
      y: 50000,
    });
    const mySelf = makeShip({ x: 50000, y: 50000 });
    const gs = makeGS({
      planets: [targetPlanet],
      ships: [mySelf],
      self: makeSelf({ kills: 2, armies: 5 }),
    });
    const mission = makeMission({ type: MissionType.TAKE, targetId: 10 });
    const takeState: TakePhaseState = { phase: "transit", pickupPlanetId: 0 };
    const ctx = makeCtx({ mySelf, gs, mission });

    const inputs = executeTake(ctx, takeState);
    expect(inputs).toHaveLength(0);
  });

  it("cloaks during approach phase (veteran)", () => {
    const targetPlanet = makePlanet({
      planetId: 10,
      team: Team.ROMULANS,
      x: 55000,
      y: 50000,
      armies: 3,
    });
    const mySelf = makeShip({
      x: 50000,
      y: 50000,
      orbiting: false,
      cloaked: false,
    });
    const gs = makeGS({
      planets: [targetPlanet],
      ships: [mySelf],
      self: makeSelf({ kills: 2, armies: 5, fuel: 8000 }),
    });
    const mission = makeMission({ type: MissionType.TAKE, targetId: 10 });
    const takeState: TakePhaseState = { phase: "approach", pickupPlanetId: 0 };
    const ctx = makeCtx({
      mySelf,
      gs,
      mission,
      difficulty: BotDifficulty.VETERAN,
    });

    const inputs = executeTake(ctx, takeState);
    const commands = inputs.map((i) => i.command);
    expect(commands).toContain(InputCommand.CLOAK_TOGGLE);
  });
});

// ---------------------------------------------------------------------------
// executeEscort
// ---------------------------------------------------------------------------

describe("executeEscort", () => {
  it("closes in toward escortee when too far", () => {
    const escortee = makeShip({
      slotIndex: 3,
      team: Team.FEDERATION,
      x: 60000,
      y: 50000,
      status: ShipStatus.ALIVE,
    });
    const mySelf = makeShip({ slotIndex: 0, x: 50000, y: 50000 });
    const gs = makeGS({ ships: [mySelf, escortee] });
    const mission = makeMission({
      type: MissionType.ESCORT,
      targetId: 3,
    });
    const ctx = makeCtx({ mySelf, gs, mission });

    const inputs = executeEscort(ctx);
    const commands = inputs.map((i) => i.command);
    expect(commands).toContain(InputCommand.SET_DIRECTION);
    const speedCmd = inputs.find((i) => i.command === InputCommand.SET_SPEED);
    expect(speedCmd).toBeDefined();
    expect(speedCmd!.value).toBe(8);
  });

  it("returns empty when escortee is dead", () => {
    const escortee = makeShip({
      slotIndex: 3,
      team: Team.FEDERATION,
      x: 60000,
      y: 50000,
      status: ShipStatus.DEAD,
    });
    const mySelf = makeShip({ slotIndex: 0, x: 50000, y: 50000 });
    const gs = makeGS({ ships: [mySelf, escortee] });
    const mission = makeMission({
      type: MissionType.ESCORT,
      targetId: 3,
    });
    const ctx = makeCtx({ mySelf, gs, mission });

    const inputs = executeEscort(ctx);
    expect(inputs).toHaveLength(0);
  });

  it("shields up when escorting", () => {
    const escortee = makeShip({
      slotIndex: 3,
      team: Team.FEDERATION,
      x: 60000,
      y: 50000,
      status: ShipStatus.ALIVE,
    });
    const mySelf = makeShip({
      slotIndex: 0,
      x: 50000,
      y: 50000,
      shieldsUp: false,
    });
    const gs = makeGS({ ships: [mySelf, escortee] });
    const mission = makeMission({
      type: MissionType.ESCORT,
      targetId: 3,
    });
    const ctx = makeCtx({ mySelf, gs, mission });

    const inputs = executeEscort(ctx);
    const commands = inputs.map((i) => i.command);
    expect(commands).toContain(InputCommand.SHIELD_TOGGLE);
  });

  it("slows down when too close to escortee", () => {
    const escortee = makeShip({
      slotIndex: 3,
      team: Team.FEDERATION,
      x: 51000,
      y: 50000,
      status: ShipStatus.ALIVE,
    });
    const mySelf = makeShip({ slotIndex: 0, x: 50000, y: 50000 });
    const gs = makeGS({ ships: [mySelf, escortee] });
    const mission = makeMission({
      type: MissionType.ESCORT,
      targetId: 3,
    });
    const ctx = makeCtx({ mySelf, gs, mission });

    const inputs = executeEscort(ctx);
    const speedCmd = inputs.find((i) => i.command === InputCommand.SET_SPEED);
    expect(speedCmd).toBeDefined();
    expect(speedCmd!.value).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// executeDefend
// ---------------------------------------------------------------------------

describe("executeDefend", () => {
  it("navigates toward planet when far away", () => {
    const planet = makePlanet({
      planetId: 5,
      team: Team.FEDERATION,
      x: 70000,
      y: 50000,
    });
    const mySelf = makeShip({ x: 50000, y: 50000 });
    const gs = makeGS({ planets: [planet], ships: [mySelf] });
    const mission = makeMission({
      type: MissionType.DEFEND,
      targetId: 5,
    });
    const ctx = makeCtx({ mySelf, gs, mission });

    const inputs = executeDefend(ctx);
    const commands = inputs.map((i) => i.command);
    expect(commands).toContain(InputCommand.SET_DIRECTION);
    expect(commands).toContain(InputCommand.SET_SPEED);
    const speedCmd = inputs.find((i) => i.command === InputCommand.SET_SPEED);
    expect(speedCmd!.value).toBe(6);
  });

  it("returns empty when planet is not friendly anymore", () => {
    const planet = makePlanet({
      planetId: 5,
      team: Team.ROMULANS,
      x: 70000,
      y: 50000,
    });
    const mySelf = makeShip({ x: 50000, y: 50000 });
    const gs = makeGS({ planets: [planet], ships: [mySelf] });
    const mission = makeMission({
      type: MissionType.DEFEND,
      targetId: 5,
    });
    const ctx = makeCtx({ mySelf, gs, mission });

    const inputs = executeDefend(ctx);
    expect(inputs).toHaveLength(0);
  });

  it("shields up when defending", () => {
    const planet = makePlanet({
      planetId: 5,
      team: Team.FEDERATION,
      x: 70000,
      y: 50000,
    });
    const mySelf = makeShip({ x: 50000, y: 50000, shieldsUp: false });
    const gs = makeGS({ planets: [planet], ships: [mySelf] });
    const mission = makeMission({
      type: MissionType.DEFEND,
      targetId: 5,
    });
    const ctx = makeCtx({ mySelf, gs, mission });

    const inputs = executeDefend(ctx);
    const commands = inputs.map((i) => i.command);
    expect(commands).toContain(InputCommand.SHIELD_TOGGLE);
  });

  it("slows down when near planet", () => {
    const planet = makePlanet({
      planetId: 5,
      team: Team.FEDERATION,
      x: 50500,
      y: 50000,
    });
    const mySelf = makeShip({ x: 50000, y: 50000 });
    const gs = makeGS({ planets: [planet], ships: [mySelf] });
    const mission = makeMission({
      type: MissionType.DEFEND,
      targetId: 5,
    });
    const ctx = makeCtx({ mySelf, gs, mission });

    const inputs = executeDefend(ctx);
    const speedCmd = inputs.find((i) => i.command === InputCommand.SET_SPEED);
    expect(speedCmd).toBeDefined();
    // Near planet: speed 2-4 (we use 3, or ORBIT_MAX_SPEED from moveToOrbit)
    expect(speedCmd!.value).toBeLessThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// executeOgg
// ---------------------------------------------------------------------------

describe("executeOgg", () => {
  it("fires and tractors at close range", () => {
    const target = makeShip({
      slotIndex: 5,
      team: Team.ROMULANS,
      x: 52000,
      y: 50000,
      status: ShipStatus.ALIVE,
    });
    const mySelf = makeShip({
      slotIndex: 0,
      x: 50000,
      y: 50000,
      tractoring: false,
    });
    const gs = makeGS({ ships: [mySelf, target] });
    const mission = makeMission({
      type: MissionType.OGG,
      targetId: 5,
    });
    const ctx = makeCtx({ mySelf, gs, mission });

    const inputs = executeOgg(ctx);
    const commands = inputs.map((i) => i.command);
    expect(commands).toContain(InputCommand.FIRE_PHASER);
    expect(commands).toContain(InputCommand.FIRE_TORP);
    expect(commands).toContain(InputCommand.TRACTOR);
  });

  it("self-destructs when very close to target", () => {
    const target = makeShip({
      slotIndex: 5,
      team: Team.ROMULANS,
      x: 50300,
      y: 50000,
      status: ShipStatus.ALIVE,
    });
    const mySelf = makeShip({ slotIndex: 0, x: 50000, y: 50000 });
    const gs = makeGS({ ships: [mySelf, target] });
    const mission = makeMission({
      type: MissionType.OGG,
      targetId: 5,
    });
    const ctx = makeCtx({ mySelf, gs, mission });

    const inputs = executeOgg(ctx);
    const commands = inputs.map((i) => i.command);
    expect(commands).toContain(InputCommand.DETONATE_SELF);
  });

  it("returns empty when target is dead", () => {
    const target = makeShip({
      slotIndex: 5,
      team: Team.ROMULANS,
      x: 60000,
      y: 50000,
      status: ShipStatus.DEAD,
    });
    const mySelf = makeShip({ slotIndex: 0, x: 50000, y: 50000 });
    const gs = makeGS({ ships: [mySelf, target] });
    const mission = makeMission({
      type: MissionType.OGG,
      targetId: 5,
    });
    const ctx = makeCtx({ mySelf, gs, mission });

    const inputs = executeOgg(ctx);
    expect(inputs).toHaveLength(0);
  });

  it("veteran cloaks when approaching from distance", () => {
    const target = makeShip({
      slotIndex: 5,
      team: Team.ROMULANS,
      x: 60000,
      y: 50000,
      status: ShipStatus.ALIVE,
    });
    const mySelf = makeShip({
      slotIndex: 0,
      x: 50000,
      y: 50000,
      cloaked: false,
    });
    const gs = makeGS({
      ships: [mySelf, target],
      self: makeSelf({ fuel: 8000 }),
    });
    const mission = makeMission({
      type: MissionType.OGG,
      targetId: 5,
    });
    const ctx = makeCtx({
      mySelf,
      gs,
      mission,
      difficulty: BotDifficulty.VETERAN,
    });

    const inputs = executeOgg(ctx);
    const commands = inputs.map((i) => i.command);
    expect(commands).toContain(InputCommand.CLOAK_TOGGLE);
  });

  it("approaches at speed 9", () => {
    const target = makeShip({
      slotIndex: 5,
      team: Team.ROMULANS,
      x: 60000,
      y: 50000,
      status: ShipStatus.ALIVE,
    });
    const mySelf = makeShip({ slotIndex: 0, x: 50000, y: 50000 });
    const gs = makeGS({ ships: [mySelf, target] });
    const mission = makeMission({
      type: MissionType.OGG,
      targetId: 5,
    });
    const ctx = makeCtx({ mySelf, gs, mission });

    const inputs = executeOgg(ctx);
    const speedCmd = inputs.find((i) => i.command === InputCommand.SET_SPEED);
    expect(speedCmd).toBeDefined();
    expect(speedCmd!.value).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// executeResupply
// ---------------------------------------------------------------------------

describe("executeResupply", () => {
  it("enters repair mode when no enemies nearby and damaged", () => {
    const mySelf = makeShip({
      x: 50000,
      y: 50000,
      hullDamagePct: 0.5, // 50% damage
      repairMode: false,
    });
    const gs = makeGS({
      ships: [mySelf],
      self: makeSelf({ hullDamage: 50 }),
    });
    const ctx = makeCtx({ mySelf, gs });

    const inputs = executeResupply(ctx);
    const commands = inputs.map((i) => i.command);
    expect(commands).toContain(InputCommand.REPAIR_TOGGLE);
    // Should also stop
    const speedCmd = inputs.find((i) => i.command === InputCommand.SET_SPEED);
    expect(speedCmd).toBeDefined();
    expect(speedCmd!.value).toBe(0);
  });

  it("returns empty when fully healed and fuel is adequate", () => {
    const mySelf = makeShip({
      x: 50000,
      y: 50000,
      hullDamagePct: 0.05, // 5% damage
      fuelPct: 0.8,
    });
    const gs = makeGS({ ships: [mySelf] });
    const ctx = makeCtx({ mySelf, gs });

    const inputs = executeResupply(ctx);
    expect(inputs).toHaveLength(0);
  });

  it("heads to fuel planet when fuel is low", () => {
    const fuelPlanet = makePlanet({
      planetId: 3,
      team: Team.FEDERATION,
      x: 40000,
      y: 50000,
      features: PlanetFeature.FUEL,
    });
    const mySelf = makeShip({
      x: 50000,
      y: 50000,
      fuelPct: 0.2, // 20% fuel
      hullDamagePct: 0.5,
    });
    const gs = makeGS({
      planets: [fuelPlanet],
      ships: [mySelf],
    });
    const ctx = makeCtx({ mySelf, gs });

    const inputs = executeResupply(ctx);
    const commands = inputs.map((i) => i.command);
    expect(commands).toContain(InputCommand.SET_DIRECTION);
    expect(commands).toContain(InputCommand.SET_SPEED);
  });

  it("heads to repair planet when badly damaged and planet is close", () => {
    const repairPlanet = makePlanet({
      planetId: 3,
      team: Team.FEDERATION,
      x: 55000,
      y: 50000,
      features: PlanetFeature.REPAIR,
    });
    const mySelf = makeShip({
      x: 50000,
      y: 50000,
      hullDamagePct: 0.6, // 60% damage
      fuelPct: 0.5,
    });
    const gs = makeGS({
      planets: [repairPlanet],
      ships: [mySelf],
    });
    const ctx = makeCtx({ mySelf, gs });

    const inputs = executeResupply(ctx);
    const commands = inputs.map((i) => i.command);
    expect(commands).toContain(InputCommand.SET_DIRECTION);
    expect(commands).toContain(InputCommand.SET_SPEED);
  });

  it("keeps moving when enemies are nearby", () => {
    const enemy = makeShip({
      slotIndex: 5,
      team: Team.ROMULANS,
      x: 55000,
      y: 50000,
      status: ShipStatus.ALIVE,
    });
    const friendlyPlanet = makePlanet({
      planetId: 0,
      team: Team.FEDERATION,
      x: 40000,
      y: 50000,
    });
    const mySelf = makeShip({
      slotIndex: 0,
      x: 50000,
      y: 50000,
      hullDamagePct: 0.5,
      fuelPct: 0.5,
    });
    const gs = makeGS({
      ships: [mySelf, enemy],
      planets: [friendlyPlanet],
    });
    const ctx = makeCtx({ mySelf, gs });

    const inputs = executeResupply(ctx);
    const commands = inputs.map((i) => i.command);
    // Should be moving, not repairing
    expect(commands).not.toContain(InputCommand.REPAIR_TOGGLE);
    expect(commands).toContain(InputCommand.SET_SPEED);
    const speedCmd = inputs.find((i) => i.command === InputCommand.SET_SPEED);
    expect(speedCmd!.value).toBeGreaterThan(0);
  });
});

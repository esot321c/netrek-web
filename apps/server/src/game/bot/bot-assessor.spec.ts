import { describe, it, expect } from "vitest";
import { assess } from "./bot-assessor";
import {
  MissionType,
  ORDER_SCORE_BONUS,
  type TeamBotState,
  type BotOrder,
} from "./bot-types";
import {
  BotDifficulty,
  Team,
  ShipStatus,
  ShipType,
  PlanetVisibility,
  PlanetFeature,
  AlertStatus,
  type ClientShip,
  type ClientPlanet,
  type ClientSelfExtra,
  type ClientGameState,
} from "@netrek/shared";

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
    shieldStrength: 100,
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
    x: 50000,
    y: 50000,
    name: "Earth",
    team: Team.FEDERATION,
    armies: 10,
    features: 0,
    visibility: PlanetVisibility.FRESH,
    ...overrides,
  };
}

function makeGS(overrides: Partial<ClientGameState> = {}): ClientGameState {
  return {
    tick: 100,
    recipientSlot: 0,
    ships: [makeShip({ slotIndex: 0, team: Team.FEDERATION })],
    torps: [],
    phasers: [],
    explosions: [],
    plasmas: [],
    planets: [],
    self: makeSelf(),
    ...overrides,
  };
}

describe("assess", () => {
  it("RESUPPLY scores high when hull damage is high", () => {
    const myShip = makeShip({ slotIndex: 0, hullDamagePct: 0.6, fuelPct: 0.2 });
    const gs = makeGS();
    const candidates = assess(
      50000,
      50000,
      gs,
      Team.FEDERATION,
      Team.ROMULANS,
      0,
      BotDifficulty.COMPETENT,
      [],
      null,
      myShip,
    );
    const resupply = candidates.find((c) => c.type === MissionType.RESUPPLY);
    const patrol = candidates.find((c) => c.type === MissionType.PATROL);
    expect(resupply!.score).toBeGreaterThan(patrol!.score);
  });

  it("BOMB scores high for army-rich enemy planet", () => {
    const myShip = makeShip({ slotIndex: 0 });
    const planet = makePlanet({
      planetId: 15,
      team: Team.ROMULANS,
      armies: 30,
      x: 55000,
      y: 50000,
    });
    const gs = makeGS({ ships: [myShip], planets: [planet] });
    const candidates = assess(
      50000,
      50000,
      gs,
      Team.FEDERATION,
      Team.ROMULANS,
      0,
      BotDifficulty.COMPETENT,
      [],
      null,
      myShip,
    );
    const bomb = candidates.find((c) => c.type === MissionType.BOMB);
    expect(bomb).toBeDefined();
    expect(bomb!.score).toBeGreaterThan(40);
  });

  it("chat order adds bonus to matching mission", () => {
    const myShip = makeShip({ slotIndex: 0 });
    const planet = makePlanet({
      planetId: 15,
      team: Team.ROMULANS,
      armies: 10,
      x: 55000,
      y: 50000,
    });
    const gs = makeGS({ ships: [myShip], planets: [planet] });
    const order: BotOrder = {
      missionType: MissionType.BOMB,
      targetId: 15,
      receivedTick: 50,
      expiresTick: 650,
    };
    const withOrder = assess(
      50000,
      50000,
      gs,
      Team.FEDERATION,
      Team.ROMULANS,
      0,
      BotDifficulty.COMPETENT,
      [],
      order,
      myShip,
    );
    const withoutOrder = assess(
      50000,
      50000,
      gs,
      Team.FEDERATION,
      Team.ROMULANS,
      0,
      BotDifficulty.COMPETENT,
      [],
      null,
      myShip,
    );
    const bombWithOrder = withOrder.find(
      (c) => c.type === MissionType.BOMB && c.targetId === 15,
    );
    const bombWithout = withoutOrder.find(
      (c) => c.type === MissionType.BOMB && c.targetId === 15,
    );
    expect(bombWithOrder!.score - bombWithout!.score).toBe(ORDER_SCORE_BONUS);
  });

  it("deduplication penalizes missions other bots are doing", () => {
    const myShip = makeShip({ slotIndex: 0 });
    const planet = makePlanet({
      planetId: 15,
      team: Team.ROMULANS,
      armies: 10,
      x: 55000,
      y: 50000,
    });
    const gs = makeGS({ ships: [myShip], planets: [planet] });
    const teamBots: TeamBotState[] = [
      {
        slot: 2,
        currentMission: MissionType.BOMB,
        missionTargetId: 15,
      },
      {
        slot: 3,
        currentMission: MissionType.BOMB,
        missionTargetId: 15,
      },
    ];
    const noDup = assess(
      50000,
      50000,
      gs,
      Team.FEDERATION,
      Team.ROMULANS,
      0,
      BotDifficulty.COMPETENT,
      [],
      null,
      myShip,
    );
    const withDup = assess(
      50000,
      50000,
      gs,
      Team.FEDERATION,
      Team.ROMULANS,
      0,
      BotDifficulty.COMPETENT,
      teamBots,
      null,
      myShip,
    );
    const bombNoDup = noDup.find(
      (c) => c.type === MissionType.BOMB && c.targetId === 15,
    );
    const bombWithDup = withDup.find(
      (c) => c.type === MissionType.BOMB && c.targetId === 15,
    );
    expect(bombWithDup!.score).toBeLessThan(bombNoDup!.score);
  });

  it("healthy bots score RESUPPLY at 0, below PATROL", () => {
    const myShip = makeShip({ slotIndex: 0, hullDamagePct: 0, fuelPct: 1 });
    const gs = makeGS();
    const candidates = assess(
      50000,
      50000,
      gs,
      Team.FEDERATION,
      Team.ROMULANS,
      0,
      BotDifficulty.COMPETENT,
      [],
      null,
      myShip,
    );
    const resupply = candidates.find((c) => c.type === MissionType.RESUPPLY);
    const patrol = candidates.find((c) => c.type === MissionType.PATROL);
    expect(resupply!.score).toBe(0);
    expect(patrol!.score).toBeGreaterThan(resupply!.score);
  });

  it("PATROL is always a candidate as fallback", () => {
    const myShip = makeShip({ slotIndex: 0 });
    const gs = makeGS({ ships: [myShip] });
    const candidates = assess(
      50000,
      50000,
      gs,
      Team.FEDERATION,
      Team.ROMULANS,
      0,
      BotDifficulty.NEWBIE,
      [],
      null,
      myShip,
    );
    const patrol = candidates.find((c) => c.type === MissionType.PATROL);
    expect(patrol).toBeDefined();
  });

  it("DEFEND scores when enemies threaten a friendly planet", () => {
    const myShip = makeShip({
      slotIndex: 0,
      team: Team.FEDERATION,
    });
    const enemyShip = makeShip({
      slotIndex: 1,
      team: Team.ROMULANS,
      x: 51000,
      y: 50000,
    });
    const friendlyPlanet = makePlanet({
      planetId: 2,
      team: Team.FEDERATION,
      x: 52000,
      y: 50000,
    });
    const gs = makeGS({
      ships: [myShip, enemyShip],
      planets: [friendlyPlanet],
    });
    const candidates = assess(
      50000,
      50000,
      gs,
      Team.FEDERATION,
      Team.ROMULANS,
      0,
      BotDifficulty.COMPETENT,
      [],
      null,
      myShip,
    );
    const defend = candidates.find((c) => c.type === MissionType.DEFEND);
    expect(defend).toBeDefined();
    expect(defend!.score).toBeGreaterThan(15);
  });

  it("OGG appears for COMPETENT+ when enemy carrier exists", () => {
    const myShip = makeShip({
      slotIndex: 0,
      team: Team.FEDERATION,
    });
    const enemyCarrier = makeShip({
      slotIndex: 1,
      team: Team.ROMULANS,
      beaming: 2,
      x: 60000,
      y: 50000,
    });
    const gs = makeGS({ ships: [myShip, enemyCarrier] });
    const competent = assess(
      50000,
      50000,
      gs,
      Team.FEDERATION,
      Team.ROMULANS,
      0,
      BotDifficulty.COMPETENT,
      [],
      null,
      myShip,
    );
    const newbie = assess(
      50000,
      50000,
      gs,
      Team.FEDERATION,
      Team.ROMULANS,
      0,
      BotDifficulty.NEWBIE,
      [],
      null,
      myShip,
    );
    expect(competent.find((c) => c.type === MissionType.OGG)).toBeDefined();
    expect(newbie.find((c) => c.type === MissionType.OGG)).toBeUndefined();
  });

  it("results are sorted by score descending", () => {
    const myShip = makeShip({ slotIndex: 0, hullDamagePct: 0.6, fuelPct: 0.2 });
    const gs = makeGS();
    const candidates = assess(
      50000,
      50000,
      gs,
      Team.FEDERATION,
      Team.ROMULANS,
      0,
      BotDifficulty.COMPETENT,
      [],
      null,
      myShip,
    );
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i]!.score).toBeLessThanOrEqual(
        candidates[i - 1]!.score,
      );
    }
  });
});

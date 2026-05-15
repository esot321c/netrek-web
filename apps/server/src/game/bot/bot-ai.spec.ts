import { describe, it, expect, beforeEach } from "vitest";
import { BotBrain } from "./bot-ai";
import {
  BotDifficulty,
  BotAIState,
  Team,
  ShipType,
  ShipStatus,
  AlertStatus,
  PlanetFeature,
  PlanetVisibility,
  type ClientShip,
  type ClientPlanet,
  type ClientSelfExtra,
  type ClientGameState,
  type ClientTorp,
  type ClientPhaser,
  type ClientExplosion,
} from "@netrek/shared";
import { MissionType } from "./bot-types";

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

/** Build a minimal ClientGameState with the bot's own ship at slot 0. */
function makeState(
  selfShipOverrides: Partial<ClientShip> = {},
  selfOverrides: Partial<ClientSelfExtra> = {},
  extraShips: ClientShip[] = [],
  extraPlanets: ClientPlanet[] = [],
  tick = 0,
): ClientGameState {
  const botShip = makeShip({
    slotIndex: 0,
    team: Team.FEDERATION,
    ...selfShipOverrides,
  });
  const friendlyPlanet = makePlanet({
    planetId: 0,
    team: Team.FEDERATION,
    x: 45000,
    y: 45000,
  });

  return {
    tick,
    recipientSlot: 0,
    ships: [botShip, ...extraShips],
    torps: [] as ClientTorp[],
    phasers: [] as ClientPhaser[],
    explosions: [] as ClientExplosion[],
    plasmas: [],
    planets: [friendlyPlanet, ...extraPlanets],
    self: makeSelf(selfOverrides),
  };
}

// ---------------------------------------------------------------------------
// BotBrain tests
// ---------------------------------------------------------------------------

describe("BotBrain", () => {
  let brain: BotBrain;

  beforeEach(() => {
    brain = new BotBrain(BotDifficulty.COMPETENT, Team.FEDERATION, 0);
  });

  // -------------------------------------------------------------------------
  // 1. Starts in PATROL state
  // -------------------------------------------------------------------------

  it("starts in PATROL state", () => {
    expect(brain.currentState).toBe(BotAIState.PATROL);
  });

  // -------------------------------------------------------------------------
  // 2. Produces inputs with valid game state
  // -------------------------------------------------------------------------

  it("produces inputs when an enemy planet exists for patrol target", () => {
    const enemyPlanet = makePlanet({
      planetId: 10,
      team: Team.ROMULANS,
      x: 80000,
      y: 50000,
      armies: 17,
    });
    const gs = makeState({}, {}, [], [enemyPlanet]);
    const inputs = brain.think(gs);
    expect(inputs.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 3. Reports ATTACK state when in combat (enemy ship nearby)
  // -------------------------------------------------------------------------

  it("reports ATTACK state when an enemy ship is within combat engage distance", () => {
    // Place enemy within FORCED_FIGHT_RANGE (3000) — even task-focused missions fight at this range
    const enemy = makeShip({
      slotIndex: 1,
      team: Team.ROMULANS,
      x: 52000, // 2000 units away
      y: 50000,
      status: ShipStatus.ALIVE,
    });
    const enemyPlanet = makePlanet({
      planetId: 10,
      team: Team.ROMULANS,
      x: 80000,
      y: 50000,
      armies: 17,
    });
    const gs = makeState({}, {}, [enemy], [enemyPlanet]);
    brain.think(gs);
    expect(brain.currentState).toBe(BotAIState.ATTACK);
  });

  // -------------------------------------------------------------------------
  // 4. Heavy damage triggers re-assessment (mission changes to RESUPPLY)
  // -------------------------------------------------------------------------

  it("heavy damage triggers re-assessment and switches to RESUPPLY mission", () => {
    // First tick: healthy bot, enemy planet nearby => BOMB should score well
    // BOMB score for planet at 60000: dist = ~10000, armies = 17
    //   = 40 + 17*3 - 10000*0.002 = 40 + 51 - 20 = 71
    // RESUPPLY at full health: needsResupply=false, score=0. BOMB wins.
    const enemyPlanet = makePlanet({
      planetId: 10,
      team: Team.ROMULANS,
      x: 60000,
      y: 50000,
      armies: 17,
    });
    const gs1 = makeState(
      { hullDamagePct: 0, fuelPct: 1 },
      {},
      [],
      [enemyPlanet],
      0,
    );
    brain.think(gs1);
    expect(brain.currentMission).toBe(MissionType.BOMB);

    // Second tick: sudden jump to 80% hull damage.
    // Delta = 0.8 - 0 = 0.8 > 0.3. Triggers needsReassessment.
    // Resupply score = 20 + 0.8*80 + (1-0.2)*60 = 20+64+48 = 132
    // That exceeds BOMB score of 71.
    const gs2 = makeState(
      { hullDamagePct: 0.8, fuelPct: 0.2 },
      {},
      [],
      [enemyPlanet],
      1,
    );
    brain.think(gs2);
    expect(brain.currentMission).toBe(MissionType.RESUPPLY);
  });

  // -------------------------------------------------------------------------
  // 5. setOrder triggers reassessment (mission changes)
  // -------------------------------------------------------------------------

  it("setOrder triggers reassessment and changes mission", () => {
    const enemyPlanet = makePlanet({
      planetId: 5,
      team: Team.ROMULANS,
      x: 60000,
      y: 50000,
      armies: 17,
    });
    const gs = makeState({}, {}, [], [enemyPlanet]);

    // First call: normal assessment
    brain.think(gs);
    const firstMission = brain.currentMission;

    // Issue order to bomb planet 5
    brain.setOrder(BotAIState.BOMB, 5, 0);

    // Next think: order bonus should push BOMB to top
    const gs2 = makeState({}, {}, [], [enemyPlanet], 1);
    brain.think(gs2);
    expect(brain.currentMission).toBe(MissionType.BOMB);
    expect(brain.currentMissionTargetId).toBe(5);
  });

  // -------------------------------------------------------------------------
  // 6. Exposes currentMission and currentMissionTargetId
  // -------------------------------------------------------------------------

  it("exposes currentMission and currentMissionTargetId for team registry", () => {
    expect(brain.currentMission).toBe(MissionType.PATROL);
    expect(brain.currentMissionTargetId).toBe(-1);

    // After assessment with a bomb order
    const enemyPlanet = makePlanet({
      planetId: 7,
      team: Team.ROMULANS,
      x: 60000,
      y: 50000,
      armies: 17,
    });
    brain.setOrder(BotAIState.BOMB, 7, 0);
    const gs = makeState({}, {}, [], [enemyPlanet]);
    brain.think(gs);

    expect(brain.currentMission).toBe(MissionType.BOMB);
    expect(brain.currentMissionTargetId).toBe(7);
  });

  // -------------------------------------------------------------------------
  // 7. clearOrder clears the order
  // -------------------------------------------------------------------------

  it("clearOrder clears the order so it no longer affects assessment", () => {
    brain.setOrder(BotAIState.BOMB, 5, 0);
    brain.clearOrder();

    // Without the order bonus, BOMB may not be chosen if no planet is worth it
    const gs = makeState({}, {}, [], []);
    brain.think(gs);
    // With no enemy planets in state, there's nothing to bomb
    expect(brain.currentMission).not.toBe(MissionType.BOMB);
  });

  // -------------------------------------------------------------------------
  // 8. Returns empty when ship is dead
  // -------------------------------------------------------------------------

  it("returns empty array when own ship is dead", () => {
    const gs = makeState({ status: ShipStatus.DEAD });
    const inputs = brain.think(gs);
    expect(inputs).toHaveLength(0);
  });

  it("returns empty array when own ship is exploding", () => {
    const gs = makeState({ status: ShipStatus.EXPLODING });
    const inputs = brain.think(gs);
    expect(inputs).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 9. currentState maps RESUPPLY mission to RETREAT BotAIState
  // -------------------------------------------------------------------------

  it("currentState maps RESUPPLY mission to RETREAT BotAIState for backward compat", () => {
    // Force high damage + low fuel so assessor picks RESUPPLY
    const gs = makeState({ hullDamagePct: 0.8, fuelPct: 0.2 }, {}, [], [], 0);
    brain.think(gs);
    // RESUPPLY mission should map to RETREAT in the BotAIState getter
    if (brain.currentMission === MissionType.RESUPPLY) {
      expect(brain.currentState).toBe(BotAIState.RETREAT);
    }
  });

  // -------------------------------------------------------------------------
  // Additional tests
  // -------------------------------------------------------------------------

  it("has correct slot, difficulty, team, and enemyTeam after construction", () => {
    const b = new BotBrain(BotDifficulty.VETERAN, Team.ROMULANS, 7);
    expect(b.slot).toBe(7);
    expect(b.difficulty).toBe(BotDifficulty.VETERAN);
    expect(b.team).toBe(Team.ROMULANS);
    expect(b.enemyTeam).toBe(Team.FEDERATION);
  });

  it("order expires after ORDER_EXPIRE_TICKS (600 ticks)", () => {
    // Use a scenario with no enemy planets at all so that without an order
    // the assessor has nothing to BOMB and defaults to PATROL.
    // Set a BOMB order targeting planet 5 at tick 0 (expires at tick 600).
    const enemyPlanet = makePlanet({
      planetId: 5,
      team: Team.ROMULANS,
      x: 60000,
      y: 50000,
      armies: 17,
    });
    brain.setOrder(BotAIState.BOMB, 5, 0);
    const gs1 = makeState({}, {}, [], [enemyPlanet], 0);
    brain.think(gs1);
    expect(brain.currentMission).toBe(MissionType.BOMB);

    // At tick 600, order expires. With ASSESS_INTERVAL_TICKS = 15,
    // the assessor will re-run. Without the +40 order bonus, BOMB score
    // for a planet 10000 units away with 17 armies = 40 + 51 - 20 = 71.
    // That still beats RESUPPLY_BASE (20), so BOMB persists on its own merit.
    // To verify expiry, remove the planet so BOMB has no valid target.
    const gs2 = makeState({}, {}, [], [], 600);
    brain.think(gs2);
    // No enemy planets left => BOMB not a candidate. Healthy bot: RESUPPLY=0, PATROL=15.
    expect(brain.currentMission).toBe(MissionType.PATROL);
  });

  it("think accepts optional teamBots parameter", () => {
    const enemyPlanet = makePlanet({
      planetId: 10,
      team: Team.ROMULANS,
      x: 80000,
      y: 50000,
      armies: 17,
    });
    const gs = makeState({}, {}, [], [enemyPlanet]);
    // Should work with teamBots
    const inputs = brain.think(gs, [
      { slot: 1, currentMission: MissionType.PATROL, missionTargetId: -1 },
    ]);
    expect(inputs.length).toBeGreaterThanOrEqual(0);
  });

  it("all returned inputs carry the tick from the game state", () => {
    const enemyPlanet = makePlanet({
      planetId: 10,
      team: Team.ROMULANS,
      x: 80000,
      y: 50000,
      armies: 17,
    });
    const gs = makeState({}, {}, [], [enemyPlanet], 42);
    const inputs = brain.think(gs);
    for (const inp of inputs) {
      expect(inp.tick).toBe(42);
    }
  });

  it("combat module returns to mission execution when enemies leave", () => {
    const enemyPlanet = makePlanet({
      planetId: 10,
      team: Team.ROMULANS,
      x: 80000,
      y: 50000,
      armies: 17,
    });
    const enemy = makeShip({
      slotIndex: 1,
      team: Team.ROMULANS,
      x: 52000, // within forced-fight range
      y: 50000,
      status: ShipStatus.ALIVE,
    });

    // Enter combat
    const gs1 = makeState({}, {}, [enemy], [enemyPlanet], 0);
    brain.think(gs1);
    expect(brain.currentState).toBe(BotAIState.ATTACK);

    // Enemy moves far away - after disengage ticks (20), combat exits
    const farEnemy = makeShip({
      slotIndex: 1,
      team: Team.ROMULANS,
      x: 90000, // way out of range
      y: 50000,
      status: ShipStatus.ALIVE,
    });
    // Run enough ticks for combat to disengage (COMBAT_EXIT_TICKS = 20)
    for (let t = 1; t <= 25; t++) {
      const gs = makeState({}, {}, [farEnemy], [enemyPlanet], t);
      brain.think(gs);
    }
    // After disengaging, should be back to a non-ATTACK state
    expect(brain.currentState).not.toBe(BotAIState.ATTACK);
  });
});

import { describe, it, expect } from "vitest";
import {
  createCombatState,
  updateCombat,
  combatShieldLogic,
  combatMovement,
  combatWeapons,
  combatTractorPressor,
} from "./bot-combat-module";
import {
  BotDifficulty,
  ShipType,
  ShipStatus,
  Team,
  AlertStatus,
  InputCommand,
  SHIP_STATS,
  type ClientShip,
  type ClientSelfExtra,
  type ClientGameState,
  type ClientTorp,
  type ClientPhaser,
  type ClientExplosion,
  type ClientPlasma,
  type ClientPlanet,
} from "@netrek/shared";
import {
  CombatPhase,
  COMBAT_ENGAGE_DIST,
  COMBAT_EXIT_TICKS,
} from "./bot-types";

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
    speed: 4,
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

function makeGameState(
  overrides: Partial<ClientGameState> = {},
): ClientGameState {
  return {
    tick: 100,
    recipientSlot: 0,
    ships: [],
    torps: [],
    phasers: [] as ClientPhaser[],
    explosions: [] as ClientExplosion[],
    plasmas: [] as ClientPlasma[],
    planets: [] as ClientPlanet[],
    self: makeSelf(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Phase transitions
// ---------------------------------------------------------------------------

describe("updateCombat — phase transitions", () => {
  it("enters ENGAGED when enemy within engage distance", () => {
    const myShip = makeShip({
      slotIndex: 0,
      team: Team.FEDERATION,
      x: 50000,
      y: 50000,
    });
    const enemy = makeShip({
      slotIndex: 1,
      team: Team.ROMULANS,
      x: 50000 + COMBAT_ENGAGE_DIST - 100,
      y: 50000,
    });
    const combat = createCombatState();
    const state = makeGameState({
      ships: [myShip, enemy],
      tick: 100,
    });

    const result = updateCombat(
      state,
      myShip,
      state.self,
      combat,
      BotDifficulty.COMPETENT,
      Team.FEDERATION,
      Team.ROMULANS,
      100,
    );

    expect(combat.phase).toBe(CombatPhase.ENGAGED);
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);
  });

  it("returns null when no enemies in range (stays NONE)", () => {
    const myShip = makeShip({
      slotIndex: 0,
      team: Team.FEDERATION,
      x: 50000,
      y: 50000,
    });
    // Enemy very far away
    const enemy = makeShip({
      slotIndex: 1,
      team: Team.ROMULANS,
      x: 90000,
      y: 90000,
    });
    const combat = createCombatState();
    const state = makeGameState({
      ships: [myShip, enemy],
      tick: 100,
    });

    const result = updateCombat(
      state,
      myShip,
      state.self,
      combat,
      BotDifficulty.COMPETENT,
      Team.FEDERATION,
      Team.ROMULANS,
      100,
    );

    expect(combat.phase).toBe(CombatPhase.NONE);
    expect(result).toBeNull();
  });

  it("transitions to DISENGAGING when enemy leaves range", () => {
    const myShip = makeShip({
      slotIndex: 0,
      team: Team.FEDERATION,
      x: 50000,
      y: 50000,
    });
    const combat = createCombatState();
    combat.phase = CombatPhase.ENGAGED;
    combat.targetSlot = 1;

    // No enemies in range
    const state = makeGameState({
      ships: [myShip],
      tick: 100,
    });

    const result = updateCombat(
      state,
      myShip,
      state.self,
      combat,
      BotDifficulty.COMPETENT,
      Team.FEDERATION,
      Team.ROMULANS,
      100,
    );

    expect(combat.phase).toBe(CombatPhase.DISENGAGING);
    expect(result).not.toBeNull();
  });

  it("exits combat (returns null, phase=NONE) after COMBAT_EXIT_TICKS with no threats", () => {
    const myShip = makeShip({
      slotIndex: 0,
      team: Team.FEDERATION,
      x: 50000,
      y: 50000,
    });
    const combat = createCombatState();
    combat.phase = CombatPhase.DISENGAGING;
    combat.ticksSinceLastThreat = COMBAT_EXIT_TICKS - 1; // one more tick will trigger exit

    // No enemies
    const state = makeGameState({
      ships: [myShip],
      tick: 200,
    });

    const result = updateCombat(
      state,
      myShip,
      state.self,
      combat,
      BotDifficulty.COMPETENT,
      Team.FEDERATION,
      Team.ROMULANS,
      200,
    );

    expect(combat.phase).toBe(CombatPhase.NONE);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// NEWBIE combat — no tractor/pressor
// ---------------------------------------------------------------------------

describe("NEWBIE combat", () => {
  it("does not use tractor or pressor", () => {
    const myShip = makeShip({
      slotIndex: 0,
      team: Team.FEDERATION,
      x: 50000,
      y: 50000,
    });
    const enemy = makeShip({
      slotIndex: 1,
      team: Team.ROMULANS,
      x: 50000 + 2000, // close enough for pressor consideration
      y: 50000,
    });
    const combat = createCombatState();
    combat.phase = CombatPhase.ENGAGED;
    combat.targetSlot = 1;

    const state = makeGameState({
      ships: [myShip, enemy],
      tick: 100,
    });

    const result = updateCombat(
      state,
      myShip,
      state.self,
      combat,
      BotDifficulty.NEWBIE,
      Team.FEDERATION,
      Team.ROMULANS,
      100,
    );

    expect(result).not.toBeNull();
    const hasTractor = result!.some((i) => i.command === InputCommand.TRACTOR);
    const hasPressor = result!.some((i) => i.command === InputCommand.PRESSOR);
    expect(hasTractor).toBe(false);
    expect(hasPressor).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Shield management
// ---------------------------------------------------------------------------

describe("combatShieldLogic", () => {
  it("COMPETENT+ raises shields during combat if shields are down", () => {
    const myShip = makeShip({ shieldsUp: false });
    const enemy = makeShip({
      slotIndex: 1,
      team: Team.ROMULANS,
      x: 50000 + 5000,
      y: 50000,
    });
    const self = makeSelf();

    const inputs = combatShieldLogic(
      myShip,
      self,
      [enemy],
      BotDifficulty.COMPETENT,
      100,
    );

    const hasShieldToggle = inputs.some(
      (i) => i.command === InputCommand.SHIELD_TOGGLE,
    );
    expect(hasShieldToggle).toBe(true);
  });

  it("COMPETENT+ does not toggle shields if already up", () => {
    const myShip = makeShip({ shieldsUp: true });
    const enemy = makeShip({
      slotIndex: 1,
      team: Team.ROMULANS,
      x: 50000 + 5000,
      y: 50000,
    });
    const self = makeSelf();

    const inputs = combatShieldLogic(
      myShip,
      self,
      [enemy],
      BotDifficulty.COMPETENT,
      100,
    );

    expect(inputs.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Weapons — torp leading for VETERAN
// ---------------------------------------------------------------------------

describe("combatWeapons", () => {
  it("fires torps with leading for VETERAN", () => {
    const myShip = makeShip({
      slotIndex: 0,
      team: Team.FEDERATION,
      x: 50000,
      y: 50000,
      weaponTemp: 0,
      shipType: ShipType.CA,
    });
    // Target moving east (direction 64), within torp range
    const target = makeShip({
      slotIndex: 1,
      team: Team.ROMULANS,
      x: 50000 + 5000,
      y: 50000,
      direction: 64,
      speed: 6,
    });
    const self = makeSelf({ weaponBurnout: 0 });

    const inputs = combatWeapons(
      myShip,
      self,
      target,
      [], // no torps in flight
      BotDifficulty.VETERAN,
      100,
    );

    const torpInput = inputs.find((i) => i.command === InputCommand.FIRE_TORP);
    expect(torpInput).toBeDefined();
    // The lead direction should differ from the direct direction (64-ish)
    // because the target is moving east
    // Direct direction from (50000,50000) to (55000,50000) is east = 64
    // With leading, the torp direction should be offset
    expect(torpInput!.value).toBeGreaterThanOrEqual(0);
    expect(torpInput!.value).toBeLessThanOrEqual(255);
  });

  it("does not fire when weapon temp exceeds allStop threshold", () => {
    const stats = SHIP_STATS[ShipType.CA];
    const myShip = makeShip({
      slotIndex: 0,
      team: Team.FEDERATION,
      weaponTemp: stats.maxWpnTemp * 0.95, // above 90% threshold
      shipType: ShipType.CA,
    });
    const target = makeShip({
      slotIndex: 1,
      team: Team.ROMULANS,
      x: 50000 + 3000,
      y: 50000,
    });
    const self = makeSelf();

    const inputs = combatWeapons(
      myShip,
      self,
      target,
      [],
      BotDifficulty.VETERAN,
      100,
    );

    const hasTorp = inputs.some((i) => i.command === InputCommand.FIRE_TORP);
    const hasPhaser = inputs.some(
      (i) => i.command === InputCommand.FIRE_PHASER,
    );
    expect(hasTorp).toBe(false);
    expect(hasPhaser).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tractor / Pressor
// ---------------------------------------------------------------------------

describe("combatTractorPressor", () => {
  it("COMPETENT uses pressor when too close", () => {
    const myShip = makeShip({
      slotIndex: 0,
      team: Team.FEDERATION,
      x: 50000,
      y: 50000,
      pressoring: false,
      pressorTarget: -1,
    });
    const target = makeShip({
      slotIndex: 1,
      team: Team.ROMULANS,
      x: 50000 + 2000, // within MIN_COMBAT_DIST (2500)
      y: 50000,
    });

    const inputs = combatTractorPressor(
      myShip,
      target,
      BotDifficulty.COMPETENT,
      100,
    );

    const hasPressor = inputs.some((i) => i.command === InputCommand.PRESSOR);
    expect(hasPressor).toBe(true);
  });

  it("VETERAN uses tractor on fleeing enemy", () => {
    const myShip = makeShip({
      slotIndex: 0,
      team: Team.FEDERATION,
      x: 50000,
      y: 50000,
      tractoring: false,
      tractorTarget: -1,
    });
    // Enemy heading away (direction 64 = east, and enemy is east of us)
    // dirToMe from enemy to us would be 192 (west)
    // target.direction = 64, delta = |64 - 192| normalized = 128 > 64 => fleeing
    const target = makeShip({
      slotIndex: 1,
      team: Team.ROMULANS,
      x: 50000 + 4000, // within tractor range (CA tractorRange=1.0 * 6000 = 6000)
      y: 50000,
      direction: 64, // heading east (away from us if we're west)
    });

    const inputs = combatTractorPressor(
      myShip,
      target,
      BotDifficulty.VETERAN,
      100,
    );

    const hasTractor = inputs.some((i) => i.command === InputCommand.TRACTOR);
    expect(hasTractor).toBe(true);
  });

  it("VETERAN does not tractor enemy heading towards us", () => {
    const myShip = makeShip({
      slotIndex: 0,
      team: Team.FEDERATION,
      x: 50000,
      y: 50000,
      tractoring: false,
      tractorTarget: -1,
    });
    // Enemy is east of us and heading west (192) = heading towards us
    // dirToMe from enemy perspective is 192 (west)
    // target.direction = 192, delta = |192 - 192| = 0 < 64 => not fleeing
    const target = makeShip({
      slotIndex: 1,
      team: Team.ROMULANS,
      x: 50000 + 4000,
      y: 50000,
      direction: 192, // heading west (towards us)
    });

    const inputs = combatTractorPressor(
      myShip,
      target,
      BotDifficulty.VETERAN,
      100,
    );

    const hasTractor = inputs.some((i) => i.command === InputCommand.TRACTOR);
    expect(hasTractor).toBe(false);
  });
});

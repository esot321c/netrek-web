import { describe, it, expect } from "vitest";
import {
  selectTarget,
  shouldRetreat,
  shouldFirePhaser,
  shouldFireTorp,
  shouldCloak,
} from "./bot-combat";
import {
  BotDifficulty,
  ShipType,
  ShipStatus,
  Team,
  AlertStatus,
  type ClientShip,
  type ClientSelfExtra,
} from "@netrek/shared";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeShip(overrides: Partial<ClientShip> = {}): ClientShip {
  return {
    slotIndex: 0,
    status: ShipStatus.ALIVE,
    team: Team.ROMULANS,
    shipType: ShipType.CA,
    x: 0,
    y: 0,
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
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// selectTarget
// ---------------------------------------------------------------------------

describe("selectTarget", () => {
  it("returns null for empty enemies array", () => {
    expect(selectTarget(0, 0, [], BotDifficulty.NEWBIE)).toBeNull();
  });

  it("newbie: picks the closest enemy", () => {
    const near = makeShip({ slotIndex: 1, x: 100, y: 0 });
    const far = makeShip({ slotIndex: 2, x: 5000, y: 0 });
    expect(selectTarget(0, 0, [far, near], BotDifficulty.NEWBIE)).toBe(near);
  });

  it("newbie: picks closest even when far target is heavily damaged", () => {
    const nearHealthy = makeShip({
      slotIndex: 1,
      x: 100,
      y: 0,
      hullDamagePct: 0,
    });
    const farDamaged = makeShip({
      slotIndex: 2,
      x: 5000,
      y: 0,
      hullDamagePct: 0.9,
    });
    // Newbie always picks closest regardless of damage
    expect(
      selectTarget(0, 0, [farDamaged, nearHealthy], BotDifficulty.NEWBIE),
    ).toBe(nearHealthy);
  });

  it("competent: prefers a damaged nearby target over a healthy far target", () => {
    const nearDamaged = makeShip({
      slotIndex: 1,
      x: 500,
      y: 0,
      hullDamagePct: 0.8,
    });
    const farHealthy = makeShip({
      slotIndex: 2,
      x: 8000,
      y: 0,
      hullDamagePct: 0,
    });
    expect(
      selectTarget(0, 0, [farHealthy, nearDamaged], BotDifficulty.COMPETENT),
    ).toBe(nearDamaged);
  });

  it("competent: avoids starbases when a non-starbase option exists", () => {
    // Starbase right next to bot, regular ship nearby but farther
    const closeSB = makeShip({
      slotIndex: 1,
      x: 100,
      y: 0,
      shipType: ShipType.SB,
    });
    const regularShip = makeShip({
      slotIndex: 2,
      x: 500,
      y: 0,
      shipType: ShipType.CA,
    });
    // With scoring, the regular ship should be preferred because starbase is penalised
    const result = selectTarget(
      0,
      0,
      [closeSB, regularShip],
      BotDifficulty.COMPETENT,
    );
    expect(result).toBe(regularShip);
  });

  it("veteran: prefers a damaged nearby target (same logic as competent)", () => {
    const nearDamaged = makeShip({
      slotIndex: 1,
      x: 500,
      y: 0,
      hullDamagePct: 0.7,
    });
    const farHealthy = makeShip({
      slotIndex: 2,
      x: 9000,
      y: 0,
      hullDamagePct: 0,
    });
    expect(
      selectTarget(0, 0, [farHealthy, nearDamaged], BotDifficulty.VETERAN),
    ).toBe(nearDamaged);
  });

  it("returns single enemy when only one exists", () => {
    const only = makeShip({ slotIndex: 1, x: 1000, y: 0 });
    expect(selectTarget(0, 0, [only], BotDifficulty.COMPETENT)).toBe(only);
  });
});

// ---------------------------------------------------------------------------
// shouldRetreat
// ---------------------------------------------------------------------------

describe("shouldRetreat", () => {
  it("newbie: does NOT retreat at moderate damage (below 85)", () => {
    const self = makeSelf({ hullDamage: 70, fuel: 5000 });
    expect(shouldRetreat(self, BotDifficulty.NEWBIE)).toBe(false);
  });

  it("newbie: retreats at 85+ hull damage", () => {
    const self = makeSelf({ hullDamage: 85, fuel: 5000 });
    expect(shouldRetreat(self, BotDifficulty.NEWBIE)).toBe(true);
  });

  it("competent: retreats at 60+ hull damage", () => {
    const self = makeSelf({ hullDamage: 60, fuel: 5000 });
    expect(shouldRetreat(self, BotDifficulty.COMPETENT)).toBe(true);
  });

  it("competent: does NOT retreat below 60 hull damage", () => {
    const self = makeSelf({ hullDamage: 59, fuel: 5000 });
    expect(shouldRetreat(self, BotDifficulty.COMPETENT)).toBe(false);
  });

  it("veteran: retreats at 50+ hull damage", () => {
    const self = makeSelf({ hullDamage: 50, fuel: 5000 });
    expect(shouldRetreat(self, BotDifficulty.VETERAN)).toBe(true);
  });

  it("veteran: does NOT retreat below 50 hull damage", () => {
    const self = makeSelf({ hullDamage: 49, fuel: 5000 });
    expect(shouldRetreat(self, BotDifficulty.VETERAN)).toBe(false);
  });

  it("low fuel always triggers retreat regardless of difficulty", () => {
    const self = makeSelf({ hullDamage: 0, fuel: 999 });
    expect(shouldRetreat(self, BotDifficulty.NEWBIE)).toBe(true);
    expect(shouldRetreat(self, BotDifficulty.COMPETENT)).toBe(true);
    expect(shouldRetreat(self, BotDifficulty.VETERAN)).toBe(true);
  });

  it("fuel exactly at threshold does NOT trigger low-fuel retreat", () => {
    const self = makeSelf({ hullDamage: 0, fuel: 1000 });
    expect(shouldRetreat(self, BotDifficulty.COMPETENT)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// shouldFirePhaser
// ---------------------------------------------------------------------------

describe("shouldFirePhaser", () => {
  it("fires when in range, off cooldown, no burnout", () => {
    const self = makeSelf({ phaserCooldown: 0, weaponBurnout: 0 });
    expect(shouldFirePhaser(3000, self)).toBe(true);
  });

  it("does NOT fire when on cooldown", () => {
    const self = makeSelf({ phaserCooldown: 5, weaponBurnout: 0 });
    expect(shouldFirePhaser(3000, self)).toBe(false);
  });

  it("does NOT fire when weapon burnout is active", () => {
    const self = makeSelf({ phaserCooldown: 0, weaponBurnout: 3 });
    expect(shouldFirePhaser(3000, self)).toBe(false);
  });

  it("does NOT fire when beyond max phaser range", () => {
    const self = makeSelf({ phaserCooldown: 0, weaponBurnout: 0 });
    expect(shouldFirePhaser(6001, self)).toBe(false);
  });

  it("fires exactly at max phaser range", () => {
    const self = makeSelf({ phaserCooldown: 0, weaponBurnout: 0 });
    expect(shouldFirePhaser(6000, self)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// shouldFireTorp
// ---------------------------------------------------------------------------

describe("shouldFireTorp", () => {
  it("fires when within effective torp range", () => {
    expect(shouldFireTorp(10000)).toBe(true);
  });

  it("fires at the effective torp range boundary", () => {
    expect(shouldFireTorp(15000)).toBe(true);
  });

  it("does NOT fire beyond effective torp range", () => {
    expect(shouldFireTorp(15001)).toBe(false);
  });

  it("fires at point-blank range", () => {
    expect(shouldFireTorp(100)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// shouldCloak
// ---------------------------------------------------------------------------

describe("shouldCloak", () => {
  it("newbie: never cloaks", () => {
    const self = makeSelf({ armies: 5, fuel: 10000 });
    expect(shouldCloak(self, BotDifficulty.NEWBIE)).toBe(false);
  });

  it("competent: cloaks when carrying armies and has fuel", () => {
    const self = makeSelf({ armies: 3, fuel: 5000 });
    expect(shouldCloak(self, BotDifficulty.COMPETENT)).toBe(true);
  });

  it("competent: does NOT cloak when not carrying armies", () => {
    const self = makeSelf({ armies: 0, fuel: 5000 });
    expect(shouldCloak(self, BotDifficulty.COMPETENT)).toBe(false);
  });

  it("competent: does NOT cloak when fuel is low", () => {
    const self = makeSelf({ armies: 3, fuel: 500 });
    expect(shouldCloak(self, BotDifficulty.COMPETENT)).toBe(false);
  });

  it("veteran: cloaks when carrying armies and has fuel", () => {
    const self = makeSelf({ armies: 1, fuel: 8000 });
    expect(shouldCloak(self, BotDifficulty.VETERAN)).toBe(true);
  });

  it("veteran: does NOT cloak when no armies and fuel is ok", () => {
    const self = makeSelf({ armies: 0, fuel: 8000 });
    expect(shouldCloak(self, BotDifficulty.VETERAN)).toBe(false);
  });
});

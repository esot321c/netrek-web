import { describe, it, expect } from "vitest";
import {
  nearestPlanet,
  nearestEnemyShip,
  nearestFriendlyShip,
  nearestFriendlyPlanet,
  nearestEnemyPlanet,
  nearestRepairPlanet,
  nearestFuelPlanet,
  planetsOwnedByTeam,
  enemyCarriers,
  friendlyBombers,
  directionTo,
} from "./bot-navigation";
import {
  ShipStatus,
  ShipType,
  Team,
  AlertStatus,
  PlanetFeature,
  type ClientShip,
  type ClientPlanet,
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

function makePlanet(overrides: Partial<ClientPlanet> = {}): ClientPlanet {
  return {
    planetId: 0,
    x: 0,
    y: 0,
    name: "Test",
    team: 0xff, // neutral
    armies: 0,
    features: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// nearestPlanet
// ---------------------------------------------------------------------------

describe("nearestPlanet", () => {
  it("returns null for empty array", () => {
    expect(nearestPlanet(0, 0, [])).toBeNull();
  });

  it("returns the only planet when array has one entry", () => {
    const p = makePlanet({ planetId: 1, x: 100, y: 100 });
    expect(nearestPlanet(0, 0, [p])).toBe(p);
  });

  it("returns the closest planet", () => {
    const near = makePlanet({ planetId: 1, x: 10, y: 0 });
    const far = makePlanet({ planetId: 2, x: 500, y: 500 });
    expect(nearestPlanet(0, 0, [far, near])).toBe(near);
  });

  it("works correctly when position is near a distant planet", () => {
    const p1 = makePlanet({ planetId: 1, x: 50, y: 0 });
    const p2 = makePlanet({ planetId: 2, x: 10, y: 0 });
    expect(nearestPlanet(0, 0, [p1, p2])).toBe(p2);
  });
});

// ---------------------------------------------------------------------------
// nearestEnemyShip
// ---------------------------------------------------------------------------

describe("nearestEnemyShip", () => {
  it("returns null for empty array", () => {
    expect(nearestEnemyShip(0, 0, Team.FEDERATION, 0, [])).toBeNull();
  });

  it("returns closest alive enemy ship", () => {
    const nearEnemy = makeShip({
      slotIndex: 1,
      team: Team.ROMULANS,
      x: 10,
      y: 0,
    });
    const farEnemy = makeShip({
      slotIndex: 2,
      team: Team.ROMULANS,
      x: 500,
      y: 0,
    });
    expect(
      nearestEnemyShip(0, 0, Team.FEDERATION, 0, [farEnemy, nearEnemy]),
    ).toBe(nearEnemy);
  });

  it("ignores dead enemy ships", () => {
    const deadEnemy = makeShip({
      slotIndex: 1,
      team: Team.ROMULANS,
      x: 10,
      y: 0,
      status: ShipStatus.DEAD,
    });
    const aliveEnemy = makeShip({
      slotIndex: 2,
      team: Team.ROMULANS,
      x: 100,
      y: 0,
      status: ShipStatus.ALIVE,
    });
    expect(
      nearestEnemyShip(0, 0, Team.FEDERATION, 0, [deadEnemy, aliveEnemy]),
    ).toBe(aliveEnemy);
  });

  it("ignores exploding enemy ships", () => {
    const explodingEnemy = makeShip({
      slotIndex: 1,
      team: Team.ROMULANS,
      x: 5,
      y: 0,
      status: ShipStatus.EXPLODING,
    });
    const aliveEnemy = makeShip({
      slotIndex: 2,
      team: Team.ROMULANS,
      x: 100,
      y: 0,
      status: ShipStatus.ALIVE,
    });
    expect(
      nearestEnemyShip(0, 0, Team.FEDERATION, 0, [explodingEnemy, aliveEnemy]),
    ).toBe(aliveEnemy);
  });

  it("ignores own slot", () => {
    const self = makeShip({ slotIndex: 0, team: Team.FEDERATION, x: 0, y: 0 });
    const enemy = makeShip({ slotIndex: 1, team: Team.ROMULANS, x: 50, y: 0 });
    expect(nearestEnemyShip(0, 0, Team.FEDERATION, 0, [self, enemy])).toBe(
      enemy,
    );
  });

  it("ignores friendly ships", () => {
    const friend = makeShip({
      slotIndex: 1,
      team: Team.FEDERATION,
      x: 10,
      y: 0,
    });
    const enemy = makeShip({ slotIndex: 2, team: Team.ROMULANS, x: 50, y: 0 });
    expect(nearestEnemyShip(0, 0, Team.FEDERATION, 0, [friend, enemy])).toBe(
      enemy,
    );
  });

  it("returns null when no alive enemies exist", () => {
    const deadEnemy = makeShip({
      slotIndex: 1,
      team: Team.ROMULANS,
      status: ShipStatus.DEAD,
    });
    expect(nearestEnemyShip(0, 0, Team.FEDERATION, 0, [deadEnemy])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// nearestFriendlyShip
// ---------------------------------------------------------------------------

describe("nearestFriendlyShip", () => {
  it("returns null for empty array", () => {
    expect(nearestFriendlyShip(0, 0, Team.FEDERATION, 0, [])).toBeNull();
  });

  it("returns closest alive friendly ship excluding self", () => {
    const self = makeShip({ slotIndex: 0, team: Team.FEDERATION, x: 0, y: 0 });
    const nearFriend = makeShip({
      slotIndex: 1,
      team: Team.FEDERATION,
      x: 10,
      y: 0,
    });
    const farFriend = makeShip({
      slotIndex: 2,
      team: Team.FEDERATION,
      x: 500,
      y: 0,
    });
    expect(
      nearestFriendlyShip(0, 0, Team.FEDERATION, 0, [
        self,
        farFriend,
        nearFriend,
      ]),
    ).toBe(nearFriend);
  });

  it("ignores dead friendly ships", () => {
    const deadFriend = makeShip({
      slotIndex: 1,
      team: Team.FEDERATION,
      x: 10,
      status: ShipStatus.DEAD,
    });
    expect(
      nearestFriendlyShip(0, 0, Team.FEDERATION, 0, [deadFriend]),
    ).toBeNull();
  });

  it("ignores enemy ships", () => {
    const enemy = makeShip({ slotIndex: 1, team: Team.KLINGONS, x: 10, y: 0 });
    expect(nearestFriendlyShip(0, 0, Team.FEDERATION, 0, [enemy])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// nearestFriendlyPlanet
// ---------------------------------------------------------------------------

describe("nearestFriendlyPlanet", () => {
  it("returns null when no friendly planets exist", () => {
    const neutral = makePlanet({ planetId: 1, team: 0xff });
    const enemy = makePlanet({ planetId: 2, team: Team.ROMULANS });
    expect(
      nearestFriendlyPlanet(0, 0, Team.FEDERATION, [neutral, enemy]),
    ).toBeNull();
  });

  it("returns closest friendly planet", () => {
    const near = makePlanet({
      planetId: 1,
      team: Team.FEDERATION,
      x: 20,
      y: 0,
    });
    const far = makePlanet({
      planetId: 2,
      team: Team.FEDERATION,
      x: 200,
      y: 0,
    });
    expect(nearestFriendlyPlanet(0, 0, Team.FEDERATION, [far, near])).toBe(
      near,
    );
  });
});

// ---------------------------------------------------------------------------
// nearestEnemyPlanet
// ---------------------------------------------------------------------------

describe("nearestEnemyPlanet", () => {
  it("returns null when no enemy planets exist", () => {
    const neutral = makePlanet({ planetId: 1, team: 0xff });
    const own = makePlanet({ planetId: 2, team: Team.FEDERATION });
    expect(
      nearestEnemyPlanet(0, 0, Team.FEDERATION, [neutral, own]),
    ).toBeNull();
  });

  it("returns closest enemy planet, ignoring own team and neutral", () => {
    const neutral = makePlanet({ planetId: 1, team: 0xff, x: 5, y: 0 });
    const own = makePlanet({ planetId: 2, team: Team.FEDERATION, x: 10, y: 0 });
    const nearEnemy = makePlanet({
      planetId: 3,
      team: Team.ROMULANS,
      x: 50,
      y: 0,
    });
    const farEnemy = makePlanet({
      planetId: 4,
      team: Team.KLINGONS,
      x: 500,
      y: 0,
    });
    expect(
      nearestEnemyPlanet(0, 0, Team.FEDERATION, [
        neutral,
        own,
        farEnemy,
        nearEnemy,
      ]),
    ).toBe(nearEnemy);
  });
});

// ---------------------------------------------------------------------------
// nearestRepairPlanet
// ---------------------------------------------------------------------------

describe("nearestRepairPlanet", () => {
  it("returns null when no friendly repair planet exists", () => {
    // friendly without REPAIR feature
    const noRepair = makePlanet({
      planetId: 1,
      team: Team.FEDERATION,
      features: PlanetFeature.FUEL,
    });
    // repair planet but enemy
    const enemyRepair = makePlanet({
      planetId: 2,
      team: Team.ROMULANS,
      features: PlanetFeature.REPAIR,
      x: 5,
      y: 0,
    });
    expect(
      nearestRepairPlanet(0, 0, Team.FEDERATION, [noRepair, enemyRepair]),
    ).toBeNull();
  });

  it("returns closest friendly planet with REPAIR feature", () => {
    const near = makePlanet({
      planetId: 1,
      team: Team.FEDERATION,
      features: PlanetFeature.REPAIR,
      x: 30,
      y: 0,
    });
    const far = makePlanet({
      planetId: 2,
      team: Team.FEDERATION,
      features: PlanetFeature.REPAIR,
      x: 300,
      y: 0,
    });
    const noRepair = makePlanet({
      planetId: 3,
      team: Team.FEDERATION,
      features: PlanetFeature.FUEL,
      x: 5,
      y: 0,
    });
    expect(
      nearestRepairPlanet(0, 0, Team.FEDERATION, [far, near, noRepair]),
    ).toBe(near);
  });

  it("works with combined feature bitmask", () => {
    const combined = makePlanet({
      planetId: 1,
      team: Team.FEDERATION,
      features: PlanetFeature.REPAIR | PlanetFeature.FUEL,
      x: 100,
      y: 0,
    });
    expect(nearestRepairPlanet(0, 0, Team.FEDERATION, [combined])).toBe(
      combined,
    );
  });
});

// ---------------------------------------------------------------------------
// nearestFuelPlanet
// ---------------------------------------------------------------------------

describe("nearestFuelPlanet", () => {
  it("returns null when no friendly fuel planet exists", () => {
    const noFuel = makePlanet({
      planetId: 1,
      team: Team.FEDERATION,
      features: PlanetFeature.REPAIR,
    });
    expect(nearestFuelPlanet(0, 0, Team.FEDERATION, [noFuel])).toBeNull();
  });

  it("returns closest friendly planet with FUEL feature", () => {
    const near = makePlanet({
      planetId: 1,
      team: Team.FEDERATION,
      features: PlanetFeature.FUEL,
      x: 20,
      y: 0,
    });
    const far = makePlanet({
      planetId: 2,
      team: Team.FEDERATION,
      features: PlanetFeature.FUEL,
      x: 200,
      y: 0,
    });
    expect(nearestFuelPlanet(0, 0, Team.FEDERATION, [far, near])).toBe(near);
  });
});

// ---------------------------------------------------------------------------
// planetsOwnedByTeam
// ---------------------------------------------------------------------------

describe("planetsOwnedByTeam", () => {
  it("returns 0 for empty array", () => {
    expect(planetsOwnedByTeam(Team.FEDERATION, [])).toBe(0);
  });

  it("counts planets owned by the specified team", () => {
    const planets = [
      makePlanet({ planetId: 1, team: Team.FEDERATION }),
      makePlanet({ planetId: 2, team: Team.FEDERATION }),
      makePlanet({ planetId: 3, team: Team.ROMULANS }),
      makePlanet({ planetId: 4, team: 0xff }),
    ];
    expect(planetsOwnedByTeam(Team.FEDERATION, planets)).toBe(2);
    expect(planetsOwnedByTeam(Team.ROMULANS, planets)).toBe(1);
    expect(planetsOwnedByTeam(Team.KLINGONS, planets)).toBe(0);
  });

  it("does not count neutral planets", () => {
    const planets = [
      makePlanet({ planetId: 1, team: 0xff }),
      makePlanet({ planetId: 2, team: 0xff }),
    ];
    expect(planetsOwnedByTeam(Team.FEDERATION, planets)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// enemyCarriers
// ---------------------------------------------------------------------------

describe("enemyCarriers", () => {
  it("returns empty array when no ships", () => {
    expect(enemyCarriers(Team.FEDERATION, [])).toEqual([]);
  });

  it("returns enemy AS ships", () => {
    const carrier = makeShip({
      slotIndex: 1,
      team: Team.ROMULANS,
      shipType: ShipType.AS,
      status: ShipStatus.ALIVE,
    });
    const scout = makeShip({
      slotIndex: 2,
      team: Team.ROMULANS,
      shipType: ShipType.SC,
      status: ShipStatus.ALIVE,
    });
    const result = enemyCarriers(Team.FEDERATION, [carrier, scout]);
    expect(result).toContain(carrier);
    expect(result).not.toContain(scout);
  });

  it("returns enemy ships that are beaming down (beaming=2)", () => {
    const beaming = makeShip({
      slotIndex: 1,
      team: Team.ROMULANS,
      shipType: ShipType.SC,
      beaming: 2,
      status: ShipStatus.ALIVE,
    });
    expect(enemyCarriers(Team.FEDERATION, [beaming])).toContain(beaming);
  });

  it("does not return friendly carriers", () => {
    const friendlyCarrier = makeShip({
      slotIndex: 1,
      team: Team.FEDERATION,
      shipType: ShipType.AS,
    });
    expect(enemyCarriers(Team.FEDERATION, [friendlyCarrier])).toEqual([]);
  });

  it("does not return dead enemy carriers", () => {
    const deadCarrier = makeShip({
      slotIndex: 1,
      team: Team.ROMULANS,
      shipType: ShipType.AS,
      status: ShipStatus.DEAD,
    });
    expect(enemyCarriers(Team.FEDERATION, [deadCarrier])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// friendlyBombers
// ---------------------------------------------------------------------------

describe("friendlyBombers", () => {
  it("returns empty array when no ships", () => {
    expect(friendlyBombers(Team.FEDERATION, 0, [])).toEqual([]);
  });

  it("returns friendly ships that are bombing", () => {
    const bomber = makeShip({
      slotIndex: 1,
      team: Team.FEDERATION,
      bombing: true,
      status: ShipStatus.ALIVE,
    });
    const nonBomber = makeShip({
      slotIndex: 2,
      team: Team.FEDERATION,
      bombing: false,
      status: ShipStatus.ALIVE,
    });
    const result = friendlyBombers(Team.FEDERATION, 0, [bomber, nonBomber]);
    expect(result).toContain(bomber);
    expect(result).not.toContain(nonBomber);
  });

  it("does not include self", () => {
    const selfBombing = makeShip({
      slotIndex: 0,
      team: Team.FEDERATION,
      bombing: true,
    });
    expect(friendlyBombers(Team.FEDERATION, 0, [selfBombing])).toEqual([]);
  });

  it("does not include enemy bombers", () => {
    const enemyBomber = makeShip({
      slotIndex: 1,
      team: Team.ROMULANS,
      bombing: true,
    });
    expect(friendlyBombers(Team.FEDERATION, 0, [enemyBomber])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// directionTo
// ---------------------------------------------------------------------------

describe("directionTo", () => {
  it("returns 0 (north) when target is directly above", () => {
    // Direction 0 = north (up, negative Y)
    expect(directionTo(100, 100, 100, 0)).toBe(0);
  });

  it("returns 64 (east) when target is directly to the right", () => {
    // Direction 64 = east (positive X)
    expect(directionTo(0, 0, 100, 0)).toBe(64);
  });

  it("returns 128 (south) when target is directly below", () => {
    // Direction 128 = south (positive Y)
    expect(directionTo(0, 0, 0, 100)).toBe(128);
  });

  it("returns 192 (west) when target is directly to the left", () => {
    // Direction 192 = west (negative X)
    expect(directionTo(100, 0, 0, 0)).toBe(192);
  });

  it("returns a value in 0-255 range", () => {
    const dir = directionTo(0, 0, 300, 400);
    expect(dir).toBeGreaterThanOrEqual(0);
    expect(dir).toBeLessThanOrEqual(255);
  });
});

import {
  type ClientGameState,
  type ClientShip,
  type ClientPlanet,
  BotDifficulty,
  Team,
  ShipStatus,
  distance,
  SHIP_STATS,
  PlanetVisibility,
  PlanetFeature,
} from "@netrek/shared";
import {
  type MissionCandidate,
  type TeamBotState,
  type BotOrder,
  MissionType,
  ORDER_SCORE_BONUS,
} from "./bot-types";
import {
  enemyCarriers,
  friendlyBombers,
  friendlyCarriers,
  enemiesThreateningPlanet,
} from "./bot-navigation";

const RESUPPLY_BASE = 20;
const RESUPPLY_HULL_WEIGHT = 80;
const RESUPPLY_FUEL_WEIGHT = 60;
const BOMB_BASE = 40;
const BOMB_ARMY_WEIGHT = 3;
const BOMB_DISTANCE_PENALTY = 0.002;
const TAKE_BASE = 50;
const TAKE_KILL_BONUS = 20;
const ESCORT_BASE = 60;
const ESCORT_DISTANCE_PENALTY = 0.003;
const OGG_BASE = 70;
const DEFEND_BASE = 50;
const DEFEND_THREAT_BONUS = 15;
const PATROL_BASE = 15;
const DUPLICATE_PENALTY = 30;

export function assess(
  myX: number,
  myY: number,
  gs: ClientGameState,
  team: Team,
  enemyTeam: Team,
  slot: number,
  difficulty: BotDifficulty,
  teamBots: TeamBotState[],
  order: BotOrder | null,
  mySelf: ClientShip,
): MissionCandidate[] {
  const candidates: MissionCandidate[] = [];
  const { ships, planets, self } = gs;
  const stats = SHIP_STATS[mySelf.shipType];

  // --- RESUPPLY ---
  const hullPct = self.hullDamage / stats.maxHull;
  const fuelPct = self.fuel / stats.maxFuel;
  const resupplyScore =
    RESUPPLY_BASE +
    hullPct * RESUPPLY_HULL_WEIGHT +
    (1 - fuelPct) * RESUPPLY_FUEL_WEIGHT;
  candidates.push({
    type: MissionType.RESUPPLY,
    targetId: -1,
    score: resupplyScore,
  });

  // --- BOMB ---
  for (const p of planets) {
    if (p.team !== enemyTeam) continue;
    if (p.visibility === PlanetVisibility.FRESH && p.armies < 5) continue;
    const dist = distance(myX, myY, p.x, p.y);
    let score =
      BOMB_BASE +
      (p.armies ?? 10) * BOMB_ARMY_WEIGHT -
      dist * BOMB_DISTANCE_PENALTY;
    score -=
      countBotsOnMission(teamBots, MissionType.BOMB, p.planetId) *
      DUPLICATE_PENALTY;
    candidates.push({ type: MissionType.BOMB, targetId: p.planetId, score });
  }

  // --- TAKE ---
  if (self.tmode && self.kills >= 1) {
    const capacity = Math.min(
      stats.maxArmies,
      Math.floor(self.kills) * stats.armiesPerKill,
    );
    if (capacity >= 2) {
      for (const p of planets) {
        if (p.team !== enemyTeam) continue;
        if (p.visibility !== PlanetVisibility.FRESH) continue;
        if (p.armies > 4) continue;
        if (capacity < p.armies + 1 && p.features & PlanetFeature.AGRICULTURAL)
          continue;
        const dist = distance(myX, myY, p.x, p.y);
        let score =
          TAKE_BASE +
          self.kills * TAKE_KILL_BONUS -
          dist * BOMB_DISTANCE_PENALTY;
        score -=
          countBotsOnMission(teamBots, MissionType.TAKE, p.planetId) *
          DUPLICATE_PENALTY;
        candidates.push({
          type: MissionType.TAKE,
          targetId: p.planetId,
          score,
        });
      }
    }
  }

  // --- ESCORT ---
  const carriers = friendlyCarriers(team, slot, ships);
  for (const c of carriers) {
    const dist = distance(myX, myY, c.x, c.y);
    let score = ESCORT_BASE - dist * ESCORT_DISTANCE_PENALTY;
    score -=
      countBotsOnMission(teamBots, MissionType.ESCORT, c.slotIndex) *
      DUPLICATE_PENALTY;
    candidates.push({
      type: MissionType.ESCORT,
      targetId: c.slotIndex,
      score,
    });
  }
  const bombers = friendlyBombers(team, slot, ships);
  for (const b of bombers) {
    const dist = distance(myX, myY, b.x, b.y);
    let score = ESCORT_BASE - 10 - dist * ESCORT_DISTANCE_PENALTY;
    score -=
      countBotsOnMission(teamBots, MissionType.ESCORT, b.slotIndex) *
      DUPLICATE_PENALTY;
    candidates.push({
      type: MissionType.ESCORT,
      targetId: b.slotIndex,
      score,
    });
  }

  // --- OGG ---
  if (difficulty >= BotDifficulty.COMPETENT) {
    const eCarriers = enemyCarriers(team, ships, enemyTeam);
    for (const ec of eCarriers) {
      const dist = distance(myX, myY, ec.x, ec.y);
      let score = OGG_BASE - dist * 0.002;
      if (difficulty === BotDifficulty.VETERAN) score += 15;
      score -=
        countBotsOnMission(teamBots, MissionType.OGG, ec.slotIndex) *
        DUPLICATE_PENALTY;
      candidates.push({
        type: MissionType.OGG,
        targetId: ec.slotIndex,
        score,
      });
    }
  }

  // --- DEFEND ---
  for (const p of planets) {
    if (p.team !== team) continue;
    const threats = enemiesThreateningPlanet(p, ships, team, 8000);
    if (threats === 0) continue;
    const dist = distance(myX, myY, p.x, p.y);
    let score = DEFEND_BASE + threats * DEFEND_THREAT_BONUS - dist * 0.002;
    if (p.features & PlanetFeature.AGRICULTURAL) score += 15;
    if (p.features & PlanetFeature.REPAIR) score += 10;
    score -=
      countBotsOnMission(teamBots, MissionType.DEFEND, p.planetId) *
      DUPLICATE_PENALTY;
    candidates.push({
      type: MissionType.DEFEND,
      targetId: p.planetId,
      score,
    });
  }

  // --- PATROL ---
  candidates.push({
    type: MissionType.PATROL,
    targetId: -1,
    score: PATROL_BASE,
  });

  // --- Apply chat order bonus ---
  if (order !== null) {
    for (const c of candidates) {
      if (
        c.type === order.missionType &&
        (c.targetId === order.targetId || order.targetId === -1)
      ) {
        c.score += ORDER_SCORE_BONUS;
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

function countBotsOnMission(
  teamBots: TeamBotState[],
  missionType: MissionType,
  targetId: number,
): number {
  let count = 0;
  for (const b of teamBots) {
    if (b.currentMission === missionType && b.missionTargetId === targetId)
      count++;
  }
  return count;
}

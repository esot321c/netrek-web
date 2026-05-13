import { describe, it, expect } from "vitest";
import {
  MissionType,
  CombatPhase,
  aiStateToMissionType,
  ASSESS_INTERVAL_TICKS,
  ORDER_EXPIRE_TICKS,
} from "./bot-types";
import { BotAIState } from "@netrek/shared";

describe("bot-types", () => {
  describe("aiStateToMissionType", () => {
    it("maps PATROL to PATROL", () => {
      expect(aiStateToMissionType(BotAIState.PATROL)).toBe(MissionType.PATROL);
    });
    it("maps BOMB to BOMB", () => {
      expect(aiStateToMissionType(BotAIState.BOMB)).toBe(MissionType.BOMB);
    });
    it("maps RETREAT to RESUPPLY", () => {
      expect(aiStateToMissionType(BotAIState.RETREAT)).toBe(
        MissionType.RESUPPLY,
      );
    });
    it("maps ATTACK to PATROL (combat is sub-behavior)", () => {
      expect(aiStateToMissionType(BotAIState.ATTACK)).toBe(MissionType.PATROL);
    });
  });

  describe("constants", () => {
    it("assess interval is 15 ticks", () => {
      expect(ASSESS_INTERVAL_TICKS).toBe(15);
    });
    it("order expiry is 600 ticks", () => {
      expect(ORDER_EXPIRE_TICKS).toBe(600);
    });
  });
});

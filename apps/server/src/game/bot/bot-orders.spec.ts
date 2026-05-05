import { describe, it, expect } from "vitest";
import { BotAIState } from "@netrek/shared";
import { parseOrder } from "./bot-orders";

describe("parseOrder", () => {
  const planetNames = [
    "Earth",
    "Rigel",
    "Romulus",
    "Klingus",
    "Orion",
    "Canopus",
    "Deneb",
    "Altair",
    "Vega",
  ];
  const botNames = ["comp-bot-1", "vet-bot-2"];

  it("parses 'bomb earth'", () => {
    const result = parseOrder("bomb earth", planetNames, botNames);
    expect(result).toEqual({
      state: BotAIState.BOMB,
      targetId: 0,
      targetName: "",
    });
  });

  it("parses 'bomb Earth' case-insensitive", () => {
    const result = parseOrder("bomb Earth", planetNames, botNames);
    expect(result).not.toBeNull();
    expect(result!.state).toBe(BotAIState.BOMB);
    expect(result!.targetId).toBe(0);
  });

  it("parses 'defend romulus'", () => {
    const result = parseOrder("defend romulus", planetNames, botNames);
    expect(result).toEqual({
      state: BotAIState.DEFEND,
      targetId: 2,
      targetName: "",
    });
  });

  it("parses 'escort me' with senderSlot", () => {
    const result = parseOrder("escort me", planetNames, botNames, 5);
    expect(result).toEqual({
      state: BotAIState.ESCORT,
      targetId: 5,
      targetName: "",
    });
  });

  it("parses 'escort [number]'", () => {
    const result = parseOrder("escort 7", planetNames, botNames);
    expect(result).toEqual({
      state: BotAIState.ESCORT,
      targetId: 7,
      targetName: "",
    });
  });

  it("parses 'ogg 3'", () => {
    const result = parseOrder("ogg 3", planetNames, botNames);
    expect(result).toEqual({
      state: BotAIState.OGG,
      targetId: 3,
      targetName: "",
    });
  });

  it("parses 'help' without planet", () => {
    const result = parseOrder("help", planetNames, botNames);
    expect(result).not.toBeNull();
    expect(result!.state).toBe(BotAIState.DEFEND);
    expect(result!.targetId).toBe(-1);
  });

  it("parses 'help [planet]'", () => {
    const result = parseOrder("help vega", planetNames, botNames);
    expect(result).not.toBeNull();
    expect(result!.state).toBe(BotAIState.DEFEND);
    expect(result!.targetId).toBe(8);
  });

  it("parses 'regroup'", () => {
    const result = parseOrder("regroup", planetNames, botNames);
    expect(result).not.toBeNull();
    expect(result!.state).toBe(BotAIState.PATROL);
    expect(result!.targetId).toBe(-1);
  });

  it("parses 'fall back'", () => {
    const result = parseOrder("fall back", planetNames, botNames);
    expect(result).not.toBeNull();
    expect(result!.state).toBe(BotAIState.PATROL);
    expect(result!.targetId).toBe(-1);
  });

  it("returns null for unrecognized messages", () => {
    expect(parseOrder("hello there", planetNames, botNames)).toBeNull();
    expect(parseOrder("attack", planetNames, botNames)).toBeNull();
    expect(parseOrder("", planetNames, botNames)).toBeNull();
    expect(
      parseOrder("bomb nonexistent-planet", planetNames, botNames),
    ).toBeNull();
  });

  it("extracts addressed bot name from 'comp-bot-1 bomb earth'", () => {
    const result = parseOrder("comp-bot-1 bomb earth", planetNames, botNames);
    expect(result).toEqual({
      state: BotAIState.BOMB,
      targetId: 0,
      targetName: "comp-bot-1",
    });
  });

  it("extracts addressed bot name case-insensitively", () => {
    const result = parseOrder("Comp-Bot-1 defend rigel", planetNames, botNames);
    expect(result).not.toBeNull();
    expect(result!.targetName).toBe("comp-bot-1");
    expect(result!.state).toBe(BotAIState.DEFEND);
    expect(result!.targetId).toBe(1);
  });

  it("broadcast (no bot name prefix) sets targetName to empty string", () => {
    const result = parseOrder("bomb orion", planetNames, botNames);
    expect(result).not.toBeNull();
    expect(result!.targetName).toBe("");
  });

  it("parses 'escort me' without senderSlot uses -1 as targetId", () => {
    const result = parseOrder("escort me", planetNames, botNames);
    expect(result).not.toBeNull();
    expect(result!.state).toBe(BotAIState.ESCORT);
    expect(result!.targetId).toBe(-1);
  });
});

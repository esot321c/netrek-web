"use client";

import type { ClientGameState } from "@netrek/shared";
import { ShipStatus } from "@netrek/shared";
import { TEAM_NAMES_SHORT, SHIP_NAMES, rankAbbrev } from "@netrek/shared";
import { getRoster } from "@/lib/game/chat";

const TEAM_COLORS: Record<number, string> = {
  0: "#ffff00", // Federation
  1: "#ff4444", // Romulans
  2: "#44ff44", // Klingons
  3: "#44ffff", // Orions
};

interface PlayerListPanelProps {
  state: ClientGameState | null;
  rosterVersion: number;
}

export default function PlayerListPanel({
  state,
  rosterVersion,
}: PlayerListPanelProps) {
  if (!state) return null;

  const roster = getRoster();
  const allShips = state.ships
    .slice()
    .sort((a, b) => a.slotIndex - b.slotIndex);

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        fontFamily: "monospace",
        fontSize: 11,
        color: "#aaa",
        padding: 4,
        overflowY: "auto",
      }}
    >
      {/* Header */}
      <div
        style={{
          color: "#666",
          lineHeight: "14px",
          borderBottom: "1px solid #222",
        }}
      >
        {"No Ty   Rank     Name             Kills Login"}
      </div>

      {/* Rows */}
      {allShips.map((ship) => {
        const entry = roster[ship.slotIndex];
        const isDead = ship.status === ShipStatus.DEAD;
        const isExploding = ship.status === ShipStatus.EXPLODING;
        const baseColor = TEAM_COLORS[ship.team] ?? "#888";
        const color = isDead || isExploding ? "#444" : baseColor;

        const slotStr = ship.slotIndex.toString().padStart(2, " ");
        const teamChar = (TEAM_NAMES_SHORT[ship.team] ?? "??").slice(0, 2);
        const slotHex = ship.slotIndex.toString(16);
        const typeTag = `${teamChar}${slotHex}`;
        const rank = rankAbbrev(entry?.rank ?? 0);
        const name = (entry?.name ?? ship.slotIndex.toString())
          .padEnd(16, " ")
          .slice(0, 16);
        const kills = (entry?.kills ?? 0).toFixed(2);
        const login = entry?.name ?? "";

        return (
          <div
            key={ship.slotIndex}
            style={{
              color,
              lineHeight: "14px",
              whiteSpace: "pre",
            }}
          >
            {`${slotStr} ${typeTag.padEnd(4)} ${rank.padEnd(8)} ${name} ${kills.padStart(5)} ${login}`}
          </div>
        );
      })}
    </div>
  );
}

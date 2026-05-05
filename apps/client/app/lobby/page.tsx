"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface PlayerInfo {
  slot: number;
  name: string;
  team: number;
  shipType: number;
  status: number;
  isBot: boolean;
}

interface TeamInfo {
  name: string;
  players: PlayerInfo[];
  count: number;
}

interface ServerInfo {
  motd: string;
  tmode: boolean;
  playerCount: number;
  maxPlayers: number;
  teams: Record<string, TeamInfo>;
  options: {
    shipsAllowed: string;
    tractorPressor: boolean;
    tmodeMinPlayers: number;
  };
}

const SHIP_NAMES: Record<number, string> = {
  0: "SC",
  1: "DD",
  2: "CA",
  3: "BB",
  4: "AS",
  5: "SB",
};

const TEAM_COLORS: Record<string, string> = {
  "0": "#4fc3f7", // Federation — blue
  "1": "#ef5350", // Romulans — red
};

export default function LobbyPage() {
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const fetchInfo = async () => {
      try {
        const res = await fetch(
          `${process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3010"}/lobby/info`,
        );
        if (!res.ok) throw new Error("Failed to load server info");
        setInfo(await res.json());
      } catch (e) {
        setError((e as Error).message);
      }
    };

    fetchInfo();
    const interval = setInterval(fetchInfo, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleJoinTeam = (team: number) => {
    router.push(`/game?team=${team}`);
  };

  if (error) {
    return (
      <div style={styles.container}>
        <pre style={styles.error}>ERROR: {error}</pre>
      </div>
    );
  }

  if (!info) {
    return (
      <div style={styles.container}>
        <pre style={styles.text}>Connecting to server...</pre>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.section}>
        <pre style={styles.header}>{"--- Netrek Web Server ---"}</pre>
        <pre style={styles.motd}>{info.motd}</pre>
      </div>

      <div style={styles.section}>
        <pre style={styles.subheader}>OPTIONS:</pre>
        <pre style={styles.text}>
          {`  Tournament Mode    : ${info.tmode ? "ACTIVE" : "inactive"}
  T-Mode Min Players : ${info.options.tmodeMinPlayers} players / side
  Ships Allowed      : ${info.options.shipsAllowed}
  Tractor/Pressor    : ${info.options.tractorPressor ? "enabled" : "disabled"}
  Players            : ${info.playerCount} / ${info.maxPlayers}`}
        </pre>
      </div>

      <div style={styles.teamsRow}>
        {Object.entries(info.teams).map(([teamId, team]) => (
          <div key={teamId} style={styles.teamBox}>
            <pre
              style={{
                ...styles.teamName,
                color: TEAM_COLORS[teamId] ?? "#fff",
              }}
            >
              {team.name} ({team.count})
            </pre>
            <div style={styles.playerList}>
              {team.players.map((p) => (
                <pre key={p.slot} style={styles.playerRow}>
                  {`  ${String(p.slot).padStart(2)} ${SHIP_NAMES[p.shipType] ?? "??"} ${p.name}${p.isBot ? "" : " *"}`}
                </pre>
              ))}
              {team.players.length === 0 && (
                <pre style={styles.emptyText}> (empty)</pre>
              )}
            </div>
            <button
              style={{
                ...styles.joinButton,
                borderColor: TEAM_COLORS[teamId] ?? "#fff",
                color: TEAM_COLORS[teamId] ?? "#fff",
              }}
              onClick={() => handleJoinTeam(Number(teamId))}
            >
              JOIN {team.name.toUpperCase()}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    backgroundColor: "#000",
    color: "#ffa500",
    fontFamily: "monospace",
    minHeight: "100vh",
    padding: "20px",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  section: { borderBottom: "1px solid #333", paddingBottom: "12px" },
  header: {
    color: "#ffa500",
    fontSize: "16px",
    textAlign: "center",
    margin: "0 0 8px 0",
  },
  subheader: { color: "#ffa500", fontSize: "14px", margin: "0 0 4px 0" },
  motd: { color: "#ccc", fontSize: "13px", margin: 0, whiteSpace: "pre-wrap" },
  text: { color: "#ccc", fontSize: "13px", margin: 0 },
  teamsRow: { display: "flex", gap: "24px", justifyContent: "center" },
  teamBox: {
    border: "1px solid #444",
    padding: "12px",
    minWidth: "280px",
    flex: 1,
    maxWidth: "400px",
  },
  teamName: { fontSize: "16px", margin: "0 0 8px 0", textAlign: "center" },
  playerList: { marginBottom: "12px", minHeight: "120px" },
  playerRow: { color: "#ccc", fontSize: "12px", margin: 0 },
  emptyText: { color: "#666", fontSize: "12px", margin: 0 },
  joinButton: {
    background: "transparent",
    border: "1px solid",
    padding: "8px 16px",
    fontFamily: "monospace",
    fontSize: "14px",
    cursor: "pointer",
    width: "100%",
    textAlign: "center",
  },
  error: { color: "#ef5350", fontSize: "14px", margin: 0 },
};

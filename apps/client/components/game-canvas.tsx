"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { ShipType, Team } from "@netrek/shared";
import {
  connect,
  disconnect,
  onState,
  onConnect,
  onDisconnect,
  onJoined,
  onChat,
  onKill,
  onRoster,
  sendRespawn,
} from "@/lib/game/socket";
import {
  pushSnapshot,
  setMySlot,
  getMySlot,
  getLatestSnapshot,
  resetState,
} from "@/lib/game/state";
import { setupInput, onChatChange } from "@/lib/game/input";
import { initRenderer, renderFrame } from "@/lib/game/renderer";
import {
  initSound,
  resumeAudio,
  processSounds,
  resetSound,
} from "@/lib/game/sound";
import {
  handleChatMessage,
  handleKillEvent,
  updateRoster,
  resetChat,
  getTypingState,
  TypingState,
} from "@/lib/game/chat";
import ChatPanel from "./chat-panel";
import PlayerListPanel from "./player-list-panel";

// Ship type labels
const SHIPS = [
  { type: ShipType.SC, key: "S", name: "Scout" },
  { type: ShipType.DD, key: "D", name: "Destroyer" },
  { type: ShipType.CA, key: "C", name: "Cruiser" },
  { type: ShipType.BB, key: "B", name: "Battleship" },
  { type: ShipType.AS, key: "A", name: "Assault" },
  { type: ShipType.SB, key: "O", name: "Starbase" },
] as const;

const TEAM_COLORS: Record<number, string> = {
  [Team.FEDERATION]: "#ffff00",
  [Team.ROMULANS]: "#ff4444",
  [Team.KLINGONS]: "#44ff44",
  [Team.ORIONS]: "#44ffff",
};

/** Bottom panel height in pixels */
const BOTTOM_PANEL_H = 140;

interface GameCanvasProps {
  wsUrl: string;
  gameToken: string;
}

export default function GameCanvas({ wsUrl, gameToken }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const galCanvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const [connected, setConnected] = useState(false);
  const [phase, setPhase] = useState<"waiting" | "playing" | "dead">("waiting");
  const [chatVersion, setChatVersion] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const [infoTarget, setInfoTarget] = useState<string | null>(null);

  const handleResize = useCallback(() => {
    const canvas = canvasRef.current;
    const galCanvas = galCanvasRef.current;
    if (!canvas) return;

    const totalW = window.innerWidth;
    const totalH = window.innerHeight;
    const topH = totalH - BOTTOM_PANEL_H;
    const halfW = Math.round(totalW / 2);

    canvas.width = halfW;
    canvas.height = topH;

    if (galCanvas) {
      // Galaxy map is square, fits in the right half
      const galSize = Math.min(halfW, topH);
      galCanvas.width = galSize;
      galCanvas.height = galSize;
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const galCanvas = galCanvasRef.current;
    if (!canvas) return;

    // Init
    handleResize();
    window.addEventListener("resize", handleResize);
    initRenderer(canvas, galCanvas ?? undefined);
    initSound();
    const cleanupInput = setupInput(canvas);

    // Socket events
    onConnect(() => {
      setConnected(true);
      resumeAudio();
    });
    onDisconnect(() => setConnected(false));

    onState((state) => {
      pushSnapshot(state);
      processSounds(state);

      // Check if my ship is dead → show respawn UI
      if (getMySlot() >= 0) {
        const myShip = state.ships.find((s) => s.slotIndex === getMySlot());
        if (!myShip || myShip.status === 2) {
          setPhase("dead");
        }
      }
    });

    onJoined((data) => {
      setMySlot(data.slot);
      setPhase("playing");
    });

    onChat((msg) => {
      handleChatMessage(msg, getMySlot());
      setChatVersion((v) => v + 1);
    });

    onKill((event) => {
      handleKillEvent(event);
      setChatVersion((v) => v + 1);
    });

    onRoster((roster) => {
      updateRoster(roster);
      setChatVersion((v) => v + 1);
    });

    onChatChange(() => {
      setChatVersion((v) => v + 1);
    });

    // Keyboard shortcuts for panels
    function handlePanelKeys(e: KeyboardEvent) {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (getTypingState() !== TypingState.IDLE) return;
      if (e.key === "h") {
        setShowHelp((v) => !v);
      }
      if (e.key === "i" || e.key === "I") {
        setInfoTarget((v) => (v !== null ? null : ""));
      }
    }
    window.addEventListener("keydown", handlePanelKeys);

    connect(wsUrl, gameToken);

    // Render loop
    function loop() {
      const snapshot = getLatestSnapshot();
      renderFrame(snapshot);
      rafRef.current = requestAnimationFrame(loop);
    }
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafRef.current);
      cleanupInput();
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("keydown", handlePanelKeys);
      disconnect();
      resetState();
      resetSound();
      resetChat();
    };
  }, [handleResize, wsUrl, gameToken]);

  const handleRespawn = (shipType: number) => {
    sendRespawn(shipType);
    setPhase("playing");
  };

  const snapshot = getLatestSnapshot();

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#000",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Top area: tactical (left) + galaxy map & info (right) */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* Left: Tactical view */}
        <div style={{ flex: 1, position: "relative", cursor: "crosshair" }}>
          <canvas
            ref={canvasRef}
            style={{ width: "100%", height: "100%", display: "block" }}
          />

          {/* Connection overlay */}
          {!connected && (
            <Overlay>
              <p style={{ color: "#aaa", fontSize: 18 }}>Connecting...</p>
            </Overlay>
          )}

          {/* Waiting for "joined" event */}
          {connected && phase === "waiting" && (
            <Overlay>
              <p style={{ color: "#aaa", fontSize: 18 }}>
                Waiting to join game...
              </p>
            </Overlay>
          )}

          {/* Help window (h key) */}
          {showHelp && (
            <div
              style={{
                position: "absolute",
                top: 10,
                left: 10,
                background: "rgba(0, 0, 0, 0.92)",
                border: "1px solid #444",
                padding: 12,
                fontFamily: "monospace",
                fontSize: 12,
                color: "#aaa",
                zIndex: 20,
                maxWidth: 360,
                maxHeight: "80%",
                overflowY: "auto",
              }}
            >
              <div style={{ color: "#ffff00", marginBottom: 8, fontSize: 14 }}>
                Speed & Navigation
              </div>
              <HelpRow k="0-9" desc="Set warp speed 0-9" />
              <HelpRow k=")" desc="Warp 10" />
              <HelpRow k="!" desc="Warp 11" />
              <HelpRow k="@" desc="Warp 12" />
              <HelpRow k="%" desc="Maximum speed" />
              <HelpRow k="l" desc="Lock onto nearest planet/player" />
              <div style={{ color: "#ffff00", marginTop: 8, marginBottom: 4 }}>
                Weapons & Defense
              </div>
              <HelpRow k="s" desc="Toggle shields" />
              <HelpRow k="c" desc="Toggle cloak" />
              <HelpRow k="d" desc="Detonate enemy torps" />
              <HelpRow k="D" desc="Detonate own torps" />
              <HelpRow k="T" desc="Tractor beam toggle" />
              <HelpRow k="y" desc="Pressor beam toggle" />
              <HelpRow k="r" desc="Toggle repair mode" />
              <div style={{ color: "#ffff00", marginTop: 8, marginBottom: 4 }}>
                Planet Operations
              </div>
              <HelpRow k="b" desc="Bomb enemy planet" />
              <HelpRow k="z" desc="Beam up armies" />
              <HelpRow k="x" desc="Beam down armies" />
              <div style={{ color: "#ffff00", marginTop: 8, marginBottom: 4 }}>
                Mouse Controls
              </div>
              <HelpRow k="Left click" desc="Fire torpedoes" />
              <HelpRow k="Shift+Left / Middle" desc="Fire phasers" />
              <HelpRow k="Right click" desc="Set course" />
              <div style={{ color: "#ffff00", marginTop: 8, marginBottom: 4 }}>
                Windows
              </div>
              <HelpRow k="L" desc="Toggle player list" />
              <HelpRow k="i" desc="Info on nearest entity" />
              <HelpRow k="h" desc="Toggle this help" />
              <div style={{ color: "#555", marginTop: 8 }}>
                Press h to close
              </div>
            </div>
          )}

          {/* Info panel (i key) */}
          {infoTarget !== null && snapshot && <InfoPanel state={snapshot} />}

          {/* Respawn UI (shown when dead) */}
          {connected && phase === "dead" && (
            <Overlay>
              <div style={{ textAlign: "center" }}>
                <h2
                  style={{
                    color: "#fff",
                    marginBottom: 20,
                    fontFamily: "monospace",
                  }}
                >
                  DESTROYED — Select Ship to Respawn
                </h2>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    alignItems: "center",
                  }}
                >
                  {SHIPS.map((ship) => (
                    <button
                      key={ship.type}
                      onClick={() => handleRespawn(ship.type)}
                      style={{
                        background: "#222",
                        color: "#fff",
                        border: "1px solid #444",
                        padding: "6px 24px",
                        fontFamily: "monospace",
                        fontSize: 14,
                        cursor: "pointer",
                        width: 200,
                      }}
                    >
                      [{ship.key}] {ship.name}
                    </button>
                  ))}
                </div>
              </div>
            </Overlay>
          )}
        </div>

        {/* Right: Galaxy map + player list */}
        <div
          style={{
            width: "50%",
            display: "flex",
            flexDirection: "column",
            borderLeft: "1px solid #333",
            background: "#000008",
          }}
        >
          {/* Galaxy map canvas */}
          <canvas
            ref={galCanvasRef}
            style={{
              display: "block",
              maxWidth: "100%",
              maxHeight: `calc(100vh - ${BOTTOM_PANEL_H}px)`,
              aspectRatio: "1",
            }}
          />
        </div>
      </div>

      {/* Bottom panel: player list (left) + chat (right) */}
      <div
        style={{
          height: BOTTOM_PANEL_H,
          borderTop: "1px solid #333",
          background: "#000000",
          display: "flex",
        }}
      >
        <PlayerListPanel state={snapshot} rosterVersion={chatVersion} />
        <ChatPanel chatVersion={chatVersion} />
      </div>
    </div>
  );
}

function HelpRow({ k, desc }: { k: string; desc: string }) {
  return (
    <div style={{ lineHeight: "18px" }}>
      <span style={{ color: "#fff", display: "inline-block", width: 140 }}>
        {k}
      </span>
      <span style={{ color: "#aaa" }}>{desc}</span>
    </div>
  );
}

function InfoPanel({
  state,
}: {
  state: import("@netrek/shared").ClientGameState;
}) {
  const mySlot = getMySlot();
  const myShip = state.ships.find((s) => s.slotIndex === mySlot);
  if (!myShip) return null;

  const SHIP_NAMES = [
    "Scout",
    "Destroyer",
    "Cruiser",
    "Battleship",
    "Assault",
    "Starbase",
  ];
  const TEAM_NAMES_FULL = ["Federation", "Romulans", "Klingons", "Orions"];

  let closestEnemy: (typeof state.ships)[0] | null = null;
  let closestEnemyDist = Infinity;
  for (const ship of state.ships) {
    if (ship.slotIndex === mySlot) continue;
    if (ship.status === 2) continue;
    if (ship.team === myShip.team) continue;
    const dx = ship.x - myShip.x;
    const dy = ship.y - myShip.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < closestEnemyDist) {
      closestEnemyDist = d;
      closestEnemy = ship;
    }
  }

  let closestPlanet: (typeof state.planets)[0] | null = null;
  let closestPlanetDist = Infinity;
  for (const planet of state.planets) {
    const dx = planet.x - myShip.x;
    const dy = planet.y - myShip.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < closestPlanetDist) {
      closestPlanetDist = d;
      closestPlanet = planet;
    }
  }

  return (
    <div
      style={{
        position: "absolute",
        top: 10,
        right: 10,
        background: "rgba(0, 0, 0, 0.92)",
        border: "1px solid #444",
        padding: 12,
        fontFamily: "monospace",
        fontSize: 12,
        color: "#aaa",
        zIndex: 20,
        minWidth: 240,
      }}
    >
      <div style={{ color: "#ffff00", marginBottom: 8, fontSize: 14 }}>
        Info (press i to close)
      </div>
      {closestEnemy && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ color: TEAM_COLORS[closestEnemy.team] ?? "#888" }}>
            Nearest Enemy: #{closestEnemy.slotIndex}{" "}
            {SHIP_NAMES[closestEnemy.shipType] ?? "??"} (
            {TEAM_NAMES_FULL[closestEnemy.team] ?? "??"})
          </div>
          <div style={{ color: "#888" }}>
            Distance: {Math.round(closestEnemyDist)} GU | Shields:{" "}
            {Math.round(closestEnemy.shieldPct * 100)}% | Hull:{" "}
            {Math.round((1 - closestEnemy.hullDamagePct) * 100)}%
          </div>
        </div>
      )}
      {closestPlanet && (
        <div>
          <div style={{ color: TEAM_COLORS[closestPlanet.team] ?? "#888" }}>
            Nearest Planet: {closestPlanet.name} (
            {TEAM_NAMES_FULL[closestPlanet.team] ?? "Neutral"})
          </div>
          <div style={{ color: "#888" }}>
            Distance: {Math.round(closestPlanetDist)} GU | Armies:{" "}
            {closestPlanet.armies}
          </div>
        </div>
      )}
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.85)",
        zIndex: 10,
      }}
    >
      {children}
    </div>
  );
}

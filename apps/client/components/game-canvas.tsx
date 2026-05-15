"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  ShipType,
  Team,
  InputCommand,
  REFIT_MIN_SHIELD_PCT,
  REFIT_MIN_FUEL_PCT,
  REFIT_MAX_HULL_PCT,
  REFIT_TICKS,
} from "@netrek/shared";
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
  onGameWin,
  onConnectError,
  sendRespawn,
  sendInput,
} from "@/lib/game/socket";
import {
  pushSnapshot,
  setMySlot,
  getMySlot,
  getLatestSnapshot,
  resetState,
} from "@/lib/game/state";
import { setupInput, onChatChange, onRefitKey } from "@/lib/game/input";
import { initRenderer, renderFrame } from "@/lib/game/renderer";
import {
  initSound,
  resumeAudio,
  processSounds,
  resetSound,
  playSound,
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

const TEAM_NAMES: Record<number, string> = {
  [Team.FEDERATION]: "Federation",
  [Team.ROMULANS]: "Romulans",
  [Team.KLINGONS]: "Klingons",
  [Team.ORIONS]: "Orions",
};

/** Bottom panel height in pixels */
const BOTTOM_PANEL_H = 280;

/** Below this width, switch to stacked (narrow) layout */
const BREAKPOINT = 640;

interface GameCanvasProps {
  wsUrl: string;
  gameToken: string;
}

export default function GameCanvas({ wsUrl, gameToken }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const galCanvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const respawnedAt = useRef<number>(0);
  const [connected, setConnected] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"waiting" | "playing" | "dead">("waiting");
  const [chatVersion, setChatVersion] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const [infoTarget, setInfoTarget] = useState<string | null>(null);
  const [showRefit, setShowRefit] = useState(false);
  const [respawnReject, setRespawnReject] = useState<{
    reason: string;
    cooldownRemainingSec?: number;
  } | null>(null);
  const [respawnCountdown, setRespawnCountdown] = useState<number>(0);
  const [gameWinData, setGameWinData] = useState<{
    winningTeam: number;
    losingTeam: number;
    type: string;
  } | null>(null);
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== "undefined" && window.innerWidth < BREAKPOINT,
  );
  const [refitError, setRefitError] = useState<string | null>(null);
  const [refitInProgress, setRefitInProgress] = useState<{
    targetType: number;
    startTick: number;
  } | null>(null);
  const refitRef = useRef<{ targetType: number; startTick: number } | null>(
    null,
  );

  const handleResize = useCallback(() => {
    const canvas = canvasRef.current;
    const galCanvas = galCanvasRef.current;
    if (!canvas) return;

    const totalW = window.innerWidth;
    const totalH = window.innerHeight;
    const narrow = totalW < BREAKPOINT;
    setIsNarrow(narrow);

    if (narrow) {
      canvas.width = totalW;
      canvas.height = totalW;
      if (galCanvas) {
        galCanvas.width = totalW;
        galCanvas.height = totalW;
      }
    } else {
      const topH = totalH - BOTTOM_PANEL_H;
      const halfW = Math.round(totalW / 2);
      canvas.width = halfW;
      canvas.height = topH;
      if (galCanvas) {
        const galSize = Math.min(halfW, topH);
        galCanvas.width = galSize;
        galCanvas.height = galSize;
      }
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
    onConnectError((err) => setConnectError(err.message));

    onState((state) => {
      pushSnapshot(state);
      processSounds(state);

      if (getMySlot() >= 0) {
        const myShip = state.ships.find((s) => s.slotIndex === getMySlot());
        if (!myShip || myShip.status === 2) {
          if (refitRef.current) {
            refitRef.current = null;
            setRefitInProgress(null);
          }
          if (Date.now() - respawnedAt.current > 2000) {
            setPhase((prev) => {
              if (prev !== "dead") {
                setRespawnReject(null);
                setRespawnCountdown(3);
              }
              return "dead";
            });
          }
        } else {
          setPhase("playing");
          if (refitRef.current) {
            const elapsed = state.tick - refitRef.current.startTick;
            if (myShip.shipType === refitRef.current.targetType) {
              refitRef.current = null;
              setRefitInProgress(null);
            } else if (elapsed > REFIT_TICKS + 10) {
              refitRef.current = null;
              setRefitInProgress(null);
            } else {
              setChatVersion((v) => v + 1);
            }
          }
        }
      }
    });

    onJoined((data) => {
      setMySlot(data.slot);
      setPhase("playing");
      playSound("nt_enter_ship", 0.6);
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

    onGameWin((data) => {
      setGameWinData(data);
      setTimeout(() => setGameWinData(null), 10_000);
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

    onRefitKey(() => {
      const snap = getLatestSnapshot();
      if (!snap) return;
      const myShip = snap.ships.find((s) => s.slotIndex === getMySlot());
      if (!myShip) return;
      const homeworldIdx = myShip.team * 10;
      const atHomeworld = snap.self.orbitPlanetId === homeworldIdx;
      const dockedAtSb = myShip.docked;
      if (!atHomeworld && !dockedAtSb) return;
      setRefitError(null);
      setShowRefit((v) => !v);
    });

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

  useEffect(() => {
    if (respawnCountdown <= 0) return;
    const timer = setTimeout(() => {
      setRespawnCountdown((v) => Math.max(0, v - 1));
    }, 1000);
    return () => clearTimeout(timer);
  }, [respawnCountdown]);

  const handleRespawn = (shipType: number) => {
    sendRespawn(shipType, (result) => {
      if (result.ok) {
        respawnedAt.current = Date.now();
        setRespawnReject(null);
        setRespawnCountdown(0);
        setPhase("playing");
      } else if (result.reason === "respawn_delay") {
        setRespawnCountdown(Math.ceil(result.remainingSec ?? 0));
      } else {
        setRespawnReject({
          reason: result.reason ?? "unknown",
          cooldownRemainingSec: result.cooldownRemainingSec,
        });
      }
    });
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
        overflow: isNarrow ? "auto" : undefined,
      }}
    >
      {/* Top area: tactical (left) + galaxy map (right in wide, below in narrow) */}
      <div
        style={
          isNarrow ? undefined : { flex: 1, display: "flex", minHeight: 0 }
        }
      >
        {/* Tactical view */}
        <div
          style={{
            position: "relative",
            cursor: "crosshair",
            ...(!isNarrow && { flex: 1, minWidth: 0 }),
          }}
        >
          <canvas
            ref={canvasRef}
            style={{
              display: "block",
              width: "100%",
              height: isNarrow ? "auto" : "100%",
              ...(isNarrow && { aspectRatio: "1 / 1" }),
            }}
          />

          {/* Connection overlay */}
          {!connected && (
            <Overlay>
              <p
                style={{
                  color: connectError ? "#ff4444" : "#aaa",
                  fontSize: 18,
                }}
              >
                {connectError
                  ? `Connection failed: ${connectError}`
                  : "Connecting..."}
              </p>
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
              <HelpRow k="0-9" desc="Set warp 0-9" />
              <HelpRow k=") ! @" desc="Warp 10 / 11 / 12" />
              <HelpRow k="% #" desc="Max warp / Half warp" />
              <HelpRow k="< >" desc="Decrease / Increase warp by 1" />
              <HelpRow k="k" desc="Set course (at mouse)" />
              <HelpRow k="o" desc="Enter orbit or dock" />
              <HelpRow k="l" desc="Lock onto nearest planet/player" />
              <HelpRow k=";" desc="Lock planet/starbase only" />
              <HelpRow k="*" desc="Transwarp to starbase" />
              <div style={{ color: "#ffff00", marginTop: 8, marginBottom: 4 }}>
                Weapons & Defense
              </div>
              <HelpRow k="s" desc="Toggle shields" />
              <HelpRow k="[ ]" desc="Shields down / up" />
              <HelpRow k="c" desc="Toggle cloak" />
              <HelpRow k="{ }" desc="Cloak on / off" />
              <HelpRow k="d" desc="Detonate enemy torps" />
              <HelpRow k="D" desc="Detonate own torps" />
              <HelpRow k="f" desc="Fire plasma torpedo" />
              <HelpRow k="T" desc="Tractor beam" />
              <HelpRow k="y" desc="Pressor beam" />
              <HelpRow k="_ ^" desc="Tractor on / Pressor on" />
              <HelpRow k="$" desc="Tractor/pressor off" />
              <HelpRow k="r" desc="Refit ship (orbit homeworld)" />
              <HelpRow k="R" desc="Toggle repair mode" />
              <div style={{ color: "#ffff00", marginTop: 8, marginBottom: 4 }}>
                Planet & Starbase Operations
              </div>
              <HelpRow k="b" desc="Bomb planet" />
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
              <HelpRow k="i" desc="Info on nearest entity" />
              <HelpRow k="h" desc="Toggle this help" />
              <div style={{ color: "#ffff00", marginTop: 8, marginBottom: 4 }}>
                Chat & Macros
              </div>
              <HelpRow k="m" desc="Start sending message" />
              <HelpRow k="X + key" desc="Fire macro" />
              <div style={{ color: "#555", marginTop: 8 }}>
                Full docs:{" "}
                <a
                  href="/docs/keymap"
                  target="_blank"
                  style={{ color: "#44ffff" }}
                >
                  /docs/keymap
                </a>
                {" | "}
                <a
                  href="/docs/macros"
                  target="_blank"
                  style={{ color: "#44ffff" }}
                >
                  /docs/macros
                </a>
              </div>
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
                {respawnCountdown > 0 && (
                  <p
                    style={{
                      color: "#ffff00",
                      fontFamily: "monospace",
                      fontSize: 16,
                      marginBottom: 12,
                    }}
                  >
                    Respawn in {respawnCountdown}...
                  </p>
                )}
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
                      disabled={respawnCountdown > 0}
                      style={{
                        background: respawnCountdown > 0 ? "#111" : "#222",
                        color: respawnCountdown > 0 ? "#555" : "#fff",
                        border: "1px solid #444",
                        padding: "6px 24px",
                        fontFamily: "monospace",
                        fontSize: 14,
                        cursor:
                          respawnCountdown > 0 ? "not-allowed" : "pointer",
                        width: 200,
                      }}
                    >
                      [{ship.key}] {ship.name}
                    </button>
                  ))}
                </div>
                {respawnReject && (
                  <p
                    style={{
                      color: "#ff4444",
                      fontFamily: "monospace",
                      fontSize: 12,
                      marginTop: 8,
                    }}
                  >
                    {respawnReject.reason === "rank" &&
                      "Requires Commander rank to pilot Starbase"}
                    {respawnReject.reason === "sb_active" &&
                      "Starbase already active on your team"}
                    {respawnReject.reason === "planets" &&
                      "Team needs 5+ planets for Starbase"}
                    {respawnReject.reason === "sb_cooldown" &&
                      `Starbase cooldown: ${Math.floor((respawnReject.cooldownRemainingSec ?? 0) / 60)}:${String((respawnReject.cooldownRemainingSec ?? 0) % 60).padStart(2, "0")}`}
                    {respawnReject.reason === "torps" &&
                      "Wait for torpedoes to resolve"}
                  </p>
                )}
              </div>
            </Overlay>
          )}

          {/* Refit overlay (r key while alive) */}
          {showRefit && phase === "playing" && (
            <Overlay>
              <div style={{ textAlign: "center" }}>
                <h2
                  style={{
                    color: "#fff",
                    marginBottom: 20,
                    fontFamily: "monospace",
                  }}
                >
                  REFIT — Select Ship (orbit homeworld)
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
                      onClick={() => {
                        const snap = getLatestSnapshot();
                        if (!snap) return;
                        const me = snap.ships.find(
                          (s) => s.slotIndex === getMySlot(),
                        );
                        if (!me) return;
                        if (me.shieldPct < REFIT_MIN_SHIELD_PCT) {
                          setRefitError("Shields too low (need 75%+)");
                          return;
                        }
                        if (me.fuelPct < REFIT_MIN_FUEL_PCT) {
                          setRefitError("Fuel too low (need 75%+)");
                          return;
                        }
                        if (me.hullDamagePct > REFIT_MAX_HULL_PCT) {
                          setRefitError("Hull too damaged (max 75% damage)");
                          return;
                        }
                        if (snap.self.armies > 0) {
                          setRefitError("Must drop armies first");
                          return;
                        }
                        setRefitError(null);
                        sendInput(InputCommand.REFIT, ship.type);
                        setShowRefit(false);
                        const tick = getLatestSnapshot()?.tick ?? 0;
                        refitRef.current = {
                          targetType: ship.type,
                          startTick: tick,
                        };
                        setRefitInProgress({
                          targetType: ship.type,
                          startTick: tick,
                        });
                      }}
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
                <p
                  style={{
                    color: "#555",
                    fontFamily: "monospace",
                    fontSize: 12,
                    marginTop: 12,
                  }}
                >
                  Press r to cancel
                </p>
                {refitError && (
                  <p
                    style={{
                      color: "#ff4444",
                      fontFamily: "monospace",
                      fontSize: 12,
                      marginTop: 8,
                    }}
                  >
                    {refitError}
                  </p>
                )}
              </div>
            </Overlay>
          )}

          {/* Refit countdown message */}
          {refitInProgress && !showRefit && (
            <div
              style={{
                position: "absolute",
                top: "40%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                fontFamily: "monospace",
                fontSize: 16,
                color: "#ffff00",
                textAlign: "center",
                pointerEvents: "none",
                zIndex: 15,
                textShadow: "0 0 6px #000, 0 0 12px #000",
              }}
            >
              <RefitCountdown
                startTick={refitInProgress.startTick}
                targetName={
                  SHIPS.find((s) => s.type === refitInProgress.targetType)
                    ?.name ?? "new ship"
                }
              />
            </div>
          )}

          {/* Game win/loss overlay */}
          {gameWinData && (
            <Overlay>
              <div
                style={{
                  textAlign: "center",
                  fontFamily: "monospace",
                }}
              >
                <h2
                  style={{
                    color: TEAM_COLORS[gameWinData.winningTeam] ?? "#fff",
                    fontSize: 28,
                    marginBottom: 12,
                  }}
                >
                  {TEAM_NAMES[gameWinData.winningTeam] ?? "Unknown"} WINS!
                </h2>
                <p style={{ color: "#aaa", fontSize: 16 }}>
                  {gameWinData.type === "genocide"
                    ? `${TEAM_NAMES[gameWinData.losingTeam] ?? "Enemy"} has been eliminated`
                    : `${TEAM_NAMES[gameWinData.losingTeam] ?? "Enemy"} surrendered (timer expired)`}
                </p>
                <p
                  style={{
                    color: "#555",
                    fontSize: 12,
                    marginTop: 16,
                  }}
                >
                  New game starting...
                </p>
              </div>
            </Overlay>
          )}
        </div>

        {/* Galaxy map */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            background: "#000008",
            overflow: "hidden",
            ...(isNarrow
              ? { borderTop: "1px solid #333", alignItems: "center" }
              : {
                  width: "50%",
                  minHeight: 0,
                  alignItems: "flex-start",
                  borderLeft: "1px solid #333",
                }),
          }}
        >
          <canvas ref={galCanvasRef} style={{ display: "block" }} />
        </div>
      </div>

      {/* Bottom panels */}
      {isNarrow ? (
        <>
          <div
            style={{
              borderTop: "1px solid #333",
              height: 250,
              display: "flex",
            }}
          >
            <ChatPanel chatVersion={chatVersion} />
          </div>
          <div
            style={{
              borderTop: "1px solid #333",
              height: 250,
              display: "flex",
            }}
          >
            <PlayerListPanel state={snapshot} rosterVersion={chatVersion} />
          </div>
        </>
      ) : (
        <div
          style={{
            height: BOTTOM_PANEL_H,
            borderTop: "1px solid #333",
            background: "#000000",
            display: "flex",
          }}
        >
          <PlayerListPanel state={snapshot} rosterVersion={chatVersion} />
          <div
            style={{
              borderLeft: "1px solid #333",
              display: "flex",
              flex: 1,
              minWidth: 0,
            }}
          >
            <ChatPanel chatVersion={chatVersion} />
          </div>
        </div>
      )}
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

function RefitCountdown({
  startTick,
  targetName,
}: {
  startTick: number;
  targetName: string;
}) {
  const snap = getLatestSnapshot();
  const elapsed = snap ? snap.tick - startTick : 0;
  const remaining = Math.max(0, REFIT_TICKS - elapsed);
  const secs = Math.ceil(remaining / 10);
  return (
    <p>
      Transporting to your {targetName}... {secs}
    </p>
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

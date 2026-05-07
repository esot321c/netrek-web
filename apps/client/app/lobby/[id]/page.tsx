"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { apiFetch, joinServer } from "@/lib/api/client";
import { Team, ShipType } from "@netrek/shared";
import StatsBadge from "@/components/stats-badge";

interface ServerDetail {
  id: string;
  name: string;
  isOfficial: boolean;
  region: string;
  playerCount: number;
  maxPlayers: number;
  gamePhase: string;
}

const TEAMS = [
  {
    id: Team.FEDERATION,
    name: "Federation",
    color: "text-blue-400",
    border: "border-blue-600",
    bg: "bg-blue-900/20",
  },
  {
    id: Team.ROMULANS,
    name: "Romulans",
    color: "text-red-400",
    border: "border-red-600",
    bg: "bg-red-900/20",
  },
] as const;

const SHIPS = [
  { type: ShipType.SC, name: "Scout (SC)", desc: "Fast, fragile" },
  { type: ShipType.DD, name: "Destroyer (DD)", desc: "Balanced" },
  { type: ShipType.CA, name: "Cruiser (CA)", desc: "Heavy firepower" },
  { type: ShipType.BB, name: "Battleship (BB)", desc: "Maximum armor" },
  { type: ShipType.AS, name: "Assault (AS)", desc: "Army carrier" },
  { type: ShipType.SB, name: "Starbase (SB)", desc: "Stationary fortress" },
] as const;

export default function GameDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { user, loading } = useAuth();
  const router = useRouter();

  const [server, setServer] = useState<ServerDetail | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<number>(Team.FEDERATION);
  const [selectedShip, setSelectedShip] = useState<number>(ShipType.CA);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/auth/signin");
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;

    const load = async () => {
      try {
        const data = await apiFetch<ServerDetail>(`/servers/${id}`);
        setServer((prev) => {
          if (
            prev &&
            prev.playerCount === data.playerCount &&
            prev.gamePhase === data.gamePhase
          )
            return prev;
          return data;
        });
        setFetchError(null);
      } catch (e) {
        setFetchError((e as Error).message);
      }
    };

    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [user, id]);

  const handleJoin = async () => {
    setJoining(true);
    setJoinError(null);
    try {
      const result = await joinServer(id, selectedTeam, selectedShip);
      sessionStorage.setItem(
        `game:${id}`,
        JSON.stringify({ gameToken: result.gameToken, wsUrl: result.wsUrl }),
      );
      router.push(`/game/${id}`);
    } catch (e) {
      setJoinError((e as Error).message);
      setJoining(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-900">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-gray-900 text-gray-300">
      <div className="mx-auto max-w-3xl px-4 py-10">
        {/* Back link */}
        <a
          href="/lobby"
          className="text-sm text-gray-500 hover:text-yellow-500 transition-colors"
        >
          &larr; Back to Server Browser
        </a>

        {/* Stats badge */}
        {user && (
          <div className="mt-4">
            <StatsBadge username={user.name} />
          </div>
        )}

        {/* Server info */}
        {fetchError && (
          <div className="mt-6 rounded border border-red-700 bg-red-900/30 px-4 py-3 text-sm text-red-400">
            Failed to load server: {fetchError}
          </div>
        )}

        {server ? (
          <>
            <div className="mt-6 flex items-start gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-bold text-gray-100">
                    {server.name}
                  </h1>
                  {server.isOfficial ? (
                    <span className="rounded bg-yellow-500 px-2 py-0.5 text-xs font-bold text-gray-900">
                      OFFICIAL
                    </span>
                  ) : (
                    <span className="rounded bg-gray-700 px-2 py-0.5 text-xs text-gray-400">
                      COMMUNITY
                    </span>
                  )}
                </div>
                <p className="text-gray-500 mt-1">
                  {server.region} &mdash; {server.playerCount}/
                  {server.maxPlayers} players &mdash;{" "}
                  <span
                    className={
                      server.gamePhase === "active"
                        ? "text-green-400"
                        : "text-gray-500"
                    }
                  >
                    {server.gamePhase}
                  </span>
                </p>
              </div>
            </div>

            {/* Team selector */}
            <div className="mt-8">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-3">
                Choose Team
              </h2>
              <div className="grid grid-cols-2 gap-3">
                {TEAMS.map((team) => (
                  <button
                    key={team.id}
                    onClick={() => setSelectedTeam(team.id)}
                    className={`rounded border px-4 py-3 text-left transition-colors ${
                      selectedTeam === team.id
                        ? `${team.border} ${team.bg} ${team.color} font-semibold`
                        : "border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600"
                    }`}
                  >
                    {team.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Ship selector */}
            <div className="mt-6">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-3">
                Choose Ship
              </h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {SHIPS.map((ship) => (
                  <button
                    key={ship.type}
                    onClick={() => setSelectedShip(ship.type)}
                    className={`rounded border px-3 py-2 text-left transition-colors ${
                      selectedShip === ship.type
                        ? "border-yellow-600 bg-yellow-900/20 text-yellow-400 font-semibold"
                        : "border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600"
                    }`}
                  >
                    <div className="font-mono text-sm">{ship.name}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {ship.desc}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Join error */}
            {joinError && (
              <div className="mt-4 rounded border border-red-700 bg-red-900/30 px-4 py-3 text-sm text-red-400">
                {joinError}
              </div>
            )}

            {/* Join button */}
            <div className="mt-8">
              <button
                onClick={handleJoin}
                disabled={joining}
                className="w-full rounded bg-yellow-500 px-6 py-3 text-lg font-bold text-gray-900 hover:bg-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {joining ? "Joining..." : "Join Game"}
              </button>
            </div>
          </>
        ) : (
          !fetchError && (
            <div className="mt-12 text-center text-gray-500">
              Loading server info...
            </div>
          )
        )}
      </div>
    </div>
  );
}

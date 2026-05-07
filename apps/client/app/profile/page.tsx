"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api/client";
import { calculateDI, rankForDI, rankTitle, RANK_DEFS } from "@netrek/shared";

interface PlayerStats {
  totalKills: number;
  totalDeaths: number;
  totalWins: number;
  totalLosses: number;
  planetsTaken: number;
  armiesBombed: number;
  armiesBeamed: number;
  secondsPlayed: number;
  rank: number;
}

export default function ProfilePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/auth/signin");
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    apiFetch<PlayerStats>("/stats/me")
      .then(setStats)
      .catch((e) => setError((e as Error).message));
  }, [user]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-900">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (!user) return null;

  const di = stats
    ? calculateDI({
        planetsTaken: stats.planetsTaken,
        armiesBombed: stats.armiesBombed,
        kills: stats.totalKills,
      })
    : 0;
  const currentRank = stats ? rankForDI(di) : 0;
  const nextRank = currentRank < RANK_DEFS.length - 1 ? currentRank + 1 : null;
  const nextThreshold =
    nextRank !== null ? RANK_DEFS[nextRank]!.diThreshold : null;
  const currentThreshold = RANK_DEFS[currentRank]!.diThreshold;
  const progressPct =
    nextThreshold !== null && nextThreshold > currentThreshold
      ? ((di - currentThreshold) / (nextThreshold - currentThreshold)) * 100
      : 100;

  const kd =
    stats && stats.totalDeaths > 0
      ? (stats.totalKills / stats.totalDeaths).toFixed(2)
      : stats
        ? stats.totalKills.toFixed(2)
        : "0.00";

  const hours = stats ? Math.floor(stats.secondsPlayed / 3600) : 0;
  const minutes = stats ? Math.floor((stats.secondsPlayed % 3600) / 60) : 0;

  return (
    <div className="min-h-screen bg-gray-900 text-gray-300">
      <div className="mx-auto max-w-2xl px-4 py-10">
        <a
          href="/lobby"
          className="text-sm text-gray-500 hover:text-yellow-500 transition-colors"
        >
          &larr; Back to Lobby
        </a>

        <div className="mt-6 rounded border border-gray-700 bg-gray-800/50 p-6 font-mono">
          <h1 className="text-lg text-yellow-400 mb-4">PLAYER PROFILE</h1>

          <div className="text-gray-100 text-lg">{user.name}</div>
          <div className="text-gray-400 text-sm">
            Rank: {rankTitle(currentRank)} ({currentRank})
          </div>
          <div className="text-gray-400 text-sm">DI: {di.toFixed(2)}</div>

          {error && (
            <div className="mt-4 text-red-400 text-sm">
              Failed to load stats: {error}
            </div>
          )}

          {nextRank !== null && nextThreshold !== null && (
            <div className="mt-4">
              <div className="text-gray-500 text-xs mb-1">
                Progress to {rankTitle(nextRank)}
              </div>
              <div className="h-4 bg-gray-700 rounded overflow-hidden">
                <div
                  className="h-full bg-yellow-500"
                  style={{ width: `${Math.min(progressPct, 100)}%` }}
                />
              </div>
              <div className="text-gray-500 text-xs mt-1">
                {di.toFixed(1)} / {nextThreshold}
              </div>
            </div>
          )}

          {stats && (
            <div className="mt-6">
              <h2 className="text-yellow-400 text-sm mb-2">CAREER STATS</h2>
              <div className="border-t border-gray-700 pt-2 space-y-1 text-sm">
                <StatRow label="Kills" value={stats.totalKills.toString()} />
                <StatRow label="Deaths" value={stats.totalDeaths.toString()} />
                <StatRow label="K/D Ratio" value={kd} />
                <StatRow
                  label="Planets Taken"
                  value={stats.planetsTaken.toString()}
                />
                <StatRow
                  label="Armies Bombed"
                  value={stats.armiesBombed.toString()}
                />
                <StatRow
                  label="Armies Beamed"
                  value={stats.armiesBeamed.toString()}
                />
                <StatRow label="Time Played" value={`${hours}h ${minutes}m`} />
                <StatRow label="Games Won" value={stats.totalWins.toString()} />
                <StatRow
                  label="Games Lost"
                  value={stats.totalLosses.toString()}
                />
              </div>
            </div>
          )}

          <div className="mt-6">
            <h2 className="text-yellow-400 text-sm mb-2">RANK LADDER</h2>
            <div className="border-t border-gray-700 pt-2 space-y-1 text-sm">
              {RANK_DEFS.map((def, i) => {
                const achieved = i <= currentRank;
                const isCurrent = i === currentRank;
                return (
                  <div
                    key={i}
                    className={`flex items-center gap-2 ${isCurrent ? "text-yellow-400" : achieved ? "text-green-500" : "text-gray-600"}`}
                  >
                    <span className="w-4">
                      {isCurrent ? "►" : achieved ? "✓" : " "}
                    </span>
                    <span className="w-32">{def.title}</span>
                    <span>{def.diThreshold} DI</span>
                    {isCurrent && (
                      <span className="text-gray-500 ml-2">&larr; YOU</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex">
      <span className="text-gray-500 w-40">{label}:</span>
      <span className="text-gray-300">{value}</span>
    </div>
  );
}

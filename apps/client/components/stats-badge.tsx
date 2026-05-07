"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import { calculateDI, rankAbbrev, rankForDI } from "@netrek/shared";
import Link from "next/link";

interface PlayerStats {
  totalKills: number;
  totalDeaths: number;
  planetsTaken: number;
  armiesBombed: number;
}

export default function StatsBadge({ username }: { username: string }) {
  const [stats, setStats] = useState<PlayerStats | null>(null);

  useEffect(() => {
    apiFetch<PlayerStats>("/stats/me")
      .then(setStats)
      .catch(() => {});
  }, []);

  if (!stats) return null;

  const di = calculateDI({
    planetsTaken: stats.planetsTaken,
    armiesBombed: stats.armiesBombed,
    kills: stats.totalKills,
  });
  const rank = rankForDI(di);
  const kd =
    stats.totalDeaths > 0
      ? (stats.totalKills / stats.totalDeaths).toFixed(2)
      : stats.totalKills.toFixed(2);

  return (
    <Link href="/profile">
      <div className="rounded border border-gray-700 bg-gray-800/50 px-3 py-2 font-mono text-sm hover:border-yellow-600 transition-colors cursor-pointer">
        <div className="text-gray-200">
          {rankAbbrev(rank)} {username}
        </div>
        <div className="text-gray-500 text-xs">
          DI: {di.toFixed(2)} | K/D: {kd}
        </div>
      </div>
    </Link>
  );
}

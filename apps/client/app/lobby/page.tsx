"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api/client";

interface ServerListing {
  id: string;
  name: string;
  isOfficial: boolean;
  region: string;
  playerCount: number;
  maxPlayers: number;
  gamePhase: string;
}

export default function LobbyPage() {
  const { user, isGuest, loading } = useAuth();
  const router = useRouter();
  const [servers, setServers] = useState<ServerListing[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user && !isGuest) {
      router.replace("/auth/signin");
    }
  }, [user, isGuest, loading, router]);

  useEffect(() => {
    if (!user && !isGuest) return;

    const load = async () => {
      try {
        const data = await apiFetch<ServerListing[]>("/servers");
        setServers(data);
        setFetchError(null);
      } catch (e) {
        setFetchError((e as Error).message);
      }
    };

    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [user, isGuest]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-900">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (!user && !isGuest) return null;

  return (
    <div className="min-h-screen bg-gray-900 text-gray-300">
      <div className="mx-auto max-w-5xl px-4 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-yellow-500">
              Server Browser
            </h1>
            <p className="text-gray-500 mt-1">
              Select a server to join. Refreshes every 5 seconds.
            </p>
          </div>
          {user && (
            <Link
              href="/settings/servers"
              className="rounded border border-yellow-600 px-4 py-2 text-sm text-yellow-500 hover:bg-yellow-600 hover:text-gray-900 transition-colors"
            >
              Host a Server
            </Link>
          )}
        </div>

        {fetchError && (
          <div className="mb-6 rounded border border-red-700 bg-red-900/30 px-4 py-3 text-sm text-red-400">
            Failed to load servers: {fetchError}
          </div>
        )}

        {servers.length === 0 && !fetchError ? (
          <div className="rounded border border-gray-700 bg-gray-800 px-6 py-12 text-center text-gray-500">
            No servers online right now.{" "}
            {user && (
              <Link
                href="/settings/servers"
                className="text-yellow-500 underline"
              >
                Host one?
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {servers.map((server) => (
              <Link
                key={server.id}
                href={`/lobby/${server.id}`}
                className="flex items-center gap-4 rounded border border-gray-700 bg-gray-800 px-5 py-4 hover:border-yellow-600 hover:bg-gray-750 transition-colors"
              >
                {/* Name + badge */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-100 truncate">
                      {server.name}
                    </span>
                    {server.isOfficial ? (
                      <span className="shrink-0 rounded bg-yellow-500 px-1.5 py-0.5 text-xs font-bold text-gray-900">
                        OFFICIAL
                      </span>
                    ) : (
                      <span className="shrink-0 rounded bg-gray-700 px-1.5 py-0.5 text-xs text-gray-400">
                        COMMUNITY
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-gray-500 mt-0.5">
                    {server.region}
                  </div>
                </div>

                {/* Phase */}
                <div className="text-sm text-gray-400 shrink-0">
                  <span
                    className={
                      server.gamePhase === "active"
                        ? "text-green-400"
                        : "text-gray-500"
                    }
                  >
                    {server.gamePhase}
                  </span>
                </div>

                {/* Player count */}
                <div className="text-sm shrink-0 w-20 text-right">
                  <span
                    className={
                      server.playerCount >= server.maxPlayers
                        ? "text-red-400"
                        : "text-gray-300"
                    }
                  >
                    {server.playerCount}/{server.maxPlayers}
                  </span>
                  <span className="text-gray-600 ml-1">players</span>
                </div>

                {/* Arrow */}
                <div className="text-yellow-600 shrink-0">&#8250;</div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

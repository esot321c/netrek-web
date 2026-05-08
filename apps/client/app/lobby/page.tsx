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
    if (user && !user.usernameSet) {
      router.replace("/auth/setup");
    }
  }, [user, router]);

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
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!user && !isGuest) return null;

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-5xl px-4 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-primary">Server Browser</h1>
            <p className="text-muted-foreground mt-1">
              Select a server to join. Refreshes every 5 seconds.
            </p>
          </div>
          {user && (
            <Link
              href="/settings/servers"
              className="rounded border border-primary px-4 py-2 text-sm text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
            >
              Host a Server
            </Link>
          )}
        </div>

        {fetchError && (
          <div className="mb-6 rounded border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Failed to load servers: {fetchError}
          </div>
        )}

        {servers.length === 0 && !fetchError ? (
          <div className="rounded border border-border bg-card px-6 py-12 text-center text-muted-foreground">
            No servers online right now.{" "}
            {user && (
              <Link href="/settings/servers" className="text-primary underline">
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
                className="flex items-center gap-4 rounded border border-border bg-card px-5 py-4 hover:border-primary transition-colors"
              >
                {/* Name + badge */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground truncate">
                      {server.name}
                    </span>
                    {server.isOfficial ? (
                      <span className="shrink-0 rounded bg-primary px-1.5 py-0.5 text-xs font-bold text-primary-foreground">
                        OFFICIAL
                      </span>
                    ) : (
                      <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">
                        COMMUNITY
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground mt-0.5">
                    {server.region}
                  </div>
                </div>

                {/* Phase */}
                <div className="text-sm text-muted-foreground shrink-0">
                  <span
                    className={
                      server.gamePhase === "active"
                        ? "text-green-400"
                        : "text-muted-foreground"
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
                        ? "text-destructive"
                        : "text-foreground"
                    }
                  >
                    {server.playerCount}/{server.maxPlayers}
                  </span>
                  <span className="text-muted-foreground ml-1">players</span>
                </div>

                {/* Arrow */}
                <div className="text-primary/80 shrink-0">&#8250;</div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

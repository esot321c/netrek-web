"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api/client";

interface OwnedServer {
  id: string;
  name: string;
  host: string;
  region: string;
  maxPlayers: number;
  isOfficial: boolean;
}

const REGIONS = [
  "us-east",
  "us-west",
  "eu-west",
  "eu-central",
  "ap-southeast",
  "ap-northeast",
];

export default function ServersSettingsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [servers, setServers] = useState<OwnedServer[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formHost, setFormHost] = useState("");
  const [formRegion, setFormRegion] = useState(REGIONS[0] ?? "us-east");
  const [formMaxPlayers, setFormMaxPlayers] = useState(16);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // One-time token reveal after creation
  const [newToken, setNewToken] = useState<string | null>(null);

  // Per-server action states
  const [actionStates, setActionStates] = useState<
    Record<string, { rotating?: boolean; deleting?: boolean; error?: string }>
  >({});

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/auth/signin");
    }
  }, [user, loading, router]);

  const loadServers = async () => {
    try {
      const data = await apiFetch<OwnedServer[]>("/servers/mine");
      setServers(data);
      setFetchError(null);
    } catch (e) {
      setFetchError((e as Error).message);
    }
  };

  useEffect(() => {
    if (!user) return;
    loadServers();
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormSubmitting(true);
    setFormError(null);
    setNewToken(null);
    try {
      const result = await apiFetch<{ serverToken: string }>("/servers", {
        method: "POST",
        body: JSON.stringify({
          name: formName,
          host: formHost,
          region: formRegion,
          maxPlayers: formMaxPlayers,
        }),
      });
      setNewToken(result.serverToken);
      setFormName("");
      setFormHost("");
      setFormRegion(REGIONS[0] ?? "us-east");
      setFormMaxPlayers(16);
      await loadServers();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleRotateToken = async (serverId: string) => {
    setActionStates((prev) => ({
      ...prev,
      [serverId]: { ...prev[serverId], rotating: true, error: undefined },
    }));
    try {
      const result = await apiFetch<{ serverToken: string }>(
        `/servers/${serverId}/rotate-token`,
        { method: "POST" },
      );
      setNewToken(result.serverToken);
    } catch (e) {
      setActionStates((prev) => ({
        ...prev,
        [serverId]: {
          ...prev[serverId],
          rotating: false,
          error: (e as Error).message,
        },
      }));
      return;
    }
    setActionStates((prev) => ({
      ...prev,
      [serverId]: { ...prev[serverId], rotating: false },
    }));
  };

  const handleDelete = async (serverId: string, serverName: string) => {
    if (!confirm(`Delete server "${serverName}"? This cannot be undone.`))
      return;
    setActionStates((prev) => ({
      ...prev,
      [serverId]: { ...prev[serverId], deleting: true, error: undefined },
    }));
    try {
      await apiFetch(`/servers/${serverId}`, { method: "DELETE" });
      setServers((prev) => prev.filter((s) => s.id !== serverId));
    } catch (e) {
      setActionStates((prev) => ({
        ...prev,
        [serverId]: {
          ...prev[serverId],
          deleting: false,
          error: (e as Error).message,
        },
      }));
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
        <h1 className="text-3xl font-bold text-yellow-500 mb-2">My Servers</h1>
        <p className="text-gray-500 mb-8">
          Register and manage community servers that players can join from the
          lobby.
        </p>

        {/* Token reveal (one-time) */}
        {newToken && (
          <div className="mb-8 rounded border border-yellow-600 bg-yellow-900/20 px-4 py-4">
            <div className="text-sm font-semibold text-yellow-400 mb-2">
              Server token (shown once — save it now)
            </div>
            <code className="block break-all rounded bg-gray-900 px-3 py-2 text-xs text-green-400 font-mono">
              {newToken}
            </code>
            <p className="text-xs text-gray-500 mt-2">
              Configure your server with this token. It will not be shown again.
            </p>
            <button
              onClick={() => setNewToken(null)}
              className="mt-3 text-xs text-gray-500 underline hover:text-gray-400"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Existing servers */}
        {fetchError && (
          <div className="mb-6 rounded border border-red-700 bg-red-900/30 px-4 py-3 text-sm text-red-400">
            Failed to load servers: {fetchError}
          </div>
        )}

        {servers.length > 0 && (
          <div className="mb-10 space-y-4">
            {servers.map((server) => {
              const state = actionStates[server.id] ?? {};
              return (
                <div
                  key={server.id}
                  className="rounded border border-gray-700 bg-gray-800 px-5 py-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-gray-100">
                        {server.name}
                      </div>
                      <div className="text-sm text-gray-500 mt-0.5">
                        {server.region} &mdash; max {server.maxPlayers} players
                      </div>
                      <div className="text-xs text-gray-600 mt-0.5 truncate">
                        {server.host}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => handleRotateToken(server.id)}
                        disabled={state.rotating ?? false}
                        className="rounded border border-gray-600 px-3 py-1 text-xs text-gray-400 hover:border-yellow-600 hover:text-yellow-500 disabled:opacity-50 transition-colors"
                      >
                        {state.rotating ? "Rotating..." : "Rotate Token"}
                      </button>
                      <button
                        onClick={() => handleDelete(server.id, server.name)}
                        disabled={state.deleting ?? false}
                        className="rounded border border-gray-600 px-3 py-1 text-xs text-gray-400 hover:border-red-600 hover:text-red-400 disabled:opacity-50 transition-colors"
                      >
                        {state.deleting ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </div>
                  {state.error && (
                    <div className="mt-2 text-xs text-red-400">
                      {state.error}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {servers.length === 0 && !fetchError && (
          <div className="mb-10 rounded border border-gray-700 bg-gray-800 px-6 py-8 text-center text-gray-500 text-sm">
            You have no registered servers yet. Use the form below to add one.
          </div>
        )}

        {/* Register new server form */}
        <div className="rounded border border-gray-700 bg-gray-800 px-6 py-6">
          <h2 className="text-xl font-semibold text-gray-100 mb-5">
            Register New Server
          </h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label
                className="block text-sm text-gray-400 mb-1"
                htmlFor="srv-name"
              >
                Server Name
              </label>
              <input
                id="srv-name"
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                required
                placeholder="My Netrek Server"
                className="w-full rounded border border-gray-600 bg-gray-900 px-3 py-2 text-gray-200 placeholder-gray-600 focus:border-yellow-600 focus:outline-none"
              />
            </div>

            <div>
              <label
                className="block text-sm text-gray-400 mb-1"
                htmlFor="srv-host"
              >
                Host URL
              </label>
              <input
                id="srv-host"
                type="url"
                value={formHost}
                onChange={(e) => setFormHost(e.target.value)}
                required
                placeholder="https://netrek.example.com"
                className="w-full rounded border border-gray-600 bg-gray-900 px-3 py-2 text-gray-200 placeholder-gray-600 focus:border-yellow-600 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  className="block text-sm text-gray-400 mb-1"
                  htmlFor="srv-region"
                >
                  Region
                </label>
                <select
                  id="srv-region"
                  value={formRegion}
                  onChange={(e) => setFormRegion(e.target.value)}
                  className="w-full rounded border border-gray-600 bg-gray-900 px-3 py-2 text-gray-200 focus:border-yellow-600 focus:outline-none"
                >
                  {REGIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  className="block text-sm text-gray-400 mb-1"
                  htmlFor="srv-max"
                >
                  Max Players
                </label>
                <input
                  id="srv-max"
                  type="number"
                  min={2}
                  max={64}
                  value={formMaxPlayers}
                  onChange={(e) => setFormMaxPlayers(Number(e.target.value))}
                  required
                  className="w-full rounded border border-gray-600 bg-gray-900 px-3 py-2 text-gray-200 focus:border-yellow-600 focus:outline-none"
                />
              </div>
            </div>

            {formError && (
              <div className="rounded border border-red-700 bg-red-900/30 px-3 py-2 text-sm text-red-400">
                {formError}
              </div>
            )}

            <button
              type="submit"
              disabled={formSubmitting}
              className="w-full rounded bg-yellow-500 px-4 py-2 font-semibold text-gray-900 hover:bg-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {formSubmitting ? "Registering..." : "Register Server"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

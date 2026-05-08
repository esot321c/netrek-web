"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { updateUsername } from "@/lib/api/client";
import { Button } from "@netrek/ui/button";

const USERNAME_REGEX = /^[a-zA-Z0-9_-]+$/;

export default function SettingsPage() {
  const { user, loading, refreshUser } = useAuth();
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/auth/signin");
    }
  }, [user, loading, router]);

  if (user && !initialized) {
    setUsername(user.username);
    setInitialized(true);
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-900">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (!user) return null;

  const validationError =
    username.length > 0 && username.length < 2
      ? "Must be at least 2 characters"
      : username.length > 20
        ? "Must be 20 characters or fewer"
        : username.length > 0 && !USERNAME_REGEX.test(username)
          ? "Only letters, numbers, hyphens, and underscores"
          : username.toLowerCase().startsWith("guest-")
            ? "Cannot start with 'Guest-'"
            : null;

  const hasChanged = username !== user.username;

  const canSubmit =
    hasChanged &&
    username.length >= 2 &&
    username.length <= 20 &&
    USERNAME_REGEX.test(username) &&
    !username.toLowerCase().startsWith("guest-") &&
    !saving;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await updateUsername(username);
      await refreshUser();
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes("409") || message.toLowerCase().includes("taken")) {
        setError("Username already taken");
      } else {
        setError("Failed to update username");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-300">
      <div className="mx-auto max-w-xl px-4 py-10">
        <h1 className="text-3xl font-bold text-yellow-500 mb-8">Settings</h1>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="rounded border border-gray-700 bg-gray-800 p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-4">
              Username
            </h2>
            <input
              type="text"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setError(null);
                setSuccess(false);
              }}
              maxLength={20}
              className="w-full rounded border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-gray-200 focus:border-yellow-500 focus:outline-none"
            />
            {validationError && (
              <p className="mt-1 text-xs text-red-400">{validationError}</p>
            )}
            {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
            {success && (
              <p className="mt-1 text-xs text-green-400">Username updated</p>
            )}
          </div>

          <Button
            type="submit"
            disabled={!canSubmit}
            className="bg-yellow-500 text-gray-900 hover:bg-yellow-400 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </form>
      </div>
    </div>
  );
}

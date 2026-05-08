"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { updateUsername } from "@/lib/api/client";
import { Button } from "@netrek/ui/button";
import { Server } from "lucide-react";

const USERNAME_REGEX = /^[a-zA-Z0-9_-]+$/;

export default function UsernameSetupPage() {
  const { user, loading, refreshUser } = useAuth();
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!loading && !user) {
    router.replace("/auth/signin");
    return null;
  }

  if (user && !initialized) {
    setUsername(user.username);
    setInitialized(true);
  }

  if (user?.usernameSet) {
    router.replace("/lobby");
    return null;
  }

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

  const canSubmit =
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
    try {
      await updateUsername(username);
      await refreshUser();
      router.push("/lobby");
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes("409") || message.toLowerCase().includes("taken")) {
        setError("Username already taken");
      } else {
        setError("Failed to update username");
      }
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center space-y-2 text-center">
          <Server className="h-8 w-8" />
          <h1>Choose Your Username</h1>
          <p className="text-sm text-muted-foreground">
            This is how other players will see you.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="text"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setError(null);
              }}
              maxLength={20}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Username"
              autoFocus
            />
            {validationError && (
              <p className="mt-1 text-xs text-destructive">{validationError}</p>
            )}
            {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
          </div>

          <Button type="submit" className="w-full" disabled={!canSubmit}>
            {saving ? "Saving..." : "Confirm"}
          </Button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          You can change this later in Settings.
        </p>
      </div>
    </div>
  );
}

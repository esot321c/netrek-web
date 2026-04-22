"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@netrek/ui/button";

function LandingPage() {
  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] flex-col items-center justify-center px-4 text-center">
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Netrek</h1>
      <p className="mt-4 max-w-lg text-lg text-muted-foreground">
        Browser-based multiplayer space combat. Two teams, 40 planets,
        capture-the-flag with armies.
      </p>
      <div className="mt-8">
        <Link href="/auth/signin">
          <Button size="lg">Sign in to play</Button>
        </Link>
      </div>
    </div>
  );
}

export default function HomePage() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return <LandingPage />;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-bold">Lobby</h1>
      <p className="mt-1 text-muted-foreground">
        Welcome back, {user.name || user.email}
      </p>
      <div className="mt-6">
        <Link href="/game">
          <Button size="lg">Enter Game</Button>
        </Link>
      </div>
    </div>
  );
}

"use client";

import { Suspense, use } from "react";
import { useSearchParams } from "next/navigation";
import GameCanvas from "@/components/game-canvas";

function GamePageInner({ id }: { id: string }) {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const ws = searchParams.get("ws");

  if (!token || !ws) {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#000",
          color: "#ef5350",
          fontFamily: "monospace",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div>Missing game token. Please join from the lobby.</div>
        <a
          href="/lobby"
          style={{
            color: "#ffa500",
            textDecoration: "underline",
            fontSize: 14,
          }}
        >
          Back to lobby
        </a>
      </div>
    );
  }

  return <GameCanvas wsUrl={ws} gameToken={token} />;
}

export default function GamePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  return (
    <Suspense
      fallback={
        <div
          style={{
            height: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#000",
            color: "#666",
            fontFamily: "monospace",
          }}
        >
          Loading...
        </div>
      }
    >
      <GamePageInner id={id} />
    </Suspense>
  );
}

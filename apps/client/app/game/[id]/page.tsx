"use client";

import { use, useState } from "react";
import GameCanvas from "@/components/game-canvas";

function readAndClearCreds(
  id: string,
): { gameToken: string; wsUrl: string } | null {
  const raw = sessionStorage.getItem(`game:${id}`);
  if (!raw) return null;
  sessionStorage.removeItem(`game:${id}`);
  return JSON.parse(raw);
}

function GamePageInner({ id }: { id: string }) {
  const [creds] = useState(() => readAndClearCreds(id));

  if (!creds) {
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

  return <GameCanvas wsUrl={creds.wsUrl} gameToken={creds.gameToken} />;
}

export default function GamePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <GamePageInner id={id} />;
}

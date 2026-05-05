"use client";

import { use, useEffect, useState } from "react";
import GameCanvas from "@/components/game-canvas";

function GamePageInner({ id }: { id: string }) {
  const [creds, setCreds] = useState<{
    gameToken: string;
    wsUrl: string;
  } | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const raw = sessionStorage.getItem(`game:${id}`);
    if (!raw) {
      setMissing(true);
      return;
    }
    sessionStorage.removeItem(`game:${id}`);
    setCreds(JSON.parse(raw));
  }, [id]);

  if (missing) {
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

  if (!creds) return null;

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

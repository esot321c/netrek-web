"use client";

import { useEffect, useRef } from "react";
import type { DisplayMessage } from "@/lib/game/chat";
import {
  getTypingDisplay,
  getPersonalMessages,
  getTeamMessages,
  getAllMessages,
  getLastKillMessage,
  getTypingState,
  TypingState,
  startMessage,
} from "@/lib/game/chat";

interface ChatPanelProps {
  chatVersion: number;
}

export default function ChatPanel({ chatVersion }: ChatPanelProps) {
  const typingDisplay = getTypingDisplay();
  const personalMsgs = getPersonalMessages();
  const teamMsgs = getTeamMessages();
  const allMsgs = getAllMessages();
  const killMsg = getLastKillMessage();
  const typingState = getTypingState();

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        fontFamily: "monospace",
        fontSize: 11,
        color: "#aaa",
        padding: 4,
        overflow: "hidden",
        cursor: typingState === TypingState.IDLE ? "pointer" : "text",
      }}
      onClick={() => {
        if (typingState === TypingState.IDLE) {
          startMessage();
        }
      }}
    >
      {/* Typing line */}
      <div
        style={{
          color: "#ffffff",
          height: 16,
          lineHeight: "16px",
          borderBottom: "1px solid #222",
          flexShrink: 0,
          whiteSpace: "nowrap",
          overflow: "hidden",
        }}
      >
        {typingDisplay || " "}
      </div>

      {/* Personal messages */}
      <MessageSection label="Personal" messages={personalMsgs} maxVisible={3} />

      {/* Team messages */}
      <MessageSection label="Team" messages={teamMsgs} maxVisible={3} />

      {/* All messages */}
      <MessageSection label="All" messages={allMsgs} maxVisible={3} />

      {/* Kill announcements */}
      <div
        style={{
          marginTop: "auto",
          color: killMsg?.color ?? "#555",
          height: 14,
          lineHeight: "14px",
          flexShrink: 0,
          whiteSpace: "nowrap",
          overflow: "hidden",
          borderTop: "1px solid #222",
        }}
      >
        {killMsg?.text ?? " "}
      </div>
    </div>
  );
}

function MessageSection({
  label,
  messages,
  maxVisible,
}: {
  label: string;
  messages: readonly DisplayMessage[];
  maxVisible: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  const visible = messages.slice(-maxVisible);

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          color: "#555",
          fontSize: 9,
          lineHeight: "12px",
          flexShrink: 0,
        }}
      >
        {label}
      </div>
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          minHeight: 0,
        }}
      >
        {visible.map((msg, i) => (
          <div
            key={i}
            style={{
              color: msg.color,
              lineHeight: "14px",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {msg.text}
          </div>
        ))}
      </div>
    </div>
  );
}

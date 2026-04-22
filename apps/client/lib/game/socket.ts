import { io, Socket } from "socket.io-client";
import {
  deserializeGameState,
  serializeInput,
  InputCommand,
  type ClientGameState,
} from "@netrek/shared";

// ---------------------------------------------------------------------------
// Singleton socket — lives outside React lifecycle
// ---------------------------------------------------------------------------

// Strip /v1 suffix — WebSocket gateway is at the root, not behind the REST prefix
const API_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3012"
).replace(/\/v1$/, "");

let socket: Socket | null = null;
let stateCallback: ((state: ClientGameState) => void) | null = null;
let connectCallback: (() => void) | null = null;
let disconnectCallback: (() => void) | null = null;
let joinCallback:
  | ((result: { slot: number } | { error: string }) => void)
  | null = null;

export function getSocket(): Socket | null {
  return socket;
}

export function connect(): Socket {
  if (socket?.connected) return socket;

  socket = io(`${API_URL}/game`, {
    withCredentials: true, // sends auth cookies automatically
    transports: ["websocket"],
    autoConnect: true,
  });

  socket.on("connect", () => {
    connectCallback?.();
  });

  socket.on("disconnect", () => {
    disconnectCallback?.();
  });

  socket.on("state", (data: ArrayBuffer) => {
    if (!stateCallback) return;
    const state = deserializeGameState(data);
    stateCallback(state);
  });

  return socket;
}

export function disconnect(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

// ---------------------------------------------------------------------------
// Event registration (called by React components)
// ---------------------------------------------------------------------------

export function onState(cb: (state: ClientGameState) => void): void {
  stateCallback = cb;
}

export function onConnect(cb: () => void): void {
  connectCallback = cb;
}

export function onDisconnect(cb: () => void): void {
  disconnectCallback = cb;
}

export function onJoinResult(
  cb: (result: { slot: number } | { error: string }) => void,
): void {
  joinCallback = cb;
}

// ---------------------------------------------------------------------------
// Commands (sent to server)
// ---------------------------------------------------------------------------

export function sendJoin(team: number, shipType: number): void {
  if (!socket) return;
  socket.emit(
    "join",
    { team, shipType },
    (result: { slot: number } | { error: string }) => {
      joinCallback?.(result);
    },
  );
}

export function sendInput(command: InputCommand, value: number): void {
  if (!socket) return;
  const buf = serializeInput(command, value);
  socket.emit("input", buf);
}

export function sendRespawn(shipType: number): void {
  if (!socket) return;
  socket.emit("respawn", { shipType });
}

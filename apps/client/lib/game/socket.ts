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

let socket: Socket | null = null;
let stateCallback: ((state: ClientGameState) => void) | null = null;
let connectCallback: (() => void) | null = null;
let disconnectCallback: (() => void) | null = null;
let joinedCallback: ((data: { slot: number }) => void) | null = null;

export function getSocket(): Socket | null {
  return socket;
}

export function connect(wsUrl: string, gameToken: string): Socket {
  if (socket) {
    socket.disconnect();
  }

  socket = io(`${wsUrl}/game`, {
    auth: { token: gameToken },
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

  socket.on("joined", (data: { slot: number }) => {
    joinedCallback?.(data);
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

export function onJoined(cb: (data: { slot: number }) => void): void {
  joinedCallback = cb;
}

// ---------------------------------------------------------------------------
// Commands (sent to server)
// ---------------------------------------------------------------------------

export function sendInput(command: InputCommand, value: number): void {
  if (!socket) return;
  const buf = serializeInput(command, value);
  socket.emit("input", buf);
}

export function sendRespawn(shipType: number): void {
  if (!socket) return;
  socket.emit("respawn", { shipType });
}

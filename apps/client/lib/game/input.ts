import { InputCommand, LockType, ShipStatus } from "@netrek/shared";
import { sendInput } from "./socket";
import { getMySlot, getLatestSnapshot } from "./state";

// ---------------------------------------------------------------------------
// Input capture — keyboard + mouse
// ---------------------------------------------------------------------------

let canvas: HTMLCanvasElement | null = null;
let viewportCenterX = 0;
let viewportCenterY = 0;
let viewportScale = 1; // pixels per game unit
let lastMouseX = 0; // last known mouse position (client pixels)
let lastMouseY = 0;

// Called by the renderer each frame so input knows the current viewport
export function updateViewport(
  centerX: number,
  centerY: number,
  scale: number,
): void {
  viewportCenterX = centerX;
  viewportCenterY = centerY;
  viewportScale = scale;
}

function mouseToGameCoords(e: MouseEvent): { gx: number; gy: number } | null {
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;

  // Convert pixel coords to game coords using display canvas dimensions
  const canvasW = canvas.width;
  const canvasH = canvas.height;
  const gx = viewportCenterX + (px - canvasW / 2) / viewportScale;
  const gy = viewportCenterY + (py - canvasH / 2) / viewportScale;

  return { gx, gy };
}

function mouseDirFromEvent(e: MouseEvent): number | null {
  const coords = mouseToGameCoords(e);
  if (!coords) return null;

  const dx = coords.gx - viewportCenterX;
  const dy = coords.gy - viewportCenterY;
  const rad = Math.atan2(dx, -dy); // north=0, clockwise
  return (
    Math.round(
      ((((rad % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) /
        (Math.PI * 2)) *
        256,
    ) & 0xff
  );
}

function handleMouseMove(e: MouseEvent): void {
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
}

/** Find the nearest planet or ship to the current mouse position and send a LOCK command. */
function lockNearestEntity(): void {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const px = lastMouseX - rect.left;
  const py = lastMouseY - rect.top;
  const gx = viewportCenterX + (px - canvas.width / 2) / viewportScale;
  const gy = viewportCenterY + (py - canvas.height / 2) / viewportScale;

  const snap = getLatestSnapshot();
  if (!snap) return;

  let bestType = LockType.NONE;
  let bestId = -1;
  let bestDist = Infinity;

  // Check planets
  for (let i = 0; i < snap.planets.length; i++) {
    const p = snap.planets[i]!;
    const dx = p.x - gx;
    const dy = p.y - gy;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      bestType = LockType.PLANET;
      bestId = p.planetId;
    }
  }

  // Check ships (closer ship overrides planet if nearer)
  const mySlot = getMySlot();
  for (let i = 0; i < snap.ships.length; i++) {
    const s = snap.ships[i]!;
    if (s.slotIndex === mySlot) continue;
    if (s.status !== 0) continue; // ShipStatus.ALIVE = 0
    const dx = s.x - gx;
    const dy = s.y - gy;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      bestType = LockType.PLAYER;
      bestId = s.slotIndex;
    }
  }

  if (bestType !== LockType.NONE && bestId >= 0) {
    sendInput(InputCommand.LOCK, (bestType << 8) | bestId);
  }
}

/** Find the nearest ship to the mouse cursor (any team). Returns slot or -1. */
function findNearestShip(): number {
  if (!canvas) return -1;
  const rect = canvas.getBoundingClientRect();
  const px = lastMouseX - rect.left;
  const py = lastMouseY - rect.top;
  const gx = viewportCenterX + (px - canvas.width / 2) / viewportScale;
  const gy = viewportCenterY + (py - canvas.height / 2) / viewportScale;

  const snap = getLatestSnapshot();
  if (!snap) return -1;

  const mySlot = getMySlot();
  let bestSlot = -1;
  let bestDist = Infinity;

  for (let i = 0; i < snap.ships.length; i++) {
    const s = snap.ships[i]!;
    if (s.slotIndex === mySlot) continue;
    if (s.status !== ShipStatus.ALIVE) continue;
    const dx = s.x - gx;
    const dy = s.y - gy;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      bestSlot = s.slotIndex;
    }
  }

  return bestSlot;
}

function handleMouseDown(e: MouseEvent): void {
  if (getMySlot() < 0) return;
  e.preventDefault();

  const dir = mouseDirFromEvent(e);
  if (dir === null) return;

  if (e.button === 0) {
    if (e.shiftKey) {
      // Shift+Left: fire phaser in mouse direction
      sendInput(InputCommand.FIRE_PHASER, dir);
    } else {
      // Left click: fire torpedo in mouse direction
      sendInput(InputCommand.FIRE_TORP, dir);
    }
  } else if (e.button === 1) {
    // Middle click: fire phaser in mouse direction
    sendInput(InputCommand.FIRE_PHASER, dir);
  } else if (e.button === 2) {
    // Right click: set course to mouse direction
    sendInput(InputCommand.SET_DIRECTION, dir);
  }
}

function handleKeyDown(e: KeyboardEvent): void {
  if (getMySlot() < 0) return;
  // Ignore modified keys (Ctrl+, Alt+, Meta+) — let browser handle those
  if (e.ctrlKey || e.altKey || e.metaKey) return;

  // Number keys 0-9 set warp speed
  if (e.key >= "0" && e.key <= "9") {
    e.preventDefault();
    sendInput(InputCommand.SET_SPEED, parseInt(e.key, 10));
    return;
  }

  switch (e.key) {
    case ")":
      e.preventDefault();
      sendInput(InputCommand.SET_SPEED, 10);
      break;
    case "!":
      e.preventDefault();
      sendInput(InputCommand.SET_SPEED, 11);
      break;
    case "@":
      e.preventDefault();
      sendInput(InputCommand.SET_SPEED, 12);
      break;
    case "%":
      e.preventDefault();
      sendInput(InputCommand.SET_SPEED, 99); // server clamps to max
      break;
    case "s":
    case "S":
      e.preventDefault();
      sendInput(InputCommand.SHIELD_TOGGLE, 0);
      break;
    case "r":
    case "R":
      e.preventDefault();
      sendInput(InputCommand.REPAIR_TOGGLE, 0);
      break;
    case "d":
      e.preventDefault();
      sendInput(InputCommand.DETONATE, 0);
      break;
    case "D":
      e.preventDefault();
      sendInput(InputCommand.DETONATE_SELF, 0);
      break;
    case "b":
      e.preventDefault();
      sendInput(InputCommand.BOMB, 0);
      break;
    case "z":
      e.preventDefault();
      sendInput(InputCommand.BEAM_UP, 0);
      break;
    case "x":
      e.preventDefault();
      sendInput(InputCommand.BEAM_DOWN, 0);
      break;
    case "c":
      e.preventDefault();
      sendInput(InputCommand.CLOAK_TOGGLE, 0);
      break;
    case "T": {
      e.preventDefault();
      const tractorSlot = findNearestShip();
      sendInput(InputCommand.TRACTOR, tractorSlot >= 0 ? tractorSlot : 0xff);
      break;
    }
    case "y": {
      e.preventDefault();
      const pressorSlot = findNearestShip();
      sendInput(InputCommand.PRESSOR, pressorSlot >= 0 ? pressorSlot : 0xff);
      break;
    }
    case "l":
      e.preventDefault();
      lockNearestEntity();
      break;
  }
}

function handleContextMenu(e: Event): void {
  e.preventDefault(); // Prevent right-click menu
}

export function setupInput(canvasEl: HTMLCanvasElement): () => void {
  canvas = canvasEl;

  canvasEl.addEventListener("mousedown", handleMouseDown);
  canvasEl.addEventListener("mousemove", handleMouseMove);
  canvasEl.addEventListener("contextmenu", handleContextMenu);
  window.addEventListener("keydown", handleKeyDown);

  return () => {
    canvasEl.removeEventListener("mousedown", handleMouseDown);
    canvasEl.removeEventListener("mousemove", handleMouseMove);
    canvasEl.removeEventListener("contextmenu", handleContextMenu);
    window.removeEventListener("keydown", handleKeyDown);
    canvas = null;
  };
}

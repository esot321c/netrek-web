import {
  ShipStatus,
  Team,
  LockType,
  PlanetFeature,
  PlanetVisibility,
  GALAXY_WIDTH,
  GALAXY_HEIGHT,
  SHIP_STATS,
  armyCapacity,
  PLANET_RADIUS_GU,
  TEAM_NEUTRAL,
  type ClientGameState,
  type ClientShip,
  type ClientTorp,
  type ClientPhaser,
  type ClientExplosion,
  type ClientPlanet,
  type ClientPlasma,
} from "@netrek/shared";
import { getInterpolatedShip, getMySlot } from "./state";
import { updateViewport } from "./input";
import { getShipSprite, getCloakSprite, initSprites } from "./sprites";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VIEWPORT_SIZE = 12000; // game units visible in each direction from center

// Team colors — original COW client: Fed=Yellow, Rom=Red, Kli=Green, Ori=Cyan
const TEAM_COLORS: Record<number, string> = {
  [Team.FEDERATION]: "#ffff00",
  [Team.ROMULANS]: "#ff4444",
  [Team.KLINGONS]: "#44ff44",
  [Team.ORIONS]: "#44ffff",
};

const GRID_COLOR = "#111122";
const BORDER_COLOR = "#333366";
const BG_COLOR = "#000008";

// Entity sizes in game units — these scale naturally with the viewport
const SHIP_SIZE_GU = 400; // ship nose-to-tail in game units
const SHIELD_RADIUS_GU = 350;
const TORP_SIZE_GU = 120;

// ---------------------------------------------------------------------------
// Renderer state
// ---------------------------------------------------------------------------

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let galCanvas: HTMLCanvasElement | null = null;
let galCtx: CanvasRenderingContext2D | null = null;

let viewCenterX = 50000;
let viewCenterY = 50000;
let myTeam: Team = Team.FEDERATION;

export function initRenderer(
  display: HTMLCanvasElement,
  galaxyMap?: HTMLCanvasElement,
): void {
  canvas = display;
  ctx = display.getContext("2d")!;
  if (galaxyMap) {
    galCanvas = galaxyMap;
    galCtx = galaxyMap.getContext("2d")!;
  }
  initSprites();
  loadPlanetIcons();
}

// ---------------------------------------------------------------------------
// Coordinate transform — game coords to screen pixels
// ---------------------------------------------------------------------------

function getScale(): number {
  if (!canvas) return 1;
  return Math.min(canvas.width, canvas.height) / (VIEWPORT_SIZE * 2);
}

function gameToScreen(gx: number, gy: number): [number, number] {
  if (!canvas) return [0, 0];
  const w = canvas.width;
  const h = canvas.height;
  const scale = getScale();
  const cx = w / 2 + (gx - viewCenterX) * scale;
  const cy = h / 2 + (gy - viewCenterY) * scale;
  return [cx, cy];
}

// ---------------------------------------------------------------------------
// Render frame — draws directly on the display canvas at full resolution
// ---------------------------------------------------------------------------

export function renderFrame(state: ClientGameState | null): void {
  if (!ctx || !canvas) return;

  const w = canvas.width;
  const h = canvas.height;

  // Update viewport center to own ship position
  const mySlot = getMySlot();
  if (mySlot >= 0) {
    const interp = getInterpolatedShip(mySlot);
    if (interp) {
      viewCenterX = interp.x;
      viewCenterY = interp.y;
    }
  }

  // Report viewport to input module (using display canvas scale)
  updateViewport(viewCenterX, viewCenterY, getScale());

  // Clear
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, w, h);

  // Grid
  drawGrid(ctx, w, h);

  // Galaxy boundary
  drawBoundary(ctx);

  if (state) {
    // Track own team for cloak rendering
    const myShipState =
      mySlot >= 0 ? state.ships.find((s) => s.slotIndex === mySlot) : undefined;
    if (myShipState) myTeam = myShipState.team;

    // Planets (draw under everything)
    for (const planet of state.planets) {
      drawPlanet(ctx, planet);
    }

    // Torpedoes (draw under ships)
    for (const torp of state.torps) {
      drawTorp(ctx, torp);
    }

    // Plasmas (draw as larger pulsing dots)
    for (const plasma of state.plasmas) {
      drawPlasma(ctx, plasma, state.tick);
    }

    // Phasers
    for (const phaser of state.phasers) {
      drawPhaser(ctx, phaser, state);
    }

    // Explosions
    for (const expl of state.explosions) {
      drawExplosion(ctx, expl);
    }

    // Ships
    for (const ship of state.ships) {
      drawShip(ctx, ship);
    }

    // Tractor/pressor beams (draw over ships)
    for (const ship of state.ships) {
      if (ship.status !== ShipStatus.ALIVE) continue;
      if (ship.tractorTarget >= 0)
        drawBeam(ctx, ship, ship.tractorTarget, state, false);
      if (ship.pressorTarget >= 0)
        drawBeam(ctx, ship, ship.pressorTarget, state, true);
    }

    // Lock indicator (triangle above locked target)
    drawLockIndicator(ctx, state);

    // HUD overlay
    drawHUD(ctx, state);
  }

  // Galaxy map (right pane)
  if (galCtx && galCanvas && state) {
    renderGalaxyMap(galCtx, galCanvas, state, mySlot);
  }
}

// ---------------------------------------------------------------------------
// Drawing functions
// ---------------------------------------------------------------------------

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;

  const gridSpacing = 10000;
  for (let gx = 0; gx <= GALAXY_WIDTH; gx += gridSpacing) {
    const [sx] = gameToScreen(gx, 0);
    if (sx < -1 || sx > w + 1) continue;
    const x = Math.round(sx) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let gy = 0; gy <= GALAXY_HEIGHT; gy += gridSpacing) {
    const [, sy] = gameToScreen(0, gy);
    if (sy < -1 || sy > h + 1) continue;
    const y = Math.round(sy) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}

function drawBoundary(ctx: CanvasRenderingContext2D): void {
  const [x0, y0] = gameToScreen(0, 0);
  const [x1, y1] = gameToScreen(GALAXY_WIDTH, GALAXY_HEIGHT);
  ctx.strokeStyle = BORDER_COLOR;
  ctx.lineWidth = 2;
  ctx.strokeRect(
    Math.round(x0) + 0.5,
    Math.round(y0) + 0.5,
    Math.round(x1 - x0),
    Math.round(y1 - y0),
  );
}

function drawShip(ctx: CanvasRenderingContext2D, ship: ClientShip): void {
  if (ship.status === ShipStatus.DEAD) return;

  const interp = getInterpolatedShip(ship.slotIndex);
  const sx = interp?.x ?? ship.x;
  const sy = interp?.y ?? ship.y;
  const [cx, cy] = gameToScreen(sx, sy);

  // Off-screen culling
  if (!canvas) return;
  const margin = 40;
  if (
    cx < -margin ||
    cx > canvas.width + margin ||
    cy < -margin ||
    cy > canvas.height + margin
  )
    return;

  const color = TEAM_COLORS[ship.team] ?? "#888888";

  const scale = getScale();
  const shipPx = SHIP_SIZE_GU * scale;
  const shieldPx = SHIELD_RADIUS_GU * scale;

  if (ship.status === ShipStatus.EXPLODING) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.globalAlpha = Math.random() > 0.5 ? 1 : 0.4;
    ctx.beginPath();
    ctx.arc(cx, cy, shipPx + 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    return;
  }

  // Cloaked ship rendering
  if (ship.cloaked) {
    const isFriendly = ship.team === myTeam;
    // Friendly cloaked: white cloak symbol, no outline
    // Enemy cloaked: team-colored cloak symbol (position already fuzzed by server)
    const cloakSprite = getCloakSprite(isFriendly ? -1 : ship.team);
    if (cloakSprite) {
      const spriteSize = shipPx * 2;
      const smoothing = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        cloakSprite,
        Math.round(cx - spriteSize / 2),
        Math.round(cy - spriteSize / 2),
        Math.round(spriteSize),
        Math.round(spriteSize),
      );
      ctx.imageSmoothingEnabled = smoothing;
    }
    return;
  }

  // Draw ship bitmap sprite (view 0 = up, canvas-rotated to direction)
  const sprite = getShipSprite(ship.team, ship.shipType, 0);
  if (sprite) {
    const spriteSize = shipPx * 2;
    const angle = (ship.direction / 256) * Math.PI * 2;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.drawImage(
      sprite,
      Math.round(-spriteSize / 2),
      Math.round(-spriteSize / 2),
      Math.round(spriteSize),
      Math.round(spriteSize),
    );
    ctx.restore();
  }

  // Shield circle
  if (ship.shieldsUp && ship.shieldPct > 0) {
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.3 + ship.shieldPct * 0.7;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, shieldPx, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Player number label
  ctx.fillStyle = color;
  ctx.font = `${Math.max(10, Math.round(shipPx * 0.8))}px monospace`;
  ctx.fillText(String(ship.slotIndex), cx + shieldPx + 2, cy - 2);
}

function drawTorp(ctx: CanvasRenderingContext2D, torp: ClientTorp): void {
  const [cx, cy] = gameToScreen(torp.x, torp.y);
  if (!canvas) return;
  if (cx < -5 || cx > canvas.width + 5 || cy < -5 || cy > canvas.height + 5)
    return;

  const scale = getScale();
  const torpPx = Math.max(2, TORP_SIZE_GU * scale);
  const color = TEAM_COLORS[torp.team] ?? "#888888";
  const half = torpPx / 2;
  const isFriendly = torp.team === myTeam;

  if (isFriendly) {
    // Friendly torps: filled dot
    ctx.fillStyle = color;
    ctx.fillRect(
      Math.round(cx - half),
      Math.round(cy - half),
      Math.round(torpPx),
      Math.round(torpPx),
    );
  } else {
    // Enemy torps: X shape
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - half, cy - half);
    ctx.lineTo(cx + half, cy + half);
    ctx.moveTo(cx + half, cy - half);
    ctx.lineTo(cx - half, cy + half);
    ctx.stroke();
  }
}

function drawPlasma(
  ctx: CanvasRenderingContext2D,
  plasma: ClientPlasma,
  tick: number,
): void {
  const [cx, cy] = gameToScreen(plasma.x, plasma.y);
  if (!canvas) return;
  if (cx < -10 || cx > canvas.width + 10 || cy < -10 || cy > canvas.height + 10)
    return;

  const scale = getScale();
  const basePx = Math.max(4, 120 * scale);
  const pulse = 1 + 0.3 * Math.sin(tick * 0.5);
  const px = basePx * pulse;
  const color = TEAM_COLORS[plasma.team] ?? "#888888";

  ctx.fillStyle = color;
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.arc(cx, cy, px / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1.0;
}

function drawPhaser(
  ctx: CanvasRenderingContext2D,
  phaser: ClientPhaser,
  state: ClientGameState,
): void {
  const ownerShip = state.ships.find((s) => s.slotIndex === phaser.ownerSlot);
  if (!ownerShip) return;

  const interp = getInterpolatedShip(phaser.ownerSlot);
  const ox = interp?.x ?? ownerShip.x;
  const oy = interp?.y ?? ownerShip.y;

  const [x1, y1] = gameToScreen(ox, oy);
  const [x2, y2] = gameToScreen(phaser.targetX, phaser.targetY);

  const color = TEAM_COLORS[phaser.team] ?? "#888888";
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function drawExplosion(
  ctx: CanvasRenderingContext2D,
  expl: ClientExplosion,
): void {
  const [cx, cy] = gameToScreen(expl.x, expl.y);
  const scale = getScale();
  const r = Math.max(2, expl.radius * scale);

  if (!canvas) return;
  if (
    cx + r < 0 ||
    cx - r > canvas.width ||
    cy + r < 0 ||
    cy - r > canvas.height
  )
    return;

  ctx.strokeStyle = "#ff8800";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Tractor/pressor beam — two dashed lines from ship to target
// ---------------------------------------------------------------------------

function drawBeam(
  ctx: CanvasRenderingContext2D,
  ship: ClientShip,
  targetSlot: number,
  state: ClientGameState,
  isPressor: boolean,
): void {
  const target = state.ships.find((s) => s.slotIndex === targetSlot);
  if (!target || target.status !== ShipStatus.ALIVE) return;

  const srcInterp = getInterpolatedShip(ship.slotIndex);
  const dstInterp = getInterpolatedShip(targetSlot);
  const srcX = srcInterp?.x ?? ship.x;
  const srcY = srcInterp?.y ?? ship.y;
  const dstX = dstInterp?.x ?? target.x;
  const dstY = dstInterp?.y ?? target.y;

  const [x1, y1] = gameToScreen(srcX, srcY);
  const [x2, y2] = gameToScreen(dstX, dstY);

  // Perpendicular offset for the two lines (spread to target ship width)
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return;

  const scale = getScale();
  const halfWidth = SHIP_SIZE_GU * scale * 0.5;
  const nx = (-dy / len) * halfWidth;
  const ny = (dx / len) * halfWidth;

  const color = isPressor ? "#ff8844" : (TEAM_COLORS[ship.team] ?? "#888888");

  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);

  // Line 1: from ship center to target + offset
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2 + nx, y2 + ny);
  ctx.stroke();

  // Line 2: from ship center to target - offset
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2 - nx, y2 - ny);
  ctx.stroke();

  ctx.setLineDash([]);
}

// ---------------------------------------------------------------------------
// Lock indicator — small triangle pointing down at locked target
// ---------------------------------------------------------------------------

function drawLockIndicator(
  ctx: CanvasRenderingContext2D,
  state: ClientGameState,
): void {
  const { lockType, lockTargetId } = state.self;
  if (lockType === LockType.NONE || lockTargetId < 0) return;

  let targetX: number | undefined;
  let targetY: number | undefined;

  if (lockType === LockType.PLANET) {
    const planet = state.planets.find((p) => p.planetId === lockTargetId);
    if (planet) {
      targetX = planet.x;
      targetY = planet.y;
    }
  } else if (lockType === LockType.PLAYER) {
    const ship = state.ships.find((s) => s.slotIndex === lockTargetId);
    if (ship && ship.status === ShipStatus.ALIVE) {
      const interp = getInterpolatedShip(lockTargetId);
      targetX = interp?.x ?? ship.x;
      targetY = interp?.y ?? ship.y;
    }
  }

  if (targetX === undefined || targetY === undefined) return;

  const [cx, cy] = gameToScreen(targetX, targetY);
  if (!canvas) return;
  if (cx < -50 || cx > canvas.width + 50 || cy < -50 || cy > canvas.height + 50)
    return;

  const scale = getScale();
  const offset =
    (lockType === LockType.PLANET ? PLANET_RADIUS_GU : SHIELD_RADIUS_GU) *
      scale +
    8;
  const triH = 10;
  const triW = 6;

  // Bobbing animation
  const bob = Math.sin(performance.now() / 300) * 3;
  const tipY = cy - offset + bob;

  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(cx, tipY);
  ctx.lineTo(cx - triW, tipY - triH);
  ctx.lineTo(cx + triW, tipY - triH);
  ctx.closePath();
  ctx.fill();
}

// ---------------------------------------------------------------------------
// Planets — tactical view
// ---------------------------------------------------------------------------

const NEUTRAL_COLOR = "#888888";

// ---------------------------------------------------------------------------
// Planet feature bitmap icons (from original COW client, team-tinted)
// ---------------------------------------------------------------------------

// Raw source images (loaded once)
const rawIcons: {
  army: HTMLImageElement;
  repair: HTMLImageElement;
  fuel: HTMLImageElement;
} = {
  army: null as unknown as HTMLImageElement,
  repair: null as unknown as HTMLImageElement,
  fuel: null as unknown as HTMLImageElement,
};
let iconsReady = false;

// Cache of team-tinted OffscreenCanvas: tintedIcons[colorHex][iconName]
const tintedIcons = new Map<string, Map<string, OffscreenCanvas>>();

/** Tint a source image to a solid color (preserving alpha). */
function tintIcon(src: HTMLImageElement, color: string): OffscreenCanvas {
  const w = src.naturalWidth;
  const h = src.naturalHeight;
  const oc = new OffscreenCanvas(w, h);
  const octx = oc.getContext("2d")!;
  // Draw original to get alpha mask
  octx.drawImage(src, 0, 0);
  // Tint: fill with color, use source-atop to only color opaque pixels
  octx.globalCompositeOperation = "source-atop";
  octx.fillStyle = color;
  octx.fillRect(0, 0, w, h);
  octx.globalCompositeOperation = "source-over";
  return oc;
}

/** Get a team-tinted icon canvas, creating it on first access. */
function getTintedIcon(name: string, color: string): OffscreenCanvas | null {
  if (!iconsReady) return null;
  let colorMap = tintedIcons.get(color);
  if (!colorMap) {
    colorMap = new Map();
    tintedIcons.set(color, colorMap);
  }
  let oc = colorMap.get(name);
  if (!oc) {
    const src = rawIcons[name as keyof typeof rawIcons];
    if (!src || !src.complete || src.naturalWidth === 0) return null;
    oc = tintIcon(src, color);
    colorMap.set(name, oc);
  }
  return oc;
}

function loadPlanetIcons(): void {
  let loaded = 0;
  const names: Array<keyof typeof rawIcons> = ["army", "repair", "fuel"];
  for (const name of names) {
    const img = new Image();
    img.src = `/sprites/${name}.png`;
    img.onload = () => {
      loaded++;
      if (loaded === names.length) iconsReady = true;
    };
    rawIcons[name] = img;
  }
}

/** Draw planet circle */
function drawPlanetCircle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  color: string,
): void {
  ctx.fillStyle = "#000008";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
}

/** Draw feature icons inside a planet circle at fixed positions:
 *  left = armies (>4), center = repair, right = fuel.
 *  Icons are tinted to team color and sized to fill the circle. */
function drawPlanetFeatures(
  ctx: CanvasRenderingContext2D,
  planet: ClientPlanet,
  cx: number,
  cy: number,
  r: number,
  color: string,
): void {
  // Icons are pixel-perfect to the original — uniform scale factor, draw at native proportions.
  // Wrench is tallest (38px native), scale so it fits inside the planet circle.
  const scale = (r * 2 - 2) / 38;

  // Helper: draw icon centered at (ix, iy) using native size * scale
  const draw = (name: string, ix: number, iy: number) => {
    const ic = getTintedIcon(name, color);
    if (!ic) return;
    const w = Math.round(ic.width * scale);
    const h = Math.round(ic.height * scale);
    ctx.drawImage(ic, ix - w / 2, iy - h / 2, w, h);
  };

  // Wrench centered; army and fuel packed 1px from wrench edges
  const wrenchHalfW = Math.round((9 * scale) / 2);
  const gap = wrenchHalfW + 1;

  if (planet.armies > 4)
    draw("army", cx - gap - Math.round((12 * scale) / 2) + 1, cy);
  if (planet.features & PlanetFeature.REPAIR) draw("repair", cx, cy);
  if (planet.features & PlanetFeature.FUEL)
    draw("fuel", cx + gap + Math.round((10 * scale) / 2), cy);
}

function drawPlanet(ctx: CanvasRenderingContext2D, planet: ClientPlanet): void {
  const [cx, cy] = gameToScreen(planet.x, planet.y);
  if (!canvas) return;

  const scale = getScale();
  const r = Math.max(4, PLANET_RADIUS_GU * scale);

  // Off-screen culling
  if (
    cx + r < 0 ||
    cx - r > canvas.width ||
    cy + r < 0 ||
    cy - r > canvas.height
  )
    return;

  if (planet.visibility === PlanetVisibility.UNKNOWN) {
    drawPlanetCircle(ctx, cx, cy, r, "#555555");
    const fontSize = Math.max(8, Math.round(r * 0.7));
    ctx.fillStyle = "#555555";
    ctx.font = `${fontSize}px monospace`;
    ctx.textAlign = "center";
    ctx.fillText("?", cx, cy + Math.round(fontSize * 0.35));
    ctx.fillText(planet.name, cx, cy + r + 10);
    ctx.textAlign = "start";
    return;
  }

  const color =
    (planet.team as number) === TEAM_NEUTRAL
      ? NEUTRAL_COLOR
      : (TEAM_COLORS[planet.team] ?? NEUTRAL_COLOR);

  const isAgri = (planet.features & PlanetFeature.AGRICULTURAL) !== 0;

  drawPlanetCircle(ctx, cx, cy, r, color);

  const displayName = isAgri ? planet.name.toUpperCase() : planet.name;
  ctx.fillStyle = isAgri ? "#ffffff" : color;
  const fontSize = Math.max(8, Math.round(r * 0.7));
  const isFriendlyPlanet = planet.team === (myTeam as number);
  ctx.font = `${isFriendlyPlanet ? "bold " : ""}${fontSize}px monospace`;
  ctx.textAlign = "center";
  ctx.fillText(`${displayName} (${planet.armies})`, cx, cy + r + 10);

  drawPlanetFeatures(ctx, planet, cx, cy, r, color);

  ctx.textAlign = "start";
}

// ---------------------------------------------------------------------------
// Galaxy map — right pane overview of entire galaxy
// ---------------------------------------------------------------------------

function renderGalaxyMap(
  ctx: CanvasRenderingContext2D,
  mapCanvas: HTMLCanvasElement,
  state: ClientGameState,
  mySlot: number,
): void {
  const w = mapCanvas.width;
  const h = mapCanvas.height;

  // Clear
  ctx.fillStyle = "#000008";
  ctx.fillRect(0, 0, w, h);

  // Scale: map entire galaxy to the canvas
  const scaleX = w / GALAXY_WIDTH;
  const scaleY = h / GALAXY_HEIGHT;

  // Galaxy border
  ctx.strokeStyle = BORDER_COLOR;
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, w, h);

  // Grid lines
  ctx.strokeStyle = "#0a0a18";
  ctx.lineWidth = 1;
  const gridSpacing = 10000;
  for (let gx = gridSpacing; gx < GALAXY_WIDTH; gx += gridSpacing) {
    const sx = gx * scaleX;
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, h);
    ctx.stroke();
  }
  for (let gy = gridSpacing; gy < GALAXY_HEIGHT; gy += gridSpacing) {
    const sy = gy * scaleY;
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(w, sy);
    ctx.stroke();
  }

  // Planets — scale radius relative to map size
  const planetRadius = Math.max(5, Math.round(w * 0.018));
  const planetFont = `${Math.max(7, Math.round(planetRadius * 0.9))}px monospace`;
  for (const planet of state.planets) {
    const px = planet.x * scaleX;
    const py = planet.y * scaleY;

    if (planet.visibility === PlanetVisibility.UNKNOWN) {
      drawPlanetCircle(ctx, px, py, planetRadius, "#555555");
      ctx.fillStyle = "#555555";
      ctx.font = planetFont;
      ctx.textAlign = "center";
      ctx.fillText("?", px, py + Math.round(planetRadius * 0.35));
      continue;
    }

    const color =
      (planet.team as number) === TEAM_NEUTRAL
        ? NEUTRAL_COLOR
        : (TEAM_COLORS[planet.team] ?? NEUTRAL_COLOR);

    const isAgri = (planet.features & PlanetFeature.AGRICULTURAL) !== 0;

    if (planet.visibility === PlanetVisibility.STALE) {
      // Dashed border for stale planets
      ctx.setLineDash([3, 3]);
      drawPlanetCircle(ctx, px, py, planetRadius, color);
      ctx.setLineDash([]);
    } else {
      drawPlanetCircle(ctx, px, py, planetRadius, color);
    }

    drawPlanetFeatures(ctx, planet, px, py, planetRadius, color);

    const abbr = planet.name.substring(0, 3);
    const isFriendlyPlanet = planet.team === (myTeam as number);
    ctx.fillStyle = isAgri ? "#ffffff" : color;
    ctx.font = isFriendlyPlanet ? `bold ${planetFont}` : planetFont;
    ctx.textAlign = "center";
    ctx.fillText(
      isAgri ? abbr.toUpperCase() : abbr,
      px,
      py + planetRadius + Math.round(planetRadius * 0.6),
    );
  }

  // Ships as small dots
  for (const ship of state.ships) {
    if (ship.status === ShipStatus.DEAD) continue;
    const sx = ship.x * scaleX;
    const sy = ship.y * scaleY;
    const color = TEAM_COLORS[ship.team] ?? "#888888";
    const isMe = ship.slotIndex === mySlot;
    const isCloakedEnemy = ship.cloaked && ship.team !== myTeam && !isMe;

    if (isCloakedEnemy) {
      // Cloaked enemies show as "??" with team color (position already fuzzed by server)
      ctx.fillStyle = color;
      ctx.font = "7px monospace";
      ctx.textAlign = "center";
      ctx.fillText("??", sx, sy + 3);
    } else {
      ctx.fillStyle = isMe ? "#ffffff" : color;
      ctx.fillRect(sx - 2, sy - 2, isMe ? 5 : 3, isMe ? 5 : 3);

      // Player number
      ctx.fillStyle = isMe ? "#ffffff" : color;
      ctx.font = "7px monospace";
      ctx.textAlign = "center";
      ctx.fillText(String(ship.slotIndex), sx, sy - 4);
    }
  }

  // Plasmas on galaxy map (larger dots)
  for (const plasma of state.plasmas) {
    const px = (plasma.x / GALAXY_WIDTH) * w;
    const py = (plasma.y / GALAXY_HEIGHT) * h;
    ctx.fillStyle = TEAM_COLORS[plasma.team] ?? "#888";
    ctx.fillRect(Math.round(px) - 1, Math.round(py) - 1, 3, 3);
  }

  // Viewport indicator (show tactical view area)
  if (mySlot >= 0) {
    const vpSize = VIEWPORT_SIZE;
    const vx = (viewCenterX - vpSize) * scaleX;
    const vy = (viewCenterY - vpSize) * scaleY;
    const vw = vpSize * 2 * scaleX;
    const vh = vpSize * 2 * scaleY;
    ctx.strokeStyle = "#ffffff44";
    ctx.lineWidth = 1;
    ctx.strokeRect(vx, vy, vw, vh);
  }

  ctx.textAlign = "start"; // reset
}

// ---------------------------------------------------------------------------
// HUD — matches original COW client dashboard layout
// ---------------------------------------------------------------------------

const SHIP_LETTERS = ["SC", "DD", "CA", "BB", "AS", "SB"];
const TEAM_LETTERS = ["Fed", "Rom", "Kli", "Ori"];

/** Pick bar color: green → yellow → red based on fill percentage */
function barColor(pct: number): string {
  if (pct < 0.5) return "#44ff44";
  if (pct < 0.8) return "#ffff44";
  return "#ff4444";
}

function drawHUD(ctx: CanvasRenderingContext2D, state: ClientGameState): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const self = state.self;
  const mySlot = getMySlot();
  const myShip = state.ships.find((s) => s.slotIndex === mySlot);
  if (!myShip) return;

  const stats = SHIP_STATS[myShip.shipType];

  // Alert status border (like original red/yellow/green border)
  const alertColors = ["#00ff00", "#ffff00", "#ff0000"];
  const alertColor = alertColors[myShip.alertStatus] ?? "#00ff00";
  ctx.strokeStyle = alertColor;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);

  // Scale HUD to fit canvas width (reference width = 650px)
  const hudScale = Math.min(1, w / 650);

  // Dashboard background — 3 rows
  const dashH = Math.round(52 * hudScale);
  const dashY = h - dashH;
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, dashY, w, dashH);
  ctx.strokeStyle = "#ffff00";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, dashY);
  ctx.lineTo(w, dashY);
  ctx.stroke();

  const fontSize = Math.max(8, Math.round(12 * hudScale));
  const font = `${fontSize}px monospace`;
  ctx.font = font;
  const lineH = Math.round(16 * hudScale);
  const charW = 7.2 * hudScale;
  const pad = Math.round(6 * hudScale);
  const barH = Math.round(10 * hudScale);
  const barW = Math.round(60 * hudScale);
  const flash = Math.floor(performance.now() / 250) % 2 === 0;

  // Compute raw values from percentages + ship stats
  const shieldRaw = Math.round(myShip.shieldPct * stats.maxShields);
  const hullRaw = Math.round((1 - myShip.hullDamagePct) * stats.maxHull);
  const fuelRaw = self.fuel;
  const wtRaw = Math.round((myShip.weaponTemp * stats.maxWpnTemp) / 10); // display /10 like original
  const wtMax = Math.round(stats.maxWpnTemp / 10);
  const etRaw = Math.round((self.engineTemp * stats.maxEgnTemp) / 10);
  const etMax = Math.round(stats.maxEgnTemp / 10);
  const myTorpCount = state.torps.filter((t) => t.ownerSlot === mySlot).length;
  const spd = Math.round(myShip.speed);

  // Speed label — "Impulse" when moving, blank at 0 (no warp in bronco Netrek)
  const spdLabel = spd > 0 ? "Impulse" : "";

  // Build flags string
  const flags: string[] = [];
  if (myShip.shieldsUp) flags.push("S");
  if (myShip.repairMode) flags.push("R");
  if (myShip.cloaked) flags.push("C");
  if (myShip.orbiting) flags.push("O");
  if (myShip.bombing) flags.push("B");
  if (myShip.beaming === 1) flags.push("u");
  if (myShip.beaming === 2) flags.push("d");
  if (myShip.tractoring) flags.push("T");
  if (myShip.pressoring) flags.push("P");

  // --- Column positions (grid layout like original) ---
  const col1 = pad; // Flags / flag letters / timestamp
  const col2 = pad + charW * 15; // Speed / Shields / Hull
  const col3after = col2 + charW * 12 + barW + charW; // after Speed/Sh/Hu bar
  const col4after = col3after + charW * 12 + barW + charW; // after Ar/Wt/Et bar

  // --- Row 1: Flags, Impulse/Warp, Sp[x/y]bar, Ar[x/y]bar, Fu[x/y]bar ---
  let y = dashY + 2;

  // Flags + speed mode label
  ctx.fillStyle = "#ffff00";
  ctx.fillText("Flags", col1, y + barH);
  if (spdLabel) {
    ctx.fillStyle = "#00ff00";
    ctx.fillText(spdLabel, col1 + charW * 6, y + barH);
  }

  // Speed with bar (absolute range 0-12, tick at ship max)
  const ABS_MAX_SPEED = 12;
  const spdStr = `Sp[${padNum(spd, 2)}/${padNum(stats.maxSpeed, 2)}]`;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(spdStr, col2, y + barH);
  let bx = col2 + charW * spdStr.length;
  drawInlineBar(
    ctx,
    bx,
    y + 1,
    barW,
    barH,
    spd / ABS_MAX_SPEED,
    "#44ff44",
    stats.maxSpeed / ABS_MAX_SPEED,
  );

  // Armies with bar (absolute range 0-25, tick at kill-based capacity)
  const ABS_MAX_ARMIES = 25;
  const armyCap = armyCapacity(myShip.shipType, self.kills);
  const arStr = `Ar[${padNum(self.armies, 2)}/${padNum(armyCap, 2)}]`;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(arStr, col3after, y + barH);
  bx = col3after + charW * arStr.length;
  const arPct = armyCap > 0 ? self.armies / ABS_MAX_ARMIES : 0;
  drawInlineBar(
    ctx,
    bx,
    y + 1,
    barW,
    barH,
    arPct,
    "#44ff44",
    armyCap / ABS_MAX_ARMIES,
  );

  // Fuel with bar
  const fuelLen = String(stats.maxFuel).length;
  const fuelStr = `Fu[${padNum(fuelRaw, fuelLen)}/${padNum(stats.maxFuel, fuelLen)}]`;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(fuelStr, col4after, y + barH);
  bx = col4after + charW * fuelStr.length;
  drawInlineBar(
    ctx,
    bx,
    y + 1,
    barW + Math.round(40 * hudScale),
    barH,
    myShip.fuelPct,
    barColor(1 - myShip.fuelPct),
  );

  // --- Row 2: Flag letters, Shields bar, Wt bar, Kills ---
  y += lineH;

  // Flag letters and ship indicators (like original: RL D T)
  const shipLetter = SHIP_LETTERS[myShip.shipType] ?? "??";
  const teamLetter = TEAM_LETTERS[myShip.team] ?? "??";
  ctx.fillStyle = TEAM_COLORS[myShip.team] ?? "#ffffff";
  ctx.fillText(shipLetter, col1, y + barH);

  // Show active flags spaced out (like original "RL  D  T")
  let fx = col1 + charW * 4;
  ctx.fillStyle = "#ffffff";
  for (const f of flags) {
    ctx.fillText(f, fx, y + barH);
    fx += charW * 2;
  }

  // Shields with bar
  const shLen = String(stats.maxShields).length;
  const shStr = `Sh[${padNum(shieldRaw, shLen)}/${padNum(stats.maxShields, shLen)}]`;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(shStr, col2, y + barH);
  bx = col2 + charW * shStr.length;
  drawInlineBar(
    ctx,
    bx,
    y + 1,
    barW,
    barH,
    myShip.shieldPct,
    barColor(1 - myShip.shieldPct),
  );

  // Weapon temp with bar
  const wtBurnout = self.weaponBurnout > 0;
  const wtLabel = wtBurnout
    ? "WBURN"
    : `Wt[${padNum(wtRaw, String(wtMax).length)}/${wtMax}]`;
  ctx.fillStyle = wtBurnout && flash ? "#ff0000" : "#ffffff";
  ctx.fillText(wtLabel, col3after, y + barH);
  bx = col3after + charW * (wtBurnout ? 5 : wtLabel.length);
  const wtBarPct = wtBurnout
    ? Math.min(1, self.weaponBurnout / 250)
    : Math.min(1, myShip.weaponTemp);
  const wtBarColor = wtBurnout ? "#ff4444" : barColor(myShip.weaponTemp);
  drawInlineBar(ctx, bx, y + 1, barW, barH, wtBarPct, wtBarColor);

  // Kills at end of row 2
  ctx.fillStyle = "#ffffff";
  ctx.fillText(`Kills: ${self.kills.toFixed(2)}`, col4after, y + barH);

  // --- Row 3: Timestamp, Hull bar, Engine Temp bar, Torps ---
  y += lineH;

  // Timestamp
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  ctx.fillStyle = "#888888";
  ctx.fillText(`${hh}:${mm}:${ss}`, col1, y + barH);

  // Hull with bar
  const huLen = String(stats.maxHull).length;
  const huStr = `Hu[${padNum(hullRaw, huLen)}/${padNum(stats.maxHull, huLen)}]`;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(huStr, col2, y + barH);
  bx = col2 + charW * huStr.length;
  drawInlineBar(
    ctx,
    bx,
    y + 1,
    barW,
    barH,
    1 - myShip.hullDamagePct,
    barColor(myShip.hullDamagePct),
  );

  // Engine temp with bar
  const etBurnout = self.engineBurnout > 0;
  const etLabel = etBurnout
    ? "EBURN"
    : `Et[${padNum(etRaw, String(etMax).length)}/${etMax}]`;
  ctx.fillStyle = etBurnout && flash ? "#ff0000" : "#ffffff";
  ctx.fillText(etLabel, col3after, y + barH);
  bx = col3after + charW * (etBurnout ? 5 : etLabel.length);
  const etBarPct = etBurnout
    ? Math.min(1, self.engineBurnout / 250)
    : Math.min(1, self.engineTemp);
  const etBarColor = etBurnout ? "#ff4444" : barColor(self.engineTemp);
  drawInlineBar(ctx, bx, y + 1, barW, barH, etBarPct, etBarColor);

  // Torps at end of row 3
  ctx.fillStyle = "#ffffff";
  ctx.fillText(`Torps: ${myTorpCount}`, col4after, y + barH);

  // --- Status indicators ---
  const statusItems: string[] = [];
  if (self.phaserCooldown > 0) statusItems.push("PHASER COOLING");
  if (myShip.bombing) statusItems.push("BOMBING");
  if (myShip.beaming === 1) statusItems.push("BEAMING UP");
  if (myShip.beaming === 2) statusItems.push("BEAMING DOWN");
  if (myShip.orbiting) {
    const orbitPlanet =
      self.orbitPlanetId >= 0
        ? state.planets.find((p) => p.planetId === self.orbitPlanetId)
        : null;
    statusItems.push(`ORBIT: ${orbitPlanet?.name ?? "?"}`);
  }

  if (statusItems.length > 0) {
    y += lineH;
    ctx.fillStyle = flash ? "#ff8800" : "#884400";
    ctx.fillText(statusItems.join("  "), col1, y + barH);
  }

  // T-Mode indicator (top of screen)
  if (self.tmode) {
    ctx.fillStyle = "#ff4444";
    ctx.font = "14px monospace";
    ctx.textAlign = "center";
    ctx.fillText("T-MODE", w / 2, 16);
    ctx.textAlign = "start";
  }

  // Surrender timers
  const timerY = self.tmode ? 34 : 16;
  if (self.surrenderTimer > 0) {
    const totalSec = Math.ceil(self.surrenderTimer / 10);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    const flash = Math.floor(Date.now() / 500) % 2 === 0;
    ctx.fillStyle = flash ? "#ff0000" : "#cc0000";
    ctx.font = "16px monospace";
    ctx.textAlign = "center";
    ctx.fillText(
      `SURRENDER IN ${min}:${String(sec).padStart(2, "0")}`,
      w / 2,
      timerY,
    );
    ctx.textAlign = "start";
  } else if (self.enemySurrenderTimer > 0) {
    const totalSec = Math.ceil(self.enemySurrenderTimer / 10);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    ctx.fillStyle = "#ffcc00";
    ctx.font = "16px monospace";
    ctx.textAlign = "center";
    ctx.fillText(
      `ENEMY SURRENDERS IN ${min}:${String(sec).padStart(2, "0")}`,
      w / 2,
      timerY,
    );
    ctx.textAlign = "start";
  }
}

/** Pad a number to a fixed width with spaces */
function padNum(n: number | string, width: number): string {
  const s = String(n);
  return s.length >= width ? s : " ".repeat(width - s.length) + s;
}

/** Draw an inline colored bar with optional max-capacity tick mark */
function drawInlineBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  pct: number,
  color: string,
  maxPct?: number,
): void {
  ctx.fillStyle = "#111111";
  ctx.fillRect(x, y, w, h);

  const fill = Math.round(w * Math.min(1, Math.max(0, pct)));
  if (fill > 0) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, fill, h);
  }

  if (maxPct !== undefined && maxPct < 1) {
    const tickX = Math.round(x + w * maxPct);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(tickX, y, 1, h);
  }
}

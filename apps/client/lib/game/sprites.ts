import { ShipType, Team } from "@netrek/shared";
import {
  SHIP_BITMAPS,
  CLOAK_BITMAP,
  SPRITE_WIDTH,
  SPRITE_HEIGHT,
  SPRITE_VIEWS,
  BYTES_PER_ROW,
} from "./sprite-data";

// ---------------------------------------------------------------------------
// Pre-rendered ship sprites from original COW client XBM bitmaps
// ---------------------------------------------------------------------------

// Team name prefixes matching bitmaps.h naming
const TEAM_PREFIX: Record<number, string> = {
  [Team.FEDERATION]: "fed",
  [Team.ROMULANS]: "rom",
  [Team.KLINGONS]: "kli",
  [Team.ORIONS]: "ori",
};

// Ship type names matching bitmaps.h naming
const SHIP_NAME: Record<number, string> = {
  [ShipType.SC]: "scout",
  [ShipType.DD]: "destroyer",
  [ShipType.CA]: "cruiser",
  [ShipType.BB]: "battleship",
  [ShipType.AS]: "assault",
  [ShipType.SB]: "starbase",
};

// Team colors for tinting (RGB values)
const TEAM_RGB: Record<number, [number, number, number]> = {
  [Team.FEDERATION]: [255, 255, 0], // yellow
  [Team.ROMULANS]: [255, 68, 68], // red
  [Team.KLINGONS]: [68, 255, 68], // green
  [Team.ORIONS]: [68, 255, 255], // cyan
};

// Cache: spriteCache[team][shipType][viewIndex] = OffscreenCanvas (20x20)
const spriteCache = new Map<string, OffscreenCanvas>();

let initialized = false;

/**
 * Decode one XBM view (60 bytes → 20x20 pixel ImageData) tinted with color.
 */
function decodeXBM(
  bytes: number[],
  r: number,
  g: number,
  b: number,
): ImageData {
  const img = new ImageData(SPRITE_WIDTH, SPRITE_HEIGHT);
  const data = img.data;

  for (let row = 0; row < SPRITE_HEIGHT; row++) {
    for (let col = 0; col < SPRITE_WIDTH; col++) {
      const byteIdx = row * BYTES_PER_ROW + Math.floor(col / 8);
      const bitIdx = col % 8;
      const set = (bytes[byteIdx]! >> bitIdx) & 1;

      const px = (row * SPRITE_WIDTH + col) * 4;
      if (set) {
        data[px] = r;
        data[px + 1] = g;
        data[px + 2] = b;
        data[px + 3] = 255;
      } else {
        data[px + 3] = 0; // transparent
      }
    }
  }

  return img;
}

/**
 * Initialize all ship sprites. Call once after DOM is ready.
 */
export function initSprites(): void {
  if (initialized) return;

  for (const team of [
    Team.FEDERATION,
    Team.ROMULANS,
    Team.KLINGONS,
    Team.ORIONS,
  ]) {
    const prefix = TEAM_PREFIX[team];
    const [r, g, b] = TEAM_RGB[team]!;

    for (const shipType of [
      ShipType.SC,
      ShipType.DD,
      ShipType.CA,
      ShipType.BB,
      ShipType.AS,
      ShipType.SB,
    ]) {
      const name = SHIP_NAME[shipType];
      const key = `${prefix}_${name}`;
      const bitmapData = SHIP_BITMAPS[key];
      if (!bitmapData) continue;

      // Only cache view 0 (up-facing); renderer rotates via canvas transform
      const bytes = bitmapData[0]!;
      const imgData = decodeXBM(bytes, r, g, b);

      const oc = new OffscreenCanvas(SPRITE_WIDTH, SPRITE_HEIGHT);
      const octx = oc.getContext("2d")!;
      octx.putImageData(imgData, 0, 0);

      const cacheKey = `${team}_${shipType}_0`;
      spriteCache.set(cacheKey, oc);
    }
  }

  initialized = true;
}

/**
 * Get a pre-rendered ship sprite canvas.
 * direction: 0-255 (mapped to one of 16 views)
 */
export function getShipSprite(
  team: Team,
  shipType: ShipType,
  direction: number,
): OffscreenCanvas | null {
  const view = Math.floor(((direction & 0xff) * SPRITE_VIEWS) / 256);
  const cacheKey = `${team}_${shipType}_${view}`;
  return spriteCache.get(cacheKey) ?? null;
}

// Cloak sprites: one per team color + one white (for friendly)
const cloakSpriteCache = new Map<string, OffscreenCanvas>();

/**
 * Get the cloak symbol sprite, tinted by team color.
 * Pass team=-1 for white (friendly cloaked).
 */
export function getCloakSprite(team: number): OffscreenCanvas | null {
  if (!initialized) return null;
  const key = `cloak_${team}`;
  const cached = cloakSpriteCache.get(key);
  if (cached) return cached;

  const [r, g, b] =
    team >= 0 ? (TEAM_RGB[team] ?? [255, 255, 255]) : [255, 255, 255];

  const imgData = decodeXBM(CLOAK_BITMAP as number[], r, g, b);
  const oc = new OffscreenCanvas(SPRITE_WIDTH, SPRITE_HEIGHT);
  const octx = oc.getContext("2d")!;
  octx.putImageData(imgData, 0, 0);
  cloakSpriteCache.set(key, oc);
  return oc;
}

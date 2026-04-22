/**
 * Parse bitmaps.h and generate a TypeScript module with XBM sprite data.
 * Output: apps/client/lib/game/sprite-data.ts
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  resolve(__dirname, "../docs/original-assets/bitmaps.h"),
  "utf8",
);

// Ship types we care about (skip galaxy)
const SHIP_TYPES = [
  "scout",
  "destroyer",
  "cruiser",
  "battleship",
  "assault",
  "starbase",
];

// Teams
const TEAMS = ["fed", "rom", "kli", "ori"];

// Parse all bitmap arrays from the C header
// Format: static char NAME_bits[VIEWS][60] = { {0x00, ...}, ... };
const results = {};

for (const team of TEAMS) {
  for (const ship of SHIP_TYPES) {
    const name = `${team}_${ship}_bits`;
    // Find the array in source
    const idx = src.indexOf(`${name}[`);
    if (idx === -1) {
      console.warn(`Not found: ${name}`);
      continue;
    }

    // Find the opening { after the = sign
    const eqIdx = src.indexOf("=", idx);
    const outerStart = src.indexOf("{", eqIdx);

    // Parse 16 views, each is a { ... } block
    const views = [];
    let pos = outerStart + 1; // skip outer {

    for (let v = 0; v < 16; v++) {
      // Find next inner {
      const innerStart = src.indexOf("{", pos);
      const innerEnd = src.indexOf("}", innerStart);
      const inner = src.substring(innerStart + 1, innerEnd);

      // Parse hex values
      const bytes = inner
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((s) => parseInt(s, 16));

      views.push(bytes);
      pos = innerEnd + 1;
    }

    results[`${team}_${ship}`] = views;
  }
}

// Generate TypeScript
let ts = `// Auto-generated from bitmaps.h — do not edit manually
// Run: node scripts/extract-bitmaps.mjs

// XBM bitmap data: 20x20 pixels, 3 bytes per row, 16 rotations per sprite
// Bit order: LSB first (XBM standard)

export const SPRITE_WIDTH = 20;
export const SPRITE_HEIGHT = 20;
export const SPRITE_VIEWS = 16;
export const BYTES_PER_ROW = 3;

// Keys: "fed_scout", "fed_cruiser", etc.
// Values: [16 views][60 bytes each]
export const SHIP_BITMAPS: Record<string, readonly number[][]> = {
`;

for (const [key, views] of Object.entries(results)) {
  ts += `  "${key}": [\n`;
  for (const view of views) {
    ts += `    [${view.join(",")}],\n`;
  }
  ts += `  ],\n`;
}

ts += `};\n`;

const outPath = resolve(
  __dirname,
  "../apps/client/lib/game/sprite-data.ts",
);
writeFileSync(outPath, ts);
console.log(
  `Generated ${outPath} with ${Object.keys(results).length} sprites`,
);

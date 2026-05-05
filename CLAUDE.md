# CLAUDE.md

Project: Netrek Web, a browser-based clone of Bronco (Vanilla) Netrek.

## Read First

Read SPEC.md before making changes to game logic. It contains the complete game mechanics specification sourced from the original Netrek documentation.

## Project Overview

Multiplayer 2D space combat game with team-based strategy. 8v8, two teams, 40 planets, capture-the-flag with armies. Browser client with Canvas 2D rendering, NestJS WebSocket server, PostgreSQL for persistent data.

## Architecture

Monorepo (pnpm workspaces + Turborepo) with apps and packages:

**packages/shared** (`@netrek/shared`): Game constants, TypeScript types, deterministic game logic (damage formulas, physics, collision math). Imported by both client and server. This is the single source of truth for all game rules. If a formula or constant exists in the spec, it belongs here and nowhere else.

**apps/backend** (`@netrek/backend`): NestJS application. Central authority. Owns PostgreSQL + Redis. Handles auth (Google OAuth, JWT sessions), user accounts, server registry, lobby/server browser API, stats storage, match history, and game token signing (ES256). REST-only — no WebSocket.

**apps/server** (`@netrek/server`): NestJS application (lightweight). Runs the authoritative game loop at 10Hz, bot manager, and WebSocket gateway. No database — game state is entirely in-memory during matches. Communicates with the backend via REST (heartbeat, stat push, match reporting). Validates player connections using short-lived game tokens signed by the backend (asymmetric ES256 — server has only the public key). Can run standalone without a backend for local development.

**apps/client** (`@netrek/client`): Next.js application. Lobby UI with SSR. Game view is a full-screen Canvas 2D component. Sends only player inputs over WebSocket. Renders at 60fps with interpolation between 10Hz server updates.

**packages/ui** (`@netrek/ui`): Shared React UI components (shadcn/ui based). Used by the client for lobby and non-game UI.

**packages/typescript-config** (`@netrek/typescript-config`): Shared TypeScript configs (base, nestjs, nextjs).

**packages/eslint-config** (`@netrek/eslint-config`): Shared ESLint configs.

## Tech Stack

- TypeScript throughout (strict mode)
- NestJS (server)
- Next.js (client)
- PostgreSQL (accounts, stats, match history)
- WebSocket via NestJS gateway (game networking)
- WebRTC via LiveKit (team voice chat, self-hosted)
- Canvas 2D API (game rendering)
- pnpm workspaces + Turborepo (monorepo)
- Prisma ORM (database)
- Redis (sessions, pub/sub for future scaling)

## Key Constraints

**Server authority.** The server owns all game state. Clients send only inputs (direction 0-255, speed setting, discrete commands like fire/bomb/cloak). The server resolves everything. The client never sends position data or hit detection results.

**Cloaking privacy.** The server filters outgoing state per player. Cloaked enemy positions are fuzzed or omitted before transmission. The client never receives precise cloaked enemy positions. This is how the cloaking mechanic works, not just anti-cheat.

**10Hz tick rate.** The server game loop runs at 10 ticks per second (100ms per tick). All game logic resolves per tick. Do not change this without understanding the cascading effects on movement, combat timing, and temperature math.

**No GC in the hot path.** The server game loop must not allocate objects in the hot path. Use object pools for torpedoes, phasers, and state snapshots. Reuse arrays where possible.

**Binary protocol for game state.** Use ArrayBuffer for the 10Hz game state broadcasts (the hot path). JSON is fine for lobby, chat, scoring, and other low-frequency messages. 16 ships at 10Hz is trivial bandwidth, but JSON parse overhead in the client's 60fps interpolation loop adds up.

**Retro rendering.** Render to a small offscreen canvas (~500x500 or configurable) and scale to display with CSS `image-rendering: pixelated`. Set `imageSmoothingEnabled = false` on the context. Use `ctx.translate(0.5, 0.5)` for pixel-snapped lines. No antialiasing, no gradients, no transparency effects. Dark background, clean vector lines, team-colored geometric shapes.

**Game token auth.** Players connect to game servers using short-lived JWTs (30s) signed by the backend with ES256. The game server verifies with the public key only — it cannot forge tokens. The game token contains userId, username, team, shipType, and player stats (for starbase eligibility).

**Backend owns all persistence.** The game server never touches the database. Stats are pushed to the backend every 60 seconds. Match results are reported at game end. The backend scopes stats by server — official servers aggregate to a shared "official" scope, community servers get their own scope.

## Code Conventions

- Always use nullish coalescing (??) instead of logical OR (||) for fallbacks
- Strict TypeScript: no `any`, no type assertions unless absolutely necessary and commented
- All game constants in one file in the shared package, not scattered
- All game formulas (damage, movement, temperature) in one file in the shared package
- Direction is 0-255 (256 discrete headings), matching the original protocol

## Server Game Loop (per tick)

1. Process all queued player inputs
2. Update ship positions and velocities (turning, acceleration)
3. Move torpedoes, check collisions
4. Resolve phaser hits
5. Update planet state (army pops, bombing, beaming)
6. Update temperatures, fuel, repair, shield regen
7. Check for deaths, process explosions
8. Serialize per-player game state (filtering cloaked ships)
9. Broadcast to all connected clients

## Client Render Loop (60fps)

1. Read latest two server snapshots
2. Interpolate entity positions between snapshots
3. Apply client-side prediction for own ship (input applied immediately, corrected on next server update)
4. Render to offscreen canvas at game resolution
5. Scale to display canvas
6. Draw HUD overlay

## Bot Architecture

Bots run server-side as virtual players that submit inputs through the same interface as human players. They receive the same filtered game state a real client would (no cheating on cloaked positions). AI is a state machine (PATROL, ATTACK, BOMB, ESCORT, DEFEND, OGG, RETREAT) with heuristic tactics and intentional imprecision (randomized delays, aim scatter).

## Database

PostgreSQL for persistent data only: player accounts, stats, rankings, match history. Game state during a match is entirely in-memory on the server. No database reads or writes in the game loop.

## Development Phases

**Phase 1 (Core Combat):** Shared package with constants, types, and physics. Server game loop with ship movement and weapons (phasers, torpedoes). Client with Canvas rendering and input handling. No planets, no armies. Just flying and shooting. Get the feel right.

**Phase 2 (Planet Economy):** Planets, armies, bombing, beaming, T-Mode, win conditions, cloaking, tractor/pressor beams, refitting, temperature system. This is where it becomes Netrek.

**Phase 3 (Multiplayer Infrastructure):** Server separation (backend + game server), game token auth with ES256, server registry (community + official servers), lobby/server browser, live stat tracking, match history, bots. Remaining: voice (LiveKit), matchmaking, rankings formula.

# Netrek Web

A browser-based clone of [Bronco (Vanilla) Netrek](https://www.netrek.org/), the classic multiplayer 2D space combat game. 8v8 team-based strategy with 40 planets, army economy, and capture-the-flag mechanics — all running in the browser.

## What is Netrek?

Netrek is one of the oldest internet team games, dating back to 1988. Four teams (Federation, Romulans, Klingons, Orions) fight for control of a galaxy of 40 planets. Players pilot warships to destroy enemies, bomb planet defenses, and ferry armies to capture territory. A team wins by capturing all enemy planets (genocide).

## Architecture

Monorepo with pnpm workspaces and Turborepo:

- **`packages/shared`** — Game constants, types, physics, and protocol. Shared by client and server.
- **`apps/server`** — NestJS authoritative game server. 10Hz game loop, WebSocket gateway, PostgreSQL for persistent data.
- **`apps/client`** — Next.js client. Canvas 2D rendering at 60fps with interpolation, retro pixel art style.
- **`packages/ui`** — Shared React UI components (shadcn/ui).

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- PostgreSQL 15+ (for accounts/stats)
- Redis (for sessions)

### Setup

```bash
# Install dependencies
pnpm install

# Copy environment config
cp .env.example .env
# Edit .env with your database and Redis connection strings

# Run database migrations
pnpm --filter @netrek/server prisma:migrate

# Start development servers
pnpm dev
```

The client runs at `http://localhost:3000` and the game server at `http://localhost:3001`.

### Build

```bash
pnpm build
```

## How to Play

1. Open the client in your browser
2. Pick a team and ship type
3. Fly with mouse (direction) and number keys (speed 0-9)
4. **Combat**: click to fire phasers, `t` to launch torpedoes, `d` to detonate nearby enemy torps
5. **Planet taking**: orbit enemy planet (`o`), shields down (`s`), bomb (`b`) until armies drop to 4, then beam down your own armies (`z`)
6. **Getting armies**: orbit a friendly planet with 5+ armies, shields down, press `z` to beam up (requires kills for capacity)

### Key Bindings

| Key   | Action                                        |
| ----- | --------------------------------------------- |
| Mouse | Steer toward cursor                           |
| Click | Fire phaser                                   |
| `t`   | Fire torpedo                                  |
| `d`   | Detonate enemy torpedoes                      |
| `s`   | Toggle shields                                |
| `o`   | Enter orbit                                   |
| `b`   | Toggle bombing                                |
| `z`   | Beam armies (up from friendly, down to enemy) |
| `c`   | Toggle cloak                                  |
| `r`   | Toggle repair mode                            |
| `0-9` | Set speed                                     |
| `R`   | Refit ship (must orbit homeworld)             |
| `l`   | Toggle player list                            |

## Development Status

### Phase 1 (Core Combat) - Complete

Ship movement, phasers, torpedoes, explosions, Canvas rendering, binary protocol, HUD.

### Phase 2 (Planet Economy) - In Progress

Planets, armies, bombing, beaming, planet capture, cloaking, tractor/pressor beams, refitting, temperature system, win conditions.

### Phase 3 (Multiplayer Infrastructure) - Planned

Bots/AI, voice chat (LiveKit), lobby system, matchmaking, accounts, scoring, ranks, persistent stats.

## Credits

Based on the original [Netrek](https://www.netrek.org/) by Kevin Smith (1988) and the many contributors to the Netrek community over the decades. Ship sprites and planet icons derived from the [COW client](https://github.com/quozl/netrek-client-cow). Planet layout from the [Netrek server](https://github.com/quozl/netrek-server-vanilla).

## License

[MIT](LICENSE)

# Netrek Web

A browser-based clone of [Bronco (Vanilla) Netrek](https://www.netrek.org/), the classic multiplayer 2D space combat game. 8v8 team-based strategy with 40 planets, army economy, and capture-the-flag mechanics — all running in the browser.

## What is Netrek?

Netrek is one of the oldest internet team games, dating back to 1988. Four teams (Federation, Romulans, Klingons, Orions) fight for control of a galaxy of 40 planets. Players pilot warships to destroy enemies, bomb planet defenses, and ferry armies to capture territory. A team wins by capturing all enemy planets (genocide).

## Architecture

Monorepo with pnpm workspaces and Turborepo:

- **`packages/shared`** — Game constants, types, physics, and protocol. Shared by client and server.
- **`apps/backend`** — NestJS backend. Auth (Google OAuth, JWT), user accounts, server registry, lobby API, stats, match history. REST-only, port 3012.
- **`apps/server`** — NestJS game server. 10Hz authoritative game loop, WebSocket gateway, bot manager. In-memory only — no database. Port 3013.
- **`apps/client`** — Next.js client. Canvas 2D rendering at 60fps with interpolation, retro pixel art style. Port 3011.
- **`packages/ui`** — Shared React UI components (shadcn/ui).

## Development

### Prerequisites

- Node.js 20+
- pnpm 9+
- PostgreSQL
- Redis

### Setup

```bash
pnpm install
cp apps/backend/.env.example apps/backend/.env
cp apps/server/.env.example apps/server/.env
cp apps/client/.env.example apps/client/.env

# Edit apps/backend/.env with your database URL, JWT secret, and Google OAuth credentials

cd apps/backend && pnpm db:migrate
```

### Running

```bash
# Terminal 1: Backend (auth, lobby, stats)
cd apps/backend && pnpm dev

# Terminal 2: Game server
cd apps/server && pnpm dev

# Terminal 3: Client
cd apps/client && pnpm dev
```

The backend runs on port 3012, the game server on port 3013, and the client on port 3011.

### Standalone Mode

The game server can run without a backend for local development. Just omit `SERVER_ID` and `SERVER_TOKEN` from the `.env`. Players won't be able to join through the lobby — connect directly via the client.

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

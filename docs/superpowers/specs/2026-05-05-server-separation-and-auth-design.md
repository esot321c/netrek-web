# Server Separation, Auth & Lobby Design

## Goal

Split the current monolithic `apps/server` into two independent apps: a central **backend** (`apps/backend`) that owns auth, accounts, stats, and the server registry, and a stateless **game server** (`apps/server`) that runs matches in-memory. Players browse games through a lobby UI, authenticate through the backend, and connect to game servers via short-lived tokens. Stats are tracked centrally for all servers, scoped per-server for community games and aggregated for official ones.

## Architecture Overview

```
┌──────────┐  REST   ┌──────────────┐  REST    ┌──────────────┐
│  Client   │───────▶│   Backend    │◀────────│ Game Server  │
│ (Next.js) │        │  (NestJS)    │ Heartbeat│  (NestJS)    │
│           │        │              │ Stats    │              │
│ /lobby    │        │ Auth/OAuth   │          │ Game loop    │
│ /game/:id │        │ Server reg.  │          │ Bots         │
│           │   WS   │ Stats/Lobby  │          │ WebSocket GW │
│           │──────────────────────────────────▶│              │
└──────────┘        └──────────────┘          └──────────────┘
                          │
                    ┌─────┴─────┐
                    │ PostgreSQL│
                    │ + Redis   │
                    └───────────┘
```

- **Backend** (`apps/backend`): NestJS. Owns PostgreSQL + Redis. Handles auth (Google OAuth, JWT sessions), user accounts, server registry, lobby/server browser API, stats storage, and match history. This is the central authority.
- **Game Server** (`apps/server`): NestJS (lighter). Runs the game loop, bot manager, and WebSocket gateway. No database — game state is entirely in-memory. Communicates with the backend via REST: registers on startup, heartbeats periodically, pushes stat updates, reports match results. Validates player connections using short-lived JWTs (asymmetric verification — backend signs with private key, game server verifies with public key).
- **Client** (`apps/client`): Next.js. Talks to the backend for auth, lobby browsing, and server info. Connects directly to a game server's WebSocket for gameplay.
- **Shared** (`packages/shared`): Game constants, types, physics, protocol. Imported by all three.

## App Split: What Goes Where

### `apps/backend` (new — extracted from current `apps/server`)

- `auth/` — Google OAuth, JWT, sessions, CSRF (existing code, moves as-is)
- `prisma/` — schema, migrations (existing, extended with new models)
- `config/` — app configuration (existing)
- `common/` — filters, utilities (existing)
- `servers/` — new: server registration, heartbeat endpoint, server browser API
- `stats/` — new: player stats, match history, live stat ingestion
- `lobby/` — reworked: fetches live data from registered game servers for the detail view

### `apps/server` (slimmed down — keeps game code only)

- `game/` — game loop, game state, game service (existing)
- `game/bot/` — bot AI, bot manager, bot navigation, bot combat (existing)
- `game/state/` — game state container (existing)
- `gateway/` — WebSocket gateway (existing `game.gateway.ts`, modified for game token auth)
- `registration/` — new: startup registration with backend, periodic heartbeat, stat push
- `config/` — new: lightweight config (backend URL, server token, port, game settings)

## Server Registration & Discovery

### Registration Flow

1. Authenticated user calls backend: `POST /v1/servers` with `{ name, region, maxPlayers, host }`. The `host` field is the public WebSocket URL (e.g. `wss://my-server.example.com:3013`) and is locked at registration time — it cannot be changed via heartbeat.
2. Backend creates a `GameServer` record, generates a **server token** (random 256-bit key, stored hashed). Per-user limit: 5 server registrations per account.
3. Backend returns the server ID + plaintext server token (shown once).
4. User configures the game server binary with: backend URL, server ID, server token.
5. On startup, game server calls `POST /v1/servers/:id/heartbeat` with current player count, game phase, and team composition.
6. Heartbeat repeats every 30 seconds. If backend receives no heartbeat for 90 seconds, server is marked offline.
7. To change the host URL, the owner calls `PATCH /v1/servers/:id` with `{ host }` (authenticated, owner-only).

### Heartbeat Payload

```typescript
{
  playerCount: number; // Current human players
  botCount: number; // Current bots
  maxPlayers: number; // Server capacity
  gamePhase: string; // "waiting" | "playing" | "postgame"
  teams: {
    // Per-team summary
    team: number;
    humanCount: number;
    botCount: number;
  }
  [];
}
```

### Admin Flow

An admin calls `PATCH /v1/servers/:id` with `{ isOfficial: true }`. Same registration process, just a flag. Official servers push stats that count toward central rankings.

### Server Token Security

- Token is hashed (bcrypt or SHA-256) in the database, never stored in plaintext after initial display.
- Server authenticates every request to the backend using the token in an `Authorization` header.
- Owner can regenerate the token via `POST /v1/servers/:id/rotate-token`. Old token immediately invalid.

## Player Connection Flow

### Joining a Game

1. Player browses `/lobby` — sees list of active games (name, player count, official/community, region, game phase).
2. Player clicks a game → `/lobby/:id` — sees team rosters, ship types, MOTD, server settings.
3. Player selects team and ship type, clicks "Join Game."
4. Client calls backend: `POST /v1/servers/:id/join` with `{ team, shipType }`.
5. Backend validates: player is authenticated, server is online, server isn't full.
6. Backend generates a **game token**: short-lived JWT (30-second expiry) containing:

```typescript
{
  sub: string; // userId
  username: string;
  serverId: string;
  team: number;
  shipType: number;
  stats: {
    // Player's stats for this server scope
    totalKills: number;
    totalDeaths: number;
    totalWins: number;
    totalLosses: number;
    planetsTaken: number;
    armiesBombed: number;
    armiesBeamed: number;
    secondsPlayed: number;
    rank: number;
  }
  exp: number; // now + 30 seconds
}
```

7. Backend returns `{ gameToken, wsUrl }` (the server's WebSocket address).
8. Client connects to the game server's WebSocket with the game token in the handshake (`auth` field or query param).
9. Game server validates the JWT locally using the public key (asymmetric verification), checks expiry, extracts player info, slots them into the game.

### Token Validation on Game Server

The backend signs game tokens with an asymmetric key pair (RS256 or ES256). The backend holds the private key; game servers only receive the public key. This means game servers can verify tokens but cannot forge them — community server hosts cannot mint fake player identities. No network round-trip needed for validation.

### Disconnect / Reconnect

If a player disconnects, the game server holds their slot for 30 seconds. To reconnect, the client requests a fresh game token from the backend and reconnects to the same game server. The game server matches the userId to the held slot and restores the player.

## Stats System

### Scoping

All stats are stored on the backend, scoped by server:

- **Official servers** share a single scope (e.g. `serverId = "official"`). A player's official stats aggregate across all official servers. This is their canonical profile and rank.
- **Community servers** each have their own scope (`serverId = <actual server ID>`). Stats on one community server are independent of another.

This means: one `PlayerStats` table with a composite key of `(userId, serverId)`. Official servers all write to the `"official"` scope.

### Live Stat Updates

Game servers push stat deltas to the backend every 60 seconds during active play:

```
POST /v1/stats/ingest
Authorization: Bearer <server-token>

{
  serverId: string;
  players: [
    {
      userId: string;
      kills: number;       // delta since last push
      deaths: number;
      planetsTaken: number;
      armiesBombed: number;
      armiesBeamed: number;
      secondsPlayed: number;
    }
  ]
}
```

Backend validates:

- Server token is valid.
- If server is official, stats go to the `"official"` scope.
- If community, stats go to that server's scope.
- Deltas are added to existing cumulative stats.

### Match Reporting

When a match ends, the game server sends a final match summary:

```
POST /v1/matches
Authorization: Bearer <server-token>

{
  serverId: string;
  winningTeam: number;
  duration: number;        // seconds
  genocide: boolean;
  players: [
    {
      userId: string;
      team: number;
      shipType: number;
      kills: number;       // total for this match
      deaths: number;
      planetsTaken: number;
      armiesBombed: number;
      armiesBeamed: number;
    }
  ]
}
```

Backend records the match and updates win/loss counts. Only accepted from official servers for ranking purposes. Community server matches are still recorded for that server's local history.

### Starbase Eligibility

The game token includes the player's stats for the relevant scope. The game server checks starbase eligibility locally using those stats — no mid-game calls to the backend.

### Rankings

Rank is derived from cumulative official stats: wins, K/D, planets taken. The formula can be refined later without schema changes since raw stats are stored. Simple tier system for now (Ensign → Admiral or similar, matching original Netrek ranks).

## Database Schema Changes

### New Models

```prisma
model GameServer {
  id              String   @id @default(uuid())
  name            String
  ownerId         String
  owner           User     @relation(fields: [ownerId], references: [id])
  region          String   @default("us-east")
  host            String   // WebSocket URL, set at registration, owner-editable only
  maxPlayers      Int      @default(16)
  isOfficial      Boolean  @default(false)
  serverTokenHash String
  status          String   @default("offline") // "online" | "offline"
  playerCount     Int      @default(0)
  botCount        Int      @default(0)
  gamePhase       String   @default("waiting")
  lastHeartbeatAt DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  matches Match[]
}

model PlayerStats {
  id             String @id @default(uuid())
  userId         String
  user           User   @relation(fields: [userId], references: [id])
  serverId       String // "official" for official servers, actual server ID for community
  totalKills     Int    @default(0)
  totalDeaths    Int    @default(0)
  totalWins      Int    @default(0)
  totalLosses    Int    @default(0)
  planetsTaken   Int    @default(0)
  armiesBombed   Int    @default(0)
  armiesBeamed   Int    @default(0)
  secondsPlayed  Int    @default(0)
  rank           Int    @default(0)
  updatedAt      DateTime @updatedAt

  @@unique([userId, serverId])
}

model Match {
  id           String   @id @default(uuid())
  serverId     String
  server       GameServer @relation(fields: [serverId], references: [id])
  winningTeam  Int
  duration     Int      // seconds
  genocide     Boolean  @default(false)
  playedAt     DateTime @default(now())

  players MatchPlayer[]
}

model MatchPlayer {
  id           String @id @default(uuid())
  matchId      String
  match        Match  @relation(fields: [matchId], references: [id])
  userId       String
  user         User   @relation(fields: [userId], references: [id])
  team         Int
  shipType     Int
  kills        Int    @default(0)
  deaths       Int    @default(0)
  planetsTaken Int    @default(0)
  armiesBombed Int    @default(0)
  armiesBeamed Int    @default(0)
}
```

### User Model Extension

Add relations to existing User model:

```prisma
model User {
  // ... existing fields ...
  servers      GameServer[]
  playerStats  PlayerStats[]
  matchPlayers MatchPlayer[]
}
```

## Client UX

### Routes

| Route               | Purpose                                                                      |
| ------------------- | ---------------------------------------------------------------------------- |
| `/`                 | Landing page — what is Netrek, how to play, game info, links to docs/wiki    |
| `/auth/signin`      | Google OAuth login (existing)                                                |
| `/lobby`            | Server browser — list of active games, auto-refreshes                        |
| `/lobby/:id`        | Game detail — team rosters, settings, team/ship picker, "Join Game" button   |
| `/game/:id`         | Full-screen game canvas, WebSocket connection to game server                 |
| `/settings/servers` | Server host management — register servers, view tokens, manage registrations |

### Landing Page (`/`)

Informational page for new visitors:

- What is Netrek — short description, screenshots
- How to play — controls, game mechanics overview, link to full documentation
- Quick link to lobby if authenticated
- Login prompt if not

### Lobby (`/lobby`)

The main hub after login:

- Table/list of active games: name, player count (e.g. "12/16"), official/community badge, region, game phase
- Auto-refreshes every 5 seconds (polling backend `GET /v1/servers?status=online`)
- Click a game to go to detail view
- "Host a Server" link to `/settings/servers` for users who want to run their own

### Game Detail (`/lobby/:id`)

Per-game view before joining:

- Team rosters showing players and bots per team (Fed/Rom), ship types
- MOTD / server description
- Server settings (max players, allowed ships, etc.)
- Team selector + ship type selector
- "Join Game" button — calls backend, gets game token, redirects to `/game/:id`

### Game View (`/game/:id`)

- Full-screen canvas (existing `game-canvas.tsx`)
- Connects to game server WebSocket using game token from join flow
- On disconnect/game end, returns to `/lobby`

### Server Management (`/settings/servers`)

Simple utilitarian page behind auth:

- List of servers owned by the user
- Register new server form (name, region, max players)
- Show server token (once on creation, option to regenerate)
- Delete server registration

## Error Handling & Edge Cases

- **Server goes offline mid-game:** Backend marks it offline after 90 seconds of missed heartbeats. Players get disconnected. Live stat pushes (every 60s) mean most progress is preserved — at most 60 seconds of stats lost.
- **Player connects with expired game token:** Game server rejects WebSocket handshake. Client can request a fresh token from the backend and retry automatically.
- **Player tries to join a full server:** Backend checks current player count from latest heartbeat before issuing game token. Returns error if full.
- **Duplicate connection:** Game server rejects if a userId is already connected (same as current behavior).
- **Server token compromised:** Owner regenerates via `POST /v1/servers/:id/rotate-token`. Old token immediately invalid. Server must be reconfigured with new token.
- **Community server sends stat updates:** Backend accepts them but scopes to that server's ID. They never pollute official rankings.
- **Backend is temporarily unreachable:** Game server continues running — it doesn't need the backend for active gameplay. Heartbeats and stat pushes are retried. Players already connected keep playing. New players can't join (can't get game tokens) until backend is back.

## Configuration

### Backend (`apps/backend`)

```env
# Existing
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
JWT_SECRET=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_CALLBACK_URL=...
CORS_ORIGIN=http://localhost:3011
API_PORT=3012

# New
GAME_TOKEN_PRIVATE_KEY=<path-or-PEM-private-key-for-signing-game-tokens>
GAME_TOKEN_TTL=30s
SERVER_HEARTBEAT_TIMEOUT=90
```

### Game Server (`apps/server`)

```env
# Game server config
BACKEND_URL=http://localhost:3012/v1
SERVER_ID=<uuid-from-registration>
SERVER_TOKEN=<token-from-registration>
GAME_TOKEN_PUBLIC_KEY=<path-or-PEM-public-key-for-verifying-game-tokens>
WS_PORT=3013
PUBLIC_WS_URL=ws://localhost:3013

# Game settings
BOTS_PER_TEAM=4
MAX_PLAYERS_PER_TEAM=8
BOT_DIFFICULTY_MIX=1:2:1
```

### Client (`apps/client`)

```env
NEXT_PUBLIC_API_URL=http://localhost:3012/v1
# No game server URL — received dynamically from backend on join
```

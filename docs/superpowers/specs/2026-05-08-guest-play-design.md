# Guest Play — Design Spec

## Summary

Add a "Play as Guest" option so players can join games without Google login. Guests are fully ephemeral — no database record, no persistent stats, no match history. They get an auto-generated username like "Guest-4821" and disappear when they disconnect.

## Motivation

Lower the barrier to entry. New players should be able to try the game immediately without creating an account. If they like it, they can sign in with Google later for persistent stats and rank progression.

## Design

### Backend

**New endpoint:** `POST /servers/:id/join-guest`

- No auth guard (public endpoint)
- Request body: `{ team: number, shipType: number }`
- Generates a random guest identity:
  - `userId`: UUID prefixed with `guest:` (e.g., `guest:a1b2c3d4-...`)
  - `username`: `Guest-XXXX` where XXXX is a random 4-digit number (1000-9999)
- Signs a game token (ES256) with the same `GameTokenPayload` shape, plus `isGuest: true`
- Stats in the token are all zeros, rank 0
- Returns `{ gameToken, wsUrl }` — same response shape as the regular join endpoint
- Rate limiting: basic IP-based rate limit to prevent abuse (e.g., 10 guest joins per minute per IP)

**Validation:** Same server checks as regular join — server must be online and not full.

**No changes to:** Auth controller, auth service, JWT sessions, user model, database schema.

### Game Token Payload

Add optional `isGuest` field to `GameTokenPayload` in shared types:

```typescript
interface GameTokenPayload {
  sub: string;        // userId (guest: prefixed for guests)
  username: string;   // "Guest-4821"
  serverId: string;
  team: number;
  shipType: number;
  isGuest?: boolean;  // true for guests, undefined for real users
  stats: { ... };     // all zeros for guests
}
```

### Game Server

**Stat push filtering:** When the server pushes periodic stats to the backend, skip any player where `isGuest` is true. Other players' stats against guests are tracked normally — killing a guest counts as a real kill for the non-guest.

**No other changes:** The game loop, WebSocket auth, player management, bot system, and broadcast service all work unchanged. A guest token validates the same way as a regular token.

### Client

**Sign-in page:** Add a "Play as Guest" button below the Google sign-in button. Clicking it sets a `guest` flag in the auth context and navigates to the lobby (server browser).

**Auth context changes:**

- New state: `isGuest: boolean` (default false)
- When `isGuest` is true, skip the `/auth/me` call — there's no session to validate
- Expose a `loginAsGuest()` function that sets the flag and navigates to lobby
- The `user` object can be null when in guest mode — UI conditionally shows "Guest" where a username would appear

**Lobby page:** Allow access when `isGuest` is true (currently redirects to signin if no user). The server list API is already public (no auth guard).

**Join flow:** When `isGuest` is true, call `POST /servers/:id/join-guest` instead of `POST /servers/:id/join`. The response is the same shape, so the rest of the flow (store token in sessionStorage, navigate to `/game/:id`) is unchanged.

**Game page:** No changes. The game token works identically.

### What Guests Don't Get

- Persistent stats or rank progression
- Match history
- Username choice
- Starbase eligibility (requires rank/stats thresholds)
- Any account management features

### What Stays The Same

- Game token format and validation (one optional field added)
- WebSocket connection flow
- Game loop and physics
- Scoreboard display during matches (guests appear with their Guest-XXXX name)
- Bot behavior (bots treat guests the same as any player)
- Other players' stat tracking (kills against guests still count)

## Out of Scope

- Guest name selection (always auto-generated)
- Guest-to-account conversion/upgrade flow (future feature)
- Guest restrictions on specific servers
- Guest visual indicators on scoreboard (they just look like any player)

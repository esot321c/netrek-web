# Guest Play & Username Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Play as Guest" (no login required) and username management (choose on first login, change in /settings).

**Architecture:** Backend gets two new endpoints (guest join + username update), a Prisma migration for `usernameSet`, and the `GameTokenPayload` gains an `isGuest` field. Game server filters guests from stat pushes. Client gets guest auth context support, a Play as Guest button, a first-login username setup page, and a /settings page.

**Tech Stack:** NestJS, Prisma, Next.js, class-validator, Socket.IO

---

### Task 1: Prisma migration — add `usernameSet` to User

**Files:**

- Modify: `apps/backend/prisma/schema.prisma`

- [ ] **Step 1: Add `usernameSet` field to User model in schema.prisma**

In `apps/backend/prisma/schema.prisma`, add `usernameSet` after `avatarUrl` in the User model:

```prisma
model User {
  id        String   @id @default(uuid())
  email     String   @unique
  username  String   @unique
  name      String?
  avatarUrl String?
  usernameSet Boolean @default(false)

  lastActiveAt DateTime?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  // Relations
  accounts    Account[]
  sessions    Session[]
  servers     GameServer[]
  playerStats PlayerStats[]
  matchPlayers MatchPlayer[]

  roles Role[] @default([USER])

  @@map("users")
}
```

- [ ] **Step 2: Generate the migration**

Run:

```bash
cd apps/backend && npx prisma migrate dev --name add_username_set
```

Expected: Migration created successfully.

- [ ] **Step 3: Backfill existing users**

Create a manual SQL step in the migration file. Open the newly created migration SQL file and add at the end:

```sql
UPDATE "users" SET "usernameSet" = true WHERE "usernameSet" = false;
```

This ensures existing users don't get prompted to set a username.

- [ ] **Step 4: Re-run the migration to apply the backfill**

Run:

```bash
cd apps/backend && npx prisma migrate reset --force
```

Then verify:

```bash
cd apps/backend && npx prisma migrate status
```

Expected: All migrations applied.

- [ ] **Step 5: Regenerate the Prisma client**

Run:

```bash
cd apps/backend && npx prisma generate
```

Expected: Prisma Client generated successfully.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/prisma/schema.prisma apps/backend/prisma/migrations/
git commit -m "feat: add usernameSet field to User model"
```

---

### Task 2: Backend — username update endpoint

**Files:**

- Create: `apps/backend/src/auth/dto/update-username.dto.ts`
- Modify: `apps/backend/src/auth/services/auth.service.ts`
- Modify: `apps/backend/src/auth/controllers/auth.controller.ts`

- [ ] **Step 1: Create the UpdateUsernameDto**

Create `apps/backend/src/auth/dto/update-username.dto.ts`:

```typescript
import { IsString, MinLength, MaxLength, Matches } from "class-validator";

export class UpdateUsernameDto {
  @IsString()
  @MinLength(2)
  @MaxLength(20)
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message:
      "Username can only contain letters, numbers, hyphens, and underscores",
  })
  username!: string;
}
```

- [ ] **Step 2: Add `updateUsername` method to AuthService**

In `apps/backend/src/auth/services/auth.service.ts`, add this import at the top:

```typescript
import { ConflictException } from "@nestjs/common";
```

(Add `ConflictException` to the existing `@nestjs/common` import.)

Then add this method after `getUserProfile`:

```typescript
  async updateUsername(userId: string, username: string) {
    if (username.toLowerCase().startsWith("guest-")) {
      throw new ConflictException("Username cannot start with 'Guest-'");
    }

    const existing = await this.prisma.user.findFirst({
      where: {
        username: { equals: username, mode: "insensitive" },
        id: { not: userId },
      },
    });

    if (existing) {
      throw new ConflictException("Username already taken");
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { username, usernameSet: true },
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        avatarUrl: true,
        roles: true,
        usernameSet: true,
      },
    });

    return user;
  }
```

- [ ] **Step 3: Add `usernameSet` to `getUserProfile` response**

In `apps/backend/src/auth/services/auth.service.ts`, update the `getUserProfile` method to include `usernameSet`:

```typescript
  async getUserProfile(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        avatarUrl: true,
        roles: true,
        usernameSet: true,
      },
    });

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      name: user.name,
      avatarUrl: user.avatarUrl,
      roles: user.roles,
      usernameSet: user.usernameSet,
    };
  }
```

- [ ] **Step 4: Add PATCH /auth/username endpoint to AuthController**

In `apps/backend/src/auth/controllers/auth.controller.ts`, add this import:

```typescript
import { UpdateUsernameDto } from "../dto/update-username.dto";
```

Add `Body` and `Patch` to the `@nestjs/common` import (add `Body, Patch` — `Body` is not yet imported, `Patch` is not yet imported).

Then add this endpoint after the `me` endpoint:

```typescript
  @Patch("username")
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth("auth_token")
  @ApiOperation({ summary: "Update username" })
  async updateUsername(
    @User() user: AuthUser,
    @Body() dto: UpdateUsernameDto,
  ) {
    return this.authService.updateUsername(user.id, dto.username);
  }
```

- [ ] **Step 5: Build and verify**

Run:

```bash
cd apps/backend && npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/auth/dto/update-username.dto.ts apps/backend/src/auth/services/auth.service.ts apps/backend/src/auth/controllers/auth.controller.ts
git commit -m "feat: add PATCH /auth/username endpoint with validation"
```

---

### Task 3: Backend — guest join endpoint

**Files:**

- Modify: `apps/backend/src/servers/game-token.service.ts`
- Modify: `apps/backend/src/servers/servers.controller.ts`

- [ ] **Step 1: Add `isGuest` to `GameTokenPayload` in game-token.service.ts**

In `apps/backend/src/servers/game-token.service.ts`, add `isGuest` to the interface:

```typescript
export interface GameTokenPayload {
  sub: string;
  username: string;
  serverId: string;
  team: number;
  shipType: number;
  isGuest?: boolean;
  stats: {
    totalKills: number;
    totalDeaths: number;
    totalWins: number;
    totalLosses: number;
    planetsTaken: number;
    armiesBombed: number;
    armiesBeamed: number;
    secondsPlayed: number;
    rank: number;
  };
}
```

- [ ] **Step 2: Add `POST /servers/:id/join-guest` endpoint**

In `apps/backend/src/servers/servers.controller.ts`, add `randomUUID` import at the top:

```typescript
import { randomUUID } from "crypto";
```

Then add this endpoint after the existing `join` method:

```typescript
  @Post(":id/join-guest")
  async joinGuest(
    @Param("id") id: string,
    @Body() dto: JoinServerDto,
  ) {
    const server = await this.serversService.findById(id);
    if (server.status !== "online") {
      throw new BadRequestException("Server is offline");
    }
    if (server.playerCount >= server.maxPlayers) {
      throw new BadRequestException("Server is full");
    }

    const guestNumber = Math.floor(Math.random() * 9000) + 1000;
    const gameToken = await this.gameTokenService.signGameToken({
      sub: `guest:${randomUUID()}`,
      username: `Guest-${guestNumber}`,
      serverId: id,
      team: dto.team,
      shipType: dto.shipType,
      isGuest: true,
      stats: {
        totalKills: 0,
        totalDeaths: 0,
        totalWins: 0,
        totalLosses: 0,
        planetsTaken: 0,
        armiesBombed: 0,
        armiesBeamed: 0,
        secondsPlayed: 0,
        rank: 0,
      },
    });

    return { gameToken, wsUrl: server.host };
  }
```

- [ ] **Step 3: Build and verify**

Run:

```bash
cd apps/backend && npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/servers/game-token.service.ts apps/backend/src/servers/servers.controller.ts
git commit -m "feat: add guest join endpoint and isGuest to GameTokenPayload"
```

---

### Task 4: Game server — add `isGuest` to token type and filter stat pushes

**Files:**

- Modify: `apps/server/src/game/guards/ws-auth.guard.ts`
- Modify: `apps/server/src/game/game.gateway.ts`
- Modify: `apps/server/src/registration/stat-reporter.service.ts`

- [ ] **Step 1: Add `isGuest` to `GameTokenPayload` in ws-auth.guard.ts**

In `apps/server/src/game/guards/ws-auth.guard.ts`, add `isGuest` to the interface after `shipType`:

```typescript
export interface GameTokenPayload {
  sub: string;
  username: string;
  serverId: string;
  team: number;
  shipType: number;
  isGuest?: boolean;
  stats: {
    totalKills: number;
    totalDeaths: number;
    totalWins: number;
    totalLosses: number;
    planetsTaken: number;
    armiesBombed: number;
    armiesBeamed: number;
    secondsPlayed: number;
    rank: number;
  };
}
```

- [ ] **Step 2: Store `isGuest` flag on socket data in game.gateway.ts**

In `apps/server/src/game/game.gateway.ts`, in the `handleConnection` method, after `client.data["payload"] = payload;` (line 88), add:

```typescript
client.data["isGuest"] = payload.isGuest === true;
```

- [ ] **Step 3: Add guest tracking to StatReporterService**

In `apps/server/src/registration/stat-reporter.service.ts`, add a `Set` to track guest user IDs. Add this field after the `lastReportTick` declaration (line 24):

```typescript
  private guestUserIds = new Set<string>();
```

Add a public method to register guest players:

```typescript
  markGuest(userId: string) {
    this.guestUserIds.add(userId);
  }

  unmarkGuest(userId: string) {
    this.guestUserIds.delete(userId);
  }
```

- [ ] **Step 4: Filter guests from stat pushes**

In `apps/server/src/registration/stat-reporter.service.ts`, in the `pushStats` method, change the `players` array construction (line 85-91) to filter out guests:

```typescript
const players = Array.from(this.deltas.entries())
  .filter(([userId]) => !this.guestUserIds.has(userId))
  .map(([userId, delta]) => ({
    userId,
    ...delta,
    secondsPlayed: secondsElapsed,
  }));
```

Also clean up guest entries from deltas to avoid memory leaks. After `this.deltas.clear();` (line 93), the guest entries are already cleared since we clear all deltas.

- [ ] **Step 5: Wire up guest marking in game.gateway.ts**

In `apps/server/src/game/game.gateway.ts`, add `StatReporterService` to imports:

```typescript
import { StatReporterService } from "../registration/stat-reporter.service";
```

Add it to the constructor:

```typescript
  constructor(
    private readonly wsAuth: WsAuthService,
    private readonly gameService: GameService,
    private readonly broadcastService: GameBroadcastService,
    private readonly botManager: BotManagerService,
    private readonly config: ServerConfig,
    private readonly statReporter: StatReporterService,
  ) {}
```

In `handleConnection`, after `client.data["isGuest"] = payload.isGuest === true;`, add:

```typescript
if (payload.isGuest) {
  this.statReporter.markGuest(payload.sub);
}
```

In `handleDisconnect`, inside the `if (player)` block, after `this.gameService.leaveGame(player.slot);`, add:

```typescript
if (client.data["isGuest"]) {
  this.statReporter.unmarkGuest(player.userId);
}
```

- [ ] **Step 6: Build and verify**

Run:

```bash
cd apps/server && npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/game/guards/ws-auth.guard.ts apps/server/src/game/game.gateway.ts apps/server/src/registration/stat-reporter.service.ts
git commit -m "feat: filter guest players from stat pushes"
```

---

### Task 5: Client — auth context with guest support and username

**Files:**

- Modify: `apps/client/lib/auth-context.tsx`
- Modify: `apps/client/lib/api/client.ts`
- Modify: `apps/client/lib/api/index.ts`

- [ ] **Step 1: Add `joinGuestServer` and `updateUsername` to API client**

In `apps/client/lib/api/client.ts`, add these functions after the existing `fetchServer` function:

```typescript
export async function joinGuestServer(
  serverId: string,
  team: number,
  shipType: number,
): Promise<{ gameToken: string; wsUrl: string }> {
  return apiFetch(`/servers/${serverId}/join-guest`, {
    method: "POST",
    body: JSON.stringify({ team, shipType }),
  });
}

export async function updateUsername(
  username: string,
): Promise<{ id: string; username: string; usernameSet: boolean }> {
  return apiFetch(`/auth/username`, {
    method: "PATCH",
    body: JSON.stringify({ username }),
  });
}
```

- [ ] **Step 2: Update the api/index.ts exports**

In `apps/client/lib/api/index.ts`, update to:

```typescript
export { apiFetch, apiFetch as api } from "./client";
export { joinGuestServer, updateUsername } from "./client";
```

- [ ] **Step 3: Update AuthUser interface and auth context**

Replace the entire contents of `apps/client/lib/auth-context.tsx`:

```typescript
"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { api } from "./api";

interface AuthUser {
  id: string;
  email: string;
  username: string;
  name: string;
  avatarUrl: string | null;
  roles: string[];
  usernameSet: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  isGuest: boolean;
  loading: boolean;
  logout: () => Promise<void>;
  loginAsGuest: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const data = await api<AuthUser>("/auth/me");
      setUser(data);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    api<AuthUser>("/auth/me")
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const logout = useCallback(async () => {
    if (isGuest) {
      setIsGuest(false);
      return;
    }
    try {
      await api("/auth/logout", { method: "POST" });
    } finally {
      setUser(null);
    }
  }, [isGuest]);

  const loginAsGuest = useCallback(() => {
    setIsGuest(true);
    setLoading(false);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, isGuest, loading, logout, loginAsGuest, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
```

- [ ] **Step 4: Build and verify**

Run:

```bash
cd apps/client && npx tsc --noEmit
```

Expected: Type errors in components that use `useAuth()` — they now need to handle `isGuest`. We'll fix those in the next tasks. For now, just note the errors and move on.

- [ ] **Step 5: Commit**

```bash
git add apps/client/lib/auth-context.tsx apps/client/lib/api/client.ts apps/client/lib/api/index.ts
git commit -m "feat: add guest auth context, joinGuestServer, and updateUsername API"
```

---

### Task 6: Client — sign-in page with Play as Guest

**Files:**

- Modify: `apps/client/app/auth/signin/page.tsx`

- [ ] **Step 1: Add Play as Guest button**

Replace the entire contents of `apps/client/app/auth/signin/page.tsx`:

```typescript
"use client";

import { useRouter } from "next/navigation";
import { Button } from "@netrek/ui/button";
import { Server } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3012/v1";

export default function SignInPage() {
  const router = useRouter();
  const { loginAsGuest } = useAuth();

  const handleGuestPlay = () => {
    loginAsGuest();
    router.push("/lobby");
  };

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center space-y-2 text-center">
          <Server className="h-8 w-8" />
          <h1>Welcome to Netrek</h1>
          <p className="text-sm text-muted-foreground">Sign in to play</p>
        </div>

        <div className="space-y-3">
          <a href={`${API_URL}/auth/google`}>
            <Button variant="outline" className="w-full gap-2">
              <GoogleIcon />
              Sign in with Google
            </Button>
          </a>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                or
              </span>
            </div>
          </div>

          <Button
            variant="ghost"
            className="w-full text-muted-foreground"
            onClick={handleGuestPlay}
          >
            Play as Guest
          </Button>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Guests don&apos;t get stats, rankings, or match history.
        </p>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/client/app/auth/signin/page.tsx
git commit -m "feat: add Play as Guest button to sign-in page"
```

---

### Task 7: Client — lobby pages allow guest access

**Files:**

- Modify: `apps/client/app/lobby/page.tsx`
- Modify: `apps/client/app/lobby/[id]/page.tsx`

- [ ] **Step 1: Update lobby page to allow guests**

In `apps/client/app/lobby/page.tsx`, update the auth check and server fetch:

Change the `useAuth` destructuring (line 20):

```typescript
const { user, isGuest, loading } = useAuth();
```

Change the redirect check (lines 25-29):

```typescript
useEffect(() => {
  if (!loading && !user && !isGuest) {
    router.replace("/auth/signin");
  }
}, [user, isGuest, loading, router]);
```

Change the fetch guard (lines 31-33) from `if (!user) return;` to:

```typescript
if (!user && !isGuest) return;
```

Change the dependency array of the fetch useEffect (line 47) from `[user]` to:

```typescript
  }, [user, isGuest]);
```

Change the early return (line 57) from `if (!user) return null;` to:

```typescript
if (!user && !isGuest) return null;
```

In the "Host a Server" link, conditionally hide it for guests. Wrap lines 71-76:

```typescript
          {user && (
            <Link
              href="/settings/servers"
              className="rounded border border-yellow-600 px-4 py-2 text-sm text-yellow-500 hover:bg-yellow-600 hover:text-gray-900 transition-colors"
            >
              Host a Server
            </Link>
          )}
```

Same for the "Host one?" link in the empty state (lines 88-93). Change to:

```typescript
            No servers online right now.{" "}
            {user && (
              <Link
                href="/settings/servers"
                className="text-yellow-500 underline"
              >
                Host one?
              </Link>
            )}
```

- [ ] **Step 2: Update server detail page to allow guests**

In `apps/client/app/lobby/[id]/page.tsx`:

Add `joinGuestServer` to imports (line 6):

```typescript
import { apiFetch, joinServer, joinGuestServer } from "@/lib/api/client";
```

Change the `useAuth` destructuring (line 52):

```typescript
const { user, isGuest, loading } = useAuth();
```

Change the redirect check (lines 62-66):

```typescript
useEffect(() => {
  if (!loading && !user && !isGuest) {
    router.replace("/auth/signin");
  }
}, [user, isGuest, loading, router]);
```

Change the fetch guard (line 69) from `if (!user) return;` to:

```typescript
if (!user && !isGuest) return;
```

Change the fetch useEffect dependency array (line 92) from `[user, id]` to:

```typescript
  }, [user, isGuest, id]);
```

Update `handleJoin` to use the guest endpoint when appropriate (lines 94-108):

```typescript
const handleJoin = async () => {
  setJoining(true);
  setJoinError(null);
  try {
    const result = isGuest
      ? await joinGuestServer(id, selectedTeam, selectedShip)
      : await joinServer(id, selectedTeam, selectedShip);
    sessionStorage.setItem(
      `game:${id}`,
      JSON.stringify({ gameToken: result.gameToken, wsUrl: result.wsUrl }),
    );
    router.push(`/game/${id}`);
  } catch (e) {
    setJoinError((e as Error).message);
    setJoining(false);
  }
};
```

Change the early return (line 118) from `if (!user) return null;` to:

```typescript
if (!user && !isGuest) return null;
```

Conditionally render the StatsBadge (lines 132-136) — only for authenticated users:

```typescript
        {user && (
          <div className="mt-4">
            <StatsBadge username={user.name} />
          </div>
        )}
```

- [ ] **Step 3: Build and verify**

Run:

```bash
cd apps/client && npx tsc --noEmit
```

Expected: No type errors (or only errors from components we haven't updated yet like app-bar/user-menu).

- [ ] **Step 4: Commit**

```bash
git add apps/client/app/lobby/page.tsx apps/client/app/lobby/[id]/page.tsx
git commit -m "feat: allow guest access to lobby and server detail pages"
```

---

### Task 8: Client — first-login username setup page

**Files:**

- Create: `apps/client/app/auth/setup/page.tsx`

- [ ] **Step 1: Create the username setup page**

Create `apps/client/app/auth/setup/page.tsx`:

```typescript
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { updateUsername } from "@/lib/api/client";
import { Button } from "@netrek/ui/button";
import { Server } from "lucide-react";

const USERNAME_REGEX = /^[a-zA-Z0-9_-]+$/;

export default function UsernameSetupPage() {
  const { user, loading, refreshUser } = useAuth();
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!loading && !user) {
    router.replace("/auth/signin");
    return null;
  }

  if (user && !initialized) {
    setUsername(user.username);
    setInitialized(true);
  }

  if (user?.usernameSet) {
    router.replace("/lobby");
    return null;
  }

  const validationError =
    username.length > 0 && username.length < 2
      ? "Must be at least 2 characters"
      : username.length > 20
        ? "Must be 20 characters or fewer"
        : username.length > 0 && !USERNAME_REGEX.test(username)
          ? "Only letters, numbers, hyphens, and underscores"
          : username.toLowerCase().startsWith("guest-")
            ? "Cannot start with 'Guest-'"
            : null;

  const canSubmit =
    username.length >= 2 &&
    username.length <= 20 &&
    USERNAME_REGEX.test(username) &&
    !username.toLowerCase().startsWith("guest-") &&
    !saving;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSaving(true);
    setError(null);
    try {
      await updateUsername(username);
      await refreshUser();
      router.push("/lobby");
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes("409") || message.toLowerCase().includes("taken")) {
        setError("Username already taken");
      } else {
        setError("Failed to update username");
      }
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center space-y-2 text-center">
          <Server className="h-8 w-8" />
          <h1>Choose Your Username</h1>
          <p className="text-sm text-muted-foreground">
            This is how other players will see you.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="text"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setError(null);
              }}
              maxLength={20}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Username"
              autoFocus
            />
            {validationError && (
              <p className="mt-1 text-xs text-destructive">
                {validationError}
              </p>
            )}
            {error && (
              <p className="mt-1 text-xs text-destructive">{error}</p>
            )}
          </div>

          <Button type="submit" className="w-full" disabled={!canSubmit}>
            {saving ? "Saving..." : "Confirm"}
          </Button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          You can change this later in Settings.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/client/app/auth/setup/page.tsx
git commit -m "feat: add first-login username setup page"
```

---

### Task 9: Client — settings page with username change

**Files:**

- Create: `apps/client/app/settings/page.tsx`

- [ ] **Step 1: Create the settings page**

Create `apps/client/app/settings/page.tsx`:

```typescript
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { updateUsername } from "@/lib/api/client";
import { Button } from "@netrek/ui/button";

const USERNAME_REGEX = /^[a-zA-Z0-9_-]+$/;

export default function SettingsPage() {
  const { user, loading, refreshUser } = useAuth();
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/auth/signin");
    }
  }, [user, loading, router]);

  if (user && !initialized) {
    setUsername(user.username);
    setInitialized(true);
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-900">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (!user) return null;

  const validationError =
    username.length > 0 && username.length < 2
      ? "Must be at least 2 characters"
      : username.length > 20
        ? "Must be 20 characters or fewer"
        : username.length > 0 && !USERNAME_REGEX.test(username)
          ? "Only letters, numbers, hyphens, and underscores"
          : username.toLowerCase().startsWith("guest-")
            ? "Cannot start with 'Guest-'"
            : null;

  const hasChanged = username !== user.username;

  const canSubmit =
    hasChanged &&
    username.length >= 2 &&
    username.length <= 20 &&
    USERNAME_REGEX.test(username) &&
    !username.toLowerCase().startsWith("guest-") &&
    !saving;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await updateUsername(username);
      await refreshUser();
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes("409") || message.toLowerCase().includes("taken")) {
        setError("Username already taken");
      } else {
        setError("Failed to update username");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-300">
      <div className="mx-auto max-w-xl px-4 py-10">
        <h1 className="text-3xl font-bold text-yellow-500 mb-8">Settings</h1>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="rounded border border-gray-700 bg-gray-800 p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-4">
              Username
            </h2>
            <input
              type="text"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setError(null);
                setSuccess(false);
              }}
              maxLength={20}
              className="w-full rounded border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-gray-200 focus:border-yellow-500 focus:outline-none"
            />
            {validationError && (
              <p className="mt-1 text-xs text-red-400">{validationError}</p>
            )}
            {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
            {success && (
              <p className="mt-1 text-xs text-green-400">Username updated</p>
            )}
          </div>

          <Button
            type="submit"
            disabled={!canSubmit}
            className="bg-yellow-500 text-gray-900 hover:bg-yellow-400 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/client/app/settings/page.tsx
git commit -m "feat: add settings page with username change"
```

---

### Task 10: Client — redirect new users to setup, update app bar for guests

**Files:**

- Modify: `apps/client/components/app-bar.tsx`
- Modify: `apps/client/components/user-menu.tsx`
- Modify: `apps/client/app/lobby/page.tsx`

- [ ] **Step 1: Update AppBar to show nav for guests**

In `apps/client/components/app-bar.tsx`, update the `useAuth` destructuring (line 14):

```typescript
const { user, isGuest } = useAuth();
```

Change `{user && (` on line 28 (the desktop nav) to:

```typescript
        {(user || isGuest) && (
```

Change `{user && (` on line 50 (the mobile hamburger button) to:

```typescript
        {(user || isGuest) && (
```

Change `{mobileOpen && user && (` on line 66 (mobile menu) to:

```typescript
      {mobileOpen && (user || isGuest) && (
```

- [ ] **Step 2: Update UserMenu for guests**

In `apps/client/components/user-menu.tsx`, update the `useAuth` destructuring (line 17):

```typescript
const { user, isGuest, loading, logout } = useAuth();
```

Change the `if (!user)` block (lines 23-30) to handle guests:

```typescript
  if (!user) {
    if (isGuest) {
      return (
        <Button variant="outline" size="sm" onClick={logout}>
          Guest (Sign in)
        </Button>
      );
    }
    return (
      <Link href="/auth/signin">
        <Button variant="outline" size="sm">
          Sign in
        </Button>
      </Link>
    );
  }
```

- [ ] **Step 3: Add first-login redirect to lobby page**

In `apps/client/app/lobby/page.tsx`, add a redirect for users who haven't set their username. After the existing redirect check (lines 25-29), add:

```typescript
useEffect(() => {
  if (user && !user.usernameSet) {
    router.replace("/auth/setup");
  }
}, [user, router]);
```

- [ ] **Step 4: Build the full client**

Run:

```bash
cd apps/client && npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/client/components/app-bar.tsx apps/client/components/user-menu.tsx apps/client/app/lobby/page.tsx
git commit -m "feat: update app bar and user menu for guest support, add first-login redirect"
```

---

### Task 11: Full build verification

**Files:** None (verification only)

- [ ] **Step 1: Run full build check**

Run from the repo root:

```bash
pnpm build
```

Expected: All packages build successfully.

- [ ] **Step 2: Fix any build errors**

If there are type errors or build failures, fix them. Common issues:

- Components that destructure `useAuth()` without handling the new `isGuest` field
- Missing imports for new functions

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve build errors from guest play changes"
```

Only commit if there were actual fixes needed.

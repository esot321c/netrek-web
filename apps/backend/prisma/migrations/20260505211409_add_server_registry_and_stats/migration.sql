-- CreateTable
CREATE TABLE "game_servers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT 'us-east',
    "host" TEXT NOT NULL,
    "maxPlayers" INTEGER NOT NULL DEFAULT 16,
    "isOfficial" BOOLEAN NOT NULL DEFAULT false,
    "serverTokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'offline',
    "playerCount" INTEGER NOT NULL DEFAULT 0,
    "botCount" INTEGER NOT NULL DEFAULT 0,
    "gamePhase" TEXT NOT NULL DEFAULT 'waiting',
    "lastHeartbeatAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_servers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_stats" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "totalKills" INTEGER NOT NULL DEFAULT 0,
    "totalDeaths" INTEGER NOT NULL DEFAULT 0,
    "totalWins" INTEGER NOT NULL DEFAULT 0,
    "totalLosses" INTEGER NOT NULL DEFAULT 0,
    "planetsTaken" INTEGER NOT NULL DEFAULT 0,
    "armiesBombed" INTEGER NOT NULL DEFAULT 0,
    "armiesBeamed" INTEGER NOT NULL DEFAULT 0,
    "secondsPlayed" INTEGER NOT NULL DEFAULT 0,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "player_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "winningTeam" INTEGER NOT NULL,
    "duration" INTEGER NOT NULL,
    "genocide" BOOLEAN NOT NULL DEFAULT false,
    "playedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_players" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "team" INTEGER NOT NULL,
    "shipType" INTEGER NOT NULL,
    "kills" INTEGER NOT NULL DEFAULT 0,
    "deaths" INTEGER NOT NULL DEFAULT 0,
    "planetsTaken" INTEGER NOT NULL DEFAULT 0,
    "armiesBombed" INTEGER NOT NULL DEFAULT 0,
    "armiesBeamed" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "match_players_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "player_stats_userId_serverId_key" ON "player_stats"("userId", "serverId");

-- AddForeignKey
ALTER TABLE "game_servers" ADD CONSTRAINT "game_servers_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_stats" ADD CONSTRAINT "player_stats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "game_servers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

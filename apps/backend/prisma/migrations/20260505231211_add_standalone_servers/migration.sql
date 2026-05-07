-- DropForeignKey
ALTER TABLE "game_servers" DROP CONSTRAINT "game_servers_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "match_players" DROP CONSTRAINT "match_players_matchId_fkey";

-- DropForeignKey
ALTER TABLE "match_players" DROP CONSTRAINT "match_players_userId_fkey";

-- DropForeignKey
ALTER TABLE "matches" DROP CONSTRAINT "matches_serverId_fkey";

-- DropForeignKey
ALTER TABLE "player_stats" DROP CONSTRAINT "player_stats_userId_fkey";

-- AddForeignKey
ALTER TABLE "game_servers" ADD CONSTRAINT "game_servers_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_stats" ADD CONSTRAINT "player_stats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "game_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

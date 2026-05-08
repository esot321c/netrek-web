-- AlterTable
ALTER TABLE "users" ADD COLUMN     "usernameSet" BOOLEAN NOT NULL DEFAULT false;

UPDATE "users" SET "usernameSet" = true WHERE "usernameSet" = false;

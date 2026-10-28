ALTER TABLE "app_user" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
-- Backfill from existing sessions (expired ones are deleted from now on).
UPDATE "app_user" u SET "last_login_at" = s.at FROM (SELECT "user_id", max("created_at") AS at FROM "session" GROUP BY "user_id") s WHERE s."user_id" = u."id" AND u."last_login_at" IS NULL;

ALTER TYPE "public"."patrol_status" ADD VALUE 'camp';--> statement-breakpoint
ALTER TABLE "station" ADD COLUMN "role" text;--> statement-breakpoint
-- Backfill from names (the rule paper codes used so far): "… start" → start, "… mål" → finish.
UPDATE "station" SET "role" = CASE
	WHEN lower(btrim("name")) LIKE '%start' THEN 'start'
	WHEN lower(btrim("name")) LIKE '%mål' THEN 'finish'
END
WHERE "role" IS NULL AND (lower(btrim("name")) LIKE '%start' OR lower(btrim("name")) LIKE '%mål');

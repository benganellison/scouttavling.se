ALTER TABLE "competition" ADD COLUMN "fee_per_patrol" integer;--> statement-breakpoint
ALTER TABLE "patrol" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "score" ADD COLUMN "scored_at" timestamp with time zone;--> statement-breakpoint
-- Backfill (re-runnable). The phone's own time was never stored, so existing device scores get the
-- server time of their first revision; paper/HQ scores stay null (no reliable time).
UPDATE "score" s SET "scored_at" = r."at"
FROM "score_revision" r
WHERE r."score_id" = s."id" AND r."version" = 1 AND r."origin" = 'device' AND s."scored_at" IS NULL;--> statement-breakpoint
UPDATE "patrol" SET "paid_at" = "created_at" WHERE "paid" AND "paid_at" IS NULL;

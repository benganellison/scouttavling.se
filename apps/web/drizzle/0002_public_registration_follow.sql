ALTER TABLE "competition" ADD COLUMN "registration_opens_on" date;--> statement-breakpoint
ALTER TABLE "competition" ADD COLUMN "registration_closes_on" date;--> statement-breakpoint
ALTER TABLE "competition" ADD COLUMN "max_patrols" integer;--> statement-breakpoint
ALTER TABLE "competition" ADD COLUMN "info_text" text;--> statement-breakpoint
ALTER TABLE "competition" ADD COLUMN "confirmation_text" text;--> statement-breakpoint
ALTER TABLE "competition" ADD COLUMN "follow_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "competition" ADD COLUMN "follow_show_scores" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "patrol" ADD COLUMN "follow_token_enc" text;--> statement-breakpoint
ALTER TABLE "patrol" ADD COLUMN "manage_token_hash" text;--> statement-breakpoint
ALTER TABLE "patrol" ADD CONSTRAINT "patrol_follow_token_hash" UNIQUE("follow_token_hash");--> statement-breakpoint
ALTER TABLE "patrol" ADD CONSTRAINT "patrol_manage_token_hash" UNIQUE("manage_token_hash");
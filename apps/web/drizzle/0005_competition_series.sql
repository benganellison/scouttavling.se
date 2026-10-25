CREATE TABLE "retired_link" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"competition_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"owner_group_no" text,
	"owner_group_name" text,
	"accent_color" text,
	"cover_fit" text,
	"class_colors" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "series_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "asset" ALTER COLUMN "competition_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "series_id" uuid;--> statement-breakpoint
ALTER TABLE "competition" ADD COLUMN "series_id" uuid;--> statement-breakpoint
ALTER TABLE "competition" ADD COLUMN "edition_year" integer;--> statement-breakpoint
ALTER TABLE "competition" ADD COLUMN "archive_public" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "competition" ADD COLUMN "anonymised_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "retired_link" ADD CONSTRAINT "retired_link_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition" ADD CONSTRAINT "competition_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_series_kind" UNIQUE("series_id","kind");--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_one_owner" CHECK (("asset"."competition_id" is null) <> ("asset"."series_id" is null));
CREATE TABLE "asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"sha256" text NOT NULL,
	"data" "bytea" NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_comp_kind" UNIQUE("competition_id","kind")
);
--> statement-breakpoint
ALTER TABLE "competition" ADD COLUMN "accent_color" text;--> statement-breakpoint
ALTER TABLE "competition" ADD COLUMN "cover_fit" text;--> statement-breakpoint
ALTER TABLE "track" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_uploaded_by_app_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;
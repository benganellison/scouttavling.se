CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"actor_kind" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"competition_id" uuid,
	"series_id" uuid,
	"reason" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "series_member" (
	"series_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "competition_role" NOT NULL,
	CONSTRAINT "series_member_series_id_user_id_pk" PRIMARY KEY("series_id","user_id"),
	CONSTRAINT "series_member_role" CHECK ("series_member"."role" in ('owner', 'organiser'))
);
--> statement-breakpoint
CREATE TABLE "site_admin" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by" text NOT NULL,
	"reason" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_admin_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"competition_id" uuid NOT NULL,
	"role" "competition_role" DEFAULT 'organiser' NOT NULL,
	"reason" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "competition" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "series_member" ADD CONSTRAINT "series_member_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_member" ADD CONSTRAINT "series_member_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_admin" ADD CONSTRAINT "site_admin_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_admin_access" ADD CONSTRAINT "site_admin_access_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_admin_access" ADD CONSTRAINT "site_admin_access_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_log_comp_idx" ON "audit_log" USING btree ("competition_id","at");--> statement-breakpoint
CREATE INDEX "audit_log_series_idx" ON "audit_log" USING btree ("series_id","at");--> statement-breakpoint
CREATE INDEX "site_admin_access_comp_idx" ON "site_admin_access" USING btree ("competition_id","expires_at");
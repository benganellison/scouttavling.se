CREATE TYPE "public"."competition_role" AS ENUM('owner', 'organiser', 'hq', 'startfinish');--> statement-breakpoint
CREATE TYPE "public"."device_role" AS ENUM('station_volunteer', 'startfinish');--> statement-breakpoint
CREATE TYPE "public"."patrol_status" AS ENUM('registered', 'active', 'finished', 'resigned', 'camp');--> statement-breakpoint
CREATE TYPE "public"."score_origin" AS ENUM('device', 'admin', 'paper');--> statement-breakpoint
CREATE TYPE "public"."score_state" AS ENUM('active', 'void');--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_no" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"groups" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_member_no_unique" UNIQUE("member_no")
);
--> statement-breakpoint
CREATE TABLE "asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid,
	"series_id" uuid,
	"kind" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"sha256" text NOT NULL,
	"data" "bytea" NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_comp_kind" UNIQUE("competition_id","kind"),
	CONSTRAINT "asset_series_kind" UNIQUE("series_id","kind"),
	CONSTRAINT "asset_one_owner" CHECK (("asset"."competition_id" is null) <> ("asset"."series_id" is null))
);
--> statement-breakpoint
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
CREATE TABLE "change_log" (
	"seq" bigint DEFAULT 0 NOT NULL,
	"competition_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"entity_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "change_log_competition_id_seq_pk" PRIMARY KEY("competition_id","seq")
);
--> statement-breakpoint
CREATE TABLE "change_seq" (
	"competition_id" uuid PRIMARY KEY NOT NULL,
	"last" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "command" (
	"id" uuid PRIMARY KEY NOT NULL,
	"competition_id" uuid NOT NULL,
	"device_id" uuid,
	"device_seq" integer,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"client_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"result" text NOT NULL,
	"result_detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "competition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"owner_group_no" text,
	"owner_group_name" text,
	"multi_day" boolean DEFAULT false NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"location" text,
	"hq_phone" text,
	"style_enabled" boolean DEFAULT true NOT NULL,
	"public_results" boolean DEFAULT false NOT NULL,
	"station_results_live" boolean DEFAULT false NOT NULL,
	"fee_per_patrol" integer,
	"registration_open" boolean DEFAULT false NOT NULL,
	"registration_opens_on" date,
	"registration_closes_on" date,
	"max_patrols" integer,
	"info_text" text,
	"confirmation_text" text,
	"follow_enabled" boolean DEFAULT false NOT NULL,
	"follow_show_scores" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"backup_mode" boolean DEFAULT false NOT NULL,
	"accent_color" text,
	"cover_fit" text,
	"patrol_code_key" text NOT NULL,
	"series_id" uuid,
	"edition_year" integer,
	"archive_public" boolean DEFAULT true NOT NULL,
	"anonymised_at" timestamp with time zone,
	"suspended_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competition_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "competition_member" (
	"competition_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "competition_role" NOT NULL,
	CONSTRAINT "competition_member_competition_id_user_id_role_pk" PRIMARY KEY("competition_id","user_id","role")
);
--> statement-breakpoint
CREATE TABLE "day" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"sort" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"invite_id" uuid NOT NULL,
	"role" "device_role" NOT NULL,
	"station_ids" uuid[] DEFAULT '{}' NOT NULL,
	"display_name" text NOT NULL,
	"public_jwk" jsonb NOT NULL,
	"last_seq" integer DEFAULT 0 NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"station_id" uuid,
	"role" "device_role" NOT NULL,
	"secret_hash" text NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"secret_enc" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invite_secret_hash_unique" UNIQUE("secret_hash")
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patrol_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text DEFAULT '' NOT NULL,
	"troop_text" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"important" boolean DEFAULT false NOT NULL,
	"audience" jsonb DEFAULT '["all"]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_read" (
	"message_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_read_message_id_device_id_pk" PRIMARY KEY("message_id","device_id")
);
--> statement-breakpoint
CREATE TABLE "patrol" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"name" text NOT NULL,
	"track_id" uuid,
	"troop" text DEFAULT '' NOT NULL,
	"status" "patrol_status" DEFAULT 'registered' NOT NULL,
	"start_station_id" uuid,
	"start_locked" boolean DEFAULT false NOT NULL,
	"paid" boolean DEFAULT false NOT NULL,
	"paid_at" timestamp with time zone,
	"contact_name" text,
	"contact_phone" text,
	"contact_email" text,
	"contact_member_no" text,
	"follow_token_hash" text,
	"follow_token_enc" text,
	"manage_token_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patrol_comp_number" UNIQUE("competition_id","number"),
	CONSTRAINT "patrol_follow_token_hash" UNIQUE("follow_token_hash"),
	CONSTRAINT "patrol_manage_token_hash" UNIQUE("manage_token_hash")
);
--> statement-breakpoint
CREATE TABLE "retired_link" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"competition_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "score" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"patrol_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"points" integer NOT NULL,
	"style_points" integer DEFAULT 0 NOT NULL,
	"raw" jsonb NOT NULL,
	"state" "score_state" DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"origin" "score_origin" NOT NULL,
	"device_id" uuid,
	"user_id" uuid,
	"note" text,
	"scored_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "score_patrol_item" UNIQUE("patrol_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "score_conflict" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"patrol_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"existing" jsonb NOT NULL,
	"incoming" jsonb NOT NULL,
	"command_id" uuid,
	"kind" text DEFAULT 'conflict' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "score_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"sort" integer NOT NULL,
	"name" text NOT NULL,
	"mode" text NOT NULL,
	"min" integer DEFAULT 0 NOT NULL,
	"max" integer DEFAULT 20 NOT NULL,
	"distinct_values" jsonb,
	"count_multiplier" integer,
	"style_enabled" boolean DEFAULT true NOT NULL,
	"style_min" integer DEFAULT 0 NOT NULL,
	"style_max" integer DEFAULT 5 NOT NULL,
	"counts_for_tiebreak" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "score_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"score_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"points" integer NOT NULL,
	"style_points" integer NOT NULL,
	"state" "score_state" NOT NULL,
	"origin" "score_origin" NOT NULL,
	"device_id" uuid,
	"user_id" uuid,
	"command_id" uuid,
	"reason" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "series_member" (
	"series_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "competition_role" NOT NULL,
	CONSTRAINT "series_member_series_id_user_id_pk" PRIMARY KEY("series_id","user_id"),
	CONSTRAINT "series_member_role" CHECK ("series_member"."role" in ('owner', 'organiser'))
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"csrf" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "station" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"day_id" uuid,
	"sort" integer NOT NULL,
	"name" text NOT NULL,
	"custom_code" text,
	"all_tracks" boolean DEFAULT true NOT NULL,
	"role" text,
	"startable" boolean DEFAULT true NOT NULL,
	"contact_name" text,
	"contact_phone" text
);
--> statement-breakpoint
CREATE TABLE "station_track" (
	"station_id" uuid NOT NULL,
	"track_id" uuid NOT NULL,
	CONSTRAINT "station_track_station_id_track_id_pk" PRIMARY KEY("station_id","track_id")
);
--> statement-breakpoint
CREATE TABLE "status_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patrol_id" uuid NOT NULL,
	"status" "patrol_status" NOT NULL,
	"device_id" uuid,
	"user_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "track" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort" integer NOT NULL,
	"color" text
);
--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_uploaded_by_app_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_log" ADD CONSTRAINT "change_log_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_seq" ADD CONSTRAINT "change_seq_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command" ADD CONSTRAINT "command_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command" ADD CONSTRAINT "command_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition" ADD CONSTRAINT "competition_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition" ADD CONSTRAINT "competition_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_member" ADD CONSTRAINT "competition_member_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_member" ADD CONSTRAINT "competition_member_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day" ADD CONSTRAINT "day_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device" ADD CONSTRAINT "device_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device" ADD CONSTRAINT "device_invite_id_invite_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."invite"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_station_id_station_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."station"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_patrol_id_patrol_id_fk" FOREIGN KEY ("patrol_id") REFERENCES "public"."patrol"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_read" ADD CONSTRAINT "message_read_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_read" ADD CONSTRAINT "message_read_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patrol" ADD CONSTRAINT "patrol_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patrol" ADD CONSTRAINT "patrol_track_id_track_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."track"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patrol" ADD CONSTRAINT "patrol_start_station_id_station_id_fk" FOREIGN KEY ("start_station_id") REFERENCES "public"."station"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retired_link" ADD CONSTRAINT "retired_link_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score" ADD CONSTRAINT "score_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score" ADD CONSTRAINT "score_patrol_id_patrol_id_fk" FOREIGN KEY ("patrol_id") REFERENCES "public"."patrol"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score" ADD CONSTRAINT "score_item_id_score_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."score_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score" ADD CONSTRAINT "score_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score" ADD CONSTRAINT "score_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_conflict" ADD CONSTRAINT "score_conflict_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_conflict" ADD CONSTRAINT "score_conflict_patrol_id_patrol_id_fk" FOREIGN KEY ("patrol_id") REFERENCES "public"."patrol"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_conflict" ADD CONSTRAINT "score_conflict_item_id_score_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."score_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_item" ADD CONSTRAINT "score_item_station_id_station_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."station"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_revision" ADD CONSTRAINT "score_revision_score_id_score_id_fk" FOREIGN KEY ("score_id") REFERENCES "public"."score"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_member" ADD CONSTRAINT "series_member_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_member" ADD CONSTRAINT "series_member_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_admin" ADD CONSTRAINT "site_admin_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_admin_access" ADD CONSTRAINT "site_admin_access_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_admin_access" ADD CONSTRAINT "site_admin_access_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station" ADD CONSTRAINT "station_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station" ADD CONSTRAINT "station_day_id_day_id_fk" FOREIGN KEY ("day_id") REFERENCES "public"."day"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_track" ADD CONSTRAINT "station_track_station_id_station_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."station"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_track" ADD CONSTRAINT "station_track_track_id_track_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."track"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_event" ADD CONSTRAINT "status_event_patrol_id_patrol_id_fk" FOREIGN KEY ("patrol_id") REFERENCES "public"."patrol"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track" ADD CONSTRAINT "track_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_log_comp_idx" ON "audit_log" USING btree ("competition_id","at");--> statement-breakpoint
CREATE INDEX "audit_log_series_idx" ON "audit_log" USING btree ("series_id","at");--> statement-breakpoint
CREATE INDEX "score_comp_idx" ON "score" USING btree ("competition_id");--> statement-breakpoint
CREATE INDEX "site_admin_access_comp_idx" ON "site_admin_access" USING btree ("competition_id","expires_at");--> statement-breakpoint
CREATE INDEX "station_comp_idx" ON "station" USING btree ("competition_id");
--> statement-breakpoint
-- change_log.seq: per-competition, commit-ordered sequence.
-- The upsert takes a row lock on change_seq that is held until the writing
-- transaction commits, so writers in the same competition are serialised and
-- seq values become visible in increasing order (SSE cursors never skip a row).
CREATE OR REPLACE FUNCTION change_log_assign_seq() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	INSERT INTO change_seq AS c (competition_id, last) VALUES (NEW.competition_id, 1)
	ON CONFLICT (competition_id) DO UPDATE SET last = c.last + 1
	RETURNING c.last INTO NEW.seq;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS change_log_assign_seq ON change_log;
--> statement-breakpoint
CREATE TRIGGER change_log_assign_seq BEFORE INSERT ON change_log
	FOR EACH ROW EXECUTE FUNCTION change_log_assign_seq();

--> statement-breakpoint
-- audit_log is append-only: no UPDATE, DELETE or TRUNCATE, whoever asks (docs/architecture/04 §10).
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'audit_log is append-only (% refused)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_log_no_update_delete ON audit_log;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update_delete BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_log_no_truncate ON audit_log;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();

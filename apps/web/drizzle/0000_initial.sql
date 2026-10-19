CREATE TYPE "public"."competition_role" AS ENUM('owner', 'organiser', 'hq', 'startfinish');--> statement-breakpoint
CREATE TYPE "public"."device_role" AS ENUM('station_volunteer', 'startfinish');--> statement-breakpoint
CREATE TYPE "public"."patrol_status" AS ENUM('registered', 'active', 'finished', 'resigned');--> statement-breakpoint
CREATE TYPE "public"."score_origin" AS ENUM('device', 'admin', 'paper');--> statement-breakpoint
CREATE TYPE "public"."score_state" AS ENUM('active', 'void');--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_no" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"groups" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_member_no_unique" UNIQUE("member_no")
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
	"registration_open" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"backup_mode" boolean DEFAULT false NOT NULL,
	"patrol_code_key" text NOT NULL,
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
	"contact_name" text,
	"contact_phone" text,
	"contact_email" text,
	"contact_member_no" text,
	"follow_token_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patrol_comp_number" UNIQUE("competition_id","number")
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
CREATE TABLE "session" (
	"id_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"csrf" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"sort" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "change_log" ADD CONSTRAINT "change_log_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_seq" ADD CONSTRAINT "change_seq_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command" ADD CONSTRAINT "command_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command" ADD CONSTRAINT "command_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station" ADD CONSTRAINT "station_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station" ADD CONSTRAINT "station_day_id_day_id_fk" FOREIGN KEY ("day_id") REFERENCES "public"."day"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_track" ADD CONSTRAINT "station_track_station_id_station_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."station"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_track" ADD CONSTRAINT "station_track_track_id_track_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."track"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_event" ADD CONSTRAINT "status_event_patrol_id_patrol_id_fk" FOREIGN KEY ("patrol_id") REFERENCES "public"."patrol"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track" ADD CONSTRAINT "track_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "score_comp_idx" ON "score" USING btree ("competition_id");--> statement-breakpoint
CREATE INDEX "station_comp_idx" ON "station" USING btree ("competition_id");
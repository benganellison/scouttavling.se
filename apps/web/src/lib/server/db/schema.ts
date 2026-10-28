import {
	pgTable,
	uuid,
	text,
	integer,
	boolean,
	timestamp,
	date,
	jsonb,
	bigint,
	primaryKey,
	unique,
	index,
	pgEnum,
	customType,
	check,
	type AnyPgColumn
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { DistinctValue, ItemMode, PatrolStatusValue } from '@scouttavling/domain';

/*
 * Data model v0.1 — see docs/architecture/02-backend-and-domain.md.
 * Privacy: no birth data, personnummer or addresses are ever stored.
 */

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
	dataType: () => 'bytea',
	toDriver: (v) => Buffer.from(v.buffer, v.byteOffset, v.byteLength),
	fromDriver: (v) => new Uint8Array(v)
});

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const competitionRole = pgEnum('competition_role', ['owner', 'organiser', 'hq', 'startfinish']);
/**
 * The two sides of a score_conflict, as written by scores.ts (conflict) and field.ts (quarantine).
 * Every key is optional: a quarantined command may have no score yet, and "Ta bort personuppgifter"
 * strips the keys that identify a person (anonymise.ts, CONFLICT_PERSONAL_KEYS).
 */
export interface ConflictExisting {
	points?: number;
	stylePoints?: number;
	version?: number;
	state?: 'active' | 'void';
	origin?: string;
}
export interface ConflictIncoming {
	/** Set for a VoidScore and for quarantined commands. */
	type?: 'SetScore' | 'VoidScore' | 'SetStatus';
	points?: number;
	stylePoints?: number;
	raw?: { value: number; style: number | null };
	origin?: string;
	deviceId?: string | null;
	deviceName?: string;
	userId?: string | null;
	baseVersion?: number | null;
	/** Quarantine: why the command was not applied. */
	reason?: string;
	clientNow?: string;
}

// DB order is historical (enum values were added over time); the display order is PATROL_STATUSES.
export const patrolStatus = pgEnum('patrol_status', ['registered', 'active', 'finished', 'resigned', 'camp']);
// Fails to compile if the database enum and the domain list ever differ.
type SameValues<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _statusesMatch: SameValues<(typeof patrolStatus.enumValues)[number], PatrolStatusValue> = true;
void _statusesMatch;
export const deviceRole = pgEnum('device_role', ['station_volunteer', 'startfinish']);
export const scoreState = pgEnum('score_state', ['active', 'void']);
export const scoreOrigin = pgEnum('score_origin', ['device', 'admin', 'paper']);

// ---------- people ----------

export const appUser = pgTable('app_user', {
	id: id(),
	/** Scoutnet member number — the stable ScoutID key (never `sub`). */
	memberNo: text('member_no').notNull().unique(),
	name: text('name').notNull(),
	email: text('email'),
	phone: text('phone'),
	/** [{groupNo, name}] from the scoutnet-memberships claim — selectable owners. */
	groups: jsonb('groups').$type<{ groupNo: string; name: string }[]>().notNull().default([]),
	/** Suspended by a site admin: cannot log in, sessions revoked (see #lib/server/siteAdmin.ts). */
	suspendedAt: timestamp('suspended_at', { withTimezone: true }),
	/** Latest login (expired sessions are deleted, so this is the only record of it). */
	lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
	createdAt: createdAt()
});

export const session = pgTable('session', {
	/** SHA-256 of the cookie value. */
	idHash: text('id_hash').primaryKey(),
	userId: uuid('user_id')
		.notNull()
		.references(() => appUser.id, { onDelete: 'cascade' }),
	csrf: text('csrf').notNull(),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
	createdAt: createdAt()
});

// ---------- competition ----------

/**
 * A competition series (e.g. "GökOpen"): one competition row per yearly edition.
 * Owns the shared branding; an edition's own values override it (see #lib/brand/branding.ts resolveBranding).
 * Organisers of a series = the owners/organisers of any of its editions (docs/architecture/05-series-and-archive.md).
 */
export const series = pgTable('series', {
	id: id(),
	/** Public archive address /t/<slug>. Never equal to a competition slug. */
	slug: text('slug').notNull().unique(),
	name: text('name').notNull(),
	ownerGroupNo: text('owner_group_no'),
	ownerGroupName: text('owner_group_name'),
	/** Series branding (same meaning as the competition columns). */
	accentColor: text('accent_color'),
	coverFit: text('cover_fit', { enum: ['contain', 'cover'] }),
	/** Class colour template: class name → #rrggbb. Used when an edition's class has no own colour. */
	classColors: jsonb('class_colors').$type<Record<string, string>>().notNull().default({}),
	createdBy: uuid('created_by').references(() => appUser.id, { onDelete: 'set null' }),
	createdAt: createdAt()
});

export const competition = pgTable('competition', {
	id: id(),
	slug: text('slug').notNull().unique(),
	name: text('name').notNull(),
	ownerGroupNo: text('owner_group_no'),
	ownerGroupName: text('owner_group_name'),
	multiDay: boolean('multi_day').notNull().default(false),
	startDate: date('start_date').notNull(),
	endDate: date('end_date').notNull(),
	location: text('location'),
	hqPhone: text('hq_phone'),
	/** Competition-wide switch; each item can additionally turn style off. */
	styleEnabled: boolean('style_enabled').notNull().default(true),
	publicResults: boolean('public_results').notNull().default(false),
	/** Public results also show points per station while the competition runs. Closed editions always do. */
	stationResultsLive: boolean('station_results_live').notNull().default(false),
	/** Participation fee per patrol in whole kronor (null = no fee). Paid is ticked by hand. */
	feePerPatrol: integer('fee_per_patrol'),
	registrationOpen: boolean('registration_open').notNull().default(false),
	/** Self-registration window (inclusive dates, Swedish time). null = no limit on that side; closes defaults to endDate. */
	registrationOpensOn: date('registration_opens_on'),
	registrationClosesOn: date('registration_closes_on'),
	/** Max patrols (resigned patrols do not count). null = unlimited. */
	maxPatrols: integer('max_patrols'),
	/** Organiser's text on the public competition page. */
	infoText: text('info_text'),
	/** Extra text shown on the registration confirmation. */
	confirmationText: text('confirmation_text'),
	/** "Följ patrullen": /folj/<token> pages show data only when on. */
	followEnabled: boolean('follow_enabled').notNull().default(false),
	/** Follow pages also show points and placement. */
	followShowScores: boolean('follow_show_scores').notNull().default(false),
	status: text('status', { enum: ['draft', 'live', 'closed'] })
		.notNull()
		.default('draft'),
	/** Backup mode ("Reservläge") broadcast flag. */
	backupMode: boolean('backup_mode').notNull().default(false),
	/** Event branding: accent colour as #rrggbb (null = Scouterna base, Scoutblå). Images live in `asset`. */
	accentColor: text('accent_color'),
	/** Cover display: 'contain' = whole image (never crop baked-in text), 'cover' = fill and crop, null = auto (whole image when wider than 2.5:1). */
	coverFit: text('cover_fit', { enum: ['contain', 'cover'] }),
	/** HMAC key for patrol QR check digits (not a secret from volunteers). */
	patrolCodeKey: text('patrol_code_key').notNull(),
	/** The series this edition belongs to (null = one-off competition). */
	seriesId: uuid('series_id').references((): AnyPgColumn => series.id, { onDelete: 'set null' }),
	/** Edition year, e.g. 2027 for "GökOpen 2027". */
	editionYear: integer('edition_year'),
	/** Listed under "Tidigare år" on the public series page. */
	archivePublic: boolean('archive_public').notNull().default(true),
	/** Set when "Ta bort personuppgifter" ran; the edition is read-only from then on. */
	anonymisedAt: timestamp('anonymised_at', { withTimezone: true }),
	/** Suspended by a site admin: public pages say so, field sync and admin writes are refused. */
	suspendedAt: timestamp('suspended_at', { withTimezone: true }),
	createdBy: uuid('created_by').references(() => appUser.id),
	createdAt: createdAt()
});

export const competitionMember = pgTable(
	'competition_member',
	{
		competitionId: uuid('competition_id')
			.notNull()
			.references(() => competition.id, { onDelete: 'cascade' }),
		userId: uuid('user_id')
			.notNull()
			.references(() => appUser.id, { onDelete: 'cascade' }),
		role: competitionRole('role').notNull()
	},
	(t) => [primaryKey({ columns: [t.competitionId, t.userId, t.role] })]
);

/**
 * Owners and organisers of a series (who may manage the series page and its owners). Lazily
 * initialised from the editions' owners/organisers when a series has no rows yet (#lib/server/ownership.ts).
 * At least one owner at all times, enforced by the ownership helper.
 */
export const seriesMember = pgTable(
	'series_member',
	{
		seriesId: uuid('series_id')
			.notNull()
			.references(() => series.id, { onDelete: 'cascade' }),
		userId: uuid('user_id')
			.notNull()
			.references(() => appUser.id, { onDelete: 'cascade' }),
		role: competitionRole('role').notNull()
	},
	(t) => [primaryKey({ columns: [t.seriesId, t.userId] }), check('series_member_role', sql`${t.role} in ('owner', 'organiser')`)]
);

export const day = pgTable(
	'day',
	{
		id: id(),
		competitionId: uuid('competition_id')
			.notNull()
			.references(() => competition.id, { onDelete: 'cascade' }),
		date: date('date').notNull(),
		name: text('name').notNull(),
		prefix: text('prefix').notNull(),
		sort: integer('sort').notNull()
	},
	(t) => [index('day_comp_idx').on(t.competitionId, t.sort)]
);

export const track = pgTable(
	'track',
	{
		id: id(),
		competitionId: uuid('competition_id')
			.notNull()
			.references(() => competition.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		sort: integer('sort').notNull(),
		/** Class colour #rrggbb (decoration only). null = default from the name (see #lib/brand/colors.ts). */
		color: text('color')
	},
	(t) => [index('track_comp_idx').on(t.competitionId, t.sort)]
);

export const station = pgTable(
	'station',
	{
		id: id(),
		competitionId: uuid('competition_id')
			.notNull()
			.references(() => competition.id, { onDelete: 'cascade' }),
		dayId: uuid('day_id').references(() => day.id, { onDelete: 'set null' }),
		sort: integer('sort').notNull(),
		name: text('name').notNull(),
		/** Organiser override of the suggested paper code (K1, FS, L3…). */
		customCode: text('custom_code'),
		allTracks: boolean('all_tracks').notNull().default(true),
		/**
		 * The day's start or finish (null = ordinary station). A finish station sets
		 * "I läger" on non-last days and "I mål" on the last day; also drives paper codes.
		 */
		role: text('role', { enum: ['start', 'finish'] }),
		/** Checkpoints such as lunch are never start stations. */
		startable: boolean('startable').notNull().default(true),
		contactName: text('contact_name'),
		contactPhone: text('contact_phone')
	},
	(t) => [index('station_comp_idx').on(t.competitionId)]
);

export const stationTrack = pgTable(
	'station_track',
	{
		stationId: uuid('station_id')
			.notNull()
			.references(() => station.id, { onDelete: 'cascade' }),
		trackId: uuid('track_id')
			.notNull()
			.references(() => track.id, { onDelete: 'cascade' })
	},
	(t) => [primaryKey({ columns: [t.stationId, t.trackId] })]
);

export const scoreItem = pgTable(
	'score_item',
	{
		id: id(),
		stationId: uuid('station_id')
			.notNull()
			.references(() => station.id, { onDelete: 'cascade' }),
		sort: integer('sort').notNull(),
		name: text('name').notNull(),
		mode: text('mode').$type<ItemMode>().notNull(),
		min: integer('min').notNull().default(0),
		max: integer('max').notNull().default(20),
		distinctValues: jsonb('distinct_values').$type<DistinctValue[]>(),
		countMultiplier: integer('count_multiplier'),
		styleEnabled: boolean('style_enabled').notNull().default(true),
		styleMin: integer('style_min').notNull().default(0),
		styleMax: integer('style_max').notNull().default(5),
		countsForTiebreak: boolean('counts_for_tiebreak').notNull().default(true)
	},
	(t) => [index('score_item_station_idx').on(t.stationId, t.sort)]
);

// ---------- patrols ----------

export const patrol = pgTable(
	'patrol',
	{
		id: id(),
		competitionId: uuid('competition_id')
			.notNull()
			.references(() => competition.id, { onDelete: 'cascade' }),
		number: integer('number').notNull(),
		name: text('name').notNull(),
		trackId: uuid('track_id').references(() => track.id, { onDelete: 'set null' }),
		troop: text('troop').notNull().default(''),
		status: patrolStatus('status').notNull().default('registered'),
		startStationId: uuid('start_station_id').references(() => station.id, { onDelete: 'set null' }),
		startLocked: boolean('start_locked').notNull().default(false),
		paid: boolean('paid').notNull().default(false),
		/** When "Betald" was ticked (null while unpaid). */
		paidAt: timestamp('paid_at', { withTimezone: true }),
		contactName: text('contact_name'),
		contactPhone: text('contact_phone'),
		contactEmail: text('contact_email'),
		/** Links the contact to ScoutID ("my patrols"). */
		contactMemberNo: text('contact_member_no'),
		/** SHA-256 of the /folj/<token> follow link secret. */
		followTokenHash: text('follow_token_hash'),
		/** AES-GCM encrypted follow token so the manage page can re-display the link (see #lib/server/registration.ts). */
		followTokenEnc: text('follow_token_enc'),
		/** SHA-256 of the /m/<token> manage link secret (shown once, never stored in clear). */
		manageTokenHash: text('manage_token_hash'),
		createdAt: createdAt()
	},
	(t) => [
		unique('patrol_comp_number').on(t.competitionId, t.number),
		unique('patrol_follow_token_hash').on(t.followTokenHash),
		unique('patrol_manage_token_hash').on(t.manageTokenHash)
	]
);

export const member = pgTable(
	'member',
	{
		id: id(),
		patrolId: uuid('patrol_id')
			.notNull()
			.references(() => patrol.id, { onDelete: 'cascade' }),
		firstName: text('first_name').notNull(),
		lastName: text('last_name').notNull().default(''),
		troopText: text('troop_text').notNull().default('')
	},
	(t) => [index('member_patrol_idx').on(t.patrolId)]
);

// ---------- field devices ----------

export const invite = pgTable(
	'invite',
	{
		id: id(),
		competitionId: uuid('competition_id')
			.notNull()
			.references(() => competition.id, { onDelete: 'cascade' }),
		/** null for start & finish invites. */
		stationId: uuid('station_id').references(() => station.id, { onDelete: 'cascade' }),
		role: deviceRole('role').notNull(),
		/** SHA-256 of the 128-bit secret in the /j/<secret> link. */
		secretHash: text('secret_hash').notNull().unique(),
		generation: integer('generation').notNull().default(1),
		/** AES-GCM encrypted secret so organisers can re-display the QR (admin-patrols, see lib/server/invites.ts). */
		secretEnc: text('secret_enc'),
		revokedAt: timestamp('revoked_at', { withTimezone: true }),
		createdAt: createdAt()
	},
	(t) => [index('invite_comp_idx').on(t.competitionId)]
);

export const device = pgTable(
	'device',
	{
		id: id(),
		competitionId: uuid('competition_id')
			.notNull()
			.references(() => competition.id, { onDelete: 'cascade' }),
		inviteId: uuid('invite_id')
			.notNull()
			.references(() => invite.id, { onDelete: 'cascade' }),
		role: deviceRole('role').notNull(),
		stationIds: uuid('station_ids').array().notNull().default([]),
		displayName: text('display_name').notNull(),
		/** Public ECDSA P-256 JWK; commands are signed with the matching non-extractable key. */
		publicJwk: jsonb('public_jwk').$type<JsonWebKey>().notNull(),
		lastSeq: integer('last_seq').notNull().default(0),
		lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
		revokedAt: timestamp('revoked_at', { withTimezone: true }),
		createdAt: createdAt()
	},
	(t) => [index('device_comp_idx').on(t.competitionId), index('device_invite_idx').on(t.inviteId)]
);

/** Idempotency ledger: every command ever received, keyed by its client UUIDv7. */
export const command = pgTable(
	'command',
	{
		id: uuid('id').primaryKey(),
		competitionId: uuid('competition_id')
			.notNull()
			.references(() => competition.id, { onDelete: 'cascade' }),
		deviceId: uuid('device_id').references(() => device.id, { onDelete: 'set null' }),
		deviceSeq: integer('device_seq'),
		type: text('type').notNull(),
		payload: jsonb('payload').notNull(),
		clientAt: timestamp('client_at', { withTimezone: true }),
		receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
		result: text('result', { enum: ['accepted', 'duplicate', 'conflict', 'quarantined', 'rejected'] }).notNull(),
		resultDetail: jsonb('result_detail')
	},
	(t) => [index('command_comp_idx').on(t.competitionId), index('command_device_idx').on(t.deviceId)]
);

// ---------- scores ----------

export const score = pgTable(
	'score',
	{
		id: id(),
		competitionId: uuid('competition_id')
			.notNull()
			.references(() => competition.id, { onDelete: 'cascade' }),
		patrolId: uuid('patrol_id')
			.notNull()
			.references(() => patrol.id, { onDelete: 'cascade' }),
		itemId: uuid('item_id')
			.notNull()
			.references(() => scoreItem.id, { onDelete: 'cascade' }),
		points: integer('points').notNull(),
		stylePoints: integer('style_points').notNull().default(0),
		/** What was entered: {value, style}. */
		raw: jsonb('raw').$type<{ value: number; style: number | null }>().notNull(),
		state: scoreState('state').notNull().default('active'),
		version: integer('version').notNull().default(1),
		origin: scoreOrigin('origin').notNull(),
		deviceId: uuid('device_id').references(() => device.id, { onDelete: 'set null' }),
		userId: uuid('user_id').references(() => appUser.id, { onDelete: 'set null' }),
		note: text('note'),
		/**
		 * When the patrol was at the station: the phone's clock at the first device report (capped at
		 * server time). Null for paper and HQ entries, which are typed in afterwards. Drives the times
		 * between stations; kept by "Ta bort personuppgifter".
		 */
		scoredAt: timestamp('scored_at', { withTimezone: true }),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		unique('score_patrol_item').on(t.patrolId, t.itemId),
		index('score_comp_idx').on(t.competitionId),
		index('score_item_idx').on(t.itemId),
		index('score_device_idx').on(t.deviceId)
	]
);

/** Append-only audit trail of every change to a score. */
export const scoreRevision = pgTable(
	'score_revision',
	{
		id: id(),
		scoreId: uuid('score_id')
			.notNull()
			.references(() => score.id, { onDelete: 'cascade' }),
		version: integer('version').notNull(),
		points: integer('points').notNull(),
		stylePoints: integer('style_points').notNull(),
		state: scoreState('state').notNull(),
		origin: scoreOrigin('origin').notNull(),
		deviceId: uuid('device_id'),
		userId: uuid('user_id'),
		commandId: uuid('command_id'),
		reason: text('reason'),
		at: timestamp('at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [index('score_revision_score_idx').on(t.scoreId, t.version)]
);

/** Never silently overwrite: competing writes land here for HQ review. */
export const scoreConflict = pgTable(
	'score_conflict',
	{
		id: id(),
		competitionId: uuid('competition_id')
			.notNull()
			.references(() => competition.id, { onDelete: 'cascade' }),
		patrolId: uuid('patrol_id')
			.notNull()
			.references(() => patrol.id, { onDelete: 'cascade' }),
		itemId: uuid('item_id')
			.notNull()
			.references(() => scoreItem.id, { onDelete: 'cascade' }),
		existing: jsonb('existing').$type<ConflictExisting>().notNull(),
		incoming: jsonb('incoming').$type<ConflictIncoming>().notNull(),
		commandId: uuid('command_id'),
		kind: text('kind', { enum: ['conflict', 'quarantine'] })
			.notNull()
			.default('conflict'),
		status: text('status', { enum: ['open', 'resolved'] })
			.notNull()
			.default('open'),
		createdAt: createdAt()
	},
	(t) => [index('score_conflict_comp_idx').on(t.competitionId, t.status, t.createdAt)]
);

export const statusEvent = pgTable(
	'status_event',
	{
		id: id(),
		patrolId: uuid('patrol_id')
			.notNull()
			.references(() => patrol.id, { onDelete: 'cascade' }),
		status: patrolStatus('status').notNull(),
		deviceId: uuid('device_id'),
		userId: uuid('user_id'),
		at: timestamp('at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [index('status_event_patrol_idx').on(t.patrolId, t.at)]
);

/** Monotonic change feed per competition: drives SSE resume and snapshot deltas. */
export const changeLog = pgTable(
	'change_log',
	{
		/**
		 * Per-competition sequence, assigned by the BEFORE INSERT trigger in
		 * scripts/db-extras.sql from a locked counter row. Unlike a global
		 * bigserial, numbers commit in order within a competition, so an SSE
		 * client resuming "after seq N" can never skip a row. (0 = placeholder.)
		 */
		seq: bigint('seq', { mode: 'number' }).notNull().default(0),
		competitionId: uuid('competition_id')
			.notNull()
			.references(() => competition.id, { onDelete: 'cascade' }),
		kind: text('kind').notNull(),
		entityId: uuid('entity_id'),
		at: timestamp('at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.competitionId, t.seq] })]
);

/** Counter row per competition backing change_log.seq (see trigger). */
export const changeSeq = pgTable('change_seq', {
	competitionId: uuid('competition_id')
		.primaryKey()
		.references(() => competition.id, { onDelete: 'cascade' }),
	last: bigint('last', { mode: 'number' }).notNull().default(0)
});

export const message = pgTable(
	'message',
	{
		id: id(),
		competitionId: uuid('competition_id')
			.notNull()
			.references(() => competition.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		body: text('body').notNull(),
		important: boolean('important').notNull().default(false),
		/** 'all' | 'startfinish' | station ids */
		audience: jsonb('audience').$type<string[]>().notNull().default(['all']),
		createdBy: uuid('created_by').references(() => appUser.id),
		createdAt: createdAt()
	},
	(t) => [index('message_comp_idx').on(t.competitionId, t.createdAt)]
);

export const messageRead = pgTable(
	'message_read',
	{
		messageId: uuid('message_id')
			.notNull()
			.references(() => message.id, { onDelete: 'cascade' }),
		deviceId: uuid('device_id')
			.notNull()
			.references(() => device.id, { onDelete: 'cascade' }),
		at: timestamp('at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.messageId, t.deviceId] }), index('message_read_device_idx').on(t.deviceId)]
);

// ---------- uploads ----------

/**
 * Uploaded event images, stored in Postgres behind #lib/server/assetStore.ts. One row per (edition or series, kind); replacing
 * inserts a new row (new id = new immutable URL /media/<id>) and deletes the old one.
 * Bytes are validated by magic bytes and stripped of metadata (#lib/server/imageValidate.ts).
 */
export const asset = pgTable(
	'asset',
	{
		id: id(),
		/** Exactly one of competition_id (edition override) and series_id (series branding) is set. */
		competitionId: uuid('competition_id').references(() => competition.id, { onDelete: 'cascade' }),
		seriesId: uuid('series_id').references(() => series.id, { onDelete: 'cascade' }),
		kind: text('kind', { enum: ['event_logo', 'organiser_logo', 'cover'] }).notNull(),
		mime: text('mime', { enum: ['image/png', 'image/jpeg', 'image/webp'] }).notNull(),
		size: integer('size').notNull(),
		width: integer('width').notNull(),
		height: integer('height').notNull(),
		/** Hex SHA-256 of `data`: the ETag. */
		sha256: text('sha256').notNull(),
		data: bytea('data').notNull(),
		uploadedBy: uuid('uploaded_by').references(() => appUser.id, { onDelete: 'set null' }),
		createdAt: createdAt()
	},
	(t) => [
		unique('asset_comp_kind').on(t.competitionId, t.kind),
		unique('asset_series_kind').on(t.seriesId, t.kind),
		check('asset_one_owner', sql`(${t.competitionId} is null) <> (${t.seriesId} is null)`)
	]
);

/**
 * Patrol links (/m, /folj) retired by "Ta bort personuppgifter": only the token hash and the
 * edition, so an old link can say "Tävlingen är avslutad och arkiverad" without keeping any patrol link.
 */
export const retiredLink = pgTable('retired_link', {
	tokenHash: text('token_hash').primaryKey(),
	competitionId: uuid('competition_id')
		.notNull()
		.references(() => competition.id, { onDelete: 'cascade' }),
	kind: text('kind', { enum: ['manage', 'follow'] }).notNull(),
	createdAt: createdAt()
});

// ---------- platform operation ----------

/** Platform operators. Granted and revoked ONLY from the server command line (scripts/site-admin.ts). */
export const siteAdmin = pgTable('site_admin', {
	userId: uuid('user_id')
		.primaryKey()
		.references(() => appUser.id, { onDelete: 'cascade' }),
	grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
	/** e.g. "cli:bengt". */
	grantedBy: text('granted_by').notNull(),
	reason: text('reason').notNull()
});

/**
 * "Tillfällig åtkomst": a site admin's time-limited role in one competition, with a reason.
 * Read by requireCompetition as an extra role source while `expires_at > now()` and `ended_at` is null.
 */
export const siteAdminAccess = pgTable(
	'site_admin_access',
	{
		id: id(),
		userId: uuid('user_id')
			.notNull()
			.references(() => appUser.id, { onDelete: 'cascade' }),
		competitionId: uuid('competition_id')
			.notNull()
			.references(() => competition.id, { onDelete: 'cascade' }),
		role: competitionRole('role').notNull().default('organiser'),
		reason: text('reason').notNull(),
		grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		/** Ended early by the site admin. */
		endedAt: timestamp('ended_at', { withTimezone: true })
	},
	(t) => [index('site_admin_access_comp_idx').on(t.competitionId, t.expiresAt)]
);

/**
 * Append-only audit log (owner changes, site-admin actions, personal-data removal). A trigger
 * rejects UPDATE/DELETE/TRUNCATE (trigger in 0000_initial.sql). No foreign keys on purpose: rows outlive the
 * users and competitions they mention, and a cascading delete would be an UPDATE/DELETE.
 * Only ids are stored; names are looked up at read time. `reason` must never contain patrol member names.
 */
export const auditLog = pgTable(
	'audit_log',
	{
		id: id(),
		at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
		/** null for the command line. */
		actorUserId: uuid('actor_user_id'),
		actorKind: text('actor_kind', { enum: ['user', 'site_admin', 'cli'] }).notNull(),
		action: text('action').notNull(),
		targetType: text('target_type', { enum: ['competition', 'series', 'user', 'site_admin'] }).notNull(),
		targetId: uuid('target_id'),
		competitionId: uuid('competition_id'),
		seriesId: uuid('series_id'),
		reason: text('reason'),
		details: jsonb('details').$type<Record<string, unknown>>().notNull().default({})
	},
	(t) => [index('audit_log_at_idx').on(t.at), index('audit_log_comp_idx').on(t.competitionId, t.at), index('audit_log_series_idx').on(t.seriesId, t.at)]
);

import {
	pgTable, uuid, text, integer, boolean, timestamp, date, jsonb, bigint, primaryKey, unique, index, pgEnum
} from 'drizzle-orm/pg-core';
import type { DistinctValue, ItemMode } from '@scouttavling/domain';

/*
 * Data model v0.1 — see docs/architecture/02-backend-and-domain.md.
 * Privacy: no birth data, personnummer or addresses are ever stored.
 */

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const competitionRole = pgEnum('competition_role', ['owner', 'organiser', 'hq', 'startfinish']);
export const patrolStatus = pgEnum('patrol_status', ['registered', 'active', 'finished', 'resigned', 'camp']);
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
	createdAt: createdAt()
});

export const session = pgTable('session', {
	/** SHA-256 of the cookie value. */
	idHash: text('id_hash').primaryKey(),
	userId: uuid('user_id').notNull().references(() => appUser.id, { onDelete: 'cascade' }),
	csrf: text('csrf').notNull(),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
	createdAt: createdAt()
});

// ---------- competition ----------

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
	status: text('status', { enum: ['draft', 'live', 'closed'] }).notNull().default('draft'),
	/** Backup mode ("Reservläge") broadcast flag. */
	backupMode: boolean('backup_mode').notNull().default(false),
	/** HMAC key for patrol QR check digits (not a secret from volunteers). */
	patrolCodeKey: text('patrol_code_key').notNull(),
	createdBy: uuid('created_by').references(() => appUser.id),
	createdAt: createdAt()
});

export const competitionMember = pgTable(
	'competition_member',
	{
		competitionId: uuid('competition_id').notNull().references(() => competition.id, { onDelete: 'cascade' }),
		userId: uuid('user_id').notNull().references(() => appUser.id, { onDelete: 'cascade' }),
		role: competitionRole('role').notNull()
	},
	(t) => [primaryKey({ columns: [t.competitionId, t.userId, t.role] })]
);

export const day = pgTable('day', {
	id: id(),
	competitionId: uuid('competition_id').notNull().references(() => competition.id, { onDelete: 'cascade' }),
	date: date('date').notNull(),
	name: text('name').notNull(),
	prefix: text('prefix').notNull(),
	sort: integer('sort').notNull()
});

export const track = pgTable('track', {
	id: id(),
	competitionId: uuid('competition_id').notNull().references(() => competition.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	sort: integer('sort').notNull()
});

export const station = pgTable(
	'station',
	{
		id: id(),
		competitionId: uuid('competition_id').notNull().references(() => competition.id, { onDelete: 'cascade' }),
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
		stationId: uuid('station_id').notNull().references(() => station.id, { onDelete: 'cascade' }),
		trackId: uuid('track_id').notNull().references(() => track.id, { onDelete: 'cascade' })
	},
	(t) => [primaryKey({ columns: [t.stationId, t.trackId] })]
);

export const scoreItem = pgTable('score_item', {
	id: id(),
	stationId: uuid('station_id').notNull().references(() => station.id, { onDelete: 'cascade' }),
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
});

// ---------- patrols ----------

export const patrol = pgTable(
	'patrol',
	{
		id: id(),
		competitionId: uuid('competition_id').notNull().references(() => competition.id, { onDelete: 'cascade' }),
		number: integer('number').notNull(),
		name: text('name').notNull(),
		trackId: uuid('track_id').references(() => track.id, { onDelete: 'set null' }),
		troop: text('troop').notNull().default(''),
		status: patrolStatus('status').notNull().default('registered'),
		startStationId: uuid('start_station_id').references(() => station.id, { onDelete: 'set null' }),
		startLocked: boolean('start_locked').notNull().default(false),
		paid: boolean('paid').notNull().default(false),
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

export const member = pgTable('member', {
	id: id(),
	patrolId: uuid('patrol_id').notNull().references(() => patrol.id, { onDelete: 'cascade' }),
	firstName: text('first_name').notNull(),
	lastName: text('last_name').notNull().default(''),
	troopText: text('troop_text').notNull().default('')
});

// ---------- field devices ----------

export const invite = pgTable('invite', {
	id: id(),
	competitionId: uuid('competition_id').notNull().references(() => competition.id, { onDelete: 'cascade' }),
	/** null for start & finish invites. */
	stationId: uuid('station_id').references(() => station.id, { onDelete: 'cascade' }),
	role: deviceRole('role').notNull(),
	/** SHA-256 of the 128-bit secret in the /j/<secret> link. */
	secretHash: text('secret_hash').notNull().unique(),
	generation: integer('generation').notNull().default(1),
	/** AES-GCM encrypted secret so organisers can re-display the QR (admin-patrols, see invites/inviteCrypto.server.ts). */
	secretEnc: text('secret_enc'),
	revokedAt: timestamp('revoked_at', { withTimezone: true }),
	createdAt: createdAt()
});

export const device = pgTable('device', {
	id: id(),
	competitionId: uuid('competition_id').notNull().references(() => competition.id, { onDelete: 'cascade' }),
	inviteId: uuid('invite_id').notNull().references(() => invite.id, { onDelete: 'cascade' }),
	role: deviceRole('role').notNull(),
	stationIds: uuid('station_ids').array().notNull().default([]),
	displayName: text('display_name').notNull(),
	/** Public ECDSA P-256 JWK; commands are signed with the matching non-extractable key. */
	publicJwk: jsonb('public_jwk').$type<JsonWebKey>().notNull(),
	lastSeq: integer('last_seq').notNull().default(0),
	lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
	revokedAt: timestamp('revoked_at', { withTimezone: true }),
	createdAt: createdAt()
});

/** Idempotency ledger: every command ever received, keyed by its client UUIDv7. */
export const command = pgTable('command', {
	id: uuid('id').primaryKey(),
	competitionId: uuid('competition_id').notNull().references(() => competition.id, { onDelete: 'cascade' }),
	deviceId: uuid('device_id').references(() => device.id, { onDelete: 'set null' }),
	deviceSeq: integer('device_seq'),
	type: text('type').notNull(),
	payload: jsonb('payload').notNull(),
	clientAt: timestamp('client_at', { withTimezone: true }),
	receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
	result: text('result', { enum: ['accepted', 'duplicate', 'conflict', 'quarantined', 'rejected'] }).notNull(),
	resultDetail: jsonb('result_detail')
});

// ---------- scores ----------

export const score = pgTable(
	'score',
	{
		id: id(),
		competitionId: uuid('competition_id').notNull().references(() => competition.id, { onDelete: 'cascade' }),
		patrolId: uuid('patrol_id').notNull().references(() => patrol.id, { onDelete: 'cascade' }),
		itemId: uuid('item_id').notNull().references(() => scoreItem.id, { onDelete: 'cascade' }),
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
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [unique('score_patrol_item').on(t.patrolId, t.itemId), index('score_comp_idx').on(t.competitionId)]
);

/** Append-only audit trail of every change to a score. */
export const scoreRevision = pgTable('score_revision', {
	id: id(),
	scoreId: uuid('score_id').notNull().references(() => score.id, { onDelete: 'cascade' }),
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
});

/** Never silently overwrite: competing writes land here for HQ review. */
export const scoreConflict = pgTable('score_conflict', {
	id: id(),
	competitionId: uuid('competition_id').notNull().references(() => competition.id, { onDelete: 'cascade' }),
	patrolId: uuid('patrol_id').notNull().references(() => patrol.id, { onDelete: 'cascade' }),
	itemId: uuid('item_id').notNull().references(() => scoreItem.id, { onDelete: 'cascade' }),
	existing: jsonb('existing').notNull(),
	incoming: jsonb('incoming').notNull(),
	commandId: uuid('command_id'),
	kind: text('kind', { enum: ['conflict', 'quarantine'] }).notNull().default('conflict'),
	status: text('status', { enum: ['open', 'resolved'] }).notNull().default('open'),
	createdAt: createdAt()
});

export const statusEvent = pgTable('status_event', {
	id: id(),
	patrolId: uuid('patrol_id').notNull().references(() => patrol.id, { onDelete: 'cascade' }),
	status: patrolStatus('status').notNull(),
	deviceId: uuid('device_id'),
	userId: uuid('user_id'),
	at: timestamp('at', { withTimezone: true }).notNull().defaultNow()
});

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
		competitionId: uuid('competition_id').notNull().references(() => competition.id, { onDelete: 'cascade' }),
		kind: text('kind').notNull(),
		entityId: uuid('entity_id'),
		at: timestamp('at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.competitionId, t.seq] })]
);

/** Counter row per competition backing change_log.seq (see trigger). */
export const changeSeq = pgTable('change_seq', {
	competitionId: uuid('competition_id').primaryKey().references(() => competition.id, { onDelete: 'cascade' }),
	last: bigint('last', { mode: 'number' }).notNull().default(0)
});

export const message = pgTable('message', {
	id: id(),
	competitionId: uuid('competition_id').notNull().references(() => competition.id, { onDelete: 'cascade' }),
	title: text('title').notNull(),
	body: text('body').notNull(),
	important: boolean('important').notNull().default(false),
	/** 'all' | 'startfinish' | station ids */
	audience: jsonb('audience').$type<string[]>().notNull().default(['all']),
	createdBy: uuid('created_by').references(() => appUser.id),
	createdAt: createdAt()
});

export const messageRead = pgTable(
	'message_read',
	{
		messageId: uuid('message_id').notNull().references(() => message.id, { onDelete: 'cascade' }),
		deviceId: uuid('device_id').notNull().references(() => device.id, { onDelete: 'cascade' }),
		at: timestamp('at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.messageId, t.deviceId] })]
);

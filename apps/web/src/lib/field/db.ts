/**
 * The device's local store (03 §3.2): IndexedDB via Dexie. Everything the
 * field UI shows is read from here; every write goes to the outbox first.
 */
import Dexie, { type EntityTable } from 'dexie';
import type { CommandResult, CommandType, PatrolStatus } from './protocol.ts';
import type { Snapshot } from '#lib/server/field.ts';

export type Pack = Snapshot;

export interface GrantRow {
	slug: string;
	grant: string;
	deviceId: string;
	/** Non-extractable ECDSA P-256 private key (structured-cloned CryptoKey). */
	privateKey: CryptoKey;
	publicJwk: JsonWebKey;
	displayName: string;
	role: 'station_volunteer' | 'startfinish';
	stations: string[];
	exp: number;
	/** Next deviceSeq to assign (assigned at signing time, strictly increasing). */
	nextSeq: number;
	/** base64url SHA-256 of the last signed command JWS (hash chain). */
	lastHash: string | null;
	joinedAt: number;
	/** Selected station when the grant covers several. */
	stationId: string | null;
}

export interface PackRow {
	slug: string;
	pack: Pack;
	cursor: number;
	fetchedAt: number;
	/** serverTime − deviceTime (ms), from the last snapshot round-trip. */
	offsetMs: number;
}

export type OutboxState = 'pending' | 'accepted' | 'duplicate' | 'conflict' | 'rejected' | 'quarantined';

export interface LocalValue {
	value: number;
	style: number | null;
	points: number;
	stylePoints: number;
	state: 'active' | 'void';
	at: number;
	commandId: string;
}

export interface OutboxRow {
	commandId: string;
	slug: string;
	/** One save (all items of a station for one patrol) = one group; undo works per group. */
	groupId: string;
	createdAt: number;
	type: CommandType;
	payload: Record<string, unknown> & { patrolId: string };
	baseVersion: number | null;
	/** Resolve baseVersion at signing time from this earlier command's result (own unsynced edits). */
	baseFrom: string | null;
	state: OutboxState;
	deviceSeq?: number;
	jws?: string;
	result?: CommandResult;
	sentAt?: number;
	/** What the score (or status) looked like before this command, for undo. */
	prevLocal?: LocalValue | null;
	prevStatus?: PatrolStatus;
}

export interface ServerScore {
	points: number;
	stylePoints: number;
	raw: { value: number; style: number | null };
	state: 'active' | 'void';
	version: number;
	at: string;
	by: string;
	mine: boolean;
}

export interface LocalScore {
	key: string;
	slug: string;
	patrolId: string;
	itemId: string;
	server: ServerScore | null;
	/** Optimistic value from our own not-yet-confirmed command. */
	local: LocalValue | null;
	conflict: { points: number; stylePoints: number; version: number; state: string } | null;
	problem: string | null;
}

export interface LocalStatus {
	key: string;
	slug: string;
	patrolId: string;
	status: PatrolStatus;
	commandId: string;
	at: number;
}

export interface PendingRead {
	key: string;
	slug: string;
	messageId: string;
}

export class FieldDB extends Dexie {
	grants!: EntityTable<GrantRow, 'slug'>;
	packs!: EntityTable<PackRow, 'slug'>;
	outbox!: EntityTable<OutboxRow, 'commandId'>;
	scores!: EntityTable<LocalScore, 'key'>;
	statuses!: EntityTable<LocalStatus, 'key'>;
	reads!: EntityTable<PendingRead, 'key'>;

	constructor() {
		super('st-field');
		this.version(1).stores({
			grants: 'slug',
			packs: 'slug',
			outbox: 'commandId, slug, groupId, [slug+state], createdAt',
			scores: 'key, slug',
			statuses: 'key, slug',
			reads: 'key, slug'
		});
	}
}

let instance: FieldDB | null = null;
export function fieldDb(): FieldDB {
	instance ??= new FieldDB();
	return instance;
}

export const scoreKey = (slug: string, patrolId: string, itemId: string) => `${slug}|${patrolId}|${itemId}`;

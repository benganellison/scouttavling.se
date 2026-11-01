/**
 * Field app state + sync engine (03 §3.3–3.5, contract C8).
 *
 * - Reads come from Dexie (liveQuery → $state); the UI never waits on the network.
 * - Saves go to the outbox and update the local projection optimistically.
 * - The flusher sends ~3 s after the last change, then every 10 s, on `online`
 *   and on visibility, with exponential backoff; one tab at a time (Web Locks).
 * - Commands are signed at flush time (deviceSeq + prev hash assigned then), so
 *   an undo within the window simply deletes the unsigned command.
 */
import { getContext, setContext } from 'svelte';
import { liveQuery } from 'dexie';
import { evaluate, parsePatrolCode, verifyPatrolCode, type ScoreItemDef } from '@scouttavling/domain';
import { fieldDb, scoreKey, type GrantRow, type LocalScore, type LocalStatus, type LocalValue, type OutboxRow, type Pack, type PackRow } from './db.ts';
import { uuidv7, type PatrolStatus } from './protocol.ts';
import { AuthError, SyncEngine } from './sync.ts';

export const UNDO_MS = 10_000;
const FLUSH_DELAY_MS = 3_000;
const TICK_MS = 10_000;
const MAX_BACKOFF_MS = 120_000;

export type PackItem = Pack['items'][number];
export type PackPatrol = Pack['patrols'][number];
export type PackStation = Pack['stations'][number];

export interface DisplayScore {
	points: number;
	stylePoints: number;
	raw: { value: number; style: number | null };
	state: 'active' | 'void';
	at: number;
	by: string;
	version: number | null;
	sync: 'synced' | 'pending' | 'conflict' | 'problem' | 'review';
}

export interface SaveEntry {
	itemId: string;
	value: number;
	style: number | null;
	note?: string | null;
}

/** Sync states from fine to needs-attention: a station's state is its worst item's. */
export const SYNC_SEVERITY: DisplayScore['sync'][] = ['synced', 'pending', 'review', 'problem', 'conflict'];
export const worstSync = (a: DisplayScore['sync'], b: DisplayScore['sync']) => (SYNC_SEVERITY.indexOf(b) > SYNC_SEVERITY.indexOf(a) ? b : a);

export class FieldApp {
	readonly slug: string;
	ready = $state(false);
	grant = $state<GrantRow | null>(null);
	packRow = $state<PackRow | null>(null);
	scores = $state<LocalScore[]>([]);
	outbox = $state<OutboxRow[]>([]);
	statuses = $state<LocalStatus[]>([]);
	online = $state(typeof navigator === 'undefined' ? true : navigator.onLine);
	lastSyncAt = $state<number | null>(null);
	lastFailedAt = $state<number | null>(null);
	syncing = $state(false);
	authProblem = $state<string | null>(null);
	storagePersisted = $state<boolean | null>(null);
	now = $state(Date.now());

	pack = $derived(this.packRow?.pack ?? null);
	stationId = $derived(this.grant?.stationId ?? this.pack?.myStationIds[0] ?? null);
	station = $derived(this.pack?.stations.find((s) => s.id === this.stationId) ?? null);
	items = $derived((this.pack?.items ?? []).filter((i) => i.stationId === this.stationId));
	patrols = $derived(this.pack?.patrols ?? []);
	patrolById = $derived(new Map(this.patrols.map((p) => [p.id, p])));
	patrolByNumber = $derived(new Map(this.patrols.map((p) => [p.number, p])));
	scoreByKey = $derived(new Map(this.scores.map((s) => [s.key, s])));
	outboxById = $derived(new Map(this.outbox.map((o) => [o.commandId, o])));
	statusOverride = $derived(new Map(this.statuses.map((s) => [s.patrolId, s])));
	pendingRows = $derived(this.outbox.filter((o) => o.state === 'pending'));
	/** Pending reports (a Mål save with 4 items counts as one). */
	pendingCount = $derived(new Set(this.pendingRows.map((o) => o.groupId)).size);
	/** Real conflicts only (someone else changed the score). */
	conflictCount = $derived(this.scores.filter((s) => s.conflict).length);
	/** Reports the server refused (e.g. competition closed); the reason is in the log. */
	rejectedCount = $derived(
		this.scores.filter((s) => !s.conflict && s.problem).length +
			this.outbox.filter((o) => o.type === 'SetStatus' && o.state === 'rejected' && this.statusOverride.get(o.payload.patrolId)?.commandId === o.commandId)
				.length
	);
	/** The organiser closed the competition: the server no longer accepts reports. */
	closed = $derived(this.pack?.competition.status === 'closed');
	unreadCount = $derived((this.pack?.messages ?? []).filter((m) => !m.read).length);

	private timer: ReturnType<typeof setTimeout> | null = null;
	private failures = 0;
	private subs: { unsubscribe(): void }[] = [];
	private cleanup: (() => void)[] = [];
	private db = fieldDb();
	private engine: SyncEngine;

	constructor(slug: string) {
		this.slug = slug;
		this.engine = new SyncEngine(this.db, slug);
	}

	// ---------- lifecycle ----------

	async init() {
		const db = this.db;
		const slug = this.slug;
		const [grant, packRow] = await Promise.all([db.grants.get(slug), db.packs.get(slug)]);
		this.grant = grant ?? null;
		this.packRow = packRow ?? null;
		this.subs.push(
			liveQuery(() => db.scores.where('slug').equals(slug).toArray()).subscribe((v) => (this.scores = v)),
			liveQuery(() => db.outbox.where('slug').equals(slug).sortBy('createdAt')).subscribe((v) => (this.outbox = v)),
			liveQuery(() => db.statuses.where('slug').equals(slug).toArray()).subscribe((v) => (this.statuses = v)),
			liveQuery(() => db.packs.get(slug)).subscribe((v) => (this.packRow = v ?? null)),
			liveQuery(() => db.grants.get(slug)).subscribe((v) => (this.grant = v ?? null))
		);
		// Personal data must not stay on volunteers' phones after the competition: a week after the
		// permission expired, everything about it goes, also on phones that never synced again.
		if (this.grant && this.grant.exp * 1000 < Date.now() - FORGET_AFTER_MS) {
			await forgetCompetition(slug, { keepUnsent: false });
		}
		this.ready = true;
		if (!this.grant) return;

		const on = () => {
			this.online = true;
			this.failures = 0;
			void this.syncNow();
		};
		const off = () => (this.online = false);
		const vis = () => document.visibilityState === 'visible' && void this.syncNow();
		addEventListener('online', on);
		addEventListener('offline', off);
		document.addEventListener('visibilitychange', vis);
		const clock = setInterval(() => (this.now = Date.now()), 1000);
		this.cleanup.push(() => {
			removeEventListener('online', on);
			removeEventListener('offline', off);
			document.removeEventListener('visibilitychange', vis);
			clearInterval(clock);
		});
		try {
			this.storagePersisted = (await navigator.storage?.persist?.()) ?? null;
		} catch {
			this.storagePersisted = null;
		}
		void this.syncNow();
	}

	destroy() {
		this.subs.forEach((s) => s.unsubscribe());
		this.cleanup.forEach((f) => f());
		if (this.timer) clearTimeout(this.timer);
	}

	// ---------- derived helpers ----------

	/** Server-estimated now (device clock corrected by the last snapshot offset). */
	serverNow(): number {
		return Date.now() + (this.packRow?.offsetMs ?? 0);
	}

	display(patrolId: string, itemId: string): DisplayScore | null {
		const s = this.scoreByKey.get(scoreKey(this.slug, patrolId, itemId));
		if (!s) return null;
		if (s.local) {
			const row = this.outboxById.get(s.local.commandId);
			const sync = s.conflict ? 'conflict' : s.problem ? 'problem' : row?.state === 'quarantined' ? 'review' : 'pending';
			return { ...s.local, raw: { value: s.local.value, style: s.local.style }, by: this.grant?.displayName ?? '', version: s.server?.version ?? null, sync };
		}
		if (!s.server) return null;
		return {
			points: s.server.points,
			stylePoints: s.server.stylePoints,
			raw: s.server.raw,
			state: s.server.state,
			at: Date.parse(s.server.at),
			by: s.server.by,
			version: s.server.version,
			sync: s.conflict ? 'conflict' : s.problem ? 'problem' : 'synced'
		};
	}

	patrolStatus(p: PackPatrol): PatrolStatus {
		return this.statusOverride.get(p.id)?.status ?? p.status;
	}

	eligible(p: PackPatrol, station: PackStation | null = this.station): boolean {
		if (!station) return false;
		return station.trackIds === null || (p.trackId !== null && station.trackIds.includes(p.trackId));
	}

	/** Items the volunteer actually fills in (AUTO_ON_SCAN is recorded automatically). */

	/** The patrol's result at this station across all items, or null if not (fully) reported. */
	stationResult(patrolId: string) {
		const items = this.items;
		if (!items.length) return null;
		let points = 0;
		let style = 0;
		let at = 0;
		let by = '';
		let sync: DisplayScore['sync'] = 'synced';
		for (const it of items) {
			const d = this.display(patrolId, it.id);
			if (!d || d.state !== 'active') return null;
			points += d.points;
			style += d.stylePoints;
			if (d.at > at) {
				at = d.at;
				by = d.by;
			}
			sync = worstSync(sync, d.sync);
		}
		return { points, style, total: points + style, at, by, sync };
	}

	/**
	 * What this phone has reported for a patrol at its station, for the log: the result (null while
	 * incomplete or removed), the worst sync state, and the server's side of a conflict. null when
	 * there is nothing to show.
	 */
	stationReport(patrolId: string) {
		const parts = this.items.map((it) => ({ s: this.scoreByKey.get(scoreKey(this.slug, patrolId, it.id)), d: this.display(patrolId, it.id) }));
		if (!parts.some((x) => x.d)) return null;
		const result = this.stationResult(patrolId);
		const voidPending = !result && parts.some((x) => x.d?.state === 'void' && x.d.sync === 'pending');
		const conflict = parts.find((x) => x.s?.conflict)?.s?.conflict ?? null;
		const problem = parts.find((x) => x.s?.problem)?.s?.problem ?? null;
		if (!result && !voidPending && !conflict && !problem) return null;
		const sync: DisplayScore['sync'] = conflict
			? 'conflict'
			: problem
				? 'problem'
				: parts.reduce<DisplayScore['sync']>((w, x) => (x.d ? worstSync(w, x.d.sync) : w), 'synced');
		return { result, sync, voidPending, conflict, problem, at: Math.max(...parts.map((x) => x.d?.at ?? 0)) };
	}

	/**
	 * Resolves a scanned QR text offline (C6). Returns null for foreign codes
	 * (ignored silently), or an error message for forged / other-competition codes.
	 */
	async resolveCode(text: string): Promise<{ patrol: PackPatrol } | { error: string } | null> {
		const code = parsePatrolCode(text);
		if (!code || !this.pack) return null;
		if (code.comp !== this.slug) return { error: 'Koden gäller en annan tävling' };
		if (!(await verifyPatrolCode(this.pack.competition.patrolCodeKey, code))) return { error: 'Ogiltig QR-kod – skriv numret i stället' };
		const patrol = this.patrolByNumber.get(code.nr);
		return patrol ? { patrol } : { error: `Patrull ${code.nr} finns inte i listan` };
	}

	// ---------- writes ----------

	private def(itemId: string): ScoreItemDef | undefined {
		return this.pack?.items.find((i) => i.id === itemId);
	}

	/** Base for a new command on (patrol,item): own unconfirmed command → chain to it; else the server version we saw. */
	private baseFor(s: LocalScore | undefined): { baseVersion: number | null; baseFrom: string | null } {
		if (s?.conflict) return { baseVersion: s.conflict.version, baseFrom: null };
		if (s?.local) {
			const row = this.outboxById.get(s.local.commandId);
			if (row && row.state === 'pending') return { baseVersion: null, baseFrom: row.commandId };
		}
		return { baseVersion: s?.server?.version ?? null, baseFrom: null };
	}

	/** One save = one command per item, all in one group (one undo). Returns the group id. */
	async saveScores(patrolId: string, entries: SaveEntry[]): Promise<string> {
		const db = this.db;
		const groupId = uuidv7();
		const now = this.serverNow();
		await db.transaction('rw', db.outbox, db.scores, async () => {
			for (const [i, e] of entries.entries()) {
				const def = this.def(e.itemId);
				if (!def) throw new Error('Okänt moment');
				const value = evaluate(def, { value: e.value, style: e.style });
				const key = scoreKey(this.slug, patrolId, e.itemId);
				const cur = await db.scores.get(key);
				const commandId = uuidv7(now + i);
				const local: LocalValue = { value: e.value, style: def.styleEnabled ? e.style : null, ...value, state: 'active', at: now, commandId };
				await db.outbox.add({
					commandId,
					slug: this.slug,
					groupId,
					createdAt: now + i,
					type: 'SetScore',
					state: 'pending',
					payload: { patrolId, itemId: e.itemId, value: e.value, style: def.styleEnabled ? e.style : null, ...(e.note ? { note: e.note } : {}) },
					...this.baseFor(cur),
					prevLocal: cur?.local ?? serverAsLocal(cur)
				});
				await db.scores.put({ key, slug: this.slug, patrolId, itemId: e.itemId, server: cur?.server ?? null, local, conflict: null, problem: null });
			}
		});
		this.flushSoon();
		return groupId;
	}

	/** "Ta bort": compensating VoidScore for every item of the station. */
	async voidPatrol(patrolId: string, itemIds = this.items.map((i) => i.id)): Promise<string> {
		const db = this.db;
		const groupId = uuidv7();
		const now = this.serverNow();
		await db.transaction('rw', db.outbox, db.scores, async () => {
			for (const [i, itemId] of itemIds.entries()) {
				const key = scoreKey(this.slug, patrolId, itemId);
				const cur = await db.scores.get(key);
				if (!cur || (!cur.local && cur.server?.state !== 'active') || cur.local?.state === 'void') continue;
				const commandId = uuidv7(now + i);
				await db.outbox.add({
					commandId,
					slug: this.slug,
					groupId,
					createdAt: now + i,
					type: 'VoidScore',
					state: 'pending',
					payload: { patrolId, itemId },
					...this.baseFor(cur),
					prevLocal: cur.local
				});
				const base = cur.local ?? {
					value: cur.server!.raw.value,
					style: cur.server!.raw.style,
					points: cur.server!.points,
					stylePoints: cur.server!.stylePoints
				};
				await db.scores.put({ ...cur, local: { ...base, state: 'void', at: now, commandId }, conflict: null, problem: null });
			}
		});
		this.flushSoon();
		return groupId;
	}

	async setStatus(patrolId: string, status: PatrolStatus): Promise<string> {
		const db = this.db;
		const groupId = uuidv7();
		const now = this.serverNow();
		const p = this.patrolById.get(patrolId);
		const prevStatus = p ? this.patrolStatus(p) : undefined;
		const commandId = uuidv7(now);
		await db.transaction('rw', db.outbox, db.statuses, async () => {
			await db.outbox.add({
				commandId,
				slug: this.slug,
				groupId,
				createdAt: now,
				type: 'SetStatus',
				state: 'pending',
				payload: { patrolId, status },
				baseVersion: null,
				baseFrom: null,
				prevStatus
			});
			await db.statuses.put({ key: `${this.slug}|${patrolId}`, slug: this.slug, patrolId, status, commandId, at: now });
		});
		this.flushSoon();
		return groupId;
	}

	/** Undo a save: unsent commands are deleted; sent ones get a compensating command. */
	async undo(groupId: string) {
		const db = this.db;
		const rows = await db.outbox.where('groupId').equals(groupId).toArray();
		const compensate: OutboxRow[] = [];
		await db.transaction('rw', db.outbox, db.scores, db.statuses, async () => {
			for (const row of rows) {
				if (!row.jws) {
					await db.outbox.delete(row.commandId);
					if (row.type === 'SetStatus') {
						const k = `${this.slug}|${row.payload.patrolId}`;
						const st = await db.statuses.get(k);
						if (st?.commandId === row.commandId) await db.statuses.delete(k);
					} else {
						const key = scoreKey(this.slug, row.payload.patrolId, row.payload.itemId as string);
						const cur = await db.scores.get(key);
						if (cur && cur.local?.commandId === row.commandId) {
							const prev = row.prevLocal && (await db.outbox.get(row.prevLocal.commandId))?.state === 'pending' ? row.prevLocal : null;
							if (!prev && !cur.server) await db.scores.delete(key);
							else await db.scores.put({ ...cur, local: prev });
						}
					}
				} else compensate.push(row);
			}
		});
		for (const row of compensate) {
			const pid = row.payload.patrolId;
			if (row.type === 'SetStatus') {
				if (row.prevStatus) await this.setStatus(pid, row.prevStatus);
			} else if (row.type === 'SetScore') {
				const prev = row.prevLocal;
				if (prev && prev.state === 'active') await this.saveScores(pid, [{ itemId: row.payload.itemId as string, value: prev.value, style: prev.style }]);
				else await this.voidPatrol(pid, [row.payload.itemId as string]);
			}
		}
	}

	/** Conflict resolution in the log: keep the server's value. */
	async keepServer(patrolId: string) {
		const db = this.db;
		await db.transaction('rw', db.scores, async () => {
			for (const it of this.items) {
				const key = scoreKey(this.slug, patrolId, it.id);
				const cur = await db.scores.get(key);
				if (!cur || (!cur.conflict && !cur.problem)) continue;
				const server =
					cur.conflict && cur.server
						? {
								...cur.server,
								points: cur.conflict.points,
								stylePoints: cur.conflict.stylePoints,
								version: cur.conflict.version,
								state: cur.conflict.state as 'active' | 'void'
							}
						: cur.server;
				await db.scores.put({ ...cur, server, local: null, conflict: null, problem: null });
			}
		});
		void this.syncNow();
	}

	/** Conflict resolution: send mine again on top of the server's current version. */
	async resendMine(patrolId: string) {
		const entries: SaveEntry[] = [];
		for (const it of this.items) {
			const s = this.scoreByKey.get(scoreKey(this.slug, patrolId, it.id));
			if (s?.local && s.conflict && s.local.state === 'active') entries.push({ itemId: it.id, value: s.local.value, style: s.local.style });
		}
		if (entries.length) await this.saveScores(patrolId, entries);
	}

	async markRead(messageId: string) {
		const db = this.db;
		const row = await db.packs.get(this.slug);
		if (row) await db.packs.put({ ...row, pack: { ...row.pack, messages: row.pack.messages.map((m) => (m.id === messageId ? { ...m, read: true } : m)) } });
		await db.reads.put({ key: `${this.slug}|${messageId}`, slug: this.slug, messageId });
		this.flushSoon(0);
	}

	async selectStation(stationId: string) {
		if (this.grant) await this.db.grants.update(this.slug, { stationId });
	}

	// ---------- sync loop ----------

	flushSoon(delay = FLUSH_DELAY_MS) {
		this.schedule(delay);
	}

	private schedule(delay: number) {
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.syncNow(), delay);
	}

	async syncNow() {
		if (!this.grant) return;
		// The browser knows it has no network: don't try (it would only wake the radio, and the failed
		// request is logged as an error). The 'online' event syncs at once; the regular check continues
		// meanwhile. ("Online" is no promise of a connection, so then we try and back off as usual.)
		if (typeof navigator !== 'undefined' && navigator.onLine === false) {
			this.online = false;
			this.schedule(TICK_MS);
			return;
		}
		const run = async () => {
			this.syncing = true;
			try {
				await this.engine.run();
				this.failures = 0;
				this.lastSyncAt = Date.now();
				this.lastFailedAt = null;
				this.online = true;
			} catch (e) {
				if (e instanceof AuthError) {
					this.authProblem = e.message;
					// No longer connected (expired, disconnected, new code): drop the patrol list, contact
					// phones, messages and sent reports. Unsent reports stay for a re-join.
					await forgetCompetition(this.slug, { keepUnsent: true });
				} else {
					this.failures++;
					this.lastFailedAt = Date.now();
					if (typeof navigator !== 'undefined' && !navigator.onLine) this.online = false;
				}
			} finally {
				this.syncing = false;
				const backoff = this.failures ? Math.min(TICK_MS * 2 ** (this.failures - 1), MAX_BACKOFF_MS) * (0.8 + Math.random() * 0.4) : TICK_MS;
				this.schedule(this.pendingRows.length && !this.failures ? Math.min(backoff, FLUSH_DELAY_MS) : backoff);
			}
		};
		const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
		// Another tab is syncing: try again shortly (its outbox is the same IndexedDB), never just stop.
		if (locks?.request) await locks.request(`st-sync-${this.slug}`, { ifAvailable: true }, async (lock) => (lock ? run() : this.schedule(TICK_MS)));
		else await run();
	}
}

/** A synced score as an undo target ("restore what the server had before my edit"). */
function serverAsLocal(s: LocalScore | undefined): LocalValue | null {
	if (!s?.server || s.server.state !== 'active') return null;
	return {
		value: s.server.raw.value,
		style: s.server.raw.style,
		points: s.server.points,
		stylePoints: s.server.stylePoints,
		state: 'active',
		at: Date.parse(s.server.at),
		commandId: ''
	};
}

// ---------- forgetting ----------

/** A week after the grant expired the phone forgets the competition on its own. */
const FORGET_AFTER_MS = 7 * 86400_000;

/**
 * Removes what the phone holds about a competition: patrol list (with contact phones on the desk),
 * scores, statuses, messages, sent reports. `keepUnsent`: reports not yet accepted stay (and the
 * grant, so the volunteer can re-join and send them); otherwise everything, grant included, goes.
 */
export async function forgetCompetition(slug: string, { keepUnsent }: { keepUnsent: boolean }) {
	const db = fieldDb();
	await db.transaction('rw', [db.packs, db.scores, db.statuses, db.reads, db.outbox, db.grants], async () => {
		await db.packs.delete(slug);
		await db.scores.where('slug').equals(slug).delete();
		await db.statuses.where('slug').equals(slug).delete();
		await db.reads.where('slug').equals(slug).delete();
		if (keepUnsent)
			await db.outbox
				.where('slug')
				.equals(slug)
				.and((r) => r.state !== 'pending')
				.delete();
		else {
			await db.outbox.where('slug').equals(slug).delete();
			await db.grants.delete(slug);
		}
	});
}

// ---------- joining ----------

export async function storeJoin(input: {
	slug: string;
	grant: string;
	deviceId: string;
	privateKey: CryptoKey;
	publicJwk: JsonWebKey;
	displayName: string;
	role: GrantRow['role'];
	stations: string[];
	exp: number;
}) {
	const db = fieldDb();
	const old = await db.grants.get(input.slug);
	await db.grants.put({ ...input, nextSeq: 1, lastHash: null, joinedAt: Date.now(), stationId: input.stations.length === 1 ? input.stations[0] : null });
	if (old && old.deviceId !== input.deviceId) {
		// Re-join (expired grant, new code): reports still waiting were maybe signed by the OLD key. The
		// server checks signatures against the new device and would reject them for good, so drop the
		// old signature: they are signed again by the new key and sent. Reports made well before this
		// join end up in HQ's review (clock check), never lost.
		await db.outbox
			.where('[slug+state]')
			.equals([input.slug, 'pending'])
			.modify((row) => {
				delete row.jws;
				delete row.deviceSeq;
			});
	}
	await db.packs.delete(input.slug);
}

// ---------- context ----------

const KEY = Symbol('field-app');
export const provideField = (app: FieldApp) => setContext(KEY, app);
export const useField = () => getContext<FieldApp>(KEY);

// ---------- formatting ----------

export const hhmm = (t: number | string | null | undefined) =>
	t == null ? '' : new Date(t).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });

export function shortTroop(troop: string): string {
	return troop.replace(/s? (sjö)?scoutkår$/i, '').replace(/ scoutkår$/i, '');
}

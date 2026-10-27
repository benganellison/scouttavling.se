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
import { MAX_BATCH, sha256b64url, signCommand, uuidv7, type CommandBody, type CommandResult, type PatrolStatus } from './protocol.ts';

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
	rejectedCount = $derived(this.scores.filter((s) => !s.conflict && s.problem).length + this.outbox.filter((o) => o.type === 'SetStatus' && o.state === 'rejected' && this.statusOverride.get(o.payload.patrolId)?.commandId === o.commandId).length);
	/** The organiser closed the competition: the server no longer accepts reports. */
	closed = $derived(this.pack?.competition.status === 'closed');
	unreadCount = $derived((this.pack?.messages ?? []).filter((m) => !m.read).length);

	private timer: ReturnType<typeof setTimeout> | null = null;
	private failures = 0;
	private subs: { unsubscribe(): void }[] = [];
	private cleanup: (() => void)[] = [];
	private db = fieldDb();

	constructor(slug: string) {
		this.slug = slug;
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
			points: s.server.points, stylePoints: s.server.stylePoints, raw: s.server.raw, state: s.server.state, at: Date.parse(s.server.at),
			by: s.server.by, version: s.server.version, sync: s.conflict ? 'conflict' : s.problem ? 'problem' : 'synced'
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
	manualItems = $derived(this.items.filter((i) => i.mode !== 'AUTO_ON_SCAN'));

	/** The patrol's result at this station across all items, or null if not (fully) reported. */
	stationResult(patrolId: string) {
		const items = this.items;
		if (!items.length) return null;
		let points = 0;
		let style = 0;
		let at = 0;
		let by = '';
		let sync: DisplayScore['sync'] = 'synced';
		const rank = { synced: 0, pending: 1, review: 2, problem: 3, conflict: 4 };
		for (const it of items) {
			const d = this.display(patrolId, it.id);
			if (!d || d.state !== 'active') return null;
			points += d.points;
			style += d.stylePoints;
			if (d.at > at) {
				at = d.at;
				by = d.by;
			}
			if (rank[d.sync] > rank[sync]) sync = d.sync;
		}
		return { points, style, total: points + style, at, by, sync };
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
					commandId, slug: this.slug, groupId, createdAt: now + i, type: 'SetScore', state: 'pending',
					payload: { patrolId, itemId: e.itemId, value: e.value, style: def.styleEnabled ? e.style : null, ...(e.note ? { note: e.note } : {}) },
					...this.baseFor(cur), prevLocal: cur?.local ?? serverAsLocal(cur)
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
					commandId, slug: this.slug, groupId, createdAt: now + i, type: 'VoidScore', state: 'pending',
					payload: { patrolId, itemId }, ...this.baseFor(cur), prevLocal: cur.local
				});
				const base = cur.local ?? { value: cur.server!.raw.value, style: cur.server!.raw.style, points: cur.server!.points, stylePoints: cur.server!.stylePoints };
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
				commandId, slug: this.slug, groupId, createdAt: now, type: 'SetStatus', state: 'pending', payload: { patrolId, status },
				baseVersion: null, baseFrom: null, prevStatus
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
				const server = cur.conflict && cur.server ? { ...cur.server, points: cur.conflict.points, stylePoints: cur.conflict.stylePoints, version: cur.conflict.version, state: cur.conflict.state as 'active' | 'void' } : cur.server;
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
		const run = async () => {
			this.syncing = true;
			try {
				await this.push();
				await this.flushReads();
				await this.pull();
				this.failures = 0;
				this.lastSyncAt = Date.now();
				this.lastFailedAt = null;
				this.online = true;
			} catch (e) {
				if (e instanceof AuthError) this.authProblem = e.message;
				else {
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

	private headers(): HeadersInit {
		return { authorization: `Grant ${this.grant!.grant}`, 'content-type': 'application/json' };
	}

	private async request(path: string, init?: RequestInit): Promise<Response> {
		const res = await fetch(`/api/v1/field/${this.slug}${path}`, { ...init, headers: this.headers(), cache: 'no-store' });
		if (res.status === 401) {
			const body = await res.json().catch(() => ({ message: '' }));
			throw new AuthError(authMessage(String(body.message ?? '')));
		}
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return res;
	}

	/** Signs pending commands in order and sends them, ≤100 per batch. */
	private async push() {
		const db = this.db;
		for (let round = 0; round < 20; round++) {
			const pending = await db.outbox.where('[slug+state]').equals([this.slug, 'pending']).sortBy('createdAt');
			if (!pending.length) return;
			const batch: string[] = [];
			for (const row of pending.slice(0, MAX_BATCH)) {
				if (!row.jws) {
					let baseVersion = row.baseVersion;
					if (row.baseFrom) {
						const ref = await db.outbox.get(row.baseFrom);
						const r = ref?.result;
						// Wait for the earlier command's result, but only for THIS row: with a clock that stepped back
						// the earlier one can sort after this one, and stopping here would block it (and all later
						// reports) forever. It is signed and sent in this round; this row follows in the next one.
						if (ref && !r) continue;
						if (r && (r.result === 'accepted' || r.result === 'duplicate') && r.version !== undefined) baseVersion = r.version;
						else if (r?.result === 'conflict') baseVersion = r.server.version;
					}
					const signed = await this.sign(row, baseVersion);
					if (!signed) continue;
					row.jws = signed;
				}
				batch.push(row.jws);
			}
			if (!batch.length) return;
			const res = await this.request('/sync/commands', { method: 'POST', body: JSON.stringify({ commands: batch }) });
			const { results } = (await res.json()) as { results: CommandResult[] };
			await this.applyResults(results);
		}
	}

	private async sign(row: OutboxRow, baseVersion: number | null): Promise<string | null> {
		const db = this.db;
		const grant = (await db.grants.get(this.slug))!;
		const body = {
			commandId: row.commandId, deviceId: grant.deviceId, deviceSeq: grant.nextSeq, baseVersion,
			type: row.type, payload: row.payload, clientNow: new Date(row.createdAt).toISOString(), prev: grant.lastHash
		} as CommandBody;
		const jws = await signCommand(grant.privateKey, body);
		const hash = await sha256b64url(jws);
		let ok = false;
		await db.transaction('rw', db.grants, db.outbox, async () => {
			const g = await db.grants.get(this.slug);
			const cur = await db.outbox.get(row.commandId);
			if (!g || !cur || cur.jws || g.nextSeq !== grant.nextSeq) return; // undone meanwhile
			await db.grants.update(this.slug, { nextSeq: g.nextSeq + 1, lastHash: hash });
			await db.outbox.update(row.commandId, { jws, deviceSeq: body.deviceSeq, baseVersion, sentAt: Date.now() });
			ok = true;
		});
		return ok ? jws : null;
	}

	private async applyResults(results: CommandResult[]) {
		const db = this.db;
		await db.transaction('rw', db.outbox, db.scores, db.statuses, db.packs, async () => {
			for (const r of results) {
				const row = await db.outbox.get(r.commandId);
				if (!row) continue;
				await db.outbox.update(row.commandId, { state: r.result, result: r });
				if (row.type === 'SetStatus') {
					if (r.result === 'accepted' || r.result === 'duplicate') {
						const pr = await db.packs.get(this.slug);
						if (pr) {
							const patrols = pr.pack.patrols.map((p) => (p.id === row.payload.patrolId ? { ...p, status: row.payload.status as PatrolStatus } : p));
							await db.packs.put({ ...pr, pack: { ...pr.pack, patrols } });
						}
						const k = `${this.slug}|${row.payload.patrolId}`;
						const st = await db.statuses.get(k);
						if (st?.commandId === row.commandId) await db.statuses.delete(k);
					}
					continue;
				}
				const key = scoreKey(this.slug, row.payload.patrolId, row.payload.itemId as string);
				const cur = await db.scores.get(key);
				if (!cur) continue;
				const mine = cur.local?.commandId === row.commandId;
				if (r.result === 'accepted' || r.result === 'duplicate') {
					if (!mine) continue;
					const l = cur.local!;
					await db.scores.put({
						...cur,
						server: {
							points: l.points, stylePoints: l.stylePoints, raw: { value: l.value, style: l.style }, state: l.state,
							version: r.version ?? cur.server?.version ?? 1, at: new Date(l.at).toISOString(), by: this.grant?.displayName ?? '', mine: true
						},
						local: null, conflict: null, problem: null
					});
				} else if (r.result === 'conflict') {
					if (mine) await db.scores.put({ ...cur, conflict: r.server });
				} else if (r.result === 'rejected') {
					if (mine) await db.scores.put({ ...cur, problem: r.reason });
				}
			}
		});
	}

	private async flushReads() {
		const db = this.db;
		const reads = await db.reads.where('slug').equals(this.slug).toArray();
		for (const r of reads) {
			try {
				await this.request('/messages/read', { method: 'POST', body: JSON.stringify({ messageId: r.messageId }) });
			} catch (e) {
				if (!(e instanceof Error && e.message === 'HTTP 404')) throw e;
			}
			await db.reads.delete(r.key);
		}
	}

	async pull() {
		const db = this.db;
		const since = this.packRow?.cursor;
		const t0 = Date.now();
		const res = await this.request(`/snapshot${since !== undefined ? `?since=${since}` : ''}`);
		const snap = (await res.json()) as Pack | { unchanged: true; cursor: number; serverTime: string };
		const t1 = Date.now();
		const offsetMs = Date.parse(snap.serverTime) - (t0 + t1) / 2;
		const cur = await db.packs.get(this.slug);
		if (snap.unchanged) {
			if (cur) await db.packs.update(this.slug, { offsetMs, fetchedAt: t1 });
			return;
		}
		const pack = snap as Pack;
		await db.transaction('rw', db.packs, db.scores, async () => {
			await db.packs.put({ slug: this.slug, pack, cursor: pack.cursor, fetchedAt: t1, offsetMs });
			for (const s of pack.scores) {
				const key = scoreKey(this.slug, s.patrolId, s.itemId);
				const local = await db.scores.get(key);
				const server = { points: s.points, stylePoints: s.stylePoints, raw: s.raw, state: s.state, version: s.version, at: s.at, by: s.by, mine: s.mine };
				await db.scores.put({ key, slug: this.slug, patrolId: s.patrolId, itemId: s.itemId, server, local: local?.local ?? null, conflict: local?.conflict ?? null, problem: local?.problem ?? null });
			}
		});
	}
}

class AuthError extends Error {}

/** A synced score as an undo target ("restore what the server had before my edit"). */
function serverAsLocal(s: LocalScore | undefined): LocalValue | null {
	if (!s?.server || s.server.state !== 'active') return null;
	return { value: s.server.raw.value, style: s.server.raw.style, points: s.server.points, stylePoints: s.server.stylePoints, state: 'active', at: Date.parse(s.server.at), commandId: '' };
}

function authMessage(raw: string): string {
	if (raw.startsWith('grant_expired')) return 'Behörigheten har gått ut. Skanna inbjudan igen. Osända rapporter finns kvar i telefonen.';
	if (raw.startsWith('grant_')) return 'Telefonen är inte längre kopplad till kontrollen. Skanna inbjudan igen.';
	return raw || 'Behörigheten fungerar inte';
}

// ---------- joining ----------

export async function storeJoin(input: {
	slug: string; grant: string; deviceId: string; privateKey: CryptoKey; publicJwk: JsonWebKey; displayName: string;
	role: GrantRow['role']; stations: string[]; exp: number;
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

export function totalLabel(points: number, style: number, styleOn: boolean): string {
	return styleOn ? `${points} + ${style} p` : `${points} p`;
}

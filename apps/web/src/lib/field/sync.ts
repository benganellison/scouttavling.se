/**
 * The field app's sync engine (03 §3.4, contract C1): signs pending commands in order, sends them,
 * applies the server's results to the local projection, sends read receipts and pulls the station
 * pack. Everything it needs is in IndexedDB (`db`) plus the transport (`fetch`), so it can be tested
 * with fake-indexeddb and a stub fetch (sync.test.ts). Scheduling, backoff and UI state stay in
 * FieldApp (app.svelte.ts).
 */
import { MAX_BATCH, sha256b64url, signCommand, type CommandBody, type CommandResult, type PatrolStatus } from './protocol.ts';
import { scoreKey, type FieldDB, type OutboxRow, type Pack } from './db.ts';

/** The grant no longer works (expired, disconnected, replaced): the UI asks the volunteer to re-join. */
export class AuthError extends Error {}

export class SyncEngine {
	constructor(
		private db: FieldDB,
		private slug: string,
		private fetch: typeof globalThis.fetch = (...a) => globalThis.fetch(...a)
	) {}

	/** One full round: push, read receipts, pull, prune. Throws AuthError or a network error. */
	async run() {
		await this.push();
		await this.flushReads();
		await this.pull();
		await this.pruneOutbox();
	}

	async request(path: string, init?: RequestInit): Promise<Response> {
		const grant = await this.db.grants.get(this.slug);
		if (!grant) throw new AuthError('Telefonen är inte kopplad till kontrollen. Skanna inbjudan igen.');
		const res = await this.fetch(`/api/v1/field/${this.slug}${path}`, {
			...init,
			headers: { authorization: `Grant ${grant.grant}`, 'content-type': 'application/json' },
			cache: 'no-store'
		});
		if (res.status === 401) {
			const body = await res.json().catch(() => ({ message: '' }));
			throw new AuthError(authMessage(String(body.message ?? '')));
		}
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return res;
	}

	/** Signs pending commands in order and sends them, ≤100 per batch. */
	async push() {
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

	async sign(row: OutboxRow, baseVersion: number | null): Promise<string | null> {
		const db = this.db;
		const grant = (await db.grants.get(this.slug))!;
		const body = {
			commandId: row.commandId,
			deviceId: grant.deviceId,
			deviceSeq: grant.nextSeq,
			baseVersion,
			type: row.type,
			payload: row.payload,
			clientNow: new Date(row.createdAt).toISOString(),
			prev: grant.lastHash
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

	/**
	 * Settled reports (accepted or duplicate) older than two hours leave the outbox: it is reread on
	 * every change, and after a long day it would hold thousands of signed rows. Kept: everything that
	 * still needs attention (pending, conflict, rejected, quarantined) and any row a waiting report
	 * builds on (its result is that report's version base).
	 */
	async pruneOutbox() {
		const db = this.db;
		const cutoff = Date.now() - 2 * 3600_000;
		await db.transaction('rw', db.outbox, async () => {
			const rows = await db.outbox.where('slug').equals(this.slug).toArray();
			const needed = new Set(rows.filter((r) => r.state === 'pending' && r.baseFrom).map((r) => r.baseFrom!));
			const old = rows.filter((r) => (r.state === 'accepted' || r.state === 'duplicate') && r.createdAt < cutoff && !needed.has(r.commandId));
			if (old.length) await db.outbox.bulkDelete(old.map((r) => r.commandId));
		});
	}

	async applyResults(results: CommandResult[]) {
		const db = this.db;
		const displayName = (await db.grants.get(this.slug))?.displayName ?? '';
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
							points: l.points,
							stylePoints: l.stylePoints,
							raw: { value: l.value, style: l.style },
							state: l.state,
							version: r.version ?? cur.server?.version ?? 1,
							at: new Date(l.at).toISOString(),
							by: displayName,
							mine: true
						},
						local: null,
						conflict: null,
						problem: null
					});
				} else if (r.result === 'conflict') {
					if (mine) await db.scores.put({ ...cur, conflict: r.server });
				} else if (r.result === 'rejected') {
					if (mine) await db.scores.put({ ...cur, problem: r.reason });
				}
			}
		});
	}

	async flushReads() {
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
		const since = (await db.packs.get(this.slug))?.cursor;
		const t0 = Date.now();
		const res = await this.request(`/snapshot${since !== undefined ? `?since=${since}` : ''}`);
		const snap = (await res.json()) as Pack | { unchanged: true; cursor: number; serverTime: string };
		const t1 = Date.now();
		const offsetMs = Date.parse(snap.serverTime) - (t0 + t1) / 2;
		const cur = await db.packs.get(this.slug);
		if (snap.unchanged) {
			// Nothing that concerns this phone changed: move the cursor on, so the next check starts here.
			if (cur) await db.packs.update(this.slug, { offsetMs, fetchedAt: t1, cursor: Math.max(cur.cursor, snap.cursor) });
			return;
		}
		const pack = snap as Pack;
		await db.transaction('rw', db.packs, db.scores, async () => {
			await db.packs.put({ slug: this.slug, pack, cursor: pack.cursor, fetchedAt: t1, offsetMs });
			// Only rows that changed: rewriting all of them on every pack re-renders the whole station.
			const existing = new Map((await db.scores.where('slug').equals(this.slug).toArray()).map((r) => [r.key, r]));
			const changed = [];
			for (const s of pack.scores) {
				const key = scoreKey(this.slug, s.patrolId, s.itemId);
				const local = existing.get(key);
				if (local?.server && local.server.version === s.version && local.server.state === s.state && local.server.by === s.by) continue;
				const server = { points: s.points, stylePoints: s.stylePoints, raw: s.raw, state: s.state, version: s.version, at: s.at, by: s.by, mine: s.mine };
				changed.push({
					key,
					slug: this.slug,
					patrolId: s.patrolId,
					itemId: s.itemId,
					server,
					local: local?.local ?? null,
					conflict: local?.conflict ?? null,
					problem: local?.problem ?? null
				});
			}
			if (changed.length) await db.scores.bulkPut(changed);
		});
	}
}

function authMessage(raw: string): string {
	if (raw.startsWith('grant_expired')) return 'Behörigheten har gått ut. Skanna inbjudan igen. Osända rapporter finns kvar i telefonen.';
	if (raw.startsWith('grant_')) return 'Telefonen är inte längre kopplad till kontrollen. Skanna inbjudan igen.';
	return raw || 'Behörigheten fungerar inte';
}

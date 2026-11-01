/*
 * Realtime: ONE LISTEN connection per process, fan-out per competition, plus a 3 s poll while anyone
 * is subscribed (the change_log cursor is the only truth), and the text/event-stream responses.
 */
import { and, asc, eq, gt } from 'drizzle-orm';
import postgres from 'postgres';
import { DATABASE_URL } from '$app/env/private';
import { db, schema } from './db/index.ts';
import { latestSeq } from './changes.ts';

export interface ChangeRow {
	seq: number;
	kind: string;
	entityId: string | null;
	at: Date;
}

export interface Subscriber {
	cursor: number;
	deliver(rows: ChangeRow[]): void;
}

class Hub {
	subs = new Map<string, Set<Subscriber>>();
	private listener: postgres.Sql | null = null;
	private poll: ReturnType<typeof setInterval> | null = null;
	private pumping = new Map<string, Promise<void>>();
	private again = new Set<string>();

	subscribe(competitionId: string, sub: Subscriber): () => void {
		const set = this.subs.get(competitionId) ?? new Set();
		set.add(sub);
		this.subs.set(competitionId, set);
		this.ensureRunning();
		void this.pump(competitionId);
		return () => {
			set.delete(sub);
			if (set.size === 0) this.subs.delete(competitionId);
			if (this.subs.size === 0) this.stopPoll();
		};
	}

	private ensureRunning() {
		if (!this.listener) {
			this.listener = postgres(DATABASE_URL, { max: 1, idle_timeout: 0, onnotice: () => {} });
			this.listener
				.listen(
					'changes',
					(payload) => {
						try {
							const { c } = JSON.parse(payload) as { c: string };
							if (this.subs.has(c)) void this.pump(c);
						} catch {
							/* malformed hint: the poll covers it */
						}
					},
					// (Re)connected: catch up everyone from their cursor.
					() => this.pumpAll()
				)
				.catch((e) => console.error('[live] LISTEN failed, relying on poll', e));
		}
		if (!this.poll) this.poll = setInterval(() => this.pumpAll(), 3000);
	}

	/** On shutdown: stop polling and drop the LISTEN connection so the process can exit. */
	async close() {
		this.stopPoll();
		const l = this.listener;
		this.listener = null;
		await l?.end({ timeout: 5 });
	}

	private stopPoll() {
		if (this.poll) clearInterval(this.poll);
		this.poll = null;
	}

	private pumpAll() {
		for (const c of this.subs.keys()) void this.pump(c);
	}

	/** Reads change_log after the lowest cursor once and hands each subscriber its tail. Serialised per competition. */
	pump(competitionId: string): Promise<void> {
		const running = this.pumping.get(competitionId);
		if (running) {
			this.again.add(competitionId);
			return running;
		}
		const p = (async () => {
			try {
				do {
					this.again.delete(competitionId);
					const set = this.subs.get(competitionId);
					if (!set || set.size === 0) return;
					const from = Math.min(...[...set].map((s) => s.cursor));
					const rows = await db
						.select({ seq: schema.changeLog.seq, kind: schema.changeLog.kind, entityId: schema.changeLog.entityId, at: schema.changeLog.at })
						.from(schema.changeLog)
						.where(and(eq(schema.changeLog.competitionId, competitionId), gt(schema.changeLog.seq, from)))
						.orderBy(asc(schema.changeLog.seq))
						.limit(500);
					for (const s of set) {
						const tail = rows.filter((r) => r.seq > s.cursor);
						if (tail.length) {
							s.cursor = tail[tail.length - 1].seq;
							try {
								s.deliver(tail);
							} catch {
								/* closed stream; its cleanup unsubscribes */
							}
						}
					}
					if (rows.length === 500) this.again.add(competitionId);
				} while (this.again.has(competitionId));
			} catch (e) {
				console.error('[live] pump failed', e);
			} finally {
				this.pumping.delete(competitionId);
			}
		})();
		this.pumping.set(competitionId, p);
		return p;
	}
}

const g = globalThis as unknown as { __liveHub?: Hub };
export const hub: Hub = (g.__liveHub ??= new Hub());

const HEARTBEAT_MS = 20_000;
const MAX_STREAM_MS = 55 * 60_000;

/** Cursor from Last-Event-ID (reconnect) or ?since=, else "from now". */
export async function cursorFrom(request: Request, url: URL, competitionId: string): Promise<number> {
	const raw = request.headers.get('last-event-id') ?? url.searchParams.get('since');
	const n = raw !== null ? Number(raw) : NaN;
	return Number.isFinite(n) && n >= 0 ? n : latestSeq(competitionId);
}

/**
 * Builds a text/event-stream response. `onRows` turns change rows into SSE
 * frames (return '' to skip). The stream ends itself after ~55 min; the
 * client's EventSource resumes with Last-Event-ID.
 */
export function sseResponse(
	request: Request,
	competitionId: string,
	cursor: number,
	onRows: (rows: ChangeRow[], send: (frame: string) => void) => void | Promise<void>,
	onOpen?: (send: (frame: string) => void) => void,
	onClose?: () => void
): Response {
	const enc = new TextEncoder();
	let cleanup = () => {};
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			let closed = false;
			const send = (frame: string) => {
				if (closed || !frame) return;
				try {
					controller.enqueue(enc.encode(frame));
				} catch {
					cleanup();
				}
			};
			send(`retry: 3000\n: cursor ${cursor}\n\n`);
			onOpen?.(send);
			const unsubscribe = hub.subscribe(competitionId, {
				cursor,
				deliver: (rows) => {
					void Promise.resolve(onRows(rows, send)).catch((e) => console.error('[live] sse', e));
				}
			});
			const beat = setInterval(() => send(`: hb ${Date.now()}\n\n`), HEARTBEAT_MS);
			const end = setTimeout(() => cleanup(), MAX_STREAM_MS);
			cleanup = () => {
				if (closed) return;
				closed = true;
				onClose?.();
				clearInterval(beat);
				clearTimeout(end);
				unsubscribe();
				try {
					controller.close();
				} catch {
					/* already closed */
				}
			};
			request.signal.addEventListener('abort', () => cleanup());
		},
		cancel() {
			cleanup();
		}
	});
	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream; charset=utf-8',
			'cache-control': 'no-cache, no-transform',
			'x-accel-buffering': 'no'
		}
	});
}

export const frame = (event: string, id: number | null, data: unknown) =>
	`${id !== null ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/**
 * Open public streams, per client address and in total. A stream costs a connection and work after
 * every change, so one client cannot hold thousands open (the admin stream needs a login).
 */
const streams = { total: 0, byClient: new Map<string, number>() };
// perClient is high on purpose: mobile operators put many users behind one IPv4 address (CGNAT),
// and a whole camp may share one Wi-Fi address. The total cap protects the server.
export const STREAM_LIMITS = { perClient: 200, total: 4000 };
/** Reserves a slot for a public stream; null when over a limit. Call the returned release on close. */
export function acquireStream(client: string): (() => void) | null {
	const mine = streams.byClient.get(client) ?? 0;
	if (mine >= STREAM_LIMITS.perClient || streams.total >= STREAM_LIMITS.total) return null;
	streams.byClient.set(client, mine + 1);
	streams.total++;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		streams.total--;
		const n = (streams.byClient.get(client) ?? 1) - 1;
		if (n <= 0) streams.byClient.delete(client);
		else streams.byClient.set(client, n);
	};
}

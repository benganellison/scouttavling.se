import { error } from '@sveltejs/kit';
import { refuseIfDraft, refuseIfSuspended } from '#lib/server/suspended.ts';
import { eq } from 'drizzle-orm';
import { db, schema } from '#lib/server/db/index.ts';
import { acquireStream, cursorFrom, frame, getResults, publicTracks, showStationResults, sseResponse } from '#lib/server/live.ts';

const PUBLIC_KINDS = new Set(['score', 'patrol', 'competition', 'station']);
const COALESCE_MS = 10_000;

/** Rebuild the shared frame at most this often, however many streams ask for a newer one. */
const REBUILD_MS = 2_000;

/**
 * One frame per competition, shared by every open stream: with a thousand parents watching, results
 * are computed and serialised once, not once per viewer. Rebuilt when a stream needs a newer change
 * than the frame has, at most every REBUILD_MS. null = no longer public.
 */
const shared = new Map<string, { at: number; seq: number; frame: Promise<string | null> }>();
function sharedFrame(competitionId: string, wantSeq: number): Promise<string | null> {
	const hit = shared.get(competitionId);
	const age = hit ? Date.now() - hit.at : Infinity;
	if (hit && (age < REBUILD_MS || (hit.seq >= wantSeq && age < COALESCE_MS))) return hit.frame;
	const entry: { at: number; seq: number; frame: Promise<string | null> } = { at: Date.now(), seq: hit?.seq ?? 0, frame: Promise.resolve(null) };
	entry.frame = (async () => {
		// Fresh settings every time: results are cached per change number, so computing with the row
		// from when a stream opened (e.g. style switched off since) would poison the cache.
		const [fresh] = await db.select().from(schema.competition).where(eq(schema.competition.id, competitionId));
		if (!fresh?.publicResults) return null;
		const res = await getResults(fresh, 0);
		entry.seq = res.seq;
		return frame('results', res.seq, { seq: res.seq, tracks: publicTracks(res.tracks, showStationResults(fresh)) });
	})();
	shared.set(competitionId, entry);
	entry.frame.catch(() => shared.get(competitionId) === entry && shared.delete(competitionId));
	return entry.frame;
}

/**
 * Public results stream. Not pushed per score: a coalescer emits the whole
 * (small) table at most every 10 s. No session needed, only publicResults.
 */
export async function GET({ params, request, url, locals, getClientAddress }) {
	const [comp] = await db.select().from(schema.competition).where(eq(schema.competition.slug, params.slug)).limit(1);
	if (!comp || !comp.publicResults) error(404, 'Resultaten är inte publicerade');
	refuseIfSuspended(comp);
	await refuseIfDraft(comp, locals.user?.id);
	const cursor = await cursorFrom(request, url, comp.id);
	// Limit open streams per client and in total (the page falls back to its own reconnect/poll).
	const release = acquireStream(getClientAddress());
	if (!release) return new Response('För många öppna anslutningar', { status: 429, headers: { 'retry-after': '30' } });
	let timer: ReturnType<typeof setTimeout> | null = null;
	let lastEmit = 0;
	let pendingSeq = cursor;
	return sseResponse(
		request,
		comp.id,
		cursor,
		(rows, send) => {
			const relevant = rows.filter((r) => PUBLIC_KINDS.has(r.kind));
			pendingSeq = rows[rows.length - 1].seq;
			if (relevant.length === 0 || timer) return;
			const emit = async () => {
				timer = null;
				lastEmit = Date.now();
				const f = await sharedFrame(comp.id, pendingSeq);
				send(f ?? frame('closed', pendingSeq, {}));
			};
			timer = setTimeout(emit, Math.max(0, lastEmit + COALESCE_MS - Date.now()));
		},
		undefined,
		() => {
			if (timer) clearTimeout(timer);
			release();
		}
	);
}

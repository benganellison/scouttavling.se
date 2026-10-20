import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db, schema } from '#lib/server/db/index.ts';
import { cursorFrom, frame, getResults, publicTracks, sseResponse } from '#lib/server/live.ts';

const PUBLIC_KINDS = new Set(['score', 'patrol', 'competition', 'station']);
const COALESCE_MS = 10_000;

/**
 * Public results stream. Not pushed per score: a coalescer emits the whole
 * (small) table at most every 10 s. No session needed, only publicResults.
 */
export async function GET({ params, request, url }) {
	const [comp] = await db.select().from(schema.competition).where(eq(schema.competition.slug, params.slug)).limit(1);
	if (!comp || !comp.publicResults) error(404, 'Resultaten är inte publicerade');
	const cursor = await cursorFrom(request, url, comp.id);
	let timer: ReturnType<typeof setTimeout> | null = null;
	let lastEmit = 0;
	let pendingSeq = cursor;
	return sseResponse(request, comp.id, cursor, (rows, send) => {
		const relevant = rows.filter((r) => PUBLIC_KINDS.has(r.kind));
		pendingSeq = rows[rows.length - 1].seq;
		if (relevant.length === 0 || timer) return;
		const emit = async () => {
			timer = null;
			lastEmit = Date.now();
			const [fresh] = await db.select({ publicResults: schema.competition.publicResults }).from(schema.competition).where(eq(schema.competition.id, comp.id));
			if (!fresh?.publicResults) return send(frame('closed', pendingSeq, {}));
			const res = await getResults(comp, 0);
			send(frame('results', pendingSeq, { seq: res.seq, tracks: publicTracks(res.tracks) }));
		};
		timer = setTimeout(emit, Math.max(0, lastEmit + COALESCE_MS - Date.now()));
	});
}

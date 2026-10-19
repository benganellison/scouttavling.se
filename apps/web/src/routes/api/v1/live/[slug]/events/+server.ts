import { error } from '@sveltejs/kit';
import { requireCompetition } from '#lib/server/auth.ts';
import { cursorFrom, frame, sseResponse } from '#lib/server/live.ts';

/**
 * Organiser change feed (SSE). Streams change_log rows after the cursor
 * (Last-Event-ID or ?since=). Clients refetch what they show on each event.
 */
export async function GET(event) {
	if (!event.locals.user) error(401, 'Logga in först');
	const { comp } = await requireCompetition(event, event.params.slug);
	const cursor = await cursorFrom(event.request, event.url, comp.id);
	return sseResponse(
		event.request,
		comp.id,
		cursor,
		(rows, send) => {
			for (const r of rows) send(frame('change', r.seq, { seq: r.seq, kind: r.kind, entityId: r.entityId }));
		},
		(send) => send(frame('ready', null, { seq: cursor }))
	);
}

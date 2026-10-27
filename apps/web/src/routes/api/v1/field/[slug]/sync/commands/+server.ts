import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateDevice, syncCommands } from '#lib/server/field.ts';
import { MAX_BATCH } from '#lib/field/protocol.ts';

/**
 * Writes in one competition are serialised by its change_seq lock anyway; more than two syncs at once
 * only hold pool connections while they wait. Extra phones get 503 and retry with their backoff.
 */
const MAX_CONCURRENT_SYNCS = 2;
const running = new Map<string, number>();

/** C1 push: `{commands: string[]}` of device-signed JWS, ≤100, one result per command. */
export const POST: RequestHandler = async ({ request, params }) => {
	const ctx = await authenticateDevice(request, params.slug);
	let body: { commands?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ message: 'Ogiltig begäran' }, { status: 400 });
	}
	const list = body.commands;
	if (!Array.isArray(list) || list.some((c) => typeof c !== 'string' || c.length > 8192)) return json({ message: 'commands måste vara en lista av JWS' }, { status: 400 });
	if (list.length > MAX_BATCH) return json({ message: `Högst ${MAX_BATCH} kommandon per anrop` }, { status: 413 });
	const key = ctx.comp.id;
	if ((running.get(key) ?? 0) >= MAX_CONCURRENT_SYNCS) {
		return json({ message: 'Upptaget, försöker igen strax' }, { status: 503, headers: { 'retry-after': '3', 'cache-control': 'no-store' } });
	}
	running.set(key, (running.get(key) ?? 0) + 1);
	try {
		return json(await syncCommands(ctx, list as string[]), { headers: { 'cache-control': 'no-store' } });
	} finally {
		const n = (running.get(key) ?? 1) - 1;
		if (n <= 0) running.delete(key);
		else running.set(key, n);
	}
};

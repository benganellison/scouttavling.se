import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateDevice } from '#lib/server/field/device.ts';
import { syncCommands } from '#lib/server/field/commands.ts';
import { MAX_BATCH } from '#lib/field/protocol.ts';

/**
 * Writes in one competition are serialised by its change_seq lock anyway; many syncs at once only hold
 * pool connections while they wait. Three limits, so no single phone can starve the others:
 * - one sync at a time per device (a phone looping in parallel only competes with itself);
 * - at most MAX_PER_COMPETITION at once for working phones;
 * - disconnected, superseded and expired phones (which can only quarantine) share ONE slot of their own.
 * Over a limit: 503, and the phone retries with its backoff (reports stay in its outbox).
 */
const MAX_PER_COMPETITION = 4;
const MAX_INACTIVE_PER_COMPETITION = 1;
const running = new Map<string, number>();
const busyDevices = new Set<string>();

const take = (key: string, max: number) => {
	const n = running.get(key) ?? 0;
	if (n >= max) return false;
	running.set(key, n + 1);
	return true;
};
const give = (key: string) => {
	const n = (running.get(key) ?? 1) - 1;
	if (n <= 0) running.delete(key);
	else running.set(key, n);
};
const busy = () => json({ message: 'Upptaget, försöker igen strax' }, { status: 503, headers: { 'retry-after': '3', 'cache-control': 'no-store' } });

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
	if (!Array.isArray(list) || list.some((c) => typeof c !== 'string' || c.length > 8192))
		return json({ message: 'commands måste vara en lista av JWS' }, { status: 400 });
	if (list.length > MAX_BATCH) return json({ message: `Högst ${MAX_BATCH} kommandon per anrop` }, { status: 413 });
	const inactive = ctx.revoked || ctx.superseded || ctx.claims.exp * 1000 < Date.now();
	const key = `${ctx.comp.id}:${inactive ? 'inactive' : 'active'}`;
	if (busyDevices.has(ctx.device.id)) return busy();
	if (!take(key, inactive ? MAX_INACTIVE_PER_COMPETITION : MAX_PER_COMPETITION)) return busy();
	busyDevices.add(ctx.device.id);
	try {
		return json(await syncCommands(ctx, list as string[]), { headers: { 'cache-control': 'no-store' } });
	} finally {
		busyDevices.delete(ctx.device.id);
		give(key);
	}
};

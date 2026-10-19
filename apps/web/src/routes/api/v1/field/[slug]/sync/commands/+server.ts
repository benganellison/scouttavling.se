import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateDevice, syncCommands } from '#lib/server/field.ts';
import { MAX_BATCH } from '#lib/field/protocol.ts';

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
	return json(await syncCommands(ctx, list as string[]), { headers: { 'cache-control': 'no-store' } });
};

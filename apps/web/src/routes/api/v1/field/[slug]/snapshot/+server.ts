import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateDevice, buildSnapshot } from '#lib/server/field.ts';

/** Station pack (C1 pull). `?since=<cursor>` returns `{unchanged:true}` when nothing changed. */
export const GET: RequestHandler = async ({ request, params, url }) => {
	const ctx = await authenticateDevice(request, params.slug);
	if (ctx.expired) return json({ message: 'grant_expired: Behörigheten har gått ut' }, { status: 401 });
	// A disconnected phone, or one whose invite was replaced ("Skapa ny kod"), gets no patrol list or messages.
	if (ctx.revoked || ctx.superseded) return json({ message: 'grant_revoked: Telefonen är frånkopplad' }, { status: 401 });
	const raw = url.searchParams.get('since');
	const since = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
	return json(await buildSnapshot(ctx, since), { headers: { 'cache-control': 'no-store' } });
};

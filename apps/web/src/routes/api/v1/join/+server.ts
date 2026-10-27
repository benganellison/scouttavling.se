import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { redeemInvite } from '#lib/server/field.ts';
import { joinLimiter } from '#lib/server/limits.ts';

/** Redeems an invite secret for a device grant (04 §3.2b). Not cookie-based, so exempt from CSRF in hooks. */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	if (!joinLimiter.hit(getClientAddress())) return json({ message: 'För många försök. Vänta en stund och försök igen.' }, { status: 429 });
	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return json({ message: 'Ogiltig begäran' }, { status: 400 });
	}
	const out = await redeemInvite({ secret: body.secret, displayName: body.displayName, publicJwk: body.publicJwk });
	return json(out, { headers: { 'cache-control': 'no-store' } });
};

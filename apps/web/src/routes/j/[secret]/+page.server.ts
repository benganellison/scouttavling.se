import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { joinLimiter } from '#lib/server/limits.ts';
import { inviteInfo } from '#lib/server/field.ts';

export const load: PageServerLoad = async ({ params, setHeaders, getClientAddress }) => {
	if (!joinLimiter.hit(getClientAddress())) error(429, 'För många försök. Vänta en stund och försök igen.');
	setHeaders({ 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex' });
	return { invite: await inviteInfo(params.secret) };
};

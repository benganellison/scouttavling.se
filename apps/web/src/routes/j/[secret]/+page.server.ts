import type { PageServerLoad } from './$types';
import { inviteInfo } from '#lib/server/field.ts';

export const load: PageServerLoad = async ({ params, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex' });
	return { invite: await inviteInfo(params.secret) };
};

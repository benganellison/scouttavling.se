import { error, redirect } from '@sveltejs/kit';
import { DEV_LOGIN } from '$app/env/private';
import { createSession, safeNext, upsertUser } from '#lib/server/auth.ts';
import { scoutIdEnabled } from '#lib/server/scoutid.ts';

export function load({ url, locals }) {
	const next = safeNext(url.searchParams.get('next'));
	if (locals.user) redirect(303, next);
	return { scoutId: scoutIdEnabled(), devLogin: DEV_LOGIN === '1', next };
}

export const actions = {
	/** Dev-only stand-in for ScoutID until the Scouterna client is registered. */
	dev: async ({ request, cookies, url }) => {
		if (DEV_LOGIN !== '1') error(404);
		const form = await request.formData();
		const who = String(form.get('who') ?? 'bengt');
		const people: Record<string, { memberNo: string; name: string }> = {
			bengt: { memberNo: '3000001', name: 'Bengt Ellison' },
			anna: { memberNo: '3000002', name: 'Anna Berg' }
		};
		const p = people[who] ?? people.bengt;
		const user = await upsertUser({ ...p, email: `${who}@example.org`, groups: [{ groupNo: '900', name: 'Granlidens scoutkår' }, { groupNo: '90', name: 'Göteborgs scoutdistrikt' }] });
		await createSession(cookies, url, user.id);
		redirect(303, safeNext(String(form.get('next') ?? '')));
	}
};

import { redirect } from '@sveltejs/kit';
import { destroySession } from '#lib/server/auth.ts';

export async function POST({ cookies, url }) {
	await destroySession(cookies, url);
	redirect(303, '/');
}

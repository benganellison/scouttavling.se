import type { Handle } from '@sveltejs/kit/hooks';
import { readSession } from '#lib/server/auth.ts';
import { GRANT_SIGNING_KEY } from '$app/env/private';
import { dev } from '$app/env';

// Fail fast: without a stable signing key, volunteer devices cannot join and
// every grant would break on restart. Generate one with `npm run gen:grant-key`.
if (!dev && !GRANT_SIGNING_KEY) {
	throw new Error('GRANT_SIGNING_KEY is not set. Generate one with `npm run gen:grant-key` and add it to the environment.');
}

/**
 * Session lookup + CSRF for organiser requests. Field devices authenticate with
 * their signed grant (see #lib/server/field) and are not cookie-based.
 */
export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = await readSession(event.cookies, event.url);

	const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(event.request.method);
	const isJsonApi = event.url.pathname.startsWith('/api/') && !event.url.pathname.startsWith('/api/v1/field/') && event.url.pathname !== '/api/v1/join';
	if (unsafe && isJsonApi && event.locals.user) {
		if (event.request.headers.get('x-csrf-token') !== event.locals.user.csrf) {
			return new Response(JSON.stringify({ message: 'CSRF-kontroll misslyckades' }), { status: 403, headers: { 'content-type': 'application/json' } });
		}
	}

	const response = await resolve(event);
	response.headers.set('x-content-type-options', 'nosniff');
	response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
	return response;
};

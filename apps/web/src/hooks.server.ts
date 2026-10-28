import type { Handle, HandleServerError } from '@sveltejs/kit/hooks';
import { readSession } from '#lib/server/auth.ts';
import { closeDb } from '#lib/server/db/index.ts';
import { hub } from '#lib/server/live.ts';
import { DEV_LOGIN, GRANT_SIGNING_KEY, ORIGIN } from '$app/env/private';
import { dev } from '$app/env';

// Fail fast: without a stable signing key, volunteer devices cannot join and
// every grant would break on restart. Generate one with `npm run gen:grant-key`.
if (!dev && !GRANT_SIGNING_KEY) {
	throw new Error('GRANT_SIGNING_KEY is not set. Generate one with `npm run gen:grant-key` and add it to the environment.');
}
// The developer login (fixed users, no ScoutID) must never be reachable on a real site.
if (DEV_LOGIN === '1' && (ORIGIN ?? '').startsWith('https://')) {
	throw new Error('DEV_LOGIN=1 with an https ORIGIN: refusing to start. The developer login is for local work only.');
}

// Graceful shutdown (docker stop, SIGTERM): adapter-node closes the HTTP server and then emits
// this. Without closing the database pool and the live LISTEN connection, Node never exits and
// the container is killed after the stop timeout (old test servers lingered for days).
process.once('sveltekit:shutdown', async () => {
	await hub.close();
	await closeDb();
});

/**
 * Session lookup + CSRF for organiser requests. Field devices authenticate with
 * their signed grant (see #lib/server/field) and are not cookie-based.
 */
/**
 * Unexpected errors (bugs, a lost database): one log line with a short id, which the error page
 * shows, so a report from the forest ("felkod 3f2a9c1b") can be found in the container log.
 * The route pattern is logged, never the URL: paths such as /j/<secret> and /m/<token> are secrets.
 */
export const handleError: HandleServerError = ({ error, event, kind }) => {
	if (kind !== 'unknown') return;
	const id = crypto.randomUUID().slice(0, 8);
	const e = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
	console.error(JSON.stringify({ level: 'error', id, route: event.route.id, method: event.request.method, ...e }));
	return { message: `Något gick fel (felkod ${id}). Försök igen om en stund.` };
};

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

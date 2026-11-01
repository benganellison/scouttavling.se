import { publicHost } from '#lib/server/origin.ts';

/**
 * The public domain for addresses shown as text ("scouttavling.se/gokopen"), from ORIGIN.
 * Only for /admin: a ROOT layout server load would make every page fetch server data, and the
 * volunteers' field app (/f) must start offline from the service worker's cache.
 */
export function load({ url, untrack }) {
	// untrack: the host never changes between navigations, so this load never re-runs for it.
	return { siteHost: untrack(() => publicHost(url)) };
}

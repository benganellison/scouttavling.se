/**
 * Addresses a competition or series may not take. Every top-level route (scouttavling.se/<x>) is
 * here, because scouttavling.se/<slug> is the short address of a competition or series and the
 * route would win. slugs.test.ts fails when a new top-level route folder is missing from the list.
 * The rest are words kept free for later (ny, new, series, …).
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
	// top-level routes
	'admin', 'api', 'arkiverad', 'auth', 'f', 'folj', 'healthz', 'j', 'login', 'm', 'media', 'p', 'personuppgifter', 'r', 'site-admin', 't',
	// kept free
	'new', 'ny', 'series', 'serie', 'statistik', 'om', 'hjalp', 'help', 'www', 'static', 'favicon.ico', 'robots.txt'
]);

export const isReservedSlug = (slug: string) => RESERVED_SLUGS.has(slug.toLowerCase());

export function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[åä]/g, 'a')
		.replace(/ö/g, 'o')
		.replace(/é/g, 'e')
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48)
		.replace(/-+$/g, '');
}

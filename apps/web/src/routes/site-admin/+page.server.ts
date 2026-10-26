import { requireSiteAdmin, search } from '#lib/server/siteAdmin.ts';

export async function load(event) {
	requireSiteAdmin(event);
	const q = event.url.searchParams.get('q') ?? '';
	return { q, ...(await search(q)) };
}

import { PERSONAL_DATA_FOLLOW_UP_DAYS, personalDataOverdue, requireSiteAdmin, search } from '#lib/server/siteAdmin.ts';

export async function load(event) {
	requireSiteAdmin(event);
	const q = event.url.searchParams.get('q') ?? '';
	const [found, overdue] = await Promise.all([search(q), q ? Promise.resolve([]) : personalDataOverdue()]);
	return { q, ...found, overdue, overdueDays: PERSONAL_DATA_FOLLOW_UP_DAYS };
}

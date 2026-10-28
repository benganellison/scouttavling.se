import { eq } from 'drizzle-orm';
import { db, schema } from '#lib/server/db/index.ts';
import { listAudit, type AuditFilter } from '#lib/server/audit.ts';
import { requireSiteAdmin } from '#lib/server/siteAdmin.ts';

/** Filterable audit log: action group, who (site admins only), competition/series address, date range. */
const GROUPS: Record<string, string> = {
	'': 'Alla händelser',
	'member.': 'Ägare och arrangörer',
	'owner.': 'Ägarbyten (överlåtet, ersatt)',
	'competition.': 'Tävlingar (avstängning, personuppgifter)',
	'user.': 'Användare (avstängning)',
	'access.': 'Tillfällig åtkomst',
	'site_admin.': 'Plattformsadmin (kommandoraden)'
};

export async function load(event) {
	requireSiteAdmin(event);
	const p = event.url.searchParams;
	const action = p.get('action') ?? '';
	const slug = (p.get('slug') ?? '').trim();
	const from = p.get('from') ?? '';
	const to = p.get('to') ?? '';
	const f: AuditFilter = { limit: 300 };
	if (action in GROUPS && action) f.action = action;
	if (p.get('who') === 'admin') f.siteAdminOnly = true;
	if (/^\d{4}-\d{2}-\d{2}$/.test(from)) f.from = new Date(`${from}T00:00:00`);
	if (/^\d{4}-\d{2}-\d{2}$/.test(to)) f.to = new Date(new Date(`${to}T00:00:00`).getTime() + 86400_000);
	let notFound = false;
	if (slug) {
		const [c] = await db.select({ id: schema.competition.id }).from(schema.competition).where(eq(schema.competition.slug, slug)).limit(1);
		const [s] = c ? [] : await db.select({ id: schema.series.id }).from(schema.series).where(eq(schema.series.slug, slug)).limit(1);
		if (c) f.competitionId = c.id;
		else if (s) f.seriesId = s.id;
		else notFound = true;
	}
	return { rows: notFound ? [] : await listAudit(f), groups: GROUPS, filter: { action, slug, from, to, who: p.get('who') ?? '' }, notFound };
}

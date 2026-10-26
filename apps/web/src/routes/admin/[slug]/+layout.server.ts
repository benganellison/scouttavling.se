import { asc, eq } from 'drizzle-orm';
import { db, schema } from '#lib/server/db/index.ts';
import { requireCompetition } from '#lib/server/auth.ts';
import { classColorTemplate, loadBranding } from '#lib/server/assets.ts';
import { trackColors } from '#lib/brand/colors.ts';
import { accessNotices } from '#lib/server/siteAdmin.ts';

/**
 * Admin shell data, shared by every page under /admin/[slug]:
 * `competition`, `days`, `tracks`, `trackColors` (effective class colour per track id), `branding`, `roles` and `user`.
 */
export async function load(event) {
	const { user, comp, roles, access } = await requireCompetition(event, event.params.slug);
	const [days, tracks, branding, classTemplate, notices, series] = await Promise.all([
		db.select().from(schema.day).where(eq(schema.day.competitionId, comp.id)).orderBy(asc(schema.day.sort)),
		db.select().from(schema.track).where(eq(schema.track.competitionId, comp.id)).orderBy(asc(schema.track.sort)),
		loadBranding(comp),
		classColorTemplate(comp.id),
		// Owners are told about every site-admin "Tillfällig åtkomst" (active, or ended in the last 7 days).
		roles.includes('owner') ? accessNotices(comp.id, 7) : [],
		comp.seriesId ? db.select({ slug: schema.series.slug, name: schema.series.name }).from(schema.series).where(eq(schema.series.id, comp.seriesId)).then((r) => r[0] ?? null) : null
	]);
	return { competition: comp, series, days, tracks, classTemplate, trackColors: trackColors(tracks, classTemplate), branding, readOnly: !!comp.anonymisedAt, suspended: !!comp.suspendedAt, access, notices, roles, user: { id: user.id, name: user.name, memberNo: user.memberNo } };
}

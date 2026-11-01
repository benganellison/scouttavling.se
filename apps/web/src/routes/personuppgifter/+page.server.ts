import { eq } from 'drizzle-orm';
import { OPERATOR_EMAIL, OPERATOR_NAME } from '$app/env/private';
import { db, schema } from '#lib/server/db/index.ts';
import { loadBranding } from '#lib/server/assets.ts';

/**
 * Privacy notice (GDPR art. 13/14). `?t=<slug>` names the competition and the kår that is
 * responsible for it (controller); the operator (processor) comes from OPERATOR_NAME/OPERATOR_EMAIL.
 */
export async function load({ url, setHeaders }) {
	setHeaders({ 'cache-control': 'public, max-age=300' });
	const slug = url.searchParams.get('t');
	let competition: { name: string; organiser: string | null; slug: string } | null = null;
	let branding = null;
	if (slug && /^[a-z0-9-]{1,80}$/.test(slug)) {
		const [c] = await db.select().from(schema.competition).where(eq(schema.competition.slug, slug)).limit(1);
		if (c && c.status !== 'draft') {
			competition = { name: c.name, organiser: c.ownerGroupName, slug: c.slug };
			branding = await loadBranding(c);
		}
	}
	return { competition, branding, operator: { name: OPERATOR_NAME ?? null, email: OPERATOR_EMAIL ?? null } };
}

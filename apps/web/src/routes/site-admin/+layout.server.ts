import { requireSiteAdmin } from '#lib/server/siteAdmin.ts';

/**
 * /site-admin: platform operators only. Everyone else (also logged out) gets 404, so the area's
 * existence is not revealed. Every action re-checks with requireSiteAdmin (actions run before loads).
 */
export function load(event) {
	const user = requireSiteAdmin(event);
	return { admin: { id: user.id, name: user.name } };
}

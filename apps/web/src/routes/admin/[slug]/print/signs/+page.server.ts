import { loadBranding } from '#lib/server/assets.ts';
import { requireCompetition } from '#lib/server/auth.ts';
import { db } from '#lib/server/db/index.ts';
import { loadStations } from '../prep.server.ts';
import { activeInvites, decryptSecret, inviteUrl, publicOrigin, qrSvg, rotateInvite } from '#lib/server/invites.ts';

export async function load(event) {
	const { comp } = await requireCompetition(event, event.params.slug);
	const { stations } = await loadStations(comp.id);
	const invites = await activeInvites(comp.id);
	const origin = publicOrigin(event.url);
	const signs = await Promise.all(
		stations.map(async (s) => {
			const inv = invites.get(s.id);
			const secret = inv ? await decryptSecret(comp.patrolCodeKey, inv.secretEnc) : null;
			return { id: s.id, code: s.code, name: s.name, qr: secret ? await qrSvg(inviteUrl(origin, secret), { margin: 0 }) : null };
		})
	);
	return { competition: { slug: comp.slug, name: comp.name }, branding: await loadBranding(comp), signs, missing: signs.filter((s) => !s.qr).length };
}

export const actions = {
	/** Creates invites for stations that have none (or whose code can no longer be shown). */
	createMissing: async (event) => {
		const { comp } = await requireCompetition(event, event.params.slug, ['owner', 'organiser']);
		const { stations } = await loadStations(comp.id);
		const invites = await activeInvites(comp.id);
		await db.transaction(async (tx) => {
			for (const s of stations) {
				const inv = invites.get(s.id);
				if (inv && (await decryptSecret(comp.patrolCodeKey, inv.secretEnc))) continue;
				await rotateInvite(tx, comp, s.id);
			}
		});
		return { created: true };
	}
};

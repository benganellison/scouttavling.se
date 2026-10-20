import { fail } from '@sveltejs/kit';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { requireCompetition } from '#lib/server/auth.ts';
import { db, schema } from '#lib/server/db/index.ts';
import { loadStations } from '../print/prep.server.ts';
import { activeInvites, decryptSecret, inviteUrl, publicOrigin, qrSvg, rotateInvite } from './inviteCrypto.server.ts';

const SF = 'startfinish';

export async function load(event) {
	const { comp } = await requireCompetition(event, event.params.slug);
	const { stations } = await loadStations(comp.id);
	const active = await activeInvites(comp.id);
	const inviteIds = [...active.values()].map((i) => i.id);
	const devices = inviteIds.length
		? await db
				.select({ inviteId: schema.device.inviteId, displayName: schema.device.displayName })
				.from(schema.device)
				.where(and(inArray(schema.device.inviteId, inviteIds), isNull(schema.device.revokedAt)))
		: [];
	const status = (key: string) => {
		const inv = active.get(key);
		const names = inv ? devices.filter((d) => d.inviteId === inv.id).map((d) => d.displayName) : [];
		return { status: !inv ? 'missing' : names.length ? 'joined' : 'invited', devices: names, generation: inv?.generation ?? 0 };
	};
	const rows = stations.map((s) => ({ id: s.id, code: s.code, name: s.name, ...status(s.id) }));
	const sf = { id: SF, code: 'S/M', name: 'Start & mål', ...status('') };

	const sel = event.url.searchParams.get('s') ?? (event.url.searchParams.get('role') === SF ? SF : (rows[0]?.id ?? SF));
	const target = sel === SF ? sf : (rows.find((r) => r.id === sel) ?? rows[0] ?? sf);
	const inv = active.get(target.id === SF ? '' : target.id);
	let link: string | null = null;
	let qr: string | null = null;
	if (inv) {
		const secret = await decryptSecret(comp.patrolCodeKey, inv.secretEnc);
		if (secret) {
			link = inviteUrl(publicOrigin(event.url), secret);
			qr = await qrSvg(link);
		}
	}
	return {
		competition: { slug: comp.slug, name: comp.name },
		rows,
		startFinish: sf,
		selected: { ...target, hasInvite: !!inv, link, qr }
	};
}

async function targetStation(competitionId: string, form: FormData): Promise<string | null | undefined> {
	const t = String(form.get('target') ?? '');
	if (t === SF) return null;
	const [s] = await db
		.select({ id: schema.station.id })
		.from(schema.station)
		.where(and(eq(schema.station.id, t), eq(schema.station.competitionId, competitionId)));
	return s?.id;
}

export const actions = {
	/** Creates the first invite, or replaces the current one (the old link stops working). */
	rotate: async (event) => {
		const { comp } = await requireCompetition(event, event.params.slug, ['owner', 'organiser']);
		const form = await event.request.formData();
		if (!/^[0-9a-f-]{36}$|^startfinish$/.test(String(form.get('target') ?? ''))) return fail(400, { message: 'Okänd kontroll' });
		const stationId = await targetStation(comp.id, form);
		if (stationId === undefined) return fail(400, { message: 'Okänd kontroll' });
		await db.transaction((tx) => rotateInvite(tx, comp, stationId));
		return { rotated: true };
	}
};

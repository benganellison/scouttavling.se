import { error, fail, redirect } from '@sveltejs/kit';
import { archivedLinkTarget } from '#lib/server/anonymise.ts';
import { asc, eq } from 'drizzle-orm';
import { patrolCodeUrl, stationCodes } from '@scouttavling/domain';
import { db, schema } from '#lib/server/db/index.ts';
import {
	NO_STORE, decryptToken, missLimiter, patrolByManageToken, publicOrigin, qrSvg, spotCount, updateRegistration, windowFor
} from '#lib/server/registration.ts';
import { loadBranding, trackColorFor } from '#lib/server/assets.ts';
import { canEditRegistration, dayMonth, readForm, validateManage } from '#lib/registration/rules.ts';

/** Manage link: the registered contact's view (equivalent to patrol_leader for their own patrol). */
async function lookup(token: string, ip: string) {
	if (missLimiter.blocked(ip)) error(429, 'För många försök. Vänta en stund.');
	const row = await patrolByManageToken(token);
	if (!row) {
		const archived = await archivedLinkTarget(token);
		if (archived) redirect(303, archived);
		missLimiter.hit(ip);
		error(404, 'Länken finns inte eller har slutat gälla');
	}
	return row;
}

export async function load({ params, url, setHeaders, getClientAddress }) {
	const { patrol, comp } = await lookup(params.token, getClientAddress());
	setHeaders(NO_STORE);
	const origin = publicOrigin(url);
	const [members, track, stations, days, count] = await Promise.all([
		db.select({ firstName: schema.member.firstName, lastName: schema.member.lastName }).from(schema.member).where(eq(schema.member.patrolId, patrol.id)).orderBy(asc(schema.member.firstName), asc(schema.member.lastName)),
		patrol.trackId ? db.select({ name: schema.track.name }).from(schema.track).where(eq(schema.track.id, patrol.trackId)).then((r) => r[0]?.name ?? '') : Promise.resolve(''),
		db.select().from(schema.station).where(eq(schema.station.competitionId, comp.id)),
		db.select({ id: schema.day.id, prefix: schema.day.prefix }).from(schema.day).where(eq(schema.day.competitionId, comp.id)),
		spotCount(comp.id)
	]);
	const w = windowFor(comp, count);
	let start: string | null = null;
	if (patrol.startStationId) {
		const codes = stationCodes(stations.map((s) => ({ id: s.id, dayId: s.dayId, order: s.sort, name: s.name, customCode: s.customCode, role: s.role })), days);
		const st = stations.find((s) => s.id === patrol.startStationId);
		if (st) start = `${codes.get(st.id) ?? ''} ${st.name}`.trim();
	}
	const followToken = comp.followEnabled ? await decryptToken(comp.patrolCodeKey, patrol.followTokenEnc) : null;
	return {
		branding: await loadBranding(comp),
		trackColor: patrol.trackId ? await trackColorFor(comp.id, patrol.trackId) : null,
		comp: { slug: comp.slug, name: comp.name, status: comp.status, startDate: comp.startDate, endDate: comp.endDate, location: comp.location, hqPhone: comp.hqPhone },
		patrol: {
			number: patrol.number, name: patrol.name, troop: patrol.troop, track, status: patrol.status, start,
			contactName: patrol.contactName ?? '', contactPhone: patrol.contactPhone ?? '', contactEmail: patrol.contactEmail ?? ''
		},
		members,
		qr: await qrSvg(await patrolCodeUrl(origin, comp.patrolCodeKey, comp.slug, patrol.number)),
		canEdit: canEditRegistration(w.state) && patrol.status === 'registered',
		closesText: dayMonth(w.closesOn, w.today),
		followUrl: followToken ? `${origin}/folj/${followToken}` : null
	};
}

export const actions = {
	save: async ({ params, request, getClientAddress }) => {
		const { patrol, comp } = await lookup(params.token, getClientAddress());
		const w = windowFor(comp, await spotCount(comp.id));
		if (!canEditRegistration(w.state) || patrol.status !== 'registered') return fail(409, { errors: { form: 'Anmälan är stängd. Kontakta arrangören för ändringar.' } as Record<string, string> });
		const raw = readForm(await request.formData());
		const v = validateManage(raw);
		if (!v.ok) return fail(400, { errors: v.errors, values: raw });
		await updateRegistration(comp.id, patrol.id, v.data);
		return { saved: true };
	}
};

import { fail } from '@sveltejs/kit';
import { desc, eq } from 'drizzle-orm';
import { requireCompetition } from '#lib/server/auth.ts';
import { db, schema } from '#lib/server/db/index.ts';
import { recordChange } from '#lib/server/changes.ts';
import { deviceInAudience, devicesFor, formatTime, loadStations, readsFor } from '#lib/server/live.ts';

export async function load(event) {
	const { comp } = await requireCompetition(event, event.params.slug);
	event.depends(`live:${comp.slug}`);
	const [stations, devices, messages] = await Promise.all([
		loadStations(comp.id),
		devicesFor(comp.id),
		db.select().from(schema.message).where(eq(schema.message.competitionId, comp.id)).orderBy(desc(schema.message.createdAt)).limit(50)
	]);
	const reads = await readsFor(messages.map((m) => m.id));
	const stationName = new Map(stations.map((s) => [s.id, `${s.code} ${s.name}`]));
	const deviceLabel = (d: (typeof devices)[number]) =>
		d.role === 'startfinish'
			? 'Start & mål'
			: d.stationIds
					.map((id) => stationName.get(id))
					.filter(Boolean)
					.join(', ') || d.displayName;
	return {
		comp: { slug: comp.slug, name: comp.name },
		stations: stations.map((s) => ({ id: s.id, code: s.code, name: s.name })),
		deviceCount: devices.length,
		sent: messages.map((m) => {
			const audience = devices.filter((d) => deviceInAudience(d, m.audience));
			const readIds = new Set(reads.filter((r) => r.messageId === m.id).map((r) => r.deviceId));
			const unread = audience.filter((d) => !readIds.has(d.id));
			return {
				id: m.id,
				title: m.title,
				body: m.body,
				important: m.important,
				time: formatTime(m.createdAt),
				audience: m.audience.map((a) => (a === 'all' ? 'Alla funktionärer' : a === 'startfinish' ? 'Start & mål' : (stationName.get(a) ?? 'Okänd kontroll'))),
				total: audience.length,
				read: audience.length - unread.length,
				unread: [...new Set(unread.map(deviceLabel))]
			};
		})
	};
}

export const actions = {
	send: async (event) => {
		const { comp, user } = await requireCompetition(event, event.params.slug);
		const f = await event.request.formData();
		const title = String(f.get('title') ?? '').trim();
		const body = String(f.get('body') ?? '').trim();
		const important = f.get('important') === 'on';
		let audience = f.getAll('audience').map(String);
		if (!title || !body) return fail(400, { title, body, message: 'Skriv både rubrik och meddelande' });
		if (audience.length === 0) return fail(400, { title, body, message: 'Välj vilka som ska få meddelandet' });
		if (audience.includes('all')) audience = ['all'];
		const stations = new Set((await loadStations(comp.id)).map((s) => s.id));
		audience = audience.filter((a) => a === 'all' || a === 'startfinish' || stations.has(a));
		await db.transaction(async (tx) => {
			const [m] = await tx.insert(schema.message).values({ competitionId: comp.id, title, body, important, audience, createdBy: user.id }).returning();
			await recordChange(tx, comp.id, 'message', m.id);
		});
		return { sent: true, message: 'Meddelandet är skickat.' };
	}
};

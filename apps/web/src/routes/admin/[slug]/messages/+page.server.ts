import { fail } from '@sveltejs/kit';
import { desc, eq } from 'drizzle-orm';
import { requireCompetition } from '#lib/server/auth.ts';
import { db, schema } from '#lib/server/db/index.ts';
import { recordChange } from '#lib/server/changes.ts';
import { deviceInAudience, devicesFor, readsFor } from '#lib/server/messages.ts';
import { formatTime } from '#lib/time.ts';
import { loadStations } from '#lib/server/queries.ts';
import * as v from 'valibot';
import { checkbox, formInput, parseForm, requiredText } from '#lib/server/forms.ts';
import { liveKey } from '#lib/live.ts';

const MessageSchema = v.object({
	title: requiredText(1, 80, 'Skriv både rubrik och meddelande'),
	body: requiredText(1, 600, 'Skriv både rubrik och meddelande'),
	important: checkbox,
	audience: v.pipe(v.array(v.string()), v.minLength(1, 'Välj vilka som ska få meddelandet'))
});

export async function load(event) {
	const { comp } = await requireCompetition(event, event.params.slug);
	event.depends(liveKey(comp.slug));
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
		const input = formInput(await event.request.formData(), ['audience']);
		const r = parseForm(MessageSchema, input);
		if (!r.ok) {
			const message = r.errors.title ?? r.errors.body ?? r.errors.audience ?? 'Kontrollera meddelandet';
			return fail(400, { title: String(input.title ?? '').trim(), body: String(input.body ?? '').trim(), message });
		}
		const { title, body, important } = r.data;
		let audience = r.data.audience;
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

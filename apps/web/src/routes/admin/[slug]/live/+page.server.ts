import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { requireCompetition } from '#lib/server/auth.ts';
import { db, schema } from '#lib/server/db/index.ts';
import { recordChange } from '#lib/server/changes.ts';
import { acknowledgeAlarm, loadDashboard } from '#lib/server/live.ts';

export async function load(event) {
	const { comp } = await requireCompetition(event, event.params.slug);
	event.depends(`live:${comp.slug}`);
	const dash = await loadDashboard(comp);
	return {
		comp: { slug: comp.slug, name: comp.name, backupMode: comp.backupMode, status: comp.status, multiDay: comp.multiDay },
		...dash
	};
}

export const actions = {
	/** "Starta reservläge" / "Avsluta reservläge": broadcast to every device via the change feed. */
	backup: async (event) => {
		const { comp } = await requireCompetition(event, event.params.slug);
		const on = (await event.request.formData()).get('on') === '1';
		await db.transaction(async (tx) => {
			await tx.update(schema.competition).set({ backupMode: on }).where(eq(schema.competition.id, comp.id));
			await recordChange(tx, comp.id, 'competition', comp.id);
		});
		return { backup: on };
	},
	ack: async (event) => {
		const { comp } = await requireCompetition(event, event.params.slug);
		const key = String((await event.request.formData()).get('key') ?? '');
		if (!key) return fail(400, { message: 'Saknar larm' });
		acknowledgeAlarm(comp.id, key);
		return { acked: key };
	}
};

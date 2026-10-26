import { fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db, schema } from '#lib/server/db/index.ts';
import { requireCompetition } from '#lib/server/auth.ts';
import { recordChange } from '#lib/server/changes.ts';
import { ASSET_KINDS, removeImage, uploadImage } from '#lib/server/assets.ts';
import { MAX_BYTES } from '#lib/server/imageValidate.ts';
import { parseHex } from '#lib/brand/colors.ts';
import type { AssetKind } from '#lib/brand/branding.ts';
import { listMembers, type OwnershipActor } from '#lib/server/ownership.ts';
import { memberAction, type MemberAction } from '#lib/server/memberActions.ts';
import { listAudit } from '#lib/server/audit.ts';
import { accessNotices } from '#lib/server/siteAdmin.ts';

const EDIT = ['owner', 'organiser'] as const;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = ['Söndag', 'Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag'];
type Errors = Record<string, string>;

export async function load(event) {
	const { comp, user, roles } = await requireCompetition(event, event.params.slug);
	const isOwner = roles.includes('owner');
	const [members, trackUse, dayUse, audit, notices] = await Promise.all([
		listMembers({ kind: 'competition', id: comp.id }),
		db
			.select({ trackId: schema.patrol.trackId, n: sql<number>`count(*)::int` })
			.from(schema.patrol)
			.where(eq(schema.patrol.competitionId, comp.id))
			.groupBy(schema.patrol.trackId),
		db
			.select({ dayId: schema.station.dayId, n: sql<number>`count(*)::int` })
			.from(schema.station)
			.where(eq(schema.station.competitionId, comp.id))
			.groupBy(schema.station.dayId),
		// Owners see this competition's audit entries (read-only) and site-admin access notices.
		isOwner ? listAudit({ competitionOrSeries: { competitionId: comp.id, seriesId: null }, limit: 50 }) : [],
		isOwner ? accessNotices(comp.id) : []
	]);
	return {
		audit,
		notices,
		groups: user.groups,
		members,
		trackPatrols: Object.fromEntries(trackUse.filter((t) => t.trackId).map((t) => [t.trackId!, t.n])) as Record<string, number>,
		dayStations: Object.fromEntries(dayUse.filter((d) => d.dayId).map((d) => [d.dayId!, d.n])) as Record<string, number>
	};
}

export const actions = {
	basics: async (event) => {
		const { comp, user } = await requireCompetition(event, event.params.slug, [...EDIT]);
		const f = await event.request.formData();
		const s = (k: string) => String(f.get(k) ?? '').trim();
		const name = s('name');
		const location = s('location');
		const hqPhone = s('hqPhone');
		const ownerNo = s('owner');
		const date = s('date');
		const errors: Errors = {};
		if (name.length < 2 || name.length > 80) errors.name = 'Namnet ska vara 2–80 tecken.';
		if (hqPhone.length > 30) errors.hqPhone = 'Telefonnumret är för långt.';
		if (!comp.multiDay && !ISO.test(date)) errors.date = 'Välj ett datum.';
		// The current owner stays selectable even if the user is not a member of it.
		const group = user.groups.find((g) => g.groupNo === ownerNo) ?? (ownerNo === comp.ownerGroupNo ? { groupNo: comp.ownerGroupNo, name: comp.ownerGroupName ?? '' } : null);
		if (!group) errors.owner = 'Välj en kår eller ett distrikt du tillhör.';
		if (Object.keys(errors).length) return fail(400, { section: 'basics', errors });
		await db.transaction(async (tx) => {
			await tx
				.update(schema.competition)
				.set({
					name, location: location || null, hqPhone: hqPhone || null, ownerGroupNo: group!.groupNo, ownerGroupName: group!.name,
					styleEnabled: f.get('styleEnabled') === 'on', publicResults: f.get('publicResults') === 'on',
					stationResultsLive: f.get('stationResultsLive') === 'on',
					...(comp.multiDay ? {} : { startDate: date, endDate: date })
				})
				.where(eq(schema.competition.id, comp.id));
			await recordChange(tx, comp.id, 'competition', comp.id);
		});
		return { section: 'basics', ok: true };
	},

	registration: async (event) => {
		const { comp } = await requireCompetition(event, event.params.slug, [...EDIT]);
		const f = await event.request.formData();
		const s = (k: string) => String(f.get(k) ?? '').trim();
		const opensOn = s('registrationOpensOn');
		const closesOn = s('registrationClosesOn');
		const max = s('maxPatrols');
		const fee = s('feePerPatrol').replace(/\s|kr$/gi, '');
		const infoText = s('infoText');
		const confirmationText = s('confirmationText');
		const errors: Errors = {};
		if (opensOn && !ISO.test(opensOn)) errors.registrationOpensOn = 'Välj ett datum.';
		if (closesOn && !ISO.test(closesOn)) errors.registrationClosesOn = 'Välj ett datum.';
		if (opensOn && closesOn && !errors.registrationOpensOn && !errors.registrationClosesOn && opensOn > closesOn) errors.registrationClosesOn = 'Sista dagen kan inte vara före första dagen.';
		if (max && (!/^\d{1,4}$/.test(max) || Number(max) < 1)) errors.maxPatrols = 'Skriv ett antal (1–9999) eller lämna tomt.';
		if (fee && (!/^\d{1,6}$/.test(fee))) errors.feePerPatrol = 'Skriv ett belopp i hela kronor (0–999999) eller lämna tomt.';
		if (infoText.length > 4000) errors.infoText = 'Högst 4000 tecken.';
		if (confirmationText.length > 1000) errors.confirmationText = 'Högst 1000 tecken.';
		if (Object.keys(errors).length) return fail(400, { section: 'registration', errors });
		await db.transaction(async (tx) => {
			await tx
				.update(schema.competition)
				.set({
					registrationOpen: f.get('registrationOpen') === 'on', registrationOpensOn: opensOn || null, registrationClosesOn: closesOn || null,
					maxPatrols: max ? Number(max) : null, feePerPatrol: fee ? Number(fee) : null, infoText: infoText || null, confirmationText: confirmationText || null,
					followEnabled: f.get('followEnabled') === 'on', followShowScores: f.get('followShowScores') === 'on'
				})
				.where(eq(schema.competition.id, comp.id));
			await recordChange(tx, comp.id, 'competition', comp.id);
		});
		return { section: 'registration', ok: true };
	},

	days: async (event) => {
		const { comp } = await requireCompetition(event, event.params.slug, [...EDIT]);
		const f = await event.request.formData();
		const days = await db.select().from(schema.day).where(eq(schema.day.competitionId, comp.id)).orderBy(asc(schema.day.sort));
		const errors: Errors = {};
		const next = days.map((d) => ({
			id: d.id,
			name: String(f.get(`name_${d.id}`) ?? d.name).trim(),
			prefix: String(f.get(`prefix_${d.id}`) ?? d.prefix).trim().toUpperCase(),
			date: String(f.get(`date_${d.id}`) ?? d.date).trim()
		}));
		const prefixes = new Set<string>();
		const dates = new Set<string>();
		for (const d of next) {
			if (!d.name || d.name.length > 30) errors[`name_${d.id}`] = 'Namn: 1–30 tecken.';
			if (!/^[A-ZÅÄÖ]{1,3}$/.test(d.prefix)) errors[`prefix_${d.id}`] = 'Prefix: 1–3 bokstäver.';
			else if (prefixes.has(d.prefix)) errors[`prefix_${d.id}`] = 'Prefixet används redan.';
			if (!ISO.test(d.date)) errors[`date_${d.id}`] = 'Välj ett datum.';
			else if (dates.has(d.date)) errors[`date_${d.id}`] = 'Två dagar har samma datum.';
			prefixes.add(d.prefix);
			dates.add(d.date);
		}
		if (Object.keys(errors).length) return fail(400, { section: 'days', errors });
		const sorted = [...next].sort((a, b) => a.date.localeCompare(b.date));
		await db.transaction(async (tx) => {
			for (const [i, d] of sorted.entries()) {
				await tx.update(schema.day).set({ name: d.name, prefix: d.prefix, date: d.date, sort: i + 1 }).where(eq(schema.day.id, d.id));
			}
			await tx
				.update(schema.competition)
				.set({ startDate: sorted[0].date, endDate: sorted.at(-1)!.date })
				.where(eq(schema.competition.id, comp.id));
			await recordChange(tx, comp.id, 'competition', comp.id);
		});
		return { section: 'days', ok: true };
	},

	addDay: async (event) => {
		const { comp } = await requireCompetition(event, event.params.slug, [...EDIT]);
		if (!comp.multiDay) return fail(400, { section: 'days', errors: { days: 'Tävlingen är på en dag.' } as Errors });
		const days = await db.select().from(schema.day).where(eq(schema.day.competitionId, comp.id)).orderBy(asc(schema.day.sort));
		if (days.length >= 14) return fail(400, { section: 'days', errors: { days: 'Högst 14 dagar.' } as Errors });
		const last = days.at(-1)?.date ?? comp.endDate;
		const d = new Date(`${last}T12:00:00Z`);
		d.setUTCDate(d.getUTCDate() + 1);
		const date = d.toISOString().slice(0, 10);
		const name = WEEKDAYS[d.getUTCDay()];
		const used = new Set(days.map((x) => x.prefix));
		const prefix = [name[0], name.slice(0, 2), `${name[0]}${days.length + 1}`].map((p) => p.toUpperCase()).find((p) => !used.has(p) && /^[A-ZÅÄÖ]{1,3}$/.test(p)) ?? 'X';
		await db.transaction(async (tx) => {
			await tx.insert(schema.day).values({ competitionId: comp.id, date, name, prefix, sort: days.length + 1 });
			await tx.update(schema.competition).set({ endDate: date }).where(eq(schema.competition.id, comp.id));
			await recordChange(tx, comp.id, 'competition', comp.id);
		});
		return { section: 'days', ok: true };
	},

	removeDay: async (event) => {
		const { comp } = await requireCompetition(event, event.params.slug, [...EDIT]);
		const f = await event.request.formData();
		const id = String(f.get('id') ?? '');
		const days = await db.select().from(schema.day).where(eq(schema.day.competitionId, comp.id)).orderBy(asc(schema.day.sort));
		if (days.length <= 2) return fail(400, { section: 'days', errors: { days: 'En flerdagarstävling behöver minst två dagar.' } as Errors });
		if (!days.some((d) => d.id === id)) return fail(404, { section: 'days', errors: { days: 'Dagen finns inte.' } as Errors });
		const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.station).where(eq(schema.station.dayId, id));
		if (n > 0) return fail(400, { section: 'days', errors: { days: `Dagen har ${n} kontroller. Flytta eller ta bort dem först.` } as Errors });
		const rest = days.filter((d) => d.id !== id);
		await db.transaction(async (tx) => {
			await tx.delete(schema.day).where(eq(schema.day.id, id));
			for (const [i, d] of rest.entries()) await tx.update(schema.day).set({ sort: i + 1 }).where(eq(schema.day.id, d.id));
			await tx.update(schema.competition).set({ startDate: rest[0].date, endDate: rest.at(-1)!.date }).where(eq(schema.competition.id, comp.id));
			await recordChange(tx, comp.id, 'competition', comp.id);
		});
		return { section: 'days', ok: true };
	},

	tracks: async (event) => {
		const { comp } = await requireCompetition(event, event.params.slug, [...EDIT]);
		const f = await event.request.formData();
		const tracks = await db.select().from(schema.track).where(eq(schema.track.competitionId, comp.id)).orderBy(asc(schema.track.sort));
		const errors: Errors = {};
		const renamed = tracks.map((t) => {
			const raw = f.get(`color_${t.id}`);
			const colorText = raw === null ? (t.color ?? '') : String(raw).trim();
			const color = parseHex(colorText);
			if (colorText && !color) errors[`track_${t.id}`] = 'Färgen ska vara en hexkod, t.ex. #003660.';
			return { id: t.id, name: String(f.get(`track_${t.id}`) ?? t.name).trim(), color };
		});
		const added = String(f.get('newTrack') ?? '').trim();
		const names = new Set<string>();
		for (const t of renamed) {
			if (errors[`track_${t.id}`]) continue;
			if (!t.name || t.name.length > 40) errors[`track_${t.id}`] = 'Namn: 1–40 tecken.';
			else if (names.has(t.name.toLowerCase())) errors[`track_${t.id}`] = 'Två klasser har samma namn.';
			names.add(t.name.toLowerCase());
		}
		if (added && (added.length > 40 || names.has(added.toLowerCase()))) errors.newTrack = added.length > 40 ? 'Högst 40 tecken.' : 'Klassen finns redan.';
		if (Object.keys(errors).length) return fail(400, { section: 'tracks', errors });
		await db.transaction(async (tx) => {
			for (const t of renamed) await tx.update(schema.track).set({ name: t.name, color: t.color }).where(eq(schema.track.id, t.id));
			if (added) await tx.insert(schema.track).values({ competitionId: comp.id, name: added, sort: tracks.length + 1 });
			await recordChange(tx, comp.id, 'competition', comp.id);
		});
		return { section: 'tracks', ok: true };
	},

	removeTrack: async (event) => {
		const { comp } = await requireCompetition(event, event.params.slug, [...EDIT]);
		const f = await event.request.formData();
		const id = String(f.get('id') ?? '');
		const [t] = await db.select().from(schema.track).where(and(eq(schema.track.id, id), eq(schema.track.competitionId, comp.id))).limit(1);
		if (!t) return fail(404, { section: 'tracks', errors: { tracks: 'Klassen finns inte.' } as Errors });
		const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.patrol).where(eq(schema.patrol.trackId, id));
		if (n > 0) return fail(400, { section: 'tracks', errors: { tracks: `${t.name} har ${n} patruller. Flytta dem till en annan klass först.` } as Errors });
		await db.transaction(async (tx) => {
			await tx.delete(schema.track).where(eq(schema.track.id, id));
			await recordChange(tx, comp.id, 'competition', comp.id);
		});
		return { section: 'tracks', ok: true };
	},

	/** Utseende: the event's accent colour ("" = Scouterna base). */
	appearance: async (event) => {
		const { comp } = await requireCompetition(event, event.params.slug, [...EDIT]);
		const f = await event.request.formData();
		const text = String(f.get('accentColor') ?? '').trim();
		const accent = parseHex(text);
		const fitRaw = String(f.get('coverFit') ?? '');
		const coverFit = fitRaw === 'contain' || fitRaw === 'cover' ? fitRaw : null;
		if (text && !accent) return fail(400, { section: 'appearance', errors: { accentColor: 'Skriv en hexkod, t.ex. #003660, eller välj en färg.' } as Errors });
		await db.transaction(async (tx) => {
			await tx.update(schema.competition).set({ accentColor: accent, coverFit }).where(eq(schema.competition.id, comp.id));
			await recordChange(tx, comp.id, 'competition', comp.id);
		});
		return { section: 'appearance', ok: true };
	},

	/** Upload or replace an event logo, organiser logo or cover (PNG/JPEG/WebP ≤ 2 MB, checked by content). */
	upload: async (event) => {
		const { comp, user } = await requireCompetition(event, event.params.slug, [...EDIT]);
		const f = await event.request.formData();
		const kind = String(f.get('kind') ?? '') as AssetKind;
		if (!ASSET_KINDS.includes(kind)) return fail(400, { section: 'appearance', errors: { upload: 'Okänd bildtyp.' } as Errors });
		const file = f.get('file');
		if (!(file instanceof File) || file.size === 0) return fail(400, { section: 'appearance', errors: { [kind]: 'Välj en bild först.' } as Errors });
		if (file.size > MAX_BYTES) return fail(400, { section: 'appearance', errors: { [kind]: 'Bilden är större än 2 MB. Förminska den och försök igen.' } as Errors });
		const r = await uploadImage({ competitionId: comp.id }, kind, new Uint8Array(await file.arrayBuffer()), user.id, [comp.id]);
		if (!r.ok) return fail(400, { section: 'appearance', errors: { [kind]: r.reason } as Errors });
		return { section: 'appearance', ok: true, uploaded: kind };
	},

	removeImage: async (event) => {
		const { comp } = await requireCompetition(event, event.params.slug, [...EDIT]);
		const f = await event.request.formData();
		const kind = String(f.get('kind') ?? '') as AssetKind;
		if (!ASSET_KINDS.includes(kind)) return fail(400, { section: 'appearance', errors: { upload: 'Okänd bildtyp.' } as Errors });
		await removeImage({ competitionId: comp.id }, kind, [comp.id]);
		return { section: 'appearance', ok: true };
	},

	memberAdd: (event) => members(event, 'add'),
	memberRole: (event) => members(event, 'role'),
	memberRemove: (event) => members(event, 'remove'),
	memberTransfer: (event) => members(event, 'transfer'),
	memberLeave: async (event) => {
		const r = await members(event, 'leave');
		if (r && 'left' in r && r.left) redirect(303, '/admin');
		return r;
	}
};

/** "Ägare och arrangörer": every check (owner-only changes, ≥ 1 owner) is in #lib/server/ownership.ts. */
async function members(event: RequestEvent<{ slug: string }>, kind: MemberAction) {
	const { comp, user, access } = await requireCompetition(event, event.params.slug, [...EDIT]);
	const f = await event.request.formData();
	const actor: OwnershipActor = access
		? { kind: 'site_admin', userId: user.id, reason: access.reason, accessRole: 'organiser' }
		: { kind: 'user', userId: user.id };
	const list = await listMembers({ kind: 'competition', id: comp.id });
	return memberAction(kind, f, { kind: 'competition', id: comp.id }, actor, new Map(list.map((m) => [m.userId, m.name])));
}

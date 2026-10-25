/**
 * Demo data for development and UAT. All names are invented.
 * Run: npm run db:seed   (wipes and recreates the demo competitions)
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, inArray } from 'drizzle-orm';
import postgres from 'postgres';
import * as s from '../src/lib/server/db/schema.ts';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateImage } from '../src/lib/server/imageValidate.ts';
import { namedTrackColor } from '../src/lib/brand/colors.ts';

const client = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(client, { schema: s });

const SLUGS = ['gokopen-2027', 'gokhajk-2027'];

async function main() {
	await db.delete(s.competition).where(inArray(s.competition.slug, SLUGS));

	const [erik] = await db
		.insert(s.appUser)
		.values({ memberNo: '3000001', name: 'Erik Rydberg', email: 'erik@example.org', groups: [{ groupNo: '900', name: 'Granlidens scoutkår' }, { groupNo: '90', name: 'Göteborgs scoutdistrikt' }] })
		.onConflictDoUpdate({ target: s.appUser.memberNo, set: { name: 'Erik Rydberg' } })
		.returning();

	// ---------- GökOpen 2027: single day ----------
	const [open] = await db
		.insert(s.competition)
		.values({
			slug: 'gokopen-2027', name: 'GökOpen 2027', ownerGroupNo: '900', ownerGroupName: 'Granlidens scoutkår',
			startDate: '2027-05-15', endDate: '2027-05-15', location: 'Gökskogens lägerplats', hqPhone: '070-111 22 33',
			publicResults: true, registrationOpen: true, status: 'live', patrolCodeKey: 'dev-key-gokopen', createdBy: erik.id,
			registrationOpensOn: '2026-09-01', registrationClosesOn: '2027-05-01', maxPatrols: 40,
			infoText: 'Välkomna till GökOpen! Banan är cirka 6 km genom Gökskogen. Samling vid lägerplatsens flaggstång kl. 08.30, första start 09.00.\n\nTa med matsäck, vattenflaska, kläder efter väder och en penna.',
			confirmationText: 'Startavgiften är 150 kr per patrull och betalas till kårens konto senast 1 maj.',
			followEnabled: true, followShowScores: true,
			// Event branding: Upptäckarblå accent (black text on it, 7.7:1); the forest cover fills its band.
			accentColor: '#00a8e1', coverFit: 'cover'
		})
		.returning();
	await db.insert(s.competitionMember).values({ competitionId: open.id, userId: erik.id, role: 'owner' });

	const tracks = await db
		.insert(s.track)
		// Class colours stored explicitly (age-group colours; Ledare = Scoutblå). Ledare has no patrols yet.
		.values(['Spårare', 'Upptäckare', 'Äventyrare', 'Utmanare', 'Ledare'].map((name, i) => ({ competitionId: open.id, name, sort: i + 1, color: namedTrackColor(name) })))
		.returning();
	const T = Object.fromEntries(tracks.map((t) => [t.name, t.id]));

	const stationDefs: { name: string; notSparare?: boolean; checkpoint?: boolean; distinct?: boolean; mal?: boolean }[] = [
		{ name: 'Lägerplatsen' }, { name: 'Naturkunskap' }, { name: 'Knopar & surrningar', distinct: true }, { name: 'Eldstaden' },
		{ name: 'Kartan & kompassen' }, { name: 'Första hjälpen' }, { name: 'Rastplatsen', checkpoint: true }, { name: 'Repstegen' },
		{ name: 'Kojbygge' }, { name: 'Kanoten', notSparare: true }, { name: 'Sinnesbanan' }, { name: 'Mörkerstigen', notSparare: true },
		{ name: 'Spårtecken' }, { name: 'Mål', mal: true }
	];
	const items: (typeof s.scoreItem.$inferSelect)[] = [];
	const stations: (typeof s.station.$inferSelect)[] = [];
	for (const [i, d] of stationDefs.entries()) {
		const [st] = await db
			.insert(s.station)
			.values({ competitionId: open.id, sort: i + 1, name: d.name, role: d.mal ? 'finish' : null, allTracks: !d.notSparare, startable: !d.checkpoint && !d.mal })
			.returning();
		stations.push(st);
		if (d.notSparare) {
			await db.insert(s.stationTrack).values(['Upptäckare', 'Äventyrare', 'Utmanare'].map((t) => ({ stationId: st.id, trackId: T[t] })));
		}
		const base = { stationId: st.id, styleMin: 0, styleMax: 5 };
		const defs = d.mal
			? [
					{ ...base, sort: 1, name: 'Målregistrering', mode: 'AUTO_ON_SCAN' as const, min: 0, max: 0, styleEnabled: false, countsForTiebreak: false },
					{ ...base, sort: 2, name: 'Nödbrev', mode: 'DISTINCT' as const, min: 0, max: 20, distinctValues: [{ value: 0, label: 'Ej inlämnat / öppnat' }, { value: 20, label: 'Oöppnat' }], styleEnabled: false, countsForTiebreak: true },
					{ ...base, sort: 3, name: 'Händighet', mode: 'RANGE' as const, min: 0, max: 20, styleEnabled: false, countsForTiebreak: true },
					{ ...base, sort: 4, name: 'Orientering', mode: 'COUNT' as const, min: 0, max: 10, countMultiplier: 2, styleEnabled: false, countsForTiebreak: true }
				]
			: d.checkpoint
				? [{ ...base, sort: 1, name: d.name, mode: 'CHECKIN' as const, min: 0, max: 0, styleEnabled: false, countsForTiebreak: false }]
				: d.distinct
					? [{ ...base, sort: 1, name: d.name, mode: 'DISTINCT' as const, min: 0, max: 20, distinctValues: [0, 5, 10, 15, 20].map((value) => ({ value })), styleEnabled: true, countsForTiebreak: true }]
					: [{ ...base, sort: 1, name: d.name, mode: 'RANGE' as const, min: 0, max: 20, styleEnabled: true, countsForTiebreak: true }];
		items.push(...(await db.insert(s.scoreItem).values(defs).returning()));
	}

	const patrolDefs: [number, string, string, string][] = [
		[104, 'Älgarna', 'Utmanare', 'Ekbackens scoutkår'], [108, 'Bävrarna', 'Spårare', 'Granlidens scoutkår'],
		[112, 'Lodjuren', 'Upptäckare', 'Granlidens scoutkår'], [115, 'Grävlingarna', 'Upptäckare', 'Sjöviks sjöscoutkår'],
		[119, 'Falkarna', 'Upptäckare', 'Sjöviks sjöscoutkår'], [120, 'Vargarna', 'Äventyrare', 'Tallbergets scoutkår'],
		[123, 'Ugglorna', 'Upptäckare', 'Sjöviks sjöscoutkår'], [127, 'Uttrarna', 'Spårare', 'Ekbackens scoutkår'],
		[128, 'Myrorna', 'Spårare', 'Granlidens scoutkår'], [133, 'Bofinkarna', 'Spårare', 'Björkhagens scoutkår'],
		[136, 'Rävarna', 'Äventyrare', 'Björkhagens scoutkår'], [137, 'Hackspettarna', 'Upptäckare', 'Sjöviks sjöscoutkår'],
		[141, 'Korparna', 'Äventyrare', 'Tallbergets scoutkår'], [144, 'Hjortarna', 'Upptäckare', 'Tallbergets scoutkår']
	];
	const patrols = await db
		.insert(s.patrol)
		.values(patrolDefs.map(([number, name, track, troop]) => ({
			competitionId: open.id, number, name, trackId: T[track], troop, status: 'active' as const,
			contactName: 'Kontakt ' + name, contactPhone: '070-000 00 ' + String(number).slice(-2), contactEmail: `${name.toLowerCase()}@example.org`
		})))
		.returning();
	await db.insert(s.member).values(
		patrols.flatMap((p) => ['Elsa', 'Noah', 'Maja', 'Liam'].map((firstName, i) => ({ patrolId: p.id, firstName, lastName: ['Ek', 'Berg', 'Lind', 'Holm'][i] })))
	);

	// A few admin-entered scores so results/HQ have something to show; two patrols tie.
	const rangeItems = items.filter((i) => i.mode === 'RANGE' && stations.find((st) => st.id === i.stationId)?.name !== 'Mål').slice(0, 5);
	const byNr = Object.fromEntries(patrols.map((p) => [p.number, p]));
	const sheet: Record<number, [number, number][]> = {
		112: [[18, 4], [15, 3], [20, 4], [12, 3]],
		137: [[18, 4], [15, 3], [20, 4], [12, 3]],
		123: [[20, 5], [19, 4], [18, 5], [17, 4], [16, 4]],
		115: [[17, 4], [20, 5], [16, 4], [18, 3]],
		119: [[9, 2], [12, 3]],
		144: [[14, 3], [11, 2], [13, 3]],
		141: [[16, 4], [18, 5], [19, 4], [20, 5], [15, 4]],
		120: [[15, 4], [17, 4], [14, 3], [19, 5]]
	};
	for (const [nr, rows] of Object.entries(sheet)) {
		for (const [i, [points, style]] of rows.entries()) {
			const it = rangeItems[i];
			const [sc] = await db
				.insert(s.score)
				.values({ competitionId: open.id, patrolId: byNr[nr].id, itemId: it.id, points, stylePoints: style, raw: { value: points, style }, origin: 'admin', userId: erik.id })
				.returning();
			await db.insert(s.scoreRevision).values({ scoreId: sc.id, version: 1, points, stylePoints: style, state: 'active', origin: 'admin', userId: erik.id, reason: 'seed' });
		}
	}

	// Event branding images: invented for the demo (scripts/make-seed-assets.ts renders them).
	for (const [kind, file] of [['event_logo', 'gokopen-logo.png'], ['organiser_logo', 'granliden-logo.png'], ['cover', 'gokopen-cover.png']] as const) {
		const v = validateImage(new Uint8Array(readFileSync(join(import.meta.dirname, 'seed-assets', file))));
		if (!v.ok) throw new Error(`${file}: ${v.reason}`);
		await db.insert(s.asset).values({
			competitionId: open.id, kind, mime: v.mime, size: v.bytes.length, width: v.width, height: v.height,
			sha256: createHash('sha256').update(v.bytes).digest('hex'), data: v.bytes, uploadedBy: erik.id
		});
	}

	// ---------- GökHajk 2027: three days ----------
	const [hajk] = await db
		.insert(s.competition)
		.values({
			slug: 'gokhajk-2027', name: 'GökHajk 2027', ownerGroupNo: '90', ownerGroupName: 'Göteborgs scoutdistrikt', multiDay: true,
			startDate: '2027-05-14', endDate: '2027-05-16', location: 'Gökskogen', status: 'draft', patrolCodeKey: 'dev-key-gokhajk', createdBy: erik.id
		})
		.returning();
	await db.insert(s.competitionMember).values({ competitionId: hajk.id, userId: erik.id, role: 'owner' });
	const days = await db
		.insert(s.day)
		.values([['2027-05-14', 'Fredag', 'F'], ['2027-05-15', 'Lördag', 'L'], ['2027-05-16', 'Söndag', 'S']].map(([date, name, prefix], i) => ({ competitionId: hajk.id, date, name, prefix, sort: i + 1 })))
		.returning();
	await db.insert(s.track).values([{ competitionId: hajk.id, name: 'Utmanare', sort: 1 }, { competitionId: hajk.id, name: 'Ledare/Rover', sort: 2 }]);
	const hajkStations: [number, string][] = [
		[0, 'Fredag start'], [0, 'Lägerbygge'], [0, 'Kvällsorientering'], [0, 'Fredag mål'],
		[1, 'Lördag start'], [1, 'Kanoten'], [1, 'Första hjälpen'], [1, 'Matlagning'], [1, 'Knopar'], [1, 'Hajk-packning'], [1, 'Nattvandring'], [1, 'Lördag mål'],
		[2, 'Söndag start'], [2, 'Naturkunskap'], [2, 'Kluringen'], [2, 'Söndag mål']
	];
	for (const [i, [d, name]] of hajkStations.entries()) {
		const checkpoint = /start$|mål$/.test(name);
		const [st] = await db.insert(s.station).values({ competitionId: hajk.id, dayId: days[d].id, sort: i + 1, name, role: name.endsWith('start') ? 'start' : name.endsWith('mål') ? 'finish' : null, startable: !checkpoint }).returning();
		await db.insert(s.scoreItem).values({
			stationId: st.id, sort: 1, name, mode: checkpoint ? 'CHECKIN' : 'RANGE', min: 0, max: checkpoint ? 0 : 20,
			styleEnabled: !checkpoint, styleMin: 0, styleMax: 5, countsForTiebreak: !checkpoint
		});
	}

	const count = await db.select().from(s.patrol).where(eq(s.patrol.competitionId, open.id));
	console.log(`Seeded: ${SLUGS.join(', ')} — ${count.length} patrols, ${items.length} items in GökOpen.`);
	await client.end();
}

main().catch(async (e) => {
	console.error(e);
	await client.end();
	process.exit(1);
});

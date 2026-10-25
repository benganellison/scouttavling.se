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

const SLUGS = ['gokopen-2026', 'gokopen-2027', 'gokhajk-2027'];
const SERIES = ['gokopen', 'gokhajk'];

type StationDef = { name: string; notSparare?: boolean; checkpoint?: boolean; distinct?: boolean; mal?: boolean };

/** The GökOpen course: stations with their items (and class limits). */
async function gokopenCourse(competitionId: string, T: Record<string, string>, defs: StationDef[]) {
	const items: (typeof s.scoreItem.$inferSelect)[] = [];
	const stations: (typeof s.station.$inferSelect)[] = [];
	for (const [i, d] of defs.entries()) {
		const [st] = await db
			.insert(s.station)
			.values({ competitionId, sort: i + 1, name: d.name, role: d.mal ? 'finish' : null, allTracks: !d.notSparare, startable: !d.checkpoint && !d.mal })
			.returning();
		stations.push(st);
		if (d.notSparare) {
			await db.insert(s.stationTrack).values(['Upptäckare', 'Äventyrare', 'Utmanare'].map((t) => ({ stationId: st.id, trackId: T[t] })));
		}
		const base = { stationId: st.id, styleMin: 0, styleMax: 5 };
		const itemDefs = d.mal
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
		items.push(...(await db.insert(s.scoreItem).values(itemDefs).returning()));
	}
	return { stations, items };
}

/** Deterministic pseudo-random numbers (mulberry32), so the seed is the same every run. */
function rng(seed: number) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

async function main() {
	await db.delete(s.competition).where(inArray(s.competition.slug, SLUGS));
	// Editions created from the demo series (e.g. by the series e2e: "Skapa GökOpen 2028") go too.
	const oldSeries = await db.select({ id: s.series.id }).from(s.series).where(inArray(s.series.slug, SERIES));
	if (oldSeries.length) {
		await db.delete(s.competition).where(inArray(s.competition.seriesId, oldSeries.map((x) => x.id)));
		await db.delete(s.series).where(inArray(s.series.id, oldSeries.map((x) => x.id)));
	}

	const [erik] = await db
		.insert(s.appUser)
		.values({ memberNo: '3000001', name: 'Erik Rydberg', email: 'erik@example.org', groups: [{ groupNo: '900', name: 'Granlidens scoutkår' }, { groupNo: '90', name: 'Göteborgs scoutdistrikt' }] })
		.onConflictDoUpdate({ target: s.appUser.memberNo, set: { name: 'Erik Rydberg' } })
		.returning();

	// ---------- Series GökOpen: shared branding and class colours ----------
	const [gokopen] = await db
		.insert(s.series)
		.values({
			slug: 'gokopen', name: 'GökOpen', ownerGroupNo: '900', ownerGroupName: 'Granlidens scoutkår', createdBy: erik.id,
			// Upptäckarblå accent (black text on it, 7.7:1); the forest cover fills its band.
			accentColor: '#00a8e1', coverFit: 'cover',
			// Class colours by name (age-group colours; Ledare = Scoutblå).
			classColors: Object.fromEntries(['Spårare', 'Upptäckare', 'Äventyrare', 'Utmanare', 'Ledare'].map((n) => [n, namedTrackColor(n)!]))
		})
		.returning();

	// ---------- GökOpen 2027: single day (the current edition) ----------
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
			// Branding is inherited from the series (no edition override).
			seriesId: gokopen.id, editionYear: 2027
		})
		.returning();
	await db.insert(s.competitionMember).values({ competitionId: open.id, userId: erik.id, role: 'owner' });

	const tracks = await db
		.insert(s.track)
		// Colours come from the series template. Ledare has no patrols yet.
		.values(['Spårare', 'Upptäckare', 'Äventyrare', 'Utmanare', 'Ledare'].map((name, i) => ({ competitionId: open.id, name, sort: i + 1 })))
		.returning();
	const T = Object.fromEntries(tracks.map((t) => [t.name, t.id]));

	const stationDefs: StationDef[] = [
		{ name: 'Lägerplatsen' }, { name: 'Naturkunskap' }, { name: 'Knopar & surrningar', distinct: true }, { name: 'Eldstaden' },
		{ name: 'Kartan & kompassen' }, { name: 'Första hjälpen' }, { name: 'Rastplatsen', checkpoint: true }, { name: 'Repstegen' },
		{ name: 'Kojbygge' }, { name: 'Kanoten', notSparare: true }, { name: 'Sinnesbanan' }, { name: 'Mörkerstigen', notSparare: true },
		{ name: 'Spårtecken' }, { name: 'Mål', mal: true }
	];
	const { stations, items } = await gokopenCourse(open.id, T, stationDefs);

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

	// Series branding images: invented for the demo (scripts/make-seed-assets.ts renders them).
	for (const [kind, file] of [['event_logo', 'gokopen-logo.png'], ['organiser_logo', 'granliden-logo.png'], ['cover', 'gokopen-cover.png']] as const) {
		const v = validateImage(new Uint8Array(readFileSync(join(import.meta.dirname, 'seed-assets', file))));
		if (!v.ok) throw new Error(`${file}: ${v.reason}`);
		await db.insert(s.asset).values({
			seriesId: gokopen.id, kind, mime: v.mime, size: v.bytes.length, width: v.width, height: v.height,
			sha256: createHash('sha256').update(v.bytes).digest('hex'), data: v.bytes, uploadedBy: erik.id
		});
	}

	// ---------- GökOpen 2026: last year's edition, closed and already archived (personal data removed) ----------
	const [prev] = await db
		.insert(s.competition)
		.values({
			slug: 'gokopen-2026', name: 'GökOpen 2026', ownerGroupNo: '900', ownerGroupName: 'Granlidens scoutkår',
			startDate: '2026-05-16', endDate: '2026-05-16', location: 'Gökskogens lägerplats', publicResults: true, status: 'closed',
			patrolCodeKey: 'dev-key-gokopen-2026', createdBy: erik.id, seriesId: gokopen.id, editionYear: 2026,
			infoText: 'GökOpen 2026 gick genom Gökskogen med tretton kontroller.', anonymisedAt: new Date('2026-06-01T10:00:00Z')
		})
		.returning();
	await db.insert(s.competitionMember).values({ competitionId: prev.id, userId: erik.id, role: 'owner' });
	const prevTracks = await db
		.insert(s.track)
		.values(['Spårare', 'Upptäckare', 'Äventyrare', 'Utmanare'].map((name, i) => ({ competitionId: prev.id, name, sort: i + 1 })))
		.returning();
	const PT = Object.fromEntries(prevTracks.map((t) => [t.name, t.id]));
	const prevCourse = await gokopenCourse(prev.id, PT, [
		{ name: 'Lägerplatsen' }, { name: 'Naturkunskap' }, { name: 'Knopar & surrningar', distinct: true }, { name: 'Eldstaden' },
		{ name: 'Kartan & kompassen' }, { name: 'Första hjälpen' }, { name: 'Rastplatsen', checkpoint: true }, { name: 'Repstegen' },
		{ name: 'Kojbygge' }, { name: 'Pilbågsskytte', notSparare: true }, { name: 'Sinnesbanan' }, { name: 'Spårtecken' }, { name: 'Mål', mal: true }
	]);
	// Patrols as kept after "Ta bort personuppgifter": number, name, kår, class, status. No members, contacts or links.
	const prevDefs: [number, string, string, string, number][] = [
		[101, 'Ekorrarna', 'Spårare', 'Granlidens scoutkår', 0.74], [102, 'Bävrarna', 'Spårare', 'Granlidens scoutkår', 0.61],
		[103, 'Myrorna', 'Spårare', 'Björkhagens scoutkår', 0.82], [104, 'Igelkottarna', 'Spårare', 'Ekbackens scoutkår', 0],
		[105, 'Lodjuren', 'Upptäckare', 'Granlidens scoutkår', 0.69], [106, 'Falkarna', 'Upptäckare', 'Sjöviks sjöscoutkår', 0.88],
		[107, 'Ugglorna', 'Upptäckare', 'Sjöviks sjöscoutkår', 0.77], [108, 'Hjortarna', 'Upptäckare', 'Tallbergets scoutkår', 0.55],
		[109, 'Tranorna', 'Upptäckare', 'Björkhagens scoutkår', 0.71], [110, 'Vargarna', 'Äventyrare', 'Tallbergets scoutkår', 0.79],
		[111, 'Rävarna', 'Äventyrare', 'Björkhagens scoutkår', 0.86], [112, 'Örnarna', 'Äventyrare', 'Ekbackens scoutkår', 0.64],
		[113, 'Älgarna', 'Utmanare', 'Ekbackens scoutkår', 0.81], [114, 'Järvarna', 'Utmanare', 'Sjöviks sjöscoutkår', 0.73]
	];
	const prevPatrols = await db
		.insert(s.patrol)
		.values(prevDefs.map(([number, name, track, troop, skill]) => ({
			competitionId: prev.id, number, name, trackId: PT[track], troop, status: skill ? ('finished' as const) : ('resigned' as const), paid: true
		})))
		.returning();
	const rand = rng(2026);
	const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));
	const stationOf = new Map(prevCourse.items.map((it) => [it.id, prevCourse.stations.find((st) => st.id === it.stationId)!]));
	const scoreRows: (typeof s.score.$inferInsert)[] = [];
	for (const p of prevPatrols) {
		const skill = prevDefs.find((d) => d[0] === p.number)![4];
		if (!skill) continue; // Återbud: never started.
		const sparare = p.trackId === PT['Spårare'];
		for (const it of prevCourse.items) {
			const st = stationOf.get(it.id)!;
			if (!st.allTracks && sparare) continue;
			const noise = () => (rand() - 0.5) * 0.5;
			let value = 0;
			let points = 0;
			if (it.mode === 'RANGE') value = points = clamp(20 * (skill + noise()), 4, 20);
			else if (it.mode === 'DISTINCT') {
				const opts = (it.distinctValues ?? []).map((d) => d.value);
				value = points = opts.length === 2 ? (rand() < 0.75 + skill / 5 ? opts[1] : opts[0]) : opts[clamp((opts.length - 1) * (skill + noise()), 0, opts.length - 1)];
			} else if (it.mode === 'COUNT') {
				value = clamp(10 * (skill + noise()), 2, 10);
				points = value * (it.countMultiplier ?? 1);
			}
			const style = it.styleEnabled ? clamp(5 * (skill + noise()), 1, 5) : null;
			scoreRows.push({
				competitionId: prev.id, patrolId: p.id, itemId: it.id, points, stylePoints: style ?? 0, raw: { value, style }, origin: 'device', updatedAt: new Date('2026-05-16T13:00:00Z')
			});
		}
	}
	const prevScores = await db.insert(s.score).values(scoreRows).returning();
	await db.insert(s.scoreRevision).values(
		prevScores.map((sc) => ({ scoreId: sc.id, version: 1, points: sc.points, stylePoints: sc.stylePoints, state: 'active' as const, origin: 'device' as const, at: sc.updatedAt }))
	);

	// ---------- GökHajk 2027: three days (a one-edition series) ----------
	const [gokhajk] = await db
		.insert(s.series)
		.values({ slug: 'gokhajk', name: 'GökHajk', ownerGroupNo: '90', ownerGroupName: 'Göteborgs scoutdistrikt', createdBy: erik.id })
		.returning();
	const [hajk] = await db
		.insert(s.competition)
		.values({
			slug: 'gokhajk-2027', name: 'GökHajk 2027', ownerGroupNo: '90', ownerGroupName: 'Göteborgs scoutdistrikt', multiDay: true,
			startDate: '2027-05-14', endDate: '2027-05-16', location: 'Gökskogen', status: 'draft', patrolCodeKey: 'dev-key-gokhajk', createdBy: erik.id,
			seriesId: gokhajk.id, editionYear: 2027
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
	console.log(`Seeded series ${SERIES.join(', ')}: ${SLUGS.join(', ')} — ${count.length} patrols, ${items.length} items in GökOpen 2027; ${prevScores.length} scores in GökOpen 2026.`);
	await client.end();
}

main().catch(async (e) => {
	console.error(e);
	await client.end();
	process.exit(1);
});

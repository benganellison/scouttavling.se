import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/env/private', () => ({ DATABASE_URL: 'postgres://unused' }));
vi.mock('./db/index.ts', () => ({ db: {}, schema: {} }));

const { computeResults } = await import('./live.ts');
type Input = import('./live.ts').ResultsInput;

/** Mirrors scripts/seed.ts for GökOpen 2027 (Upptäckare class and the first five RANGE stations). */
function seedLike(): Input {
	const stations = Array.from({ length: 8 }, (_, i) => ({ id: `st${i + 1}`, sort: i + 1, allTracks: true, trackIds: [] as string[] }));
	const items = stations.map((s, i) => ({
		id: `it${i + 1}`, stationId: s.id, sort: 1, name: `Kontroll ${i + 1}`, mode: (i === 2 ? 'DISTINCT' : 'RANGE') as 'RANGE' | 'DISTINCT',
		min: 0, max: 20, distinctValues: i === 2 ? [0, 5, 10, 15, 20].map((value) => ({ value })) : null, countMultiplier: null,
		styleEnabled: true, styleMin: 0, styleMax: 5, countsForTiebreak: true
	}));
	const range = items.filter((i) => i.mode === 'RANGE');
	const sheet: Record<number, [number, number][]> = {
		112: [[18, 4], [15, 3], [20, 4], [12, 3]],
		137: [[18, 4], [15, 3], [20, 4], [12, 3]],
		123: [[20, 5], [19, 4], [18, 5], [17, 4], [16, 4]],
		115: [[17, 4], [20, 5], [16, 4], [18, 3]],
		119: [[9, 2], [12, 3]],
		144: [[14, 3], [11, 2], [13, 3]]
	};
	const patrols = [112, 115, 119, 123, 137, 144].map((n) => ({ id: `p${n}`, number: n, name: `Patrull ${n}`, troop: 'Kår', trackId: 'upp', status: 'active' }));
	const scores = Object.entries(sheet).flatMap(([nr, rows]) =>
		rows.map(([points, stylePoints], i) => ({ patrolId: `p${nr}`, itemId: range[i].id, points, stylePoints }))
	);
	return { styleEnabled: true, tracks: [{ id: 'upp', name: 'Upptäckare', sort: 1 }], stations, items, patrols, scores };
}

describe('computeResults', () => {
	it('gives the seeded 112/137 tie a shared place', () => {
		const [upp] = computeResults(seedLike());
		const byNr = Object.fromEntries(upp.rows.map((r) => [r.number, r]));
		expect(byNr[112].place).toBe(byNr[137].place);
		expect(byNr[112].tied).toBe(true);
		expect(byNr[112].tieNote).toContain('137');
		expect(upp.rows.map((r) => r.place)).toEqual([1, 2, 3, 3, 5, 6]);
		expect(byNr[112].total).toBe(79);
		expect(byNr[112].stationsDone).toBe(4);
		expect(byNr[112].stationsTotal).toBe(8);
	});

	it('explains a tiebreak on points without style', () => {
		const input = seedLike();
		// 119 → 9+2 / 12+3 = 26; give 144 the same total with more style.
		input.scores = input.scores.filter((s) => s.patrolId !== 'p144');
		input.scores.push({ patrolId: 'p144', itemId: 'it1', points: 16, stylePoints: 5 }, { patrolId: 'p144', itemId: 'it2', points: 0, stylePoints: 5 });
		const [upp] = computeResults(input);
		const r119 = upp.rows.find((r) => r.number === 119)!;
		const r144 = upp.rows.find((r) => r.number === 144)!;
		expect(r119.place).toBeLessThan(r144.place);
		expect(r119.decidedBy).toBe('scorePoints');
		expect(r144.tieNote).toBe('Lika med 119 på totalpoäng — skiljs på poäng utan stil');
	});

	it('leaves out resigned patrols and stations of other classes', () => {
		const input = seedLike();
		input.patrols.find((p) => p.number === 119)!.status = 'resigned';
		input.stations[7].allTracks = false;
		const [upp] = computeResults(input);
		expect(upp.rows.some((r) => r.number === 119)).toBe(false);
		expect(upp.rows[0].stationsTotal).toBe(7);
	});
});

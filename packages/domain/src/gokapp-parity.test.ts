/**
 * Golden test: rank() must order real competition results exactly like gokapp.
 *
 * Fixture: Hajk-DM 2023 as stored by gokapp, anonymised (numbers only).
 * Oracle: gokappComparator (gokapp.ts), a line-by-line port of gokapp's Patrol.compareTo /
 * getNumberOfXPoints (verified against the 2023 app's compiled classes and the current source).
 * gokapp leaves exact ties in arbitrary order; scouttavling gives them a shared place.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { rank, evaluate, gokappComparator, type ScoreItemDef } from './index.ts';

const fx = JSON.parse(readFileSync(new URL('./fixtures/hajkdm2023.json', import.meta.url), 'utf8'));
type Station = { id: string; min: number; max: number; styleMin: number; styleMax: number; waypoint: boolean };
const stations: Station[] = fx.stations;
const scores: [string, string, number, number][] = fx['scores (patrolId, stationId, points, style)'];
const st = new Map(stations.map((s) => [s.id, s]));
const of = (pid: string) => scores.filter((s) => s[0] === pid);

const items: ScoreItemDef[] = stations.map((s) => ({
	id: s.id,
	name: s.id,
	mode: s.waypoint ? 'CHECKIN' : 'RANGE',
	min: s.min,
	max: s.max,
	styleEnabled: s.styleMax > 0,
	styleMin: s.styleMin,
	styleMax: s.styleMax,
	countsForTiebreak: !s.waypoint
}));

const total = (p: string) => of(p).reduce((a, s) => a + s[2] + s[3], 0);
const gokapp = gokappComparator(
	scores.map(([patrolId, stationId, points, style]) => ({ patrolId, stationId, points, style })),
	st
);

describe('gokapp parity on Hajk-DM 2023 (anonymised real data)', () => {
	it('every stored score is valid under the new score rules', () => {
		for (const [, sid, pts, style] of scores) {
			expect(() =>
				evaluate(
					items.find((i) => i.id === sid)!,
					{ value: pts, style }
				)
			).not.toThrow();
		}
	});

	for (const track of fx.tracks as { id: string; name: string }[]) {
		it(`ranks class ${track.name} exactly like gokapp`, () => {
			const ids: string[] = fx.patrols.filter((p: { track: string }) => p.track === track.id).map((p: { id: string }) => p.id);
			const ours = rank(
				ids.map((id) => ({ id, number: Number(id), scores: of(id).map(([, itemId, p, s]) => ({ itemId, points: p, stylePoints: s })) })),
				items
			);
			const place = new Map(ours.map((r) => [r.id, r.place]));
			for (const r of ours) expect(r.total, `total for ${r.id}`).toBe(total(r.id));
			const order = [...ids].sort(gokapp);
			for (let i = 1; i < order.length; i++) {
				const [a, b] = [order[i - 1], order[i]];
				if (gokapp(a, b) === 0) expect(place.get(a)).toBe(place.get(b));
				else expect(place.get(a)!).toBeLessThan(place.get(b)!);
			}
		});
	}
});

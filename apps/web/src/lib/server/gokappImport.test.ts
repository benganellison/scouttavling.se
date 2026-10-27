import { describe, expect, it } from 'vitest';
import { NEVER_READ, READS, plan, readGokapp, type GokappData } from './gokappImport.ts';

/** Invented gokapp data: two classes, a waypoint, a distinct station, a tie, a withdrawn patrol. */
function data(): GokappData {
	const at = (hhmm: string) => new Date(`2023-05-13T${hhmm}:00Z`);
	return {
		configName: 'Påhittade Hajken',
		tracks: [{ id: 1, name: 'Spårare' }, { id: 2, name: 'Upptäckare' }],
		stations: [
			{ id: 10, stationnumber: 1, stationname: 'Eldstaden', alltracks: true, minscore: 0, maxscore: 20, minstylescore: 0, maxstylescore: 5, waypoint: false, usedistinctscores: false, distinctscores: null },
			{ id: 11, stationnumber: 2, stationname: 'Rastplats', alltracks: true, minscore: 0, maxscore: 0, minstylescore: 0, maxstylescore: 0, waypoint: true, usedistinctscores: false, distinctscores: null },
			{ id: 12, stationnumber: 3, stationname: 'Nödbrev', alltracks: false, minscore: 0, maxscore: 20, minstylescore: 0, maxstylescore: 0, waypoint: false, usedistinctscores: true, distinctscores: '0,20' }
		],
		stationTracks: [{ station_id: 12, tracks_id: 2 }],
		patrols: [
			{ patrolid: 101, patrolname: 'Ekorrarna', troop: 'Påhittsby scoutkår', fk_track: 1, status: 'FINISHED' },
			{ patrolid: 102, patrolname: 'Bävrarna', troop: 'Påhittsby scoutkår', fk_track: 1, status: 'FINISHED' },
			{ patrolid: 201, patrolname: 'Falkarna', troop: 'Hittepå scoutkår', fk_track: 2, status: 'FINISHED' },
			{ patrolid: 202, patrolname: 'Ugglorna', troop: 'Hittepå scoutkår', fk_track: 2, status: 'ACTIVE' },
			{ patrolid: 203, patrolname: 'Rävarna', troop: 'Hittepå scoutkår', fk_track: 2, status: 'RESIGNED' }
		],
		scores: [
			{ patrol_id: 101, station_id: 10, score_point: 15, style_point: 3, visited_waypoint: false, last_saved: at('08:00') },
			{ patrol_id: 101, station_id: 11, score_point: 0, style_point: 0, visited_waypoint: true, last_saved: at('08:30') },
			{ patrol_id: 102, station_id: 10, score_point: 15, style_point: 3, visited_waypoint: false, last_saved: at('08:10') },
			{ patrol_id: 102, station_id: 11, score_point: 0, style_point: 0, visited_waypoint: false, last_saved: at('08:40') },
			{ patrol_id: 201, station_id: 10, score_point: 18, style_point: 4, visited_waypoint: false, last_saved: at('09:00') },
			{ patrol_id: 201, station_id: 12, score_point: 20, style_point: 0, visited_waypoint: false, last_saved: at('09:30') },
			// A duplicate (old database without the unique key): the later save wins.
			{ patrol_id: 202, station_id: 10, score_point: 9, style_point: 1, visited_waypoint: false, last_saved: at('09:05') },
			{ patrol_id: 202, station_id: 10, score_point: 19, style_point: 5, visited_waypoint: false, last_saved: at('09:50') },
			// 7 is not one of Nödbrev's values (0, 20): kept as it was, reported.
			{ patrol_id: 202, station_id: 12, score_point: 7, style_point: 0, visited_waypoint: false, last_saved: at('10:20') }
		]
	};
}

const OPTS = { series: 'pahittade-hajken', seriesName: 'Påhittade Hajken', year: 2023, withTimes: true };

describe('gokapp import: what is read', () => {
	it('never selects a column that holds personal data', () => {
		for (const q of Object.values(READS)) {
			const words = q.toLowerCase().match(/[a-z_]+/g)!;
			expect(q).not.toMatch(/\*/);
			for (const col of NEVER_READ) expect(words, `${col} in "${q}"`).not.toContain(col);
		}
	});
	it('runs exactly the allowlisted queries and maps MySQL BIT(1) buffers', async () => {
		const asked: string[] = [];
		const rows: Record<string, unknown[]> = {
			[READS.config]: [{ name: 'X' }], [READS.tracks]: [], [READS.stationTracks]: [], [READS.patrols]: [],
			[READS.stations]: [{ id: 1, stationnumber: 1, stationname: 'A', alltracks: Buffer.from([1]), minscore: 0, maxscore: 20, minstylescore: 0, maxstylescore: 5, waypoint: Buffer.from([0]), usedistinctscores: Buffer.from([0]), distinctscores: null }],
			[READS.scores]: [{ patrol_id: 1, station_id: 1, score_point: 5, style_point: 1, visited_waypoint: Buffer.from([1]), last_saved: null }]
		};
		const d = await readGokapp({ query: async (sql: string) => (asked.push(sql), [rows[sql] ?? [], []]) });
		expect(asked.sort()).toEqual(Object.values(READS).sort());
		expect(d.stations[0]).toMatchObject({ alltracks: true, waypoint: false, usedistinctscores: false });
		expect(d.scores[0].visited_waypoint).toBe(true);
	});
});

describe('gokapp import: plan', () => {
	it('maps stations, keeps the last duplicate, reports off-rule scores and matches gokapp ranking', () => {
		const { plan: p, built } = plan(data(), OPTS);
		expect(p).toMatchObject({ name: 'Påhittade Hajken 2023', slug: 'pahittade-hajken-2023', date: '2023-05-13', dateGuessed: true, stations: 3, patrols: 5 });
		expect([...built.items.values()].map((i) => i.mode)).toEqual(['RANGE', 'CHECKIN', 'DISTINCT']);
		// 102 never visited the waypoint → no row; 202's duplicate collapsed.
		expect(p.scores).toBe(7);
		expect(built.scores.find((s) => s.patrol === 202 && s.station === 10)).toMatchObject({ points: 19, style: 5 });
		expect(p.skipped.some((s) => s.startsWith('dubblett'))).toBe(true);
		expect(p.offRule).toEqual([expect.objectContaining({ patrol: 202, station: 'Nödbrev', points: 7 })]);
		expect(p.rankingDiffs).toEqual([]);
		// 101 and 102 tie exactly and share first place; the withdrawn patrol is not ranked.
		expect(p.classes[0].podium.map((r) => r.place)).toEqual([1, 1]);
		expect(p.classes[1].podium.map((r) => r.number)).toEqual([201, 202]);
		expect(p.timedScores).toBe(7);
	});
	it('can leave the times out and take the date from the command line', () => {
		const { plan: p } = plan(data(), { ...OPTS, withTimes: false, date: '2023-05-14' });
		expect(p.timedScores).toBe(0);
		expect(p).toMatchObject({ date: '2023-05-14', dateGuessed: false });
	});
});

import { describe, expect, it } from 'vitest';
import { buildReads, COLUMNS_QUERY, FIELDS, NEVER_READ, plan, readGokapp, stationNaming, type GokappData } from './gokappImport.ts';

/** Invented gokapp data: two classes, a waypoint, a distinct station, a tie, a withdrawn patrol. */
function data(): GokappData {
	const at = (hhmm: string) => new Date(`2023-05-13T${hhmm}:00Z`);
	return {
		configName: 'Påhittade Hajken',
		tracks: [
			{ id: 1, name: 'Spårare' },
			{ id: 2, name: 'Upptäckare' }
		],
		stations: [
			{
				id: 10,
				stationnumber: 1,
				stationname: 'Eldstaden',
				alltracks: true,
				minscore: 0,
				maxscore: 20,
				minstylescore: 0,
				maxstylescore: 5,
				waypoint: false,
				usedistinctscores: false,
				distinctscores: null
			},
			{
				id: 11,
				stationnumber: 2,
				stationname: 'Rastplats',
				alltracks: true,
				minscore: 0,
				maxscore: 0,
				minstylescore: 0,
				maxstylescore: 0,
				waypoint: true,
				usedistinctscores: false,
				distinctscores: null
			},
			{
				id: 12,
				stationnumber: 3,
				stationname: 'Nödbrev',
				alltracks: false,
				minscore: 0,
				maxscore: 20,
				minstylescore: 0,
				maxstylescore: 0,
				waypoint: false,
				usedistinctscores: true,
				distinctscores: '0,20'
			}
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

/** Column names as information_schema reports them: today's gokapp and the 2023 version. */
const CURRENT: Record<string, string[]> = {
	config: ['id', 'name', 'allowpublicresult', 'phone', 'use_qr'],
	track: ['id', 'name'],
	station: [
		'id',
		'stationnumber',
		'stationname',
		'alltracks',
		'minscore',
		'maxscore',
		'minstylescore',
		'maxstylescore',
		'stationcontact',
		'stationphone',
		'waypoint',
		'usedistinctscores',
		'distinctscores',
		'user_id'
	],
	station_track: ['station_id', 'tracks_id'],
	patrol: [
		'patrolid',
		'externalid',
		'patrolname',
		'troop',
		'fk_track',
		'starttime',
		'endtime',
		'members',
		'note',
		'leadercontact',
		'contactmail',
		'leadercontactphone',
		'status',
		'date_registered',
		'paid',
		'fk_station'
	],
	score: ['id', 'station_id', 'patrol_id', 'score_point', 'style_point', 'visited_waypoint', 'last_saved'],
	users: ['id', 'username', 'password']
};
const V2023: Record<string, string[]> = {
	config: ['id', 'allowpublicresult', 'name', 'phone'],
	track: ['trackid', 'trackname'],
	station: [
		'stationid',
		'maxscore',
		'maxstylescore',
		'minscore',
		'minstylescore',
		'stationcontact',
		'stationname',
		'stationnumber',
		'stationphone',
		'stationuser',
		'waypoint'
	],
	patrol: [
		'patrolid',
		'date_registered',
		'endtime',
		'externalid',
		'leadercontact',
		'contactmail',
		'leaderContactPhone',
		'members',
		'note',
		'paid',
		'patrolname',
		'starttime',
		'status',
		'troop',
		'fk_station',
		'fk_track'
	],
	score: ['scoreid', 'lastSaved', 'scorepoint', 'stylepoint', 'visitedWaypoint', 'fk_patrol', 'fk_station'],
	users: ['id', 'username', 'password']
};
const cols = (v: Record<string, string[]>) => Object.entries(v).flatMap(([t, cs]) => cs.map((c) => ({ t, c })));

describe('gokapp import: what is read', () => {
	it('no allowlisted column name holds personal data', () => {
		for (const fields of Object.values(FIELDS))
			for (const { cols: names } of Object.values(fields)) for (const n of names) expect(NEVER_READ).not.toContain(n.toLowerCase());
	});
	for (const [name, version] of [
		['current', CURRENT],
		['2023', V2023]
	] as const) {
		it(`builds SELECTs without a personal column for the ${name} schema`, () => {
			const reads = buildReads(cols(version));
			expect(Object.keys(reads).sort()).toEqual(
				name === '2023' ? ['config', 'patrol', 'score', 'station', 'track'] : ['config', 'patrol', 'score', 'station', 'station_track', 'track']
			);
			for (const q of Object.values(reads)) {
				expect(q).not.toMatch(/\*/);
				const words = q!.toLowerCase().match(/[a-z_]+/g)!;
				for (const col of NEVER_READ) expect(words, `${col} in "${q}"`).not.toContain(col);
			}
		});
	}
	it('maps the 2023 names and refuses a database without gokapp tables', () => {
		expect(buildReads(cols(V2023)).score).toBe(
			'SELECT `fk_patrol` AS `patrol_id`, `fk_station` AS `station_id`, `scorepoint` AS `score_point`, `stylepoint` AS `style_point`, `visitedWaypoint` AS `visited_waypoint`, `lastSaved` AS `last_saved` FROM `score`'
		);
		expect(() => buildReads([{ t: 'foo', c: 'id' }])).toThrow(/track/);
	});
	it('reads a 2023 database: only the column list and the built SELECTs, BIT(1) as booleans', async () => {
		const asked: string[] = [];
		const reads = buildReads(cols(V2023));
		const rows = new Map<string, unknown[]>([
			[COLUMNS_QUERY, cols(V2023)],
			[reads.config!, [{ name: 'X' }]],
			[reads.track!, [{ id: 1, name: 'Spårare' }]],
			[reads.patrol!, []],
			[
				reads.station!,
				[{ id: 1, stationnumber: 1, stationname: 'A', minscore: 0, maxscore: 20, minstylescore: 0, maxstylescore: 5, waypoint: Buffer.from([0]) }]
			],
			[reads.score!, [{ patrol_id: 1, station_id: 1, score_point: 5, style_point: 1, visited_waypoint: Buffer.from([1]), last_saved: null }]]
		]);
		const d = await readGokapp({ query: async (sql: string) => (asked.push(sql), [rows.get(sql) ?? [], []]) });
		expect(asked.sort()).toEqual([COLUMNS_QUERY, ...Object.values(reads)].sort());
		// Columns the 2023 version did not have: every station for every class, no distinct values.
		expect(d.stations[0]).toMatchObject({ alltracks: true, waypoint: false, usedistinctscores: null, distinctscores: null });
		expect(d.stationTracks).toEqual([]);
		expect(d.scores[0].visited_waypoint).toBe(true);
	});
});

describe('gokapp import: station names', () => {
	it('takes a code from the name and the start/finish role from "Start"/"Mål"', () => {
		expect(stationNaming('F1 Eldstaden')).toEqual({ name: 'Eldstaden', code: 'F1', role: null });
		expect(stationNaming('Lördag Start')).toEqual({ name: 'Lördag Start', code: null, role: 'start' });
		expect(stationNaming('Söndag Mål!')).toEqual({ name: 'Söndag Mål!', code: null, role: 'finish' });
		expect(stationNaming('Målgång och Startgrop')).toEqual({ name: 'Målgång och Startgrop', code: null, role: null });
		expect(stationNaming('Eldstaden')).toEqual({ name: 'Eldstaden', code: null, role: null });
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
	it('a hajk over several days gets days, and each station the day most of its scores were saved', () => {
		const d = data();
		const day2 = (s: (typeof d.scores)[number]) => ({ ...s, last_saved: new Date(s.last_saved!.getTime() + 86400_000) });
		// Kartan-like: everything at Nödbrev (id 12) and the waypoint (11) happened the next day.
		d.scores = d.scores.map((s) => (s.station_id === 12 || s.station_id === 11 ? day2(s) : s));
		const { plan: p, built } = plan(d, OPTS);
		expect(p.days).toEqual(['2023-05-13', '2023-05-14']);
		expect(p.stationDays).toEqual({ Eldstaden: '2023-05-13', Rastplats: '2023-05-14', Nödbrev: '2023-05-14' });
		expect(built.stationDay.get(10)).toBe('2023-05-13');
		// --date makes it one day.
		expect(plan(d, { ...OPTS, date: '2023-05-13' }).plan.days).toEqual(['2023-05-13']);
	});
	it('can leave the times out and take the date from the command line', () => {
		const { plan: p } = plan(data(), { ...OPTS, withTimes: false, date: '2023-05-14' });
		expect(p.timedScores).toBe(0);
		expect(p).toMatchObject({ date: '2023-05-14', dateGuessed: false });
	});
});

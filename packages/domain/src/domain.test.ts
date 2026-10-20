import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
	buildImport, daysBetween, distribute, evaluate, guessColumns, InvalidScoreError, isScoutnetExport,
	normalizePhone, parseCsv, parseHtmlTable, parseMembers, parsePatrolCode, patrolCodeUrl, rank,
	rankOfValue, roleFromName, stationCodes, verifyPatrolCode, type ScoreItemDef
} from './index.ts';

const rangeItem = (id: string, max = 20, style = true): ScoreItemDef => ({
	id, name: id, mode: 'RANGE', min: 0, max, styleEnabled: style, styleMin: 0, styleMax: 5, countsForTiebreak: true
});
const nodbrev: ScoreItemDef = {
	id: 'nod', name: 'Nödbrev', mode: 'DISTINCT', min: 0, max: 20,
	distinctValues: [{ value: 0, label: 'Ej inlämnat / öppnat' }, { value: 20, label: 'Oöppnat' }],
	styleEnabled: false, styleMin: 0, styleMax: 0, countsForTiebreak: true
};
const lunch: ScoreItemDef = { id: 'lunch', name: 'Rastplatsen', mode: 'CHECKIN', min: 0, max: 0, styleEnabled: false, styleMin: 0, styleMax: 0, countsForTiebreak: false };

describe('evaluate', () => {
	it('accepts range values and style', () => {
		expect(evaluate(rangeItem('a'), { value: 17, style: 3 })).toEqual({ points: 17, stylePoints: 3 });
	});
	it('rejects out-of-range, non-integer and missing style', () => {
		expect(() => evaluate(rangeItem('a'), { value: 21, style: 0 })).toThrow(InvalidScoreError);
		expect(() => evaluate(rangeItem('a'), { value: 2.5, style: 0 })).toThrow(InvalidScoreError);
		expect(() => evaluate(rangeItem('a'), { value: 5 })).toThrow(InvalidScoreError);
	});
	it('ignores style when the item has style points switched off', () => {
		expect(evaluate(rangeItem('a', 20, false), { value: 5, style: 4 })).toEqual({ points: 5, stylePoints: 0 });
	});
	it('only allows the distinct values (nödbrev 0 or 20)', () => {
		expect(evaluate(nodbrev, { value: 20 }).points).toBe(20);
		expect(() => evaluate(nodbrev, { value: 10 })).toThrow(InvalidScoreError);
	});
	it('multiplies COUNT items (orientering: hittade skärmar × 2)', () => {
		const o: ScoreItemDef = { ...rangeItem('o', 10, false), mode: 'COUNT', countMultiplier: 2 };
		expect(evaluate(o, { value: 8 }).points).toBe(16);
		expect(rankOfValue(o, 16)).toBe(2);
	});
	it('checkpoints carry no points and never enter the tiebreak', () => {
		expect(evaluate(lunch, { value: 99 })).toEqual({ points: 0, stylePoints: 0 });
		expect(rankOfValue(lunch, 0)).toBe(-1);
	});
});

describe('rank', () => {
	const items = [rangeItem('a'), rangeItem('b'), nodbrev, lunch];
	it('orders by total, then points without style, then tiebreak cascade', () => {
		const r = rank(
			[
				{ id: 'x', number: 1, scores: [{ itemId: 'a', points: 10, stylePoints: 5 }] },
				{ id: 'y', number: 2, scores: [{ itemId: 'a', points: 15, stylePoints: 0 }] },
				{ id: 'z', number: 3, scores: [{ itemId: 'a', points: 20, stylePoints: 0 }, { itemId: 'b', points: 0, stylePoints: 0 }] }
			],
			items
		);
		expect(r.map((p) => p.id)).toEqual(['z', 'y', 'x']);
		expect(r[1].decidedBy).toBe('scorePoints');
	});
	it('breaks equal points on number of top scores', () => {
		const r = rank(
			[
				{ id: 'even', number: 1, scores: [{ itemId: 'a', points: 15, stylePoints: 0 }, { itemId: 'b', points: 15, stylePoints: 0 }] },
				{ id: 'peak', number: 2, scores: [{ itemId: 'a', points: 20, stylePoints: 0 }, { itemId: 'b', points: 10, stylePoints: 0 }] }
			],
			items
		);
		expect(r[0].id).toBe('peak');
		expect(r[0].decidedBy).toBe('tiebreak');
	});
	it('exact ties share the place: 1, 2, 2, 4', () => {
		const s = (p: number) => [{ itemId: 'a', points: p, stylePoints: 0 }];
		const r = rank(
			[
				{ id: 'a', number: 10, scores: s(20) },
				{ id: 'b', number: 12, scores: s(15) },
				{ id: 'c', number: 11, scores: s(15) },
				{ id: 'd', number: 13, scores: s(5) }
			],
			items
		);
		expect(r.map((p) => p.place)).toEqual([1, 2, 2, 4]);
		expect(r.map((p) => p.number)).toEqual([10, 11, 12, 13]);
		expect(r[1].tied && r[2].tied).toBe(true);
	});
	it('is a total preorder (property test)', () => {
		const score = fc.record({ itemId: fc.constantFrom('a', 'b'), points: fc.integer({ min: 0, max: 20 }), stylePoints: fc.integer({ min: 0, max: 5 }) });
		fc.assert(
			fc.property(fc.array(fc.array(score, { maxLength: 2 }), { minLength: 1, maxLength: 12 }), (lists) => {
				const r = rank(lists.map((scores, i) => ({ id: `p${i}`, number: i + 1, scores })), items);
				for (let i = 1; i < r.length; i++) {
					expect(r[i].place).toBeGreaterThanOrEqual(r[i - 1].place);
					expect(r[i].total).toBeLessThanOrEqual(r[i - 1].total);
				}
				expect(r[0].place).toBe(1);
			})
		);
	});
});

describe('station codes', () => {
	it('uses K1… for single-day competitions', () => {
		const m = stationCodes([{ id: 'a', dayId: null, order: 2, name: 'Eldstaden' }, { id: 'b', dayId: null, order: 1, name: 'Start' }], []);
		expect([m.get('b'), m.get('a')]).toEqual(['K1', 'K2']);
	});
	it('uses day prefix + order with S/M for start and finish', () => {
		const days = [{ id: 'f', prefix: 'F' }, { id: 'l', prefix: 'L' }];
		const st = [
			{ id: '1', dayId: 'f', order: 1, name: 'Fredag start' }, { id: '2', dayId: 'f', order: 2, name: 'Lägerbygge' },
			{ id: '3', dayId: 'f', order: 3, name: 'Fredag mål' }, { id: '4', dayId: 'l', order: 4, name: 'Lördag start' },
			{ id: '5', dayId: 'l', order: 5, name: 'Kanoten' }, { id: '6', dayId: 'l', order: 6, name: 'Matlagning', customCode: 'MAT' }
		];
		const m = stationCodes(st, days);
		expect(st.map((s) => m.get(s.id))).toEqual(['FS', 'F1', 'FM', 'LS', 'L1', 'MAT']);
	});
	it('prefers the explicit role over the name', () => {
		const days = [{ id: 'f', prefix: 'F' }, { id: 'l', prefix: 'L' }];
		const st = [
			{ id: '1', dayId: 'f', order: 1, name: 'Samling', role: 'start' as const },
			{ id: '2', dayId: 'f', order: 2, name: 'Lägerbygge', role: null },
			{ id: '3', dayId: 'f', order: 3, name: 'Kvällsincheckning', role: 'finish' as const },
			// explicitly an ordinary station despite the name
			{ id: '4', dayId: 'l', order: 4, name: 'Bivack mål', role: null },
			// no role stored: the name rule is the fallback
			{ id: '5', dayId: 'l', order: 5, name: 'Lördag mål' }
		];
		const m = stationCodes(st, days);
		expect(st.map((s) => m.get(s.id))).toEqual(['FS', 'F1', 'FM', 'L1', 'LM']);
	});
	it('derives a role from the name (case-insensitive)', () => {
		expect([roleFromName('Fredag START'), roleFromName('Lördag Mål '), roleFromName('Målgång'), roleFromName('Eldstaden')]).toEqual(['start', 'finish', null, null]);
	});
	it('generates Swedish day names and unique prefixes', () => {
		expect(daysBetween('2027-05-14', '2027-05-16').map((d) => `${d.name}:${d.prefix}`)).toEqual(['Fredag:F', 'Lördag:L', 'Söndag:S']);
	});
});

describe('distribute', () => {
	const stations = Array.from({ length: 14 }, (_, i) => ({ id: `k${i + 1}`, order: i + 1, trackIds: [10, 12].includes(i + 1) ? ['up'] : null, startable: i + 1 !== 7 }));
	const patrols = [
		...Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, trackId: 'sp' })),
		...Array.from({ length: 14 }, (_, i) => ({ id: `u${i}`, trackId: 'up' }))
	];
	it('BALANCED never starts a track at a station it does not do, and stays even', () => {
		const r = distribute(patrols, stations, 'BALANCED', 3);
		expect(r.ineligible).toBe(0);
		expect(r.assignment.has('k7')).toBe(false);
		const counts = [...r.counts.values()];
		expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
		expect(r.assignment.size).toBe(patrols.length);
	});
	it('keeps locked patrols where the organiser put them', () => {
		const r = distribute([{ ...patrols[0], lockedStationId: 'k3' }, ...patrols.slice(1)], stations, 'BALANCED', 9);
		expect(r.assignment.get('s0')).toBe('k3');
	});
	it('ALL and PER_TRACK reproduce gokapp behaviour (may pick ineligible stations)', () => {
		for (const s of ['ALL', 'PER_TRACK'] as const) expect(distribute(patrols, stations, s, 1).assignment.size).toBe(patrols.length);
	});
});

describe('patrol QR code', () => {
	it('round-trips and rejects forged checks', async () => {
		const url = await patrolCodeUrl('https://scouttavling.se', 'secret', 'gokopen-2027', 112);
		const code = parsePatrolCode(url)!;
		expect(code).toMatchObject({ comp: 'gokopen-2027', nr: 112 });
		expect(await verifyPatrolCode('secret', code)).toBe(true);
		expect(await verifyPatrolCode('secret', { ...code, nr: 113 })).toBe(false);
		expect(parsePatrolCode('https://example.com/whatever')).toBeNull();
	});
});

describe('import', () => {
	const html = `<html><body><table>
<tr><th>Medlemsnummer</th><th>Namn</th><th>Personnummer</th><th>Kår</th><th>Adress</th><th>Telefonnummer</th><th>Anmäld</th><th>Betalda skulder. Höst 2026</th><th>Anmälan till Test - Scoutkår</th><th>Anmälan till Test - Mobilnummer</th><th>Anmälan till Test - Epostadress</th><th>Anmälan till Test - Patrullnamn / kontrollnummer</th><th>Anmälan till Test - Förnamn, Efternamn, kår och födelseår på alla i patrullen</th><th>Anmälan till Test - Vilken klass tävlar ni i?</th></tr>
<tr><td>1000001</td><td>Karin Test</td><td>198001019999</td><td>Granlidens Scoutkår</td><td>Gatan 1</td><td>0701</td><td>Ja</td><td>Betald</td><td>Granlidens Scoutkår</td><td>0703- 364731</td><td>Karin@Example.org</td><td>Lodjuren</td><td>Elsa Ek, 2008, Granliden<br>Noah Berg 2007<br>+ ev. en till</td><td>Utmanare</td></tr>
<tr><td>1000002</td><td>Per Test</td><td>199001019999</td><td>Ekbacken</td><td>Gatan 2</td><td>0702</td><td>Ja</td><td>Obetald, ej förfallen</td><td>granlidens scoutkår</td><td>070-1112233</td><td>per@example.org</td><td>Gamla gubbar</td><td>Per Test, 1975</td><td>Ledare/Rover</td></tr>
<tr><td>1000003</td><td>Ida Test</td><td>200001019999</td><td>Ekbacken</td><td>Gatan 3</td><td>0703</td><td>Nej</td><td>-</td><td>Ekbacken</td><td>070-0000000</td><td>ida@example.org</td><td>Avhoppet</td><td>Ida Test 2000</td><td>Utmanare</td></tr>
</table></body></html>`;
	it('recognises a Scoutnet export and never maps sensitive columns', () => {
		const t = parseHtmlTable(html);
		expect(isScoutnetExport(t[0])).toBe(true);
		const cols = guessColumns(t);
		const byHeader = Object.fromEntries(cols.map((c) => [c.header, c.field]));
		expect(byHeader['Personnummer']).toBe('ignore');
		expect(cols.find((c) => c.header === 'Personnummer')!.sensitive).toBe(true);
		expect(cols.find((c) => c.header === 'Adress')!.example).toBe('');
		expect(byHeader['Kår']).toBe('ignore');
		expect(byHeader['Anmälan till Test - Scoutkår']).toBe('troop');
		expect(byHeader['Anmälan till Test - Patrullnamn / kontrollnummer']).toBe('patrolName');
		expect(byHeader['Medlemsnummer']).toBe('contactMemberNo');
	});
	it('builds rows, skips Anmäld=Nej, strips birth years, flags issues', () => {
		const t = parseHtmlTable(html);
		const r = buildImport(t, guessColumns(t), ['Utmanare']);
		expect(r.rows).toHaveLength(2);
		expect(r.skipped).toBe(1);
		expect(JSON.stringify(r.rows)).not.toMatch(/19\d\d|20\d\d/);
		expect(JSON.stringify(r.rows)).not.toContain('Gatan');
		expect(r.rows[0].contactPhone).toBe('070-336 47 31');
		expect(r.rows[0].contactEmail).toBe('karin@example.org');
		expect(r.rows[0].members[0]).toMatchObject({ firstName: 'Elsa', lastName: 'Ek' });
		const kinds = r.issues.map((i) => i.kind);
		expect(kinds).toEqual(expect.arrayContaining(['unknownTrack', 'troopSpelling', 'members', 'skipped', 'phones']));
	});
	it('parses semicolon CSV with quotes', () => {
		expect(parseCsv('Patrullnamn;Klass\n"Lodjuren; bäst";Spårare\n')).toEqual([['Patrullnamn', 'Klass'], ['Lodjuren; bäst', 'Spårare']]);
	});
	it('normalises phones and members', () => {
		expect(normalizePhone('+46 70 333 44 55')).toBe('070-333 44 55');
		expect(parseMembers('Anna Berg\tGranliden 2010')[0]).toMatchObject({ firstName: 'Anna', lastName: 'Berg Granliden' });
	});
});

import { describe, expect, it } from 'vitest';
import { matchExisting, parseImportPayload } from './validate.ts';

const row = (over: Record<string, unknown> = {}) => ({
	patrolName: 'Ekorrarna',
	trackText: 'Upptäckare',
	troop: 'Påhittade scoutkåren',
	contactName: 'Kim Testsson',
	contactPhone: '070-123 45 67',
	contactEmail: 'kim@example.org',
	contactMemberNo: '1234567',
	members: [{ firstName: 'Alva', lastName: 'Påhitt', troopText: '' }],
	paid: false,
	...over
});

describe('parseImportPayload', () => {
	it('accepts a well-formed payload (JSON string or object)', () => {
		const p = { rows: [row()], createTracks: ['Ledare/Rover'] };
		expect(parseImportPayload(JSON.stringify(p))).toMatchObject({ ok: true });
		const res = parseImportPayload(p);
		expect(res.ok && res.payload.rows[0].patrolName).toBe('Ekorrarna');
	});

	it('rejects unknown fields on rows, members and the payload', () => {
		expect(parseImportPayload({ rows: [row({ personnummer: '20100101-1234' })], createTracks: [] }).ok).toBe(false);
		expect(parseImportPayload({ rows: [row({ birthYear: 2010 })], createTracks: [] }).ok).toBe(false);
		expect(parseImportPayload({ rows: [row({ members: [{ firstName: 'A', lastName: 'B', troopText: '', born: '2010' }] })], createTracks: [] }).ok).toBe(false);
		expect(parseImportPayload({ rows: [row()], createTracks: [], extra: 1 }).ok).toBe(false);
	});

	it('rejects personnummer-looking values in free text', () => {
		expect(parseImportPayload({ rows: [row({ contactName: 'Kim 201001011234' })], createTracks: [] }).ok).toBe(false);
		expect(parseImportPayload({ rows: [row({ members: [{ firstName: 'Alva', lastName: '100101-1234', troopText: '' }] })], createTracks: [] }).ok).toBe(false);
		// A normal mobile number is fine.
		expect(parseImportPayload({ rows: [row({ contactPhone: '0701234567' })], createTracks: [] }).ok).toBe(true);
	});

	it('requires names, valid emails and member numbers', () => {
		expect(parseImportPayload({ rows: [row({ patrolName: '  ' })], createTracks: [] }).ok).toBe(false);
		expect(parseImportPayload({ rows: [row({ contactEmail: 'not-an-email' })], createTracks: [] }).ok).toBe(false);
		expect(parseImportPayload({ rows: [row({ contactMemberNo: '12a' })], createTracks: [] }).ok).toBe(false);
		expect(parseImportPayload({ rows: [row({ paid: 'ja' })], createTracks: [] }).ok).toBe(false);
		expect(parseImportPayload({ rows: [], createTracks: [] }).ok).toBe(false);
	});

	it('rejects garbage', () => {
		expect(parseImportPayload('{not json').ok).toBe(false);
		expect(parseImportPayload(null).ok).toBe(false);
		expect(parseImportPayload({ rows: 'x', createTracks: [] }).ok).toBe(false);
	});
});

describe('member fields', () => {
	it('refuses any digit in a member field (birth dates, ages), even past the browser', () => {
		for (const m of [{ firstName: 'Elsa', lastName: 'Ek 2012', troopText: '' }, { firstName: 'Elsa', lastName: 'Ek', troopText: '12 år' }, { firstName: 'Elsa', lastName: 'Ek', troopText: '-05-03' }]) {
			expect(parseImportPayload(JSON.stringify({ rows: [row({ members: [m] })], createTracks: [] })).ok, JSON.stringify(m)).toBe(false);
		}
		expect(parseImportPayload(JSON.stringify({ rows: [row()], createTracks: [] })).ok).toBe(true);
	});
});

describe('matchExisting', () => {
	const existing = [
		{ id: 'a', name: 'Ekorrarna', troop: 'Granlidens scoutkår', contactMemberNo: '999' },
		{ id: 'b', name: 'Ekorrarna', troop: 'Ekbackens scoutkår', contactMemberNo: '1234567' },
		{ id: 'c', name: 'Lodjuren', troop: '', contactMemberNo: null },
		{ id: 'd', name: 'Vargarna', troop: 'Granlidens scoutkår', contactMemberNo: null }
	];
	it('prefers member number + name', () => {
		expect(matchExisting({ patrolName: 'ekorrarna', contactMemberNo: '1234567', troop: '' }, existing)?.id).toBe('b');
	});
	it('then name + kår', () => {
		expect(matchExisting({ patrolName: 'Ekorrarna', contactMemberNo: '', troop: 'granlidens scoutkår' }, existing)?.id).toBe('a');
		expect(matchExisting({ patrolName: 'Ekorrarna', contactMemberNo: '555', troop: 'Ekbackens scoutkår' }, existing)?.id).toBe('b');
	});
	it('the name alone only when there is one such patrol and the kår does not contradict', () => {
		expect(matchExisting({ patrolName: 'Lodjuren ', contactMemberNo: '555', troop: 'Sjöviks scoutkår' }, existing)?.id).toBe('c');
		expect(matchExisting({ patrolName: 'Vargarna', contactMemberNo: '', troop: '' }, existing)?.id).toBe('d');
		// Same name, another kår: a different patrol.
		expect(matchExisting({ patrolName: 'Vargarna', contactMemberNo: '', troop: 'Tallbergets scoutkår' }, existing)).toBeNull();
		// Two patrols with the name and no way to tell which: new.
		expect(matchExisting({ patrolName: 'Ekorrarna', contactMemberNo: '', troop: '' }, existing)).toBeNull();
	});
	it('returns null for new patrols', () => {
		expect(matchExisting({ patrolName: 'Bävrarna', contactMemberNo: '', troop: '' }, existing)).toBeNull();
	});
});

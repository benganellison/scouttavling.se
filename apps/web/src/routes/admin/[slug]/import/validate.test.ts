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

describe('matchExisting', () => {
	const existing = [
		{ id: 'a', name: 'Ekorrarna', contactMemberNo: '999' },
		{ id: 'b', name: 'Ekorrarna', contactMemberNo: '1234567' },
		{ id: 'c', name: 'Lodjuren', contactMemberNo: null }
	];
	it('prefers member number + name', () => {
		expect(matchExisting({ patrolName: 'ekorrarna', contactMemberNo: '1234567' }, existing)?.id).toBe('b');
	});
	it('falls back to the name', () => {
		expect(matchExisting({ patrolName: 'Lodjuren ', contactMemberNo: '555' }, existing)?.id).toBe('c');
		expect(matchExisting({ patrolName: 'Ekorrarna', contactMemberNo: '' }, existing)?.id).toBe('a');
	});
	it('returns null for new patrols', () => {
		expect(matchExisting({ patrolName: 'Nya', contactMemberNo: '' }, existing)).toBeNull();
	});
});

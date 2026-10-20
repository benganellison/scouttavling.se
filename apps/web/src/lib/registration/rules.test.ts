import { describe, expect, it } from 'vitest';
import { canEditRegistration, dayMonth, readForm, registrationWindow, stepOf, validateManage, validateRegistration, windowText, type WindowInput } from './rules.ts';
import { RateLimiter } from '../server/rateLimit.ts';

const TRACK = '0190f3a0-0000-4000-8000-000000000001';
const base: WindowInput = {
	status: 'live', registrationOpen: true, registrationOpensOn: '2027-02-01', registrationClosesOn: '2027-05-01',
	endDate: '2027-05-15', maxPatrols: 10, patrolCount: 3, today: '2027-03-01'
};
const valid = {
	patrolName: 'Uttrarna', troop: 'Ekbackens scoutkår', trackId: TRACK,
	members: [{ firstName: 'Alva', lastName: 'Ek' }, { firstName: 'Noah', lastName: 'Lind' }],
	contactName: 'Maria Ek', contactPhone: '070-123 45 67', contactEmail: 'Maria@Example.org'
};

describe('registrationWindow', () => {
	it('is open inside the window with spots left', () => {
		const w = registrationWindow(base);
		expect(w.state).toBe('open');
		expect(w.spotsLeft).toBe(7);
		expect(canEditRegistration(w.state)).toBe(true);
	});
	it('is not yet open before the opening day, and says when', () => {
		const w = registrationWindow({ ...base, today: '2027-01-31' });
		expect(w.state).toBe('not_yet');
		expect(windowText(w, '2027-01-31')).toBe('Anmälan öppnar 1 feb');
		expect(windowText(w, '2026-10-20')).toBe('Anmälan öppnar 1 feb 2027');
	});
	it('opening and closing days are inclusive', () => {
		expect(registrationWindow({ ...base, today: '2027-02-01' }).state).toBe('open');
		expect(registrationWindow({ ...base, today: '2027-05-01' }).state).toBe('open');
		expect(registrationWindow({ ...base, today: '2027-05-02' }).state).toBe('closed');
	});
	it('without a close date it closes after the last competition day', () => {
		const i = { ...base, registrationClosesOn: null };
		expect(registrationWindow({ ...i, today: '2027-05-15' }).state).toBe('open');
		expect(registrationWindow({ ...i, today: '2027-05-16' }).state).toBe('closed');
	});
	it('is full at max patrols, but the contact may still edit', () => {
		const w = registrationWindow({ ...base, patrolCount: 10 });
		expect(w.state).toBe('full');
		expect(w.spotsLeft).toBe(0);
		expect(windowText(w, base.today)).toBe('Tävlingen är fullbokad');
		expect(canEditRegistration(w.state)).toBe(true);
	});
	it('unlimited when maxPatrols is null', () => {
		expect(registrationWindow({ ...base, maxPatrols: null, patrolCount: 999 })).toMatchObject({ state: 'open', spotsLeft: null });
	});
	it('the switch, draft and closed status win over dates', () => {
		expect(registrationWindow({ ...base, registrationOpen: false }).state).toBe('disabled');
		expect(registrationWindow({ ...base, status: 'draft' }).state).toBe('draft');
		expect(registrationWindow({ ...base, status: 'closed' }).state).toBe('closed');
		expect(windowText(registrationWindow({ ...base, registrationOpen: false }), base.today)).toBe('Anmälan är stängd');
		expect(canEditRegistration('closed')).toBe(false);
	});
	it('dayMonth formats Swedish short dates', () => {
		expect(dayMonth('2027-05-15')).toBe('15 maj');
	});
});

describe('validateRegistration', () => {
	it('accepts a valid registration and normalises email', () => {
		const r = validateRegistration(valid, [TRACK]);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.data.contactEmail).toBe('maria@example.org');
	});
	it('rejects an unknown class', () => {
		const r = validateRegistration({ ...valid, trackId: '0190f3a0-0000-4000-8000-000000000999' }, [TRACK]);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.errors.trackId).toBe('Välj en klass');
	});
	it('reports field errors with step-mapped keys', () => {
		const r = validateRegistration(
			{ ...valid, patrolName: 'A', members: [{ firstName: 'Alva', lastName: '' }], contactPhone: '12', contactEmail: 'nope' },
			[TRACK]
		);
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(Object.keys(r.errors).sort()).toEqual(['contactEmail', 'contactPhone', 'member_0_lastName', 'patrolName']);
		expect(stepOf('patrolName')).toBe(1);
		expect(stepOf('member_0_lastName')).toBe(2);
		expect(stepOf('contactEmail')).toBe(3);
	});
	it('needs at least one member and at most 12', () => {
		const none = validateRegistration({ ...valid, members: [] }, [TRACK]);
		expect(!none.ok && none.errors.members).toBe('Lägg till minst en scout');
		const many = validateRegistration({ ...valid, members: Array.from({ length: 13 }, () => ({ firstName: 'A', lastName: 'B' })) }, [TRACK]);
		expect(!many.ok && many.errors.members).toMatch(/Högst 12/);
	});
	it('accepts international mobile numbers', () => {
		expect(validateRegistration({ ...valid, contactPhone: '+46 70 123 45 67' }, [TRACK]).ok).toBe(true);
	});
	it('never carries birth data or personnummer fields', () => {
		const f = new FormData();
		for (const [k, v] of Object.entries({ ...valid, personnummer: '20100101-1234', birthDate: '2010-01-01' })) if (typeof v === 'string') f.set(k, v);
		f.append('firstName', 'Alva');
		f.append('lastName', 'Ek');
		f.append('firstName', '');
		f.append('lastName', '');
		const raw = readForm(f);
		expect(raw.members).toEqual([{ firstName: 'Alva', lastName: 'Ek' }]);
		const r = validateRegistration(raw, [TRACK]);
		expect(r.ok).toBe(true);
		if (r.ok) expect(JSON.stringify(r.data)).not.toMatch(/personnummer|birth|1234/);
	});
	it('validateManage checks members and contact only', () => {
		expect(validateManage({ ...valid, patrolName: '', troop: '', trackId: '' }).ok).toBe(true);
	});
});

describe('RateLimiter', () => {
	it('allows `limit` hits per window per key', () => {
		const l = new RateLimiter(10, 3600_000);
		for (let i = 0; i < 10; i++) expect(l.hit('1.2.3.4', 1000 + i)).toBe(true);
		expect(l.hit('1.2.3.4', 2000)).toBe(false);
		expect(l.blocked('1.2.3.4', 2000)).toBe(true);
		expect(l.hit('5.6.7.8', 2000)).toBe(true);
		expect(l.hit('1.2.3.4', 1000 + 3600_000 + 1)).toBe(true);
	});
});

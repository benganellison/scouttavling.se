import { describe, expect, it } from 'vitest';
import { deskScanNext, nextPatrolStatus, statusAfterUndo, type StatusFacts } from './index.ts';

// Two-day hajk: day 0 = Fredag (FS F1 F2 FM), day 1 = Lördag (LS L1 L2 LM).
const f = (o: Partial<StatusFacts>): StatusFacts => ({ current: 'active', finishTrigger: false, stationDay: 0, dayCount: 2, campDay: null, ...o });

describe('nextPatrolStatus', () => {
	it('moves a registered patrol to active on its first score', () => {
		expect(nextPatrolStatus(f({ current: 'registered' }))).toBe('active');
		expect(nextPatrolStatus(f({ current: 'registered', dayCount: 0, stationDay: null }))).toBe('active');
	});
	it('leaves an active patrol alone at an ordinary station', () => {
		expect(nextPatrolStatus(f({}))).toBeNull();
		expect(nextPatrolStatus(f({ stationDay: 1 }))).toBeNull();
	});
	it('sends the patrol to camp at a finish station on a non-last day', () => {
		expect(nextPatrolStatus(f({ finishTrigger: true, stationDay: 0 }))).toBe('camp');
		expect(nextPatrolStatus(f({ current: 'registered', finishTrigger: true, stationDay: 0 }))).toBe('camp');
		expect(nextPatrolStatus(f({ finishTrigger: true, stationDay: 1, dayCount: 3 }))).toBe('camp');
	});
	it('finishes the patrol at a finish station on the last day', () => {
		expect(nextPatrolStatus(f({ finishTrigger: true, stationDay: 1 }))).toBe('finished');
		expect(nextPatrolStatus(f({ current: 'camp', finishTrigger: true, stationDay: 1, campDay: 0 }))).toBe('finished');
		expect(nextPatrolStatus(f({ current: 'registered', finishTrigger: true, stationDay: 1 }))).toBe('finished');
	});
	it('finishes the patrol when the competition has no days (single-day Mål)', () => {
		expect(nextPatrolStatus(f({ finishTrigger: true, dayCount: 0, stationDay: null }))).toBe('finished');
	});
	it('treats a finish station without a day in a multi-day competition as not the last day', () => {
		expect(nextPatrolStatus(f({ finishTrigger: true, stationDay: null }))).toBe('camp');
	});
	it('does nothing when a second finish score on the same day arrives in camp', () => {
		expect(nextPatrolStatus(f({ current: 'camp', finishTrigger: true, stationDay: 0, campDay: 0 }))).toBeNull();
	});
	it('never touches resigned patrols', () => {
		expect(nextPatrolStatus(f({ current: 'resigned' }))).toBeNull();
		expect(nextPatrolStatus(f({ current: 'resigned', finishTrigger: true, stationDay: 1 }))).toBeNull();
		expect(nextPatrolStatus(f({ current: 'resigned', finishTrigger: true, stationDay: 0 }))).toBeNull();
	});
	it('never downgrades finished patrols', () => {
		expect(nextPatrolStatus(f({ current: 'finished', finishTrigger: true, stationDay: 0 }))).toBeNull();
		expect(nextPatrolStatus(f({ current: 'finished', stationDay: 1 }))).toBeNull();
	});
	it('keeps a camp patrol in camp for a late report from the same day', () => {
		expect(nextPatrolStatus(f({ current: 'camp', stationDay: 0, campDay: 0 }))).toBeNull();
	});
	it('keeps a camp patrol in camp for a report from an earlier day', () => {
		expect(nextPatrolStatus(f({ current: 'camp', stationDay: 0, campDay: 1, dayCount: 3 }))).toBeNull();
	});
	it('moves a camp patrol back on the course on a later day', () => {
		expect(nextPatrolStatus(f({ current: 'camp', stationDay: 1, campDay: 0 }))).toBe('active');
	});
	it('moves a camp patrol with unknown camp day back on the course on any dated score', () => {
		expect(nextPatrolStatus(f({ current: 'camp', stationDay: 0, campDay: null }))).toBe('active');
		expect(nextPatrolStatus(f({ current: 'camp', stationDay: null, campDay: null }))).toBeNull();
	});
	it('ignores a late finish report from an earlier day than the patrol is on', () => {
		expect(nextPatrolStatus(f({ current: 'active', finishTrigger: true, stationDay: 0, latestDay: 1 }))).toBeNull();
		expect(nextPatrolStatus(f({ current: 'active', finishTrigger: true, stationDay: 0, latestDay: 0 }))).toBe('camp');
	});
	it('a finish station without a day counts as the day the patrol is on', () => {
		expect(nextPatrolStatus(f({ current: 'active', finishTrigger: true, stationDay: null, latestDay: 1 }))).toBe('finished');
		expect(nextPatrolStatus(f({ current: 'active', finishTrigger: true, stationDay: null, latestDay: 0 }))).toBe('camp');
	});
});

describe('statusAfterUndo', () => {
	const fin = { role: 'finish', mode: 'CHECKIN' };
	const auto = { role: null, mode: 'AUTO_ON_SCAN' };
	const plain = { role: null, mode: 'RANGE' };
	it('takes a patrol back from I mål / I läger when its only finish report is undone', () => {
		expect(statusAfterUndo({ current: 'finished', undone: fin, remaining: [plain] })).toBe('active');
		expect(statusAfterUndo({ current: 'camp', undone: auto, remaining: [plain, plain] })).toBe('active');
		expect(statusAfterUndo({ current: 'finished', undone: auto, remaining: [] })).toBe('registered');
	});
	it('keeps the status while another finish report stands', () => {
		expect(statusAfterUndo({ current: 'finished', undone: fin, remaining: [auto] })).toBeNull();
	});
	it('ignores undoing an ordinary report, and patrols not in camp or finished', () => {
		expect(statusAfterUndo({ current: 'finished', undone: plain, remaining: [] })).toBeNull();
		expect(statusAfterUndo({ current: 'resigned', undone: fin, remaining: [] })).toBeNull();
		expect(statusAfterUndo({ current: 'active', undone: fin, remaining: [] })).toBeNull();
	});
});

describe('deskScanNext', () => {
	const hajk = { startDate: '2027-05-14', endDate: '2027-05-16' };
	it('starts a registered patrol', () => {
		expect(deskScanNext({ current: 'registered', today: '2027-05-15', campDate: null, ...hajk })).toBe('active');
	});
	it('sends an active patrol to camp on an earlier day and to I mål on the last day', () => {
		expect(deskScanNext({ current: 'active', today: '2027-05-14', campDate: null, ...hajk })).toBe('camp');
		expect(deskScanNext({ current: 'active', today: '2027-05-16', campDate: null, ...hajk })).toBe('finished');
		expect(deskScanNext({ current: 'active', today: '2027-05-15', campDate: null, startDate: '2027-05-15', endDate: '2027-05-15' })).toBe('finished');
	});
	it('takes a camping patrol back out the next morning, not the same evening', () => {
		expect(deskScanNext({ current: 'camp', today: '2027-05-15', campDate: '2027-05-14', ...hajk })).toBe('active');
		expect(deskScanNext({ current: 'camp', today: '2027-05-14', campDate: '2027-05-14', ...hajk })).toBeNull();
	});
	it('never changes I mål or Återbud', () => {
		expect(deskScanNext({ current: 'finished', today: '2027-05-16', campDate: null, ...hajk })).toBeNull();
		expect(deskScanNext({ current: 'resigned', today: '2027-05-15', campDate: null, ...hajk })).toBeNull();
	});
});

import { describe, expect, it } from 'vitest';
import { nextPatrolStatus, type StatusFacts } from './index.ts';

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

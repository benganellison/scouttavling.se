/**
 * Patrol status rules applied when a score is accepted (one place for phone,
 * HQ correction and paper entry). Pure: the caller loads the facts.
 *
 *  registered → active   any accepted score ("evidently out on the course")
 *  → finished            score at a finish-role station (or an AUTO_ON_SCAN item)
 *                        on the competition's last day, or the competition has no days
 *  → camp                the same on an earlier day ("I läger", done for the day)
 *  camp → active         a score from a day later than the day the patrol went to camp
 *
 * A finish report from a day earlier than the latest day the patrol has been seen (a phone that
 * synced overnight) changes nothing, and a finish station without a day counts as that latest day.
 *
 * Resigned patrols are never touched and finished patrols are never downgraded.
 */

export type PatrolStatusValue = 'registered' | 'active' | 'camp' | 'finished' | 'resigned';

export interface StatusFacts {
	current: PatrolStatusValue;
	/** The station has role 'finish' or the item is AUTO_ON_SCAN. */
	finishTrigger: boolean;
	/** Position of the score's station's day in the competition (0-based); null = station has no day. */
	stationDay: number | null;
	/** Number of days in the competition (0 = no days). */
	dayCount: number;
	/**
	 * Day (position) the patrol went to camp: the day of its latest other active
	 * score at a finish station. null = unknown (e.g. set manually at the desk).
	 */
	campDay: number | null;
	/** Latest day (position) the patrol has been seen at any station (its other active scores). */
	latestDay?: number | null;
}

/** The status the patrol should move to, or null to leave it as it is. */
export function nextPatrolStatus(f: StatusFacts): PatrolStatusValue | null {
	if (f.current === 'resigned' || f.current === 'finished') return null;
	if (f.finishTrigger) {
		const latest = f.latestDay ?? null;
		if (f.stationDay !== null && latest !== null && f.stationDay < latest) return null; // late report from an earlier day
		const day = f.stationDay ?? latest;
		const lastDay = f.dayCount === 0 || (day !== null && day >= f.dayCount - 1);
		const target: PatrolStatusValue = lastDay ? 'finished' : 'camp';
		return target === f.current ? null : target;
	}
	if (f.current === 'registered') return 'active';
	if (f.current === 'camp') {
		if (f.stationDay === null) return null;
		if (f.campDay === null || f.stationDay > f.campDay) return 'active';
		return null;
	}
	return null;
}

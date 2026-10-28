/** Shared Swedish labels and colours for the patrol/preparation pages. */

export type PatrolStatus = 'registered' | 'active' | 'camp' | 'finished' | 'resigned';

export const STATUS_LABEL: Record<PatrolStatus, string> = {
	registered: 'Anmäld',
	active: 'På banan',
	/** Multi-day: done for the day (the day's finish station), not yet I mål. */
	camp: 'I läger',
	finished: 'I mål',
	resigned: 'Återbud'
};

export const STATUS_ORDER: PatrolStatus[] = ['registered', 'active', 'camp', 'finished', 'resigned'];

/** Class colours live in #lib/brand/colors.ts (trackColors, needsOutline); layout data has `trackColors`. */

export interface PatrolFormData {
	name: string;
	number: string | number;
	trackId: string;
	troop: string;
	contactName: string;
	contactPhone: string;
	contactEmail: string;
	contactMemberNo: string;
	paid: boolean;
	status: PatrolStatus;
	members: { firstName: string; lastName: string; troopText: string }[];
}

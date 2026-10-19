/** Shared Swedish labels and colours for the patrol/preparation pages. */

export type PatrolStatus = 'registered' | 'active' | 'finished' | 'resigned';

export const STATUS_LABEL: Record<PatrolStatus, string> = {
	registered: 'Anmäld',
	active: 'På banan',
	finished: 'I mål',
	resigned: 'Återbud'
};

export const STATUS_ORDER: PatrolStatus[] = ['registered', 'active', 'finished', 'resigned'];

/**
 * Class colours for charts. They differ in lightness, not only hue
 * (orange, forest, light green, pale with outline, then extras).
 */
export const TRACK_COLORS = ['#F26B2A', '#17402F', '#8CC2A4', '#E4E9E5', '#FFB48A', '#5B6660', '#2F7A55', '#9A3412'];

export function trackColor(index: number): string {
	return TRACK_COLORS[index % TRACK_COLORS.length];
}

/** Pale fills need an outline to be visible on white. */
export function needsOutline(color: string): boolean {
	return color === '#E4E9E5' || color === '#FFB48A';
}

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


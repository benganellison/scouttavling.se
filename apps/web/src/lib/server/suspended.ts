import { error } from '@sveltejs/kit';

/** Shown on every public page of a competition a site admin has suspended. */
export const SUSPENDED_TEXT = 'Tävlingen är tillfälligt avstängd';

/** Public pages, registration, joining and field sync of a suspended competition answer 423. */
export function refuseIfSuspended(comp: { suspendedAt: Date | null } | null | undefined) {
	if (comp?.suspendedAt) error(423, SUSPENDED_TEXT);
}

import { error } from '@sveltejs/kit';

/** Shown on every public page of a competition a site admin has suspended. */
export const SUSPENDED_TEXT = 'Tävlingen är tillfälligt avstängd';

/** Public pages, registration, joining and field sync of a suspended competition answer 423. */
export function refuseIfSuspended(comp: { suspendedAt: Date | null } | null | undefined) {
	if (comp?.suspendedAt) error(423, SUSPENDED_TEXT);
}

/**
 * A draft is not public yet: its results, statistics and live stream answer 404 (like an unknown
 * address) to everyone but the competition's own members.
 */
export async function refuseIfDraft(comp: { id: string; status: string }, userId: string | undefined) {
	if (comp.status !== 'draft') return;
	const { isMember } = await import('./registration.ts');
	if (!(await isMember(comp.id, userId))) error(404, 'Resultaten är inte publicerade');
}

/** Series and edition names, shared by the server and the "Ny tävling" preview. Pure. */

/** "GökOpen 2027" → "GökOpen". A name that is only a year stays as it is. */
export function stripYear(name: string): string {
	return (
		name
			.replace(/\b(19|20)\d{2}\b/g, '')
			.replace(/\s+/g, ' ')
			.trim() || name.trim()
	);
}

/** The year in a name ("GökOpen 2027" → 2027), else null. */
export function yearIn(name: string): number | null {
	const m = /\b((?:19|20)\d{2})\b/.exec(name);
	return m ? Number(m[1]) : null;
}

/**
 * A new series and its first year share /<slug>: when the edition's generated address equals the
 * series' address, the edition gets the year ("gokopen" → "gokopen-2027").
 */
export function editionSlug(slug: string, seriesSlug: string, year: number | string | null): string {
	return slug && slug === seriesSlug && year ? `${slug}-${year}` : slug;
}

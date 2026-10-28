import * as v from 'valibot';

/**
 * Server-side gate for the import commit. The browser parses the file and
 * sends only allow-listed fields; strict objects reject any other key, and a
 * personnummer-looking value anywhere in free text rejects the whole payload.
 * Pure (no DB) so it can be unit-tested.
 */

const PNR = /(?<!\d)(?:\d{2})?\d{6}[-+]?\d{4}(?!\d)/;
const noPnr = v.check<string, string>((s) => !PNR.test(s.replace(/\s/g, '')), 'Personnummer får inte importeras');

const text = (max: number) => v.pipe(v.string(), v.trim(), v.maxLength(max), noPnr);

// Names and kår never contain digits: a digit here is a birth date, an age or a personnummer.
const noDigits = v.check<string, string>((s) => !/\d/.test(s), 'Födelsedata får inte importeras');
export const ImportMemberSchema = v.strictObject({
	firstName: v.pipe(text(80), noDigits),
	lastName: v.pipe(text(80), noDigits),
	troopText: v.pipe(text(120), noDigits)
});

export const ImportRowSchema = v.strictObject({
	patrolName: v.pipe(text(80), v.minLength(1, 'Patrullnamn saknas')),
	trackText: text(80),
	troop: text(120),
	contactName: text(120),
	// Phones are checked by shape instead (10 digits look like a short personnummer).
	contactPhone: v.pipe(v.string(), v.trim(), v.maxLength(40), v.regex(/^[\d +()-]*$/, 'Ogiltigt telefonnummer')),
	contactEmail: v.union([v.literal(''), v.pipe(v.string(), v.trim(), v.maxLength(160), v.email())]),
	contactMemberNo: v.pipe(v.string(), v.regex(/^\d{0,10}$/, 'Ogiltigt medlemsnummer')),
	members: v.pipe(v.array(ImportMemberSchema), v.maxLength(30)),
	paid: v.nullable(v.boolean())
});

export const ImportPayloadSchema = v.strictObject({
	rows: v.pipe(v.array(ImportRowSchema), v.minLength(1, 'Inga patruller att importera'), v.maxLength(2000, 'För många rader')),
	/** Unknown class names the organiser chose to create ("Skapa klassen"). */
	createTracks: v.pipe(v.array(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(80))), v.maxLength(50))
});

export type ImportPayload = v.InferOutput<typeof ImportPayloadSchema>;
export type ImportPayloadRow = v.InferOutput<typeof ImportRowSchema>;

export type ParseResult = { ok: true; payload: ImportPayload } | { ok: false; message: string };

export function parseImportPayload(raw: unknown): ParseResult {
	let json: unknown = raw;
	if (typeof raw === 'string') {
		if (raw.length > 2_000_000) return { ok: false, message: 'För stor import' };
		try {
			json = JSON.parse(raw);
		} catch {
			return { ok: false, message: 'Ogiltig data' };
		}
	}
	const res = v.safeParse(ImportPayloadSchema, json);
	if (!res.success) {
		const issue = res.issues[0];
		const path = v.getDotPath(issue);
		return { ok: false, message: path ? `${issue.message} (${path})` : issue.message };
	}
	return { ok: true, payload: res.output };
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Idempotent matching of a file row to a patrol that already exists (re-import):
 * 1. the contact's member number + patrol name, 2. patrol name + kår, 3. the name alone, but only
 * when exactly one patrol has it and the kår does not contradict. Two "Vargarna" from different
 * kårer are two patrols. Returns the existing patrol or null for a new patrol.
 */
export function matchExisting<E extends { id: string; name: string; troop: string; contactMemberNo: string | null }>(
	row: Pick<ImportPayloadRow, 'patrolName' | 'contactMemberNo' | 'troop'>,
	existing: E[]
): E | null {
	const name = norm(row.patrolName);
	const same = existing.filter((e) => norm(e.name) === name);
	if (row.contactMemberNo) {
		const both = same.find((e) => e.contactMemberNo === row.contactMemberNo);
		if (both) return both;
	}
	const troop = norm(row.troop);
	const withTroop = same.filter((e) => norm(e.troop) === troop);
	if (withTroop.length === 1) return withTroop[0];
	if (same.length === 1 && (!troop || !norm(same[0].troop))) return same[0];
	return null;
}

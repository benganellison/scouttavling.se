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

export const ImportMemberSchema = v.strictObject({
	firstName: text(80),
	lastName: text(80),
	troopText: text(120)
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
	paid: v.boolean()
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
 * Idempotent matching: (contactMemberNo + patrolName) first, else patrolName.
 * Returns the existing patrol id or null for a new patrol.
 */
export function matchExisting<E extends { id: string; name: string; contactMemberNo: string | null }>(row: Pick<ImportPayloadRow, 'patrolName' | 'contactMemberNo'>, existing: E[]): E | null {
	const name = norm(row.patrolName);
	if (row.contactMemberNo) {
		const both = existing.find((e) => e.contactMemberNo === row.contactMemberNo && norm(e.name) === name);
		if (both) return both;
	}
	return existing.find((e) => norm(e.name) === name) ?? null;
}

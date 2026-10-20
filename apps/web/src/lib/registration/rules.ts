/**
 * Self-registration rules (pure; shared by server and client).
 *
 * Privacy: the form never asks for birth data, personnummer or addresses.
 * Members are first + last name only; the contact gives name, mobile and email.
 */
import * as v from 'valibot';

// ---------------------------------------------------------------------------
// Registration window
// ---------------------------------------------------------------------------

export type RegistrationState = 'draft' | 'disabled' | 'not_yet' | 'open' | 'full' | 'closed';

export interface WindowInput {
	status: 'draft' | 'live' | 'closed';
	registrationOpen: boolean;
	registrationOpensOn: string | null;
	registrationClosesOn: string | null;
	endDate: string;
	maxPatrols: number | null;
	/** Patrols that take a spot (resigned patrols do not). */
	patrolCount: number;
	/** Today in Sweden, yyyy-mm-dd. */
	today: string;
}

export interface WindowResult {
	state: RegistrationState;
	opensOn: string | null;
	/** Last day to register (inclusive): the close date, or the last competition day. */
	closesOn: string;
	spotsLeft: number | null;
}

export function registrationWindow(i: WindowInput): WindowResult {
	const closesOn = i.registrationClosesOn ?? i.endDate;
	const spotsLeft = i.maxPatrols == null ? null : Math.max(0, i.maxPatrols - i.patrolCount);
	const base = { opensOn: i.registrationOpensOn, closesOn, spotsLeft };
	if (i.status === 'draft') return { ...base, state: 'draft' };
	if (i.status === 'closed') return { ...base, state: 'closed' };
	if (!i.registrationOpen) return { ...base, state: 'disabled' };
	if (i.registrationOpensOn && i.today < i.registrationOpensOn) return { ...base, state: 'not_yet' };
	if (i.today > closesOn) return { ...base, state: 'closed' };
	if (spotsLeft !== null && spotsLeft <= 0) return { ...base, state: 'full' };
	return { ...base, state: 'open' };
}

/** A registered contact may edit members and contact details until registration closes (a full competition still allows edits). */
export const canEditRegistration = (s: RegistrationState) => s === 'open' || s === 'full';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

/** "1 feb", or "1 feb 2027" when the year differs from `today`'s. */
export function dayMonth(iso: string, today?: string): string {
	const [y, m, d] = iso.split('-').map(Number);
	const base = `${d} ${MONTHS[m - 1]}`;
	return today && today.slice(0, 4) !== String(y) ? `${base} ${y}` : base;
}

/** Swedish one-liner for the window state (the CTA is shown instead when open). */
export function windowText(w: WindowResult, today: string): string {
	switch (w.state) {
		case 'open':
			return `Anmälan är öppen till och med ${dayMonth(w.closesOn, today)}`;
		case 'not_yet':
			return `Anmälan öppnar ${dayMonth(w.opensOn!, today)}`;
		case 'full':
			return 'Tävlingen är fullbokad';
		case 'draft':
			return 'Tävlingen är inte publicerad ännu';
		case 'disabled':
		case 'closed':
			return 'Anmälan är stängd';
	}
}

// ---------------------------------------------------------------------------
// Form validation
// ---------------------------------------------------------------------------

export const MAX_MEMBERS = 12;

const text = (min: number, max: number, msg: string) => v.pipe(v.string(), v.trim(), v.minLength(min, msg), v.maxLength(max, `Högst ${max} tecken`));

/** Swedish or international mobile: 7–15 digits, spaces, dashes and a leading + allowed. */
const PHONE = /^\+?[0-9][0-9 \-]{5,18}[0-9]$/;

export const MemberSchema = v.object({
	firstName: text(1, 40, 'Skriv förnamn'),
	lastName: text(1, 40, 'Skriv efternamn')
});

export const ContactSchema = v.object({
	contactName: text(2, 80, 'Skriv kontaktpersonens namn'),
	contactPhone: v.pipe(
		v.string(),
		v.trim(),
		v.regex(PHONE, 'Skriv ett mobilnummer, t.ex. 070-123 45 67'),
		v.check((s) => s.replace(/\D/g, '').length >= 7 && s.replace(/\D/g, '').length <= 15, 'Skriv ett mobilnummer, t.ex. 070-123 45 67')
	),
	contactEmail: v.pipe(v.string(), v.trim(), v.toLowerCase(), v.maxLength(120, 'Högst 120 tecken'), v.email('Skriv en giltig e-postadress'))
});

const MembersSchema = v.pipe(
	v.array(MemberSchema),
	v.minLength(1, 'Lägg till minst en scout'),
	v.maxLength(MAX_MEMBERS, `Högst ${MAX_MEMBERS} scouter per patrull`)
);

export const RegistrationSchema = v.object({
	patrolName: text(2, 40, 'Skriv patrullens namn (minst 2 tecken)'),
	troop: text(2, 80, 'Skriv vilken kår ni kommer från'),
	trackId: v.pipe(v.string(), v.uuid('Välj en klass')),
	members: MembersSchema,
	...ContactSchema.entries
});

export const ManageSchema = v.object({ members: MembersSchema, ...ContactSchema.entries });

export type RegistrationData = v.InferOutput<typeof RegistrationSchema>;
export type ManageData = v.InferOutput<typeof ManageSchema>;
export type FormErrors = Record<string, string>;

export interface RawRegistration {
	patrolName: string;
	troop: string;
	trackId: string;
	members: { firstName: string; lastName: string }[];
	contactName: string;
	contactPhone: string;
	contactEmail: string;
}

/** Reads the form (members as repeated `firstName`/`lastName` fields; fully blank rows are dropped). */
export function readForm(f: FormData): RawRegistration {
	const s = (k: string) => String(f.get(k) ?? '');
	const first = f.getAll('firstName').map(String);
	const last = f.getAll('lastName').map(String);
	return {
		patrolName: s('patrolName'),
		troop: s('troop'),
		trackId: s('trackId'),
		members: first.map((fn, i) => ({ firstName: fn, lastName: last[i] ?? '' })).filter((m) => m.firstName.trim() || m.lastName.trim()),
		contactName: s('contactName'),
		contactPhone: s('contactPhone'),
		contactEmail: s('contactEmail')
	};
}

function flatten(issues: v.BaseIssue<unknown>[]): FormErrors {
	const errors: FormErrors = {};
	for (const issue of issues) {
		const path = (issue.path ?? []).map((p) => String(p.key));
		// members.2.firstName → member_2_firstName; members (array) → members
		const key = path[0] === 'members' && path.length === 3 ? `member_${path[1]}_${path[2]}` : (path[0] ?? 'form');
		errors[key] ??= issue.message;
	}
	return errors;
}

export function validateRegistration(raw: RawRegistration, trackIds: string[]): { ok: true; data: RegistrationData } | { ok: false; errors: FormErrors } {
	const r = v.safeParse(RegistrationSchema, raw);
	const errors = r.success ? {} : flatten(r.issues);
	if (!errors.trackId && !trackIds.includes(raw.trackId)) errors.trackId = 'Välj en klass';
	if (!r.success || Object.keys(errors).length) return { ok: false, errors };
	return { ok: true, data: r.output };
}

export function validateManage(raw: RawRegistration): { ok: true; data: ManageData } | { ok: false; errors: FormErrors } {
	const r = v.safeParse(ManageSchema, { members: raw.members, contactName: raw.contactName, contactPhone: raw.contactPhone, contactEmail: raw.contactEmail });
	return r.success ? { ok: true, data: r.output } : { ok: false, errors: flatten(r.issues) };
}

/** Which wizard step (1–3) a field error belongs to. */
export function stepOf(key: string): 1 | 2 | 3 {
	if (key === 'patrolName' || key === 'troop' || key === 'trackId') return 1;
	if (key === 'members' || key.startsWith('member_')) return 2;
	return 3;
}

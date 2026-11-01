/**
 * Form actions validate with Valibot, in one style:
 *
 *   const r = parseForm(Schema, formInput(await event.request.formData()));
 *   if (!r.ok) return fail(400, { errors: r.errors, values });
 *   // r.data is typed and trimmed; rules that need the database or the user come after.
 *
 * Field errors are keyed by the form field's name, one Swedish message each, which is what the
 * pages show next to the field (aria-describedby="err-<name>").
 */
import * as v from 'valibot';
import { ISO_DATE } from '#lib/time.ts';

export type FieldErrors = Record<string, string>;

const str = () => v.pipe(v.optional(v.string(), ''), v.trim());

/** Optional text, trimmed ('' when missing). */
export const text = (max: number, message = `Högst ${max} tecken.`) => v.pipe(str(), v.maxLength(max, message));

/** Required text of min–max characters (one message for both, e.g. "Namnet ska vara 2–80 tecken."). */
export const requiredText = (min: number, max: number, message: string) => v.pipe(str(), v.minLength(min, message), v.maxLength(max, message));

/** Required date (YYYY-MM-DD). */
export const isoDate = (message = 'Välj ett datum.') => v.pipe(str(), v.regex(ISO_DATE, message));

/** Optional date: '' or YYYY-MM-DD. */
export const optionalIsoDate = (message = 'Välj ett datum.') =>
	v.pipe(
		str(),
		v.check((s) => s === '' || ISO_DATE.test(s), message)
	);

/** A checkbox: true when ticked ("on"). */
export const checkbox = v.pipe(
	v.optional(v.string()),
	v.transform((x) => x === 'on')
);

/** Optional whole number matching `pattern` (e.g. /^\d{1,4}$/); null when empty. */
export const optionalInt = (pattern: RegExp, message: string) =>
	v.pipe(
		str(),
		v.check((s) => s === '' || pattern.test(s), message),
		v.transform((s) => (s === '' ? null : Number(s)))
	);

/** The form's text fields as an object; fields named in `lists` become arrays (repeated inputs). */
export function formInput(form: FormData, lists: readonly string[] = []): Record<string, string | string[]> {
	const out: Record<string, string | string[]> = {};
	for (const [k, val] of form.entries()) {
		if (typeof val !== 'string') continue; // files are read separately
		if (lists.includes(k)) out[k] = [...((out[k] as string[] | undefined) ?? []), val];
		else out[k] ??= val;
	}
	for (const k of lists) out[k] ??= [];
	return out;
}

export function parseForm<S extends v.GenericSchema>(schema: S, input: unknown): { ok: true; data: v.InferOutput<S> } | { ok: false; errors: FieldErrors } {
	const r = v.safeParse(schema, input);
	if (r.success) return { ok: true, data: r.output };
	const errors: FieldErrors = {};
	for (const issue of r.issues) errors[v.getDotPath(issue)?.split('.')[0] ?? 'form'] ??= issue.message;
	return { ok: false, errors };
}

/** For fields whose names are built at runtime (date_<id>, track_<id>): the message, or null when valid. */
export function checkField<S extends v.GenericSchema>(schema: S, value: unknown): string | null {
	const r = v.safeParse(schema, value);
	return r.success ? null : r.issues[0].message;
}

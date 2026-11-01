/** The log line for an unexpected server error (hooks.server.ts handleError). */
import { DrizzleQueryError } from 'drizzle-orm';

/** Only the stack frames: an error's stack starts with its message, which may carry values. */
const framesOnly = (stack: string | undefined) =>
	stack
		?.split('\n')
		.filter((l) => l.trimStart().startsWith('at '))
		.join('\n');

/**
 * What goes into the log. A failed query's message lists its parameters (names, phone numbers,
 * e-mail addresses from a registration or import): log the SQL and Postgres' own code and message
 * instead (never `detail`, which can quote values).
 */
export function describeError(error: unknown) {
	if (error instanceof DrizzleQueryError) {
		const pg = error.cause as { code?: string; message?: string } | undefined;
		return { message: `Failed query: ${error.query}`, cause: pg ? `${pg.code ?? ''} ${pg.message ?? ''}`.trim() : undefined, stack: framesOnly(error.stack) };
	}
	return error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
}

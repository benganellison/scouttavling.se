import { describe, expect, it } from 'vitest';
import { DrizzleQueryError } from 'drizzle-orm';
import { describeError } from './errorLog.ts';

describe('describeError', () => {
	it('never logs a failed query’s parameters (personal data from a form)', () => {
		const pg = Object.assign(new Error('duplicate key value violates unique constraint "patrol_number"'), {
			code: '23505',
			detail: 'Key (name)=(Anna Påhittad) already exists.'
		});
		const e = new DrizzleQueryError('insert into "patrol" ("name", "contact_phone") values ($1, $2)', ['Anna Påhittad', '070-000 00 00'], pg);
		const line = JSON.stringify(describeError(e));
		expect(line).toContain('insert into');
		expect(line).toContain('23505');
		expect(line).not.toContain('Påhittad');
		expect(line).not.toContain('070-000');
	});
	it('keeps an ordinary error’s message and stack', () => {
		expect(describeError(new Error('boom'))).toMatchObject({ message: 'boom', stack: expect.stringContaining('boom') });
	});
});

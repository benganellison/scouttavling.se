import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RESERVED_SLUGS } from './slugs.ts';

describe('reserved slugs', () => {
	it('reserves every top-level route, so a short address can never hide one', () => {
		const routes = readdirSync(fileURLToPath(new URL('../../routes', import.meta.url)), { withFileTypes: true })
			.filter((d) => d.isDirectory() && !d.name.startsWith('[') && !d.name.startsWith('('))
			.map((d) => d.name);
		expect(routes.length).toBeGreaterThan(10);
		for (const r of routes) expect(RESERVED_SLUGS.has(r), `add "${r}" to RESERVED_SLUGS`).toBe(true);
	});
});

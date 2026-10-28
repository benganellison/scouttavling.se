import { defineConfig } from '@playwright/test';
import { launchOptions } from './support.ts';

/** Field e2e against a running dev server: `PORT=5203 scripts/dev-server.sh start`, then `npx playwright test -c e2e/field.config.ts`. */
export default defineConfig({
	testDir: '.',
	testMatch: 'field.e2e.ts',
	timeout: 90_000,
	expect: { timeout: 15_000 },
	workers: 1,
	use: {
		baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5203',
		viewport: { width: 390, height: 844 },
		locale: 'sv-SE',
		timezoneId: 'Europe/Stockholm',
		launchOptions
	}
});

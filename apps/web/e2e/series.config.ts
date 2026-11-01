import { defineConfig } from '@playwright/test';

/** Series, new year, personal-data removal and the public archive: `PORT=5205 scripts/dev-server.sh start`, then `npx playwright test -c e2e/series.config.ts`. */
export default defineConfig({
	testDir: '.',
	testMatch: 'series.e2e.ts',
	timeout: 120_000,
	expect: { timeout: 15_000 },
	workers: 1,
	use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5205', locale: 'sv-SE', timezoneId: 'Europe/Stockholm', viewport: { width: 1280, height: 900 } }
});

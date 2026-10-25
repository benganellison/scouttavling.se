import { defineConfig } from '@playwright/test';

/** Event branding e2e against a running server: `PORT=5205 scripts/dev-server.sh start`, then `npx playwright test -c e2e/branding.config.ts`. */
export default defineConfig({
	testDir: '.',
	testMatch: 'branding.e2e.ts',
	timeout: 90_000,
	expect: { timeout: 15_000 },
	workers: 1,
	use: { baseURL: process.env.BRANDING_BASE_URL ?? 'http://localhost:5205', locale: 'sv-SE', timezoneId: 'Europe/Stockholm' }
});

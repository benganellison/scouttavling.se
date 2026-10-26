import { defineConfig } from '@playwright/test';

/** Owners and site admin: `PORT=5205 scripts/dev-server.sh start`, then `npx playwright test -c e2e/site-admin.config.ts`. */
export default defineConfig({
	testDir: '.',
	testMatch: 'site-admin.e2e.ts',
	timeout: 120_000,
	expect: { timeout: 15_000 },
	workers: 1,
	use: { baseURL: process.env.SITE_ADMIN_BASE_URL ?? 'http://localhost:5205', locale: 'sv-SE', timezoneId: 'Europe/Stockholm', viewport: { width: 1280, height: 900 } }
});

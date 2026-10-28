import { defineConfig } from '@playwright/test';

/** Runs the admin-patrols spec against a running dev server (PORT=5202 scripts/dev-server.sh start). */
export default defineConfig({
	testDir: '.',
	testMatch: 'admin-patrols.e2e.ts',
	timeout: 90_000,
	use: { channel: 'chromium', baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5202', viewport: { width: 1440, height: 1000 } }
});

import { defineConfig } from '@playwright/test';

/** Runs the admin-setup smoke spec against an already running dev server (PORT=5201 scripts/dev-server.sh start). */
export default defineConfig({
	testDir: '.',
	testMatch: 'admin-setup.e2e.ts',
	timeout: 60_000,
	use: { channel: 'chromium', baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5201', viewport: { width: 1440, height: 1000 } }
});

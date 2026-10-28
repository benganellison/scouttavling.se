import { defineConfig } from '@playwright/test';
import { launchOptions } from './support.ts';

/** Live-area e2e against the dev server on :5204 (PORT=5204 scripts/dev-server.sh start). */
export default defineConfig({
	testDir: '.',
	testMatch: 'live.e2e.ts',
	timeout: 60_000,
	use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5204', viewport: { width: 1440, height: 900 }, launchOptions }
});

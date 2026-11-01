import { defineConfig } from '@playwright/test';
import { launchOptions } from './support.ts';

/** Patrol journey e2e against a dev server on its own DB: see the header of patrol-journey.e2e.ts. */
export default defineConfig({
	testDir: '.',
	testMatch: 'patrol-journey.e2e.ts',
	timeout: 90_000,
	expect: { timeout: 15_000 },
	workers: 1,
	use: {
		baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5205',
		viewport: { width: 390, height: 844 },
		locale: 'sv-SE',
		timezoneId: 'Europe/Stockholm',
		launchOptions
	}
});

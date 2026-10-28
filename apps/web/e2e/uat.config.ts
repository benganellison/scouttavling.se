import { defineConfig } from '@playwright/test';

/**
 * UAT against the PRODUCTION build on :5210 (see e2e/uat.e2e.ts for the start commands).
 * Every test records a video; screenshots go to e2e/uat/, videos are copied to e2e/uat/videos/.
 */
export default defineConfig({
	testDir: '.',
	testMatch: 'uat.e2e.ts',
	outputDir: 'uat-results',
	timeout: 180_000,
	expect: { timeout: 15_000 },
	workers: 1,
	reporter: [['line']],
	use: {
		baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5210',
		locale: 'sv-SE',
		timezoneId: 'Europe/Stockholm',
		viewport: { width: 1440, height: 900 },
		video: { mode: 'on', size: { width: 1440, height: 900 } },
		trace: 'retain-on-failure'
	}
});

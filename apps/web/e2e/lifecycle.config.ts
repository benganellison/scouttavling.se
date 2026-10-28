import { defineConfig } from '@playwright/test';

/**
 * Full competition lifecycle UAT against the PRODUCTION build on :5210 (start commands in e2e/lifecycle.e2e.ts).
 * One serial run; each actor (organiser, volunteers, desk, public phone) records its own video.
 */
export default defineConfig({
	testDir: '.',
	testMatch: 'lifecycle.e2e.ts',
	outputDir: 'lifecycle-results',
	timeout: 300_000,
	expect: { timeout: 20_000 },
	workers: 1,
	fullyParallel: false,
	reporter: [['line']],
	use: {
		baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5210',
		locale: 'sv-SE',
		timezoneId: 'Europe/Stockholm',
		viewport: { width: 1440, height: 900 },
		video: { mode: 'on', size: { width: 1440, height: 900 } },
		acceptDownloads: true,
		trace: 'retain-on-failure'
	}
});

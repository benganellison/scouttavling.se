import { defineConfig } from '@playwright/test';

/** README demo recordings (human pace, captions). See e2e/demo.e2e.ts for how to run. */
export default defineConfig({
	testDir: '.',
	testMatch: 'demo.e2e.ts',
	outputDir: 'demo-results/_playwright',
	timeout: 300_000,
	expect: { timeout: 15_000 },
	workers: 1,
	reporter: [['line']],
	use: { baseURL: 'http://localhost:5210', locale: 'sv-SE', timezoneId: 'Europe/Stockholm' }
});

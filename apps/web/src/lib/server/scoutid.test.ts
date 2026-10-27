import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/env/private', () => ({ SCOUTID_ISSUER: undefined, SCOUTID_CLIENT_ID: undefined, SCOUTID_CLIENT_SECRET: undefined }));
const { userFromClaims } = await import('./scoutid.ts');

describe('userFromClaims', () => {
	it('uses the Scoutnet member number, or a numeric username', () => {
		expect(userFromClaims({ scoutnet_member_no: '3000123', name: 'A' })?.memberNo).toBe('3000123');
		expect(userFromClaims({ scoutnet_member_no: 3000123 })?.memberNo).toBe('3000123');
		expect(userFromClaims({ preferred_username: '3000123@scoutid.se' })?.memberNo).toBe('3000123');
	});
	it('refuses a login without a real member number (accounts are merged on it)', () => {
		for (const c of [{}, { preferred_username: 'anna@example.org' }, { preferred_username: '' }, { scoutnet_member_no: '' }, { scoutnet_member_no: 'abc' }, { scoutnet_member_no: '12' }]) {
			expect(userFromClaims(c), JSON.stringify(c)).toBeNull();
		}
	});
});

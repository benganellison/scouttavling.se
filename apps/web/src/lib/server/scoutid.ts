import * as oidc from 'openid-client';
import { SCOUTID_ISSUER, SCOUTID_CLIENT_ID, SCOUTID_CLIENT_SECRET } from '$app/env/private';

/**
 * ScoutID (Scouterna's Keycloak) as a confidential OIDC client with PKCE.
 * Scopes per 04 §2: openid profile email phone scoutnet-memberships.
 */
export const SCOPES = 'openid profile email phone scoutnet-memberships';

let configPromise: Promise<oidc.Configuration> | null = null;

export function scoutIdEnabled(): boolean {
	return !!(SCOUTID_ISSUER && SCOUTID_CLIENT_ID && SCOUTID_CLIENT_SECRET);
}

export function scoutIdConfig(): Promise<oidc.Configuration> {
	configPromise ??= oidc.discovery(new URL(SCOUTID_ISSUER!), SCOUTID_CLIENT_ID!, SCOUTID_CLIENT_SECRET!);
	return configPromise;
}

interface Memberships {
	groups?: Record<string, { name?: string; is_primary?: boolean }>;
}

/**
 * Maps ScoutID claims to our user (keyed on the Scoutnet member number, never `sub`), or null when the
 * login carries no member number. Accounts are merged on it, so anything that is not a real number
 * (an e-mail local part, an empty string) would let two different people share one account (04 §2.3).
 */
export function userFromClaims(claims: Record<string, unknown>) {
	const raw = claims.scoutnet_member_no ?? String(claims.preferred_username ?? '').split('@')[0];
	const memberNo = String(raw ?? '').trim();
	if (!/^\d{3,12}$/.test(memberNo)) return null;
	const m = (claims.memberships ?? {}) as Memberships;
	const groups = Object.entries(m.groups ?? {})
		.sort(([, a], [, b]) => Number(!!b.is_primary) - Number(!!a.is_primary))
		.map(([groupNo, g]) => ({ groupNo, name: g.name ?? `Kår ${groupNo}` }));
	return {
		memberNo,
		name: String(claims.name ?? memberNo),
		email: (claims.email as string) ?? null,
		phone: null, // stored only after explicit consent (04 §2)
		groups
	};
}

export { oidc };

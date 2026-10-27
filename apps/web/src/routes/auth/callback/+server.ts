import { error, redirect } from '@sveltejs/kit';
import { oidc, scoutIdConfig, userFromClaims } from '#lib/server/scoutid.ts';
import { createSession, safeNext, upsertUser } from '#lib/server/auth.ts';

export async function GET({ url, cookies }) {
	const verifier = cookies.get('oidc_v');
	const state = cookies.get('oidc_s');
	const next = safeNext(cookies.get('oidc_n'));
	for (const c of ['oidc_v', 'oidc_s', 'oidc_n']) cookies.delete(c, { path: '/auth' });
	if (!verifier || !state) error(400, 'Inloggningen tog för lång tid — försök igen');
	const config = await scoutIdConfig();
	const tokens = await oidc.authorizationCodeGrant(config, url, { pkceCodeVerifier: verifier, expectedState: state });
	const claims = tokens.claims();
	if (!claims) error(400, 'ScoutID skickade ingen identitet');
	// Tokens are discarded here: only our own session cookie reaches the browser.
	const profile = userFromClaims(claims as Record<string, unknown>);
	if (!profile) error(403, 'Inloggningen saknar medlemsnummer i Scoutnet. Logga in med ditt ScoutID-konto som är kopplat till ett medlemskap.');
	const user = await upsertUser(profile);
	await createSession(cookies, url, user.id);
	redirect(303, next);
}

import { error, redirect } from '@sveltejs/kit';
import { oidc, SCOPES, scoutIdConfig, scoutIdEnabled } from '#lib/server/scoutid.ts';
import { safeNext } from '#lib/server/auth.ts';

export async function GET({ url, cookies }) {
	if (!scoutIdEnabled()) error(503, 'ScoutID är inte konfigurerat ännu');
	const config = await scoutIdConfig();
	const verifier = oidc.randomPKCECodeVerifier();
	const state = oidc.randomState();
	const next = safeNext(url.searchParams.get('next'));
	const opts = { path: '/auth', httpOnly: true, sameSite: 'lax' as const, secure: url.protocol === 'https:', maxAge: 600 };
	cookies.set('oidc_v', verifier, opts);
	cookies.set('oidc_s', state, opts);
	cookies.set('oidc_n', next, opts);
	const target = oidc.buildAuthorizationUrl(config, {
		redirect_uri: `${url.origin}/auth/callback`,
		scope: SCOPES,
		code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
		code_challenge_method: 'S256',
		state
	});
	redirect(302, target.href);
}

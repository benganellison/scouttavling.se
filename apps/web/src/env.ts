import { defineEnvVars } from '@sveltejs/kit/env';

/** Returning the value (possibly undefined) makes a variable optional in SvelteKit 3. */
const optional = (value: string | undefined) => (value === '' ? undefined : value);

export const variables = defineEnvVars({
	DATABASE_URL: { description: 'PostgreSQL connection string.' },
	ORIGIN: { description: 'Public origin, e.g. https://scouttavling.se (used in QR links).', schema: optional },
	DEV_LOGIN: { description: 'Set to "1" to show a dev-only login. Never in production.', schema: optional },
	SCOUTID_ISSUER: { description: 'ScoutID (Keycloak) issuer URL.', schema: optional },
	SCOUTID_CLIENT_ID: { description: 'ScoutID OIDC client id.', schema: optional },
	SCOUTID_CLIENT_SECRET: { description: 'ScoutID OIDC client secret.', schema: optional },
	GRANT_SIGNING_KEY: { description: 'PKCS8 PEM ES256 key for device grants. Generated per boot in dev if empty.', schema: optional }
});

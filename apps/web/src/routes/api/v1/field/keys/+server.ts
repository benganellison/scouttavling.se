import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { publicKeys } from '#lib/server/field.ts';

/** JWKS of the grant signing key(s). */
export const GET: RequestHandler = async () => json({ keys: await publicKeys() }, { headers: { 'cache-control': 'public, max-age=300' } });

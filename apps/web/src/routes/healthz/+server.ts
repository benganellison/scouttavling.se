import { healthSql } from '#lib/server/db/index.ts';

/** Liveness + DB readiness for container health checks and uptime monitors. No data exposed. */
export async function GET() {
	try {
		await healthSql`select 1`;
		return new Response('ok', { headers: { 'cache-control': 'no-store' } });
	} catch {
		return new Response('db unavailable', { status: 503, headers: { 'cache-control': 'no-store' } });
	}
}

/** Test-only DB helpers for the field e2e (invented data on the seeded demo competition). */
import postgres from 'postgres';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

try {
	process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch {
	/* env already set */
}

export const sql = postgres(process.env.DATABASE_URL!, { max: 2 });
export const SLUG = 'gokopen-2027';

export async function compId() {
	const [c] = await sql`select id from competition where slug = ${SLUG}`;
	return c.id as string;
}

/** Creates an invite like the organiser UI does and returns the plaintext secret. */
export async function createInvite(stationName: string | null) {
	const cid = await compId();
	const secret = randomBytes(16).toString('base64url');
	const hash = createHash('sha256').update(secret).digest('base64url');
	const stationId = stationName ? (await sql`select id from station where competition_id = ${cid} and name = ${stationName}`)[0].id : null;
	await sql`insert into invite (competition_id, station_id, role, secret_hash) values (${cid}, ${stationId}, ${stationName ? 'station_volunteer' : 'startfinish'}, ${hash})`;
	return secret;
}

export async function stationItems(stationName: string) {
	const cid = await compId();
	return sql`select i.id, i.name from score_item i join station s on s.id = i.station_id where s.competition_id = ${cid} and s.name = ${stationName} order by i.sort`;
}

export async function patrolId(nr: number) {
	const [p] = await sql`select p.id from patrol p join competition c on c.id = p.competition_id where c.slug = ${SLUG} and p.number = ${nr}`;
	return p.id as string;
}

export async function scoresFor(nr: number, stationName: string) {
	const pid = await patrolId(nr);
	const items = (await stationItems(stationName)).map((i) => i.id);
	return sql`select item_id, points, style_points, version, state, origin from score where patrol_id = ${pid} and item_id = any(${items})`;
}

/** Makes a run repeatable: removes scores for these patrols at a station. */
export async function clearScores(nrs: number[], stationName: string) {
	const items = (await stationItems(stationName)).map((i) => i.id);
	for (const nr of nrs) await sql`delete from score where patrol_id = ${await patrolId(nr)} and item_id = any(${items})`;
}

export async function setStatus(nr: number, status: string) {
	await sql`update patrol set status = ${status} where id = ${await patrolId(nr)}`;
}

export async function statusOf(nr: number) {
	const [p] = await sql`select status from patrol where id = ${await patrolId(nr)}`;
	return p.status as string;
}

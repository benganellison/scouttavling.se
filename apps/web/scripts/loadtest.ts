/**
 * Load test for a big competition day, on its own database. All data is invented.
 *
 *   docker compose -f compose.dev.yaml exec db createdb -U scout scouttavling_load
 *   export LOAD_DB=postgres://scout:…@127.0.0.1:5544/scouttavling_load
 *   DATABASE_URL=$LOAD_DB node scripts/migrate.ts
 *   ORIGIN=http://localhost:5299 npx vite build && \
 *     PORT=5299 ORIGIN=http://localhost:5299 DATABASE_URL=$LOAD_DB DEV_LOGIN=1 ADDRESS_HEADER=X-Forwarded-For XFF_DEPTH=1 \
 *     GRANT_SIGNING_KEY="$(cat .dev-grant-key.pem)" node --env-file=.env build/index.js &
 *   DATABASE_URL=$LOAD_DB node scripts/loadtest.ts setup http://localhost:5299
 *   DATABASE_URL=$LOAD_DB node scripts/loadtest.ts run http://localhost:5299 [seconds]
 *   DATABASE_URL=$LOAD_DB node scripts/loadtest.ts explain
 *
 * The run is much faster than a real day: 30 phones each send a signed report every ~2 s (≈15/s, a
 * real big event is a few thousand reports over a whole day), 300 parents follow live results from
 * their own addresses, 100 open the results page every 10 s, and HQ reloads its dashboard every 5 s.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { createHash } from 'node:crypto';
import * as s from '../src/lib/server/db/schema.ts';
import { generateDeviceKey, sha256b64url, signCommand, uuidv7, type CommandBody, type JoinResponse, type Snapshot } from '../src/lib/field/protocol.ts';

const SLUG = 'lasttest-hajk-2027';
const STATIONS_PER_DAY = 12;
const PATROLS = 300;
const PHONES = Number(process.env.PHONES ?? 30);
const VIEWERS = Number(process.env.VIEWERS ?? 300);
const PAGE_READERS = 100;
const HQ = 3;
const ARCHIVED = Number(process.env.ARCHIVED ?? 100);

const [mode, base = 'http://localhost:5299', secondsArg] = process.argv.slice(2);
const client = postgres(process.env.DATABASE_URL!, { max: 4, onnotice: () => {} });
const db = drizzle(client, { schema: s });

// ---------------------------------------------------------------- setup

async function devLogin(): Promise<string> {
	const res = await fetch(`${base}/login?/dev`, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded', origin: base },
		body: 'who=bengt',
		redirect: 'manual'
	});
	const cookie = res.headers
		.getSetCookie()
		.map((c) => c.split(';')[0])
		.join('; ');
	if (!cookie) throw new Error(`dev login failed (${res.status}): is DEV_LOGIN=1 set on the server?`);
	return cookie;
}

async function setup() {
	await devLogin(); // creates the dev user
	const [owner] = await db.select().from(s.appUser).where(eq(s.appUser.email, 'bengt@example.org')).limit(1);
	if (!owner) throw new Error('dev user not found');
	await db.delete(s.competition).where(sql`${s.competition.slug} like 'lasttest-%'`);

	// Background: archived years (100 patrols, 20 stations, every station scored, with history) so
	// tables and indexes have the size of a platform that has run for some years.
	for (let y = 0; y < ARCHIVED; y++) {
		const [c] = await db
			.insert(s.competition)
			.values({
				slug: `lasttest-arkiv-${y}`,
				name: `Lasttest arkiv ${y}`,
				startDate: `${2000 + (y % 26)}-05-${String((y % 28) + 1).padStart(2, '0')}`,
				endDate: `${2000 + (y % 26)}-05-${String((y % 28) + 1).padStart(2, '0')}`,
				status: 'closed',
				patrolCodeKey: 'x',
				createdBy: owner.id
			})
			.returning();
		await client`
			with st as (insert into station (competition_id, sort, name) select ${c.id}, g, 'Kontroll ' || g from generate_series(1, 20) g returning id, sort),
			it as (insert into score_item (station_id, sort, name, mode, min, max, style_enabled) select id, 1, 'Poäng', 'RANGE', 0, 20, true from st returning id),
			pa as (insert into patrol (competition_id, number, name, troop) select ${c.id}, 100 + g, 'Patrull ' || g, 'Testkåren' from generate_series(1, 100) g returning id)
			insert into score (competition_id, patrol_id, item_id, points, style_points, raw, state, version, origin)
			select ${c.id}, pa.id, it.id, (random() * 20)::int, (random() * 5)::int, '{"value":10,"style":2}'::jsonb, 'active', 1, 'paper' from pa cross join it`;
		await client`insert into score_revision (score_id, version, points, style_points, state, origin, at)
			select id, 1, points, style_points, state, origin, now() - interval '1 year' * random() from score where competition_id = ${c.id}`;
		await client`insert into change_log (competition_id, kind, entity_id) select ${c.id}, 'score', id from score where competition_id = ${c.id}`;
		await client`insert into status_event (patrol_id, status, at) select id, s, now() - interval '1 year' from patrol, unnest(array['active','finished']::patrol_status[]) s where competition_id = ${c.id}`;
	}

	// The live competition: two days, 12 stations a day (start, 10 controls, finish), 300 patrols.
	const [comp] = await db
		.insert(s.competition)
		.values({
			slug: SLUG,
			name: 'Lasttest Hajk 2027',
			startDate: '2027-06-11',
			endDate: '2027-06-12',
			multiDay: true,
			status: 'live',
			publicResults: true,
			stationResultsLive: true,
			styleEnabled: true,
			patrolCodeKey: createHash('sha256').update('lasttest').digest('base64url'),
			createdBy: owner.id
		})
		.returning();
	await db.insert(s.competitionMember).values({ competitionId: comp.id, userId: owner.id, role: 'owner' });
	const days = await db
		.insert(s.day)
		.values([
			{ competitionId: comp.id, date: '2027-06-11', name: 'Fredag', prefix: 'F', sort: 1 },
			{ competitionId: comp.id, date: '2027-06-12', name: 'Lördag', prefix: 'L', sort: 2 }
		])
		.returning();
	const tracks = await db
		.insert(s.track)
		.values(['Spårare', 'Upptäckare', 'Äventyrare', 'Utmanare'].map((name, i) => ({ competitionId: comp.id, name, sort: i + 1 })))
		.returning();
	let sort = 0;
	for (const d of days) {
		for (let i = 0; i < STATIONS_PER_DAY; i++) {
			const role = i === 0 ? 'start' : i === STATIONS_PER_DAY - 1 ? 'finish' : null;
			const [st] = await db
				.insert(s.station)
				.values({
					competitionId: comp.id,
					dayId: d.id,
					sort: ++sort,
					name: role === 'start' ? `${d.name} start` : role === 'finish' ? `${d.name} mål` : `${d.name} ${i}`,
					role,
					startable: !role
				})
				.returning();
			await db
				.insert(s.scoreItem)
				.values(
					role
						? { stationId: st.id, sort: 1, name: st.name, mode: 'CHECKIN', min: 0, max: 0, styleEnabled: false, countsForTiebreak: false }
						: { stationId: st.id, sort: 1, name: st.name, mode: 'RANGE', min: 0, max: 20, styleEnabled: true, countsForTiebreak: true }
				);
		}
	}
	await db.insert(s.patrol).values(
		Array.from({ length: PATROLS }, (_, i) => ({
			competitionId: comp.id,
			number: 101 + i,
			name: `Lastpatrull ${101 + i}`,
			troop: `Testkår ${(i % 12) + 1}`,
			trackId: tracks[i % tracks.length].id,
			contactName: 'Påhittad Kontakt',
			contactPhone: '070-000 00 00'
		}))
	);
	await client`analyze`;
	console.log(`setup: ${SLUG} with ${PATROLS} patrols, ${sort} stations; ${ARCHIVED} archived years in the background`);
}

// ---------------------------------------------------------------- run

class Stats {
	private ms = new Map<string, number[]>();
	private codes = new Map<string, Map<number, number>>();
	add(name: string, t: number, status: number) {
		(this.ms.get(name) ?? this.ms.set(name, []).get(name)!).push(t);
		const c = this.codes.get(name) ?? this.codes.set(name, new Map()).get(name)!;
		c.set(status, (c.get(status) ?? 0) + 1);
	}
	report() {
		const pct = (a: number[], p: number) => a[Math.min(a.length - 1, Math.floor((a.length * p) / 100))];
		const rows = [...this.ms].map(([name, a]) => {
			a.sort((x, y) => x - y);
			const codes = [...this.codes.get(name)!].map(([c, n]) => `${c}:${n}`).join(' ');
			return { name, n: a.length, p50: pct(a, 50), p95: pct(a, 95), p99: pct(a, 99), max: a.at(-1)!, codes };
		});
		console.table(rows.map((r) => ({ ...r, p50: Math.round(r.p50), p95: Math.round(r.p95), p99: Math.round(r.p99), max: Math.round(r.max) })));
		return rows;
	}
}
const stats = new Stats();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms: number) => ms * (0.75 + Math.random() * 0.5);

async function timed(name: string, url: string, init?: RequestInit) {
	const t0 = performance.now();
	try {
		const res = await fetch(url, init);
		const body = await res.text();
		stats.add(name, performance.now() - t0, res.status);
		return { res, body };
	} catch {
		stats.add(name, performance.now() - t0, 0);
		return null;
	}
}

async function phone(i: number, secret: string, until: number, accepted: { n: number }) {
	const key = await generateDeviceKey();
	const join = await fetch(`${base}/api/v1/join`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.1.0.${i + 1}` },
		body: JSON.stringify({ secret, displayName: `Lasttelefon ${i + 1}`, publicJwk: key.publicJwk })
	});
	if (!join.ok) throw new Error(`join ${i}: ${join.status} ${await join.text()}`);
	const j = (await join.json()) as JoinResponse;
	const headers = { authorization: `Grant ${j.grant}`, 'content-type': 'application/json', 'x-forwarded-for': `10.1.0.${i + 1}` };
	let snap = JSON.parse((await timed('snapshot (full)', `${base}/api/v1/field/${j.slug}/snapshot`, { headers }))!.body) as Snapshot;
	const items = snap.items.filter((it) => it.mode === 'RANGE' || it.mode === 'CHECKIN');
	const todo = snap.patrols.map((p) => p.id).sort(() => Math.random() - 0.5);
	let seq = 1;
	let prev: string | null = null;
	let round = 0;
	while (Date.now() < until && todo.length) {
		const patrolId = todo.pop()!;
		const batch: string[] = [];
		for (const it of items) {
			const body = {
				commandId: uuidv7(),
				deviceId: j.deviceId,
				deviceSeq: seq++,
				baseVersion: null,
				clientNow: new Date().toISOString(),
				prev,
				type: 'SetScore',
				payload: {
					patrolId,
					itemId: it.id,
					value: it.mode === 'RANGE' ? Math.floor(Math.random() * 21) : 0,
					style: it.styleEnabled ? Math.floor(Math.random() * 6) : null
				}
			} as CommandBody;
			const jws = await signCommand(key.privateKey, body);
			prev = await sha256b64url(jws);
			batch.push(jws);
		}
		const r = await timed('sync/commands', `${base}/api/v1/field/${j.slug}/sync/commands`, {
			method: 'POST',
			headers,
			body: JSON.stringify({ commands: batch })
		});
		if (r?.res.status === 503) {
			todo.push(patrolId); // busy: the phone keeps the report and retries (like the real outbox)
			seq -= batch.length;
			await sleep(1000);
			continue;
		}
		if (r?.res.ok) accepted.n += (JSON.parse(r.body).results as { result: string }[]).filter((x) => x.result === 'accepted').length;
		if (++round % 3 === 0) {
			const p = await timed('snapshot (since)', `${base}/api/v1/field/${j.slug}/snapshot?since=${snap.cursor}`, { headers });
			if (p?.res.ok) {
				const next = JSON.parse(p.body) as Snapshot | { unchanged: true; cursor: number };
				snap = next.unchanged ? { ...snap, cursor: next.cursor } : (next as Snapshot);
			}
		}
		await sleep(jitter(2000));
	}
}

async function viewer(i: number, until: number, frames: { n: number }) {
	const ctrl = new AbortController();
	const stop = setTimeout(() => ctrl.abort(), until - Date.now());
	const t0 = performance.now();
	try {
		const res = await fetch(`${base}/api/v1/live/${SLUG}/results`, {
			headers: { 'x-forwarded-for': `10.2.${Math.floor(i / 250)}.${(i % 250) + 1}` },
			signal: ctrl.signal
		});
		stats.add('live stream (open)', performance.now() - t0, res.status);
		if (!res.ok || !res.body) return;
		const reader = res.body.getReader();
		const dec = new TextDecoder();
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			frames.n += (dec.decode(value).match(/^event: results/gm) ?? []).length;
		}
	} catch {
		/* aborted at the end */
	} finally {
		clearTimeout(stop);
	}
}

async function reader(i: number, until: number) {
	await sleep(Math.random() * 10_000); // people arrive over time, not in the same millisecond
	while (Date.now() < until) {
		await timed('public results page', `${base}/r/${SLUG}`, { headers: { 'x-forwarded-for': `10.3.0.${(i % 250) + 1}` } });
		await sleep(jitter(10_000));
	}
}

async function hq(cookie: string, until: number) {
	await sleep(Math.random() * 5000);
	while (Date.now() < until) {
		await timed('HQ dashboard', `${base}/admin/${SLUG}/live/__data.json`, { headers: { cookie } });
		await timed('admin results', `${base}/admin/${SLUG}/results/__data.json`, { headers: { cookie } });
		await sleep(jitter(5000));
	}
}

async function run(seconds: number) {
	const [comp] = await db.select().from(s.competition).where(eq(s.competition.slug, SLUG)).limit(1);
	if (!comp) throw new Error('run setup first');
	// Fresh day: no scores, no phones, new invites.
	await db.delete(s.scoreConflict).where(eq(s.scoreConflict.competitionId, comp.id));
	await db.delete(s.score).where(eq(s.score.competitionId, comp.id));
	await db.delete(s.device).where(eq(s.device.competitionId, comp.id));
	await db.delete(s.invite).where(eq(s.invite.competitionId, comp.id));
	const stations = await db.select().from(s.station).where(eq(s.station.competitionId, comp.id));
	const secrets: string[] = [];
	for (let i = 0; i < PHONES; i++) {
		const secret = createHash('sha256').update(`lasttest-${i}-${Date.now()}`).digest('base64url').slice(0, 22);
		await db
			.insert(s.invite)
			.values({
				competitionId: comp.id,
				stationId: stations[i % stations.length].id,
				role: 'station_volunteer',
				secretHash: createHash('sha256').update(secret).digest('base64url')
			});
		secrets.push(secret);
	}
	const cookie = await devLogin();
	const until = Date.now() + seconds * 1000;
	const accepted = { n: 0 };
	const frames = { n: 0 };
	const server = Number(process.env.SERVER_PID ?? 0);
	const samples: { cpu: number; rssMb: number; dbConns: number }[] = [];
	const sampler = setInterval(async () => {
		const [{ n }] = await client`select count(*)::int n from pg_stat_activity where datname = current_database()`;
		let cpu = 0;
		let rssMb = 0;
		if (server) {
			const { execFileSync } = await import('node:child_process');
			const [c, r] = execFileSync('ps', ['-o', '%cpu=,rss=', '-p', String(server)], { encoding: 'utf8' })
				.trim()
				.split(/\s+/);
			cpu = Number(c);
			rssMb = Math.round(Number(r) / 1024);
		}
		samples.push({ cpu, rssMb, dbConns: n });
	}, 5000);
	console.log(`run: ${seconds} s, ${PHONES} phones, ${VIEWERS} live viewers, ${PAGE_READERS} page readers, ${HQ} HQ screens`);
	await Promise.all([
		...secrets.map((sec, i) => phone(i, sec, until, accepted).catch((e) => console.error(String(e)))),
		...Array.from({ length: VIEWERS }, (_, i) => viewer(i, until, frames)),
		...Array.from({ length: PAGE_READERS }, (_, i) => reader(i, until)),
		...Array.from({ length: HQ }, () => hq(cookie, until))
	]);
	clearInterval(sampler);
	const rows = stats.report();
	const [{ n: stored }] = await client`select count(*)::int n from score where competition_id = ${comp.id}`;
	const [{ n: conflicts }] = await client`select count(*)::int n from score_conflict where competition_id = ${comp.id}`;
	console.log(`reports accepted ${accepted.n}, scores stored ${stored}, conflicts ${conflicts}, live result frames received ${frames.n}`);
	if (samples.length) {
		const max = (k: 'cpu' | 'rssMb' | 'dbConns') => Math.max(...samples.map((x) => x[k]));
		const avg = (k: 'cpu' | 'rssMb' | 'dbConns') => Math.round(samples.reduce((a, x) => a + x[k], 0) / samples.length);
		console.log(`server CPU avg ${avg('cpu')} % max ${max('cpu')} % · memory max ${max('rssMb')} MB · DB connections max ${max('dbConns')}`);
	}
	const errors = rows.reduce(
		(a, r) =>
			a + [...r.codes.matchAll(/(\d+):(\d+)/g)].filter(([, c]) => c === '0' || (Number(c) >= 500 && c !== '503')).reduce((x, [, , n]) => x + Number(n), 0),
		0
	);
	console.log(`errors (network or 5xx other than 503): ${errors}`);
}

// ---------------------------------------------------------------- explain

async function explain() {
	const [comp] = await db.select().from(s.competition).where(eq(s.competition.slug, SLUG)).limit(1);
	const [dev] = await db.select().from(s.device).where(eq(s.device.competitionId, comp.id)).limit(1);
	const [st] = await db.select().from(s.station).where(eq(s.station.competitionId, comp.id)).limit(1);
	const [pa] = await db.select().from(s.patrol).where(eq(s.patrol.competitionId, comp.id)).limit(1);
	const [it] = await db.select().from(s.scoreItem).where(eq(s.scoreItem.stationId, st.id)).limit(1);
	const [{ cursor }] = await client`select coalesce(max(seq), 0)::int as cursor from change_log where competition_id = ${comp.id}`;
	const queries: [string, string][] = [
		['latest change (every stream, every snapshot)', `select max(seq) from change_log where competition_id = '${comp.id}'`],
		[
			'change feed after a cursor (SSE hub)',
			`select seq, kind, entity_id, at from change_log where competition_id = '${comp.id}' and seq > ${cursor - 3} order by seq limit 500`
		],
		['results: active scores', `select patrol_id, item_id, points, style_points from score where competition_id = '${comp.id}' and state = 'active'`],
		['write: existing score for patrol + item', `select * from score where patrol_id = '${pa.id}' and item_id = '${it.id}'`],
		[
			'snapshot: anything new for this phone?',
			`select 1 from change_log c where c.competition_id = '${comp.id}' and c.seq > ${cursor - 3} and (c.kind in ('competition','station','patrol','message') or (c.kind = 'score' and exists (select 1 from score s join score_item i on i.id = s.item_id where s.id = c.entity_id and i.station_id in ('${st.id}')))) limit 1`
		],
		[
			'dashboard: last status per patrol',
			`select se.patrol_id, max(se.at) from status_event se join patrol p on p.id = se.patrol_id where p.competition_id = '${comp.id}' group by se.patrol_id`
		],
		[
			'HQ feed: latest reports',
			`select r.* from score_revision r join score s on s.id = r.score_id where s.competition_id = '${comp.id}' order by r.at desc, r.version desc limit 12`
		],
		[
			'quarantine cap per phone',
			`select count(*) from score_conflict where competition_id = '${comp.id}' and kind = 'quarantine' and status = 'open' and incoming->>'deviceId' = '${dev?.id ?? comp.id}'`
		],
		['open conflicts', `select id from score_conflict where competition_id = '${comp.id}' and status = 'open' order by created_at desc`]
	];
	for (const [name, q] of queries) {
		const plan = (await client.unsafe(`explain (analyze, buffers) ${q}`)).map((r) => r['QUERY PLAN'] as string);
		const time = plan.find((l) => l.startsWith('Execution Time'));
		const seq = plan.filter((l) => /Seq Scan on (score|change_log|score_revision|status_event|score_conflict)\b/.test(l));
		console.log(`\n${name}: ${time}${seq.length ? `\n  SEQUENTIAL SCAN: ${seq.map((l) => l.trim()).join(' | ')}` : ''}`);
		if (process.env.VERBOSE) console.log(plan.join('\n'));
	}
}

try {
	if (mode === 'setup') await setup();
	else if (mode === 'run') await run(Number(secondsArg ?? 180));
	else if (mode === 'explain') await explain();
	else console.log('usage: node scripts/loadtest.ts setup|run|explain <base url> [seconds]');
} finally {
	await client.end();
}

/**
 * Site admins (platform operators) are granted and revoked ONLY here, on the server's command line.
 * There is no web path for it. Docs: docs/architecture/04-security-and-operations.md §10.
 *
 *   npm run site-admin:grant  -- <memberNo> --reason "Driftansvarig för scouttavling.se"
 *   npm run site-admin:revoke -- <memberNo> --reason "Slutar som driftansvarig"
 *   npm run site-admin:list
 *
 * Production (inside the running app container, DATABASE_URL is already set):
 *   docker compose --env-file .env.prod -f compose.yaml -f compose.prod.yaml exec app \
 *     npm run site-admin:grant -- 3000001 --reason "…"
 *
 * The person must have logged in once (an app_user row exists). Every grant/revoke writes an
 * audit_log row (actor_kind 'cli', details.by = "cli:<os user>"). Self-contained on purpose: only
 * `postgres`, so it runs from the production image without the SvelteKit build.
 */
import postgres from 'postgres';
import { userInfo } from 'node:os';

const USAGE = `Usage:
  site-admin grant <memberNo> --reason "<why, at least 10 characters>"
  site-admin revoke <memberNo> --reason "<why, at least 10 characters>"
  site-admin list`;

function operator(): string {
	const who = process.env.SITE_ADMIN_OPERATOR || process.env.SUDO_USER || (() => {
		try {
			return userInfo().username;
		} catch {
			return 'unknown';
		}
	})();
	return `cli:${who}`;
}

function parse(argv: string[]) {
	const [cmd, ...rest] = argv;
	let reason = '';
	const pos: string[] = [];
	for (let i = 0; i < rest.length; i++) {
		if (rest[i] === '--reason') reason = rest[++i] ?? '';
		else if (rest[i].startsWith('--reason=')) reason = rest[i].slice('--reason='.length);
		else pos.push(rest[i]);
	}
	return { cmd, memberNo: (pos[0] ?? '').replace(/\s+/g, ''), reason: reason.trim() };
}

function fail(msg: string, code = 1): never {
	console.error(msg);
	process.exit(code);
}

const { cmd, memberNo, reason } = parse(process.argv.slice(2));
if (!['grant', 'revoke', 'list'].includes(cmd ?? '')) fail(USAGE, 2);
if (cmd !== 'list') {
	if (!/^\d{3,12}$/.test(memberNo)) fail(`Give a member number (digits only).\n${USAGE}`, 2);
	if (reason.length < 10) fail(`--reason is required (at least 10 characters). Do not write patrol member names.\n${USAGE}`, 2);
	if (reason.length > 500) fail('--reason is at most 500 characters.', 2);
}
const url = process.env.DATABASE_URL;
if (!url) fail('DATABASE_URL is not set.');

const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
	if (cmd === 'list') {
		const rows = await sql`
			select u.member_no, u.name, a.granted_at, a.granted_by, a.reason, u.suspended_at is not null as suspended
			from site_admin a join app_user u on u.id = a.user_id order by a.granted_at`;
		if (!rows.length) console.log('No site admins.');
		for (const r of rows) {
			console.log(`${r.member_no}\t${r.name}\tgranted ${new Date(r.granted_at).toISOString().slice(0, 16).replace('T', ' ')} by ${r.granted_by}${r.suspended ? '\t(SUSPENDED)' : ''}\t${r.reason}`);
		}
	} else {
		const [u] = await sql`select id, name from app_user where member_no = ${memberNo}`;
		if (!u) fail(`No user with member number ${memberNo}. They must log in to scouttavling.se once (with ScoutID) before they can be made site admin.`);
		const by = operator();
		await sql.begin(async (tx) => {
			if (cmd === 'grant') {
				const [row] = await tx`
					insert into site_admin (user_id, granted_by, reason) values (${u.id}, ${by}, ${reason})
					on conflict (user_id) do nothing returning user_id`;
				if (!row) {
					console.log(`${u.name} (${memberNo}) is already a site admin. Nothing changed.`);
					return;
				}
			} else {
				const del = await tx`delete from site_admin where user_id = ${u.id} returning user_id`;
				if (!del.length) {
					console.log(`${u.name} (${memberNo}) is not a site admin. Nothing changed.`);
					return;
				}
				// Temporary accesses end with the role.
				await tx`update site_admin_access set ended_at = now() where user_id = ${u.id} and ended_at is null and expires_at > now()`;
			}
			await tx`
				insert into audit_log (actor_user_id, actor_kind, action, target_type, target_id, reason, details)
				values (null, 'cli', ${cmd === 'grant' ? 'site_admin.grant' : 'site_admin.revoke'}, 'site_admin', ${u.id}, ${reason}, ${tx.json({ by })})`;
			console.log(cmd === 'grant' ? `${u.name} (${memberNo}) is now a site admin (${by}).` : `${u.name} (${memberNo}) is no longer a site admin (${by}).`);
		});
	}
} finally {
	await sql.end();
}

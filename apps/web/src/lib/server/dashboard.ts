/* Ledningscentralen: key figures, station tiles, alarms and the report feed. */
import { and, desc, eq, isNull, max } from 'drizzle-orm';
import { db, schema, type CompRow } from './db/index.ts';
import { latestSeq } from './changes.ts';
import { loadStations, stationAppliesTo } from './queries.ts';
import { formatDuration, formatTime } from '#lib/time.ts';
import { firstName } from '#lib/names.ts';

const ONLINE_MS = 10 * 60_000;
const OFFLINE_ALARM_MS = 20 * 60_000;
const UNSEEN_ALARM_MS = 45 * 60_000;

export interface Alarm {
	key: string;
	kind: 'unseen' | 'offline' | 'conflict';
	title: string;
	detail: string;
	href: string | null;
}

/** Acknowledged alarm keys per competition (in memory; keys embed the triggering timestamp). */
const acks: Map<string, Set<string>> = ((globalThis as unknown as { __liveAcks?: Map<string, Set<string>> }).__liveAcks ??= new Map());

export function acknowledgeAlarm(competitionId: string, key: string) {
	const set = acks.get(competitionId) ?? new Set<string>();
	set.add(key);
	acks.set(competitionId, set);
}

const minutesSince = (d: Date, now: number) => Math.floor((now - d.getTime()) / 60_000);

/**
 * "Not seen for 45 min": only patrols out on the course (active). Anmäld, I läger
 * (done for the day, overnight in camp), I mål and Återbud never alarm.
 */
export function unseenAlarms(
	patrols: { id: string; number: number; name: string; status: string }[],
	lastByPatrol: Map<string, Date>,
	now: number,
	slug: string
): Alarm[] {
	const out: Alarm[] = [];
	for (const p of patrols.filter((p) => p.status === 'active').sort((a, b) => a.number - b.number)) {
		const last = lastByPatrol.get(p.id);
		if (!last || now - last.getTime() < UNSEEN_ALARM_MS) continue;
		out.push({
			key: `unseen:${p.id}:${last.getTime()}`,
			kind: 'unseen',
			title: `${p.number} ${p.name} inte sedd på ${formatDuration(minutesSince(last, now))}`,
			detail: `Senast rapporterad ${formatTime(last)}`,
			href: `/admin/${slug}/patrol/${p.number}`
		});
	}
	return out;
}

export async function loadDashboard(comp: CompRow) {
	const now = Date.now();
	const [stations, patrols, scores, devices, statusEvents, conflicts, feed] = await Promise.all([
		loadStations(comp.id),
		db
			.select({ id: schema.patrol.id, number: schema.patrol.number, name: schema.patrol.name, status: schema.patrol.status, trackId: schema.patrol.trackId })
			.from(schema.patrol)
			.where(eq(schema.patrol.competitionId, comp.id)),
		db
			.select({ patrolId: schema.score.patrolId, itemId: schema.score.itemId, updatedAt: schema.score.updatedAt })
			.from(schema.score)
			.where(and(eq(schema.score.competitionId, comp.id), eq(schema.score.state, 'active'))),
		db
			.select()
			.from(schema.device)
			.where(and(eq(schema.device.competitionId, comp.id), isNull(schema.device.revokedAt))),
		db
			.select({ patrolId: schema.statusEvent.patrolId, at: max(schema.statusEvent.at) })
			.from(schema.statusEvent)
			.innerJoin(schema.patrol, eq(schema.patrol.id, schema.statusEvent.patrolId))
			.where(eq(schema.patrol.competitionId, comp.id))
			.groupBy(schema.statusEvent.patrolId),
		db
			.select({ id: schema.scoreConflict.id, createdAt: schema.scoreConflict.createdAt })
			.from(schema.scoreConflict)
			.where(and(eq(schema.scoreConflict.competitionId, comp.id), eq(schema.scoreConflict.status, 'open')))
			.orderBy(desc(schema.scoreConflict.createdAt)),
		loadFeed(comp.id, 12)
	]);

	const kpi = {
		active: patrols.filter((p) => p.status === 'active').length,
		camp: patrols.filter((p) => p.status === 'camp').length,
		finished: patrols.filter((p) => p.status === 'finished').length,
		registered: patrols.filter((p) => p.status === 'registered').length,
		resigned: patrols.filter((p) => p.status === 'resigned').length,
		reports: scores.length,
		devicesOnline: devices.filter((d) => d.lastSeenAt && now - d.lastSeenAt.getTime() < ONLINE_MS).length,
		devicesTotal: devices.length
	};

	const stationOfItem = new Map<string, string>();
	for (const st of stations) for (const it of st.items) stationOfItem.set(it.id, st.id);
	const doneBy = new Map<string, Set<string>>();
	for (const s of scores) {
		const st = stationOfItem.get(s.itemId);
		if (!st) continue;
		doneBy.set(st, (doneBy.get(st) ?? new Set()).add(s.patrolId));
	}
	const tiles = stations.map((st) => {
		const expected = patrols.filter((p) => p.status !== 'resigned' && stationAppliesTo(st, p.trackId)).length;
		const done = doneBy.get(st.id)?.size ?? 0;
		const devs = devices.filter((d) => d.stationIds.includes(st.id));
		const last = devs.reduce<Date | null>((acc, d) => (d.lastSeenAt && (!acc || d.lastSeenAt > acc) ? d.lastSeenAt : acc), null);
		const offMs = last ? now - last.getTime() : null;
		const state: 'online' | 'stale' | 'offline' | 'none' =
			devs.length === 0 ? 'none' : offMs === null ? 'offline' : offMs < ONLINE_MS ? 'online' : offMs < OFFLINE_ALARM_MS ? 'stale' : 'offline';
		return {
			id: st.id,
			code: st.code,
			name: st.name,
			checkpoint: st.checkpoint,
			finishSets: st.finishSets,
			expected,
			done,
			devices: devs.length,
			state,
			lastSeenAt: last,
			offlineMinutes: last && state !== 'online' ? minutesSince(last, now) : null
		};
	});

	// ---- alarms ----
	const ack = acks.get(comp.id) ?? new Set<string>();
	const alarms: Alarm[] = [];
	const lastByPatrol = new Map<string, Date>();
	const bump = (pid: string, at: Date | null) => {
		if (!at) return;
		const cur = lastByPatrol.get(pid);
		if (!cur || at > cur) lastByPatrol.set(pid, at);
	};
	for (const s of scores) bump(s.patrolId, s.updatedAt);
	for (const e of statusEvents) bump(e.patrolId, e.at ? new Date(e.at) : null);
	alarms.push(...unseenAlarms(patrols, lastByPatrol, now, comp.slug));
	for (const t of tiles.filter((t) => t.state === 'offline')) {
		alarms.push({
			key: `offline:${t.id}:${t.lastSeenAt?.getTime() ?? 0}`,
			kind: 'offline',
			title: `${t.code} ${t.name} offline`,
			detail: t.lastSeenAt ? `Ingen kontakt sedan ${formatTime(t.lastSeenAt)} (${formatDuration(t.offlineMinutes ?? 0)})` : 'Enheten har aldrig synkat',
			href: null
		});
	}
	if (conflicts.length > 0) {
		alarms.push({
			key: `conflict:${conflicts[0].id}:${conflicts.length}`,
			kind: 'conflict',
			title: conflicts.length === 1 ? '1 öppen poängkonflikt' : `${conflicts.length} öppna poängkonflikter`,
			detail: 'Två rapporter skiljer sig åt och behöver ett beslut',
			href: `/admin/${comp.slug}/conflicts`
		});
	}

	return {
		kpi,
		tiles,
		alarms: alarms.filter((a) => !ack.has(a.key)),
		acknowledged: alarms.filter((a) => ack.has(a.key)).length,
		feed,
		seq: await latestSeq(comp.id)
	};
}

/** Latest score reports (revisions), newest first. */
export async function loadFeed(competitionId: string, limit: number) {
	const stations = await loadStations(competitionId);
	const codeOf = new Map(
		stations.flatMap((s) => s.items.map((i) => [i.id, { code: s.code, station: s.name, item: i.name, multi: s.items.length > 1 }] as const))
	);
	const rows = await db
		.select({
			id: schema.scoreRevision.id,
			at: schema.scoreRevision.at,
			version: schema.scoreRevision.version,
			points: schema.scoreRevision.points,
			stylePoints: schema.scoreRevision.stylePoints,
			state: schema.scoreRevision.state,
			origin: schema.scoreRevision.origin,
			itemId: schema.score.itemId,
			patrolNumber: schema.patrol.number,
			patrolName: schema.patrol.name,
			deviceName: schema.device.displayName,
			userName: schema.appUser.name
		})
		.from(schema.scoreRevision)
		.innerJoin(schema.score, eq(schema.score.id, schema.scoreRevision.scoreId))
		.innerJoin(schema.patrol, eq(schema.patrol.id, schema.score.patrolId))
		.leftJoin(schema.device, eq(schema.device.id, schema.scoreRevision.deviceId))
		.leftJoin(schema.appUser, eq(schema.appUser.id, schema.scoreRevision.userId))
		.where(eq(schema.score.competitionId, competitionId))
		.orderBy(desc(schema.scoreRevision.at), desc(schema.scoreRevision.version))
		.limit(limit);
	return rows.map((r) => {
		const c = codeOf.get(r.itemId);
		return {
			id: r.id,
			at: r.at,
			time: formatTime(r.at),
			code: c?.code ?? '?',
			what: c ? (c.multi ? `${c.station} · ${c.item}` : c.station) : '',
			patrol: `${r.patrolNumber} ${r.patrolName}`,
			patrolNumber: r.patrolNumber,
			points: r.points,
			stylePoints: r.stylePoints,
			state: r.state,
			edited: r.version > 1,
			origin: r.origin,
			by: r.deviceName ?? (r.userName ? firstName(r.userName) : r.origin === 'paper' ? 'papper' : 'okänd')
		};
	});
}

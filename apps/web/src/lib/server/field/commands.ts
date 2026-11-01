/** Signed commands from phones (C1 push): verify, apply or quarantine, one transaction per command. */
import { error } from '@sveltejs/kit';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema, type Queryable } from '#lib/server/db/index.ts';
import { conflictSnapshot, writeScore, voidScore } from '#lib/server/scores.ts';
import { recordChange } from '#lib/server/changes.ts';
import { setPatrolStatus } from '../patrolStatus.ts';
import { type CommandBody, type CommandResult } from '#lib/field/protocol.ts';
import { processBatch, type BatchDeps } from '#lib/field/verify.ts';
import type { DeviceContext } from './device.ts';

/** Open quarantined reports per device before further ones are refused (HQ has to review them first). */
const MAX_OPEN_QUARANTINE = 200;

function resultFromRow(id: string, row: { result: string; resultDetail: unknown }): CommandResult {
	// command.result_detail as written below (the parts of a CommandResult beyond id and result).
	const d = (row.resultDetail ?? {}) as Partial<{ version: number; reason: string; server: Extract<CommandResult, { result: 'conflict' }>['server'] }>;
	switch (row.result) {
		case 'accepted':
			return { commandId: id, result: 'accepted', version: d.version ?? 0 };
		case 'duplicate':
			return { commandId: id, result: 'duplicate', version: d.version };
		case 'conflict':
			// Always stored by finish(); without it the phone could not show the conflict.
			if (d.server) return { commandId: id, result: 'conflict', server: d.server };
			return { commandId: id, result: 'rejected', reason: 'Konflikt' };
		case 'quarantined':
			return { commandId: id, result: 'quarantined', reason: d.reason ?? '' };
		default:
			return { commandId: id, result: 'rejected', reason: d.reason ?? '' };
	}
}

function clientDate(body: CommandBody): Date {
	const t = Date.parse(body.clientNow);
	return new Date(Math.min(Number.isFinite(t) ? t : Date.now(), Date.now()));
}

/**
 * The database side of processBatch (#lib/field/verify.ts) for one device. `atomic` runs each command
 * in its own transaction; while it runs, every other method uses that transaction (`q`).
 */
export function databaseDeps(ctx: DeviceContext, compItems: Map<string, { stationId: string; mode: string }>): BatchDeps {
	const { comp, device } = ctx;
	// The transaction of the command being processed (see deps.atomic); plain db outside one.
	let q: Queryable = db;

	const deps: BatchDeps = {
		atomic: (fn) =>
			db.transaction(async (tx) => {
				q = tx;
				try {
					return await fn();
				} finally {
					q = db;
				}
			}),
		async claim(body) {
			// Placeholder row reserves the id. A concurrent copy of the same command waits here (unique key)
			// until the first one's transaction ends, then reads its result.
			const inserted = await q
				.insert(schema.command)
				.values({
					id: body.commandId,
					competitionId: comp.id,
					deviceId: device.id,
					deviceSeq: body.deviceSeq,
					type: body.type,
					payload: body,
					clientAt: new Date(body.clientNow),
					result: 'rejected',
					resultDetail: { pending: true }
				})
				.onConflictDoNothing({ target: schema.command.id })
				.returning({ id: schema.command.id });
			if (inserted.length) return { fresh: true };
			const [row] = await q.select().from(schema.command).where(eq(schema.command.id, body.commandId)).limit(1);
			if (row.competitionId !== comp.id || row.deviceId !== device.id)
				return { fresh: false, result: { commandId: body.commandId, result: 'rejected', reason: 'Kommandot finns redan' } };
			// The placeholder is committed together with the result (deps.atomic), so a committed
			// `pending` row can only be left by a crash outside that: process it again. Never answer
			// "already being processed" as a rejection: the phone would drop the report for good.
			if ((row.resultDetail as { pending?: boolean } | null)?.pending) {
				await q.update(schema.command).set({ receivedAt: new Date() }).where(eq(schema.command.id, body.commandId));
				return { fresh: true };
			}
			return { fresh: false, result: resultFromRow(body.commandId, row) };
		},
		async finish(body, result, detail) {
			const { commandId: _id, result: r, ...rest } = result;
			await q
				.update(schema.command)
				.set({ result: r, resultDetail: { ...rest, ...detail } })
				.where(eq(schema.command.id, body.commandId));
		},
		async lookup(body) {
			const [p] = await q
				.select({ id: schema.patrol.id })
				.from(schema.patrol)
				.where(and(eq(schema.patrol.id, body.payload.patrolId), eq(schema.patrol.competitionId, comp.id)))
				.limit(1);
			const stationId = body.type === 'SetStatus' ? null : (compItems.get(body.payload.itemId)?.stationId ?? null);
			return { stationId, patrolOk: !!p };
		},
		async apply(body) {
			if (body.type === 'SetStatus') return setStatus(ctx, body, q);
			const base = {
				competitionId: comp.id,
				patrolId: body.payload.patrolId,
				itemId: body.payload.itemId,
				baseVersion: body.baseVersion,
				origin: 'device' as const,
				deviceId: device.id,
				commandId: body.commandId,
				at: clientDate(body)
			};
			const r =
				body.type === 'SetScore'
					? await writeScore({ ...base, raw: { value: body.payload.value, style: body.payload.style }, note: body.payload.note ?? null }, q)
					: await voidScore({ ...base, reason: 'Ångrad på kontrollen' }, q);
			// Status (På banan / I läger / I mål, incl. C10 AUTO_ON_SCAN) follows in writeScore.
			switch (r.result) {
				case 'accepted':
					return { commandId: body.commandId, result: 'accepted', version: r.version };
				case 'duplicate':
					return { commandId: body.commandId, result: 'duplicate', version: r.version };
				case 'conflict':
					return { commandId: body.commandId, result: 'conflict', server: r.server };
				case 'rejected':
					return { commandId: body.commandId, result: 'rejected', reason: r.reason };
			}
		},
		async quarantine(body, reason) {
			if (body.type === 'SetStatus' || !compItems.has(body.payload.itemId)) return true; // kept in the command ledger only
			// One phone cannot flood HQ's review list (a stolen or broken device).
			const [{ open }] = await q
				.select({ open: sql<number>`count(*)::int` })
				.from(schema.scoreConflict)
				.where(
					and(
						eq(schema.scoreConflict.competitionId, comp.id),
						eq(schema.scoreConflict.kind, 'quarantine'),
						eq(schema.scoreConflict.status, 'open'),
						sql`${schema.scoreConflict.incoming}->>'deviceId' = ${device.id}`
					)
				);
			if (open >= MAX_OPEN_QUARANTINE) return false;
			await q.transaction(async (tx) => {
				const [ex] = await tx
					.select()
					.from(schema.score)
					.where(and(eq(schema.score.patrolId, body.payload.patrolId), eq(schema.score.itemId, body.payload.itemId)))
					.limit(1);
				await tx.insert(schema.scoreConflict).values({
					competitionId: comp.id,
					patrolId: body.payload.patrolId,
					itemId: body.payload.itemId,
					commandId: body.commandId,
					kind: 'quarantine',
					existing: ex ? conflictSnapshot(ex) : {},
					incoming: {
						type: body.type,
						reason,
						deviceId: device.id,
						deviceName: device.displayName,
						baseVersion: body.baseVersion,
						clientNow: body.clientNow,
						...(body.type === 'SetScore' ? { raw: { value: body.payload.value, style: body.payload.style } } : {})
					}
				});
				await recordChange(tx, comp.id, 'conflict', null);
			});
			return true;
		}
	};
	return deps;
}

export async function syncCommands(ctx: DeviceContext, jwsList: string[]) {
	const { comp, device } = ctx;
	const compItems = new Map<string, { stationId: string; mode: string }>();
	const items = await db
		.select({ id: schema.scoreItem.id, stationId: schema.scoreItem.stationId, mode: schema.scoreItem.mode })
		.from(schema.scoreItem)
		.innerJoin(schema.station, eq(schema.station.id, schema.scoreItem.stationId))
		.where(eq(schema.station.competitionId, comp.id));
	for (const i of items) compItems.set(i.id, i);

	const deps = databaseDeps(ctx, compItems);

	const out = await processBatch(
		jwsList,
		{
			deviceId: device.id,
			publicJwk: device.publicJwk,
			role: device.role,
			stations: device.stationIds.filter((s) => ctx.claims.stations.includes(s)),
			revoked: ctx.revoked,
			superseded: ctx.superseded,
			grantExp: ctx.claims.exp,
			grantIat: ctx.claims.iat,
			lastSeq: device.lastSeq,
			closed: comp.status === 'closed'
		},
		deps
	);
	await db
		.update(schema.device)
		.set({ lastSeq: sql`greatest(${schema.device.lastSeq}, ${out.lastSeq})`, lastSeenAt: new Date() })
		.where(eq(schema.device.id, device.id));
	return { results: out.results, serverTime: new Date().toISOString() };
}

async function setStatus(ctx: DeviceContext, body: Extract<CommandBody, { type: 'SetStatus' }>, q: Queryable = db): Promise<CommandResult> {
	return q.transaction(async (tx) => {
		const [p] = await tx.select().from(schema.patrol).where(eq(schema.patrol.id, body.payload.patrolId)).for('update').limit(1);
		if (p.status === body.payload.status) return { commandId: body.commandId, result: 'duplicate' } as const;
		await setPatrolStatus(tx, {
			competitionId: ctx.comp.id,
			patrolId: p.id,
			from: p.status,
			to: body.payload.status,
			deviceId: ctx.device.id,
			at: clientDate(body)
		});
		return { commandId: body.commandId, result: 'accepted', version: 1 } as const;
	});
}

export async function markMessageRead(ctx: DeviceContext, messageId: string) {
	const [m] = await db
		.select({ id: schema.message.id })
		.from(schema.message)
		.where(and(eq(schema.message.id, messageId), eq(schema.message.competitionId, ctx.comp.id)))
		.limit(1);
	if (!m) error(404, 'Meddelandet finns inte');
	await db.transaction(async (tx) => {
		const ins = await tx
			.insert(schema.messageRead)
			.values({ messageId, deviceId: ctx.device.id })
			.onConflictDoNothing()
			.returning({ m: schema.messageRead.messageId });
		// HQ's Meddelanden page shows read receipts live; it only refreshes on change_log events.
		if (ins.length) await recordChange(tx, ctx.comp.id, 'message', messageId);
	});
}

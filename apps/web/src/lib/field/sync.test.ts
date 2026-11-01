/**
 * The field app's sync engine against an in-memory IndexedDB (fake-indexeddb) and a stub server:
 * signing order and the hash chain, an edit chained to an earlier unsent report (baseFrom), conflict
 * and rejection results, and a disconnected phone. All data is invented.
 */
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { FieldDB, scoreKey, type OutboxRow } from './db.ts';
import { generateDeviceKey, peekJws, sha256b64url, uuidv7, type CommandBody, type CommandResult } from './protocol.ts';
import { AuthError, SyncEngine } from './sync.ts';

const SLUG = 'testtavlingen';
const PATROL = uuidv7();
const ITEM = uuidv7();

async function setup() {
	const db = new FieldDB(`test-${uuidv7()}`);
	const key = await generateDeviceKey();
	await db.grants.put({
		slug: SLUG,
		grant: 'grant-jws',
		deviceId: uuidv7(),
		privateKey: key.privateKey,
		publicJwk: key.publicJwk,
		displayName: 'Testtelefon',
		role: 'station_volunteer',
		stations: [],
		exp: Math.floor(Date.now() / 1000) + 3600,
		nextSeq: 1,
		lastHash: null,
		joinedAt: Date.now(),
		stationId: null
	});
	return db;
}

function scoreRow(over: Partial<OutboxRow> = {}): OutboxRow {
	const commandId = over.commandId ?? uuidv7();
	return {
		commandId,
		slug: SLUG,
		groupId: uuidv7(),
		createdAt: Date.now(),
		type: 'SetScore',
		state: 'pending',
		payload: { patrolId: PATROL, itemId: ITEM, value: 12, style: null },
		baseVersion: null,
		baseFrom: null,
		...over
	};
}

async function localScore(db: FieldDB, commandId: string, value = 12) {
	await db.scores.put({
		key: scoreKey(SLUG, PATROL, ITEM),
		slug: SLUG,
		patrolId: PATROL,
		itemId: ITEM,
		server: null,
		local: { value, style: null, points: value, stylePoints: 0, state: 'active', at: Date.now(), commandId },
		conflict: null,
		problem: null
	});
}

/** A stub server: answers each /sync/commands call with `answer(bodies)`, records what it got. */
function server(answer: (bodies: CommandBody[]) => CommandResult[]) {
	const sent: CommandBody[][] = [];
	const fetch = (async (url: string, init?: RequestInit) => {
		if (String(url).endsWith('/sync/commands')) {
			const bodies = (JSON.parse(String(init!.body)) as { commands: string[] }).commands.map((j) => peekJws<CommandBody>(j));
			sent.push(bodies);
			return Response.json({ results: answer(bodies) });
		}
		return Response.json({ unchanged: true, cursor: 0, serverTime: new Date().toISOString() });
	}) as typeof globalThis.fetch;
	return { fetch, sent };
}

describe('SyncEngine', () => {
	it('signs in order with increasing deviceSeq and a hash chain, and settles accepted reports', async () => {
		const db = await setup();
		const a = scoreRow({ createdAt: 1 });
		const b = scoreRow({ createdAt: 2, payload: { patrolId: PATROL, itemId: uuidv7(), value: 3, style: null } });
		await db.outbox.bulkAdd([a, b]);
		await localScore(db, a.commandId);
		const srv = server((bodies) => bodies.map((c) => ({ commandId: c.commandId, result: 'accepted', version: 1 })));
		await new SyncEngine(db, SLUG, srv.fetch).push();

		const [batch] = srv.sent;
		expect(batch.map((c) => c.commandId)).toEqual([a.commandId, b.commandId]);
		expect(batch.map((c) => c.deviceSeq)).toEqual([1, 2]);
		expect(batch[0].prev).toBeNull();
		const signedA = (await db.outbox.get(a.commandId))!.jws!;
		expect(batch[1].prev).toBe(await sha256b64url(signedA));
		expect((await db.grants.get(SLUG))!.nextSeq).toBe(3);

		const score = await db.scores.get(scoreKey(SLUG, PATROL, ITEM));
		expect(score).toMatchObject({ local: null, conflict: null, server: { points: 12, version: 1, by: 'Testtelefon', mine: true } });
		expect((await db.outbox.get(a.commandId))!.state).toBe('accepted');
	});

	it('an edit of an unsent report waits for it and builds on the version the server gave it', async () => {
		const db = await setup();
		const first = scoreRow({ createdAt: 1 });
		const edit = scoreRow({ createdAt: 2, baseFrom: first.commandId, payload: { patrolId: PATROL, itemId: ITEM, value: 15, style: null } });
		await db.outbox.bulkAdd([first, edit]);
		await localScore(db, edit.commandId, 15);
		// Someone else scored this patrol first: the first report conflicts with server version 5.
		const srv = server((bodies) =>
			bodies.map((c) =>
				c.commandId === first.commandId
					? { commandId: c.commandId, result: 'conflict', server: { points: 8, stylePoints: 0, version: 5, state: 'active' } }
					: { commandId: c.commandId, result: 'accepted', version: 6 }
			)
		);
		await new SyncEngine(db, SLUG, srv.fetch).push();

		expect(srv.sent.map((b) => b.map((c) => c.commandId))).toEqual([[first.commandId], [edit.commandId]]);
		expect(srv.sent[1][0].baseVersion).toBe(5);
		expect((await db.scores.get(scoreKey(SLUG, PATROL, ITEM)))!.server).toMatchObject({ points: 15, version: 6 });
	});

	it('keeps a conflict or a refusal on the score for the volunteer to see', async () => {
		const db = await setup();
		const row = scoreRow();
		await db.outbox.add(row);
		await localScore(db, row.commandId);
		const srv = server((bodies) => bodies.map((c) => ({ commandId: c.commandId, result: 'rejected', reason: 'Tävlingen är avslutad' })));
		await new SyncEngine(db, SLUG, srv.fetch).push();
		expect((await db.scores.get(scoreKey(SLUG, PATROL, ITEM)))!).toMatchObject({ problem: 'Tävlingen är avslutad', local: { value: 12 } });
		expect((await db.outbox.get(row.commandId))!.state).toBe('rejected');
	});

	it('a disconnected phone gets an AuthError with a message for the volunteer, and the report stays', async () => {
		const db = await setup();
		const row = scoreRow();
		await db.outbox.add(row);
		const fetch = (async () => Response.json({ message: 'grant_revoked' }, { status: 401 })) as typeof globalThis.fetch;
		const err = await new SyncEngine(db, SLUG, fetch).run().catch((e) => e);
		expect(err).toBeInstanceOf(AuthError);
		expect(err.message).toMatch(/inte längre kopplad/);
		expect((await db.outbox.get(row.commandId))!.state).toBe('pending');
	});
});

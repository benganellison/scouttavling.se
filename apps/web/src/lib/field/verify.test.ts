import { describe, expect, it } from 'vitest';
import { generateDeviceKey, signCommand, signJws, uuidv7, type CommandBody, type CommandResult } from './protocol.ts';
import { processBatch, verifyCommandJws, type BatchContext, type BatchDeps } from './verify.ts';

const DEVICE = uuidv7();
const PATROL = uuidv7();
const ITEM = uuidv7();
const STATION = uuidv7();

let seq = 0;
function cmd(over: Partial<CommandBody> = {}): CommandBody {
	return {
		commandId: uuidv7(),
		deviceId: DEVICE,
		deviceSeq: ++seq,
		baseVersion: null,
		clientNow: new Date().toISOString(),
		prev: null,
		type: 'SetScore',
		payload: { patrolId: PATROL, itemId: ITEM, value: 17, style: 3 },
		...over
	} as CommandBody;
}

function fakeDeps({ patrolOk = true, quarantineCap = Infinity }: { patrolOk?: boolean; quarantineCap?: number } = {}) {
	const store = new Map<string, CommandResult | null>();
	const applied: CommandBody[] = [];
	const quarantined: { body: CommandBody; reason: string }[] = [];
	const deps: BatchDeps = {
		async claim(body) {
			if (store.has(body.commandId)) return { fresh: false, result: store.get(body.commandId)! };
			store.set(body.commandId, null);
			return { fresh: true };
		},
		async finish(body, result) {
			store.set(body.commandId, result);
		},
		async lookup() {
			return { stationId: STATION, patrolOk };
		},
		async apply(body) {
			applied.push(body);
			return { commandId: body.commandId, result: 'accepted', version: applied.length };
		},
		async quarantine(body, reason) {
			if (quarantined.length >= quarantineCap) return false;
			quarantined.push({ body, reason });
			return true;
		}
	};
	return { deps, applied, quarantined, store };
}

async function setup(over: Partial<BatchContext> = {}) {
	const key = await generateDeviceKey();
	const ctx: BatchContext = {
		deviceId: DEVICE,
		publicJwk: key.publicJwk,
		role: 'station_volunteer',
		stations: [STATION],
		revoked: false,
		superseded: false,
		grantExp: Math.floor(Date.now() / 1000) + 3600,
		grantIat: Math.floor(Date.now() / 1000) - 3600,
		lastSeq: 0,
		...over
	};
	return { key, ctx };
}

describe('verifyCommandJws', () => {
	it('accepts a WebCrypto-signed command', async () => {
		const { key } = await setup();
		const body = cmd();
		const jws = await signCommand(key.privateKey, body);
		expect(await verifyCommandJws(jws, key.publicJwk, DEVICE)).toEqual(body);
	});

	it('rejects a tampered payload', async () => {
		const { key } = await setup();
		const jws = await signCommand(key.privateKey, cmd());
		const [h, , s] = jws.split('.');
		const forged = Buffer.from(JSON.stringify({ ...cmd(), payload: { patrolId: PATROL, itemId: ITEM, value: 20, style: 5 } })).toString('base64url');
		await expect(verifyCommandJws(`${h}.${forged}.${s}`, key.publicJwk, DEVICE)).rejects.toThrow('Ogiltig signatur');
	});

	it('rejects a signature from another key', async () => {
		const { key } = await setup();
		const other = await generateDeviceKey();
		const jws = await signCommand(other.privateKey, cmd());
		await expect(verifyCommandJws(jws, key.publicJwk, DEVICE)).rejects.toThrow();
	});

	it('rejects wrong typ, alg none and foreign device ids', async () => {
		const { key } = await setup();
		const wrongTyp = await signJws(key.privateKey, { alg: 'ES256', typ: 'JWT' }, cmd());
		await expect(verifyCommandJws(wrongTyp, key.publicJwk, DEVICE)).rejects.toThrow('Fel signaturtyp');
		const none = `${Buffer.from('{"alg":"none","typ":"st-cmd+jwt"}').toString('base64url')}.${Buffer.from(JSON.stringify(cmd())).toString('base64url')}.`;
		await expect(verifyCommandJws(none, key.publicJwk, DEVICE)).rejects.toThrow();
		const foreign = await signCommand(key.privateKey, cmd({ deviceId: uuidv7() }));
		await expect(verifyCommandJws(foreign, key.publicJwk, DEVICE)).rejects.toThrow('annan enhet');
	});

	it('rejects malformed bodies', async () => {
		const { key } = await setup();
		const bad = await signCommand(key.privateKey, { ...cmd(), type: 'DropTable' } as unknown as CommandBody);
		await expect(verifyCommandJws(bad, key.publicJwk, DEVICE)).rejects.toThrow('Ogiltigt kommando');
	});
});

describe('processBatch', () => {
	it('is idempotent: the same command twice is applied once', async () => {
		const { key, ctx } = await setup();
		const f = fakeDeps();
		const jws = await signCommand(key.privateKey, cmd());
		const first = await processBatch([jws], ctx, f.deps);
		expect(first.results[0]).toMatchObject({ result: 'accepted', version: 1 });
		const again = await processBatch([jws, jws], { ...ctx, lastSeq: first.lastSeq }, f.deps);
		expect(again.results.map((r) => r.result)).toEqual(['duplicate', 'duplicate']);
		expect(again.results[0]).toMatchObject({ version: 1 });
		expect(f.applied).toHaveLength(1);
	});

	it('processes in deviceSeq order regardless of array order', async () => {
		const { key, ctx } = await setup({ lastSeq: seq });
		const f = fakeDeps();
		const a = cmd();
		const b = cmd();
		const out = await processBatch([await signCommand(key.privateKey, b), await signCommand(key.privateKey, a)], ctx, f.deps);
		expect(f.applied.map((x) => x.commandId)).toEqual([a.commandId, b.commandId]);
		expect(out.lastSeq).toBe(b.deviceSeq);
	});

	it('quarantines commands from a revoked device instead of dropping them', async () => {
		const { key, ctx } = await setup({ revoked: true, lastSeq: seq });
		const f = fakeDeps();
		const out = await processBatch([await signCommand(key.privateKey, cmd())], ctx, f.deps);
		expect(out.results[0]).toMatchObject({ result: 'quarantined' });
		expect(f.quarantined).toHaveLength(1);
		expect(f.applied).toHaveLength(0);
	});

	it('judges expiry by server time: once the grant has expired, HQ decides about everything', async () => {
		const exp = Math.floor(Date.now() / 1000) - 60;
		const { key, ctx } = await setup({ grantExp: exp, grantIat: exp - 7200, lastSeq: seq });
		const f = fakeDeps();
		// "Before" by the phone's clock is not enough: the phone sets clientNow itself.
		const before = cmd({ clientNow: new Date((exp - 600) * 1000).toISOString() });
		const after = cmd({ clientNow: new Date().toISOString() });
		const out = await processBatch([await signCommand(key.privateKey, before), await signCommand(key.privateKey, after)], ctx, f.deps);
		expect(out.results.map((r) => r.result)).toEqual(['quarantined', 'quarantined']);
		expect(f.applied).toHaveLength(0);
	});

	it('quarantines a command dated before the phone joined (a backdated clock)', async () => {
		const { key, ctx } = await setup({ lastSeq: seq });
		const f = fakeDeps();
		const old = cmd({ clientNow: new Date((ctx.grantIat - 3600) * 1000).toISOString() });
		const out = await processBatch([await signCommand(key.privateKey, old)], ctx, f.deps);
		expect(out.results[0]).toMatchObject({ result: 'quarantined', reason: 'Telefonens klocka går fel' });
	});

	it('checks scope before quarantine: a revoked device cannot park reports for other stations or patrols', async () => {
		const { key, ctx } = await setup({ revoked: true, stations: [uuidv7()], lastSeq: seq });
		const f = fakeDeps();
		const out = await processBatch([await signCommand(key.privateKey, cmd())], ctx, f.deps);
		expect(out.results[0]).toMatchObject({ result: 'rejected', reason: 'Kontrollen ingår inte i din behörighet' });
		expect(f.quarantined).toHaveLength(0);
		const g = fakeDeps({ patrolOk: false });
		const { key: k2, ctx: c2 } = await setup({ superseded: true, lastSeq: seq });
		const out2 = await processBatch([await signCommand(k2.privateKey, cmd())], c2, g.deps);
		expect(out2.results[0]).toMatchObject({ result: 'rejected', reason: 'Okänd patrull' });
		expect(g.quarantined).toHaveLength(0);
	});

	it('refuses station scores from the start & finish desk', async () => {
		const { key, ctx } = await setup({ role: 'startfinish', lastSeq: seq });
		const f = fakeDeps();
		const out = await processBatch([await signCommand(key.privateKey, cmd())], ctx, f.deps);
		expect(out.results[0]).toMatchObject({ result: 'rejected', reason: 'Start & mål rapporterar inte poäng' });
		expect(f.applied).toHaveLength(0);
	});

	it('stops quarantining when the device has too many reports waiting for HQ', async () => {
		const { key, ctx } = await setup({ superseded: true, lastSeq: seq });
		const f = fakeDeps({ quarantineCap: 1 });
		const out = await processBatch([await signCommand(key.privateKey, cmd()), await signCommand(key.privateKey, cmd())], ctx, f.deps);
		expect(out.results.map((r) => r.result)).toEqual(['quarantined', 'rejected']);
	});

	it('rejects scores for stations outside the grant and status changes from volunteers', async () => {
		const { key, ctx } = await setup({ stations: [uuidv7()], lastSeq: seq });
		const f = fakeDeps();
		const out = await processBatch(
			[
				await signCommand(key.privateKey, cmd()),
				await signCommand(key.privateKey, cmd({ type: 'SetStatus', payload: { patrolId: PATROL, status: 'finished' } } as Partial<CommandBody>))
			],
			ctx,
			f.deps
		);
		expect(out.results.map((r) => r.result)).toEqual(['rejected', 'rejected']);
		expect(f.applied).toHaveLength(0);
	});

	it('rejects a bad signature but keeps processing the rest of the batch', async () => {
		const { key, ctx } = await setup({ lastSeq: seq });
		const other = await generateDeviceKey();
		const f = fakeDeps();
		const out = await processBatch([await signCommand(other.privateKey, cmd()), await signCommand(key.privateKey, cmd())], ctx, f.deps);
		expect(out.results.map((r) => r.result)).toEqual(['rejected', 'accepted']);
	});
});

<script lang="ts">
	import { useField, hhmm, shortTroop, type PackPatrol } from '#lib/field/app.svelte.ts';
	import type { PatrolStatus } from '#lib/field/protocol.ts';
	import Icon from '#lib/field/ui/Icon.svelte';
	import SyncPill from '#lib/field/ui/SyncPill.svelte';
	import CameraView from '#lib/field/ui/CameraView.svelte';
	import ScouternaSymbol from '#lib/ui/brand/ScouternaSymbol.svelte';
	import EventLogo from '#lib/ui/brand/EventLogo.svelte';
	import TrackChip from '#lib/ui/brand/TrackChip.svelte';
	import { PATROL_STATUS_LABEL, STATUS_ORDER } from '#lib/ui/patrols/labels.ts';

	const app = useField();
	const LABEL = PATROL_STATUS_LABEL;
	const ORDER = STATUS_ORDER;
	const SV_DATE = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' });
	const svDate = (ms: number) => SV_DATE.format(ms);

	type Filter = 'all' | PatrolStatus;
	let filter = $state<Filter>('all');
	let q = $state('');
	let manual = $state('');
	let camOn = $state(true);
	let last = $state<{ patrolId: string; status: PatrolStatus; changed: boolean; groupId: string | null; at: number } | null>(null);
	let scanError = $state<string | null>(null);

	const statusOf = (p: PackPatrol) => app.patrolStatus(p);
	const counts = $derived.by(() => {
		const c = { registered: 0, active: 0, camp: 0, finished: 0, resigned: 0 };
		for (const p of app.patrols) c[statusOf(p)]++;
		return c;
	});
	const totalFor = (p: PackPatrol) => (app.pack?.stations ?? []).filter((s) => s.items > 0 && app.eligible(p, s)).length;
	const prog = (p: PackPatrol) => app.pack?.progress[p.id];
	const codeOf = (id: string | null | undefined) => app.pack?.stations.find((s) => s.id === id)?.code ?? '';

	function startedAt(p: PackPatrol): number | null {
		const o = app.statusOverride.get(p.id);
		if (o?.status === 'active') return o.at;
		const s = prog(p)?.startedAt;
		return s ? Date.parse(s) : null;
	}
	function finishedAt(p: PackPatrol): number | null {
		const o = app.statusOverride.get(p.id);
		if (o?.status === 'finished') return o.at;
		const s = prog(p)?.finishedAt;
		return s ? Date.parse(s) : null;
	}
	function campAt(p: PackPatrol): number | null {
		const o = app.statusOverride.get(p.id);
		if (o?.status === 'camp') return o.at;
		const s = prog(p)?.campAt;
		return s ? Date.parse(s) : null;
	}
	function lastSeen(p: PackPatrol): { text: string; late: boolean } {
		const st = statusOf(p);
		if (st === 'resigned') return { text: 'Återbud', late: false };
		if (st === 'finished') return { text: `Mål ${hhmm(finishedAt(p))}`, late: false };
		// Done for the day: never "late" overnight.
		if (st === 'camp') return { text: campAt(p) ? `Klar ${hhmm(campAt(p))}` : 'I läger', late: false };
		const pr = prog(p);
		const seen = pr?.lastSeenAt ? Date.parse(pr.lastSeenAt) : startedAt(p);
		if (st === 'registered' || !seen) return { text: 'Ej startad', late: false };
		const mins = Math.floor((app.serverNow() - seen) / 60000);
		if (mins > 45) return { text: `${mins} min sedan`, late: true };
		return { text: `${pr?.lastStationId ? codeOf(pr.lastStationId) + ' ' : ''}${hhmm(seen)}`, late: false };
	}
	function timeOut(p: PackPatrol): string {
		const s = startedAt(p);
		if (!s) return '–';
		const end = finishedAt(p) ?? (statusOf(p) === 'camp' ? campAt(p) : null) ?? app.serverNow();
		const mins = Math.max(0, Math.round((end - s) / 60000));
		return mins >= 60 ? `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')}` : `${mins} min`;
	}

	const rows = $derived.by(() => {
		void app.now;
		const needle = q.trim().toLowerCase();
		return app.patrols
			.filter((p) => filter === 'all' || statusOf(p) === filter)
			.filter((p) => !needle || String(p.number).startsWith(needle) || p.name.toLowerCase().includes(needle) || p.troop.toLowerCase().includes(needle));
	});

	/**
	 * A scan advances Anmäld → På banan → I mål. On a competition day that is not the
	 * last one, På banan → I läger instead, and next morning I läger → På banan. A second
	 * scan the same evening leaves a patrol in camp.
	 */
	function nextFor(p: PackPatrol): PatrolStatus | null {
		const cur = statusOf(p);
		const c = app.pack?.competition;
		const today = svDate(app.serverNow());
		const earlierDay = !!c && c.startDate < c.endDate && today >= c.startDate && today < c.endDate;
		if (cur === 'registered') return 'active';
		if (cur === 'active') return earlierDay ? 'camp' : 'finished';
		if (cur === 'camp') {
			const at = campAt(p);
			return at && svDate(at) < today ? 'active' : null;
		}
		return null;
	}

	async function advance(p: PackPatrol) {
		const cur = statusOf(p);
		const next = nextFor(p);
		const groupId = next ? await app.setStatus(p.id, next) : null;
		last = { patrolId: p.id, status: next ?? cur, changed: !!next, groupId, at: Date.now() };
		navigator.vibrate?.(60);
	}

	async function onCode(text: string) {
		const r = await app.resolveCode(text);
		if (!r) return;
		if ('error' in r) {
			scanError = r.error;
			setTimeout(() => (scanError = null), 3500);
			return;
		}
		await advance(r.patrol);
	}

	async function submitManual(e: SubmitEvent) {
		e.preventDefault();
		const p = app.patrolByNumber.get(Number(manual));
		if (!p) {
			scanError = `Patrull ${manual} finns inte`;
			setTimeout(() => (scanError = null), 3500);
			return;
		}
		manual = '';
		await advance(p);
	}

	async function set(p: PackPatrol, s: PatrolStatus) {
		if (statusOf(p) === s) return;
		const groupId = await app.setStatus(p.id, s);
		last = { patrolId: p.id, status: s, changed: true, groupId, at: Date.now() };
	}

	async function undoLast() {
		if (!last?.groupId) return;
		await app.undo(last.groupId);
		last = null;
	}

	const lastPatrol = $derived(last ? (app.patrolById.get(last.patrolId) ?? null) : null);
	const filters: { k: Filter; l: string }[] = [
		{ k: 'all', l: 'Alla' },
		{ k: 'registered', l: 'Ej startade' },
		{ k: 'active', l: 'På banan' },
		{ k: 'camp', l: 'I läger' },
		{ k: 'finished', l: 'I mål' },
		{ k: 'resigned', l: 'Återbud' }
	];
	const trackColor = (id: string | null) => (id ? app.pack?.tracks.find((t) => t.id === id)?.color : null);
	const tel = (s: string | null | undefined) => (s ?? '').replace(/[^\d+]/g, '');
</script>

<div class="desk">
	<aside>
		<div class="brand">
			<span class="b"
				>{#if app.pack?.competition.branding?.eventLogo}<EventLogo logo={app.pack.competition.branding.eventLogo} height={34} onDark />{:else}<ScouternaSymbol
						size={30}
						onDark
					/>{/if} Start &amp; mål</span
			>
			<SyncPill />
		</div>

		<div class="scanner">
			{#if camOn}
				<CameraView {onCode} compact hint="Håll upp patrullpasset — kameran skannar hela tiden" onUnavailable={() => undefined} />
			{/if}
			<form class="manual" onsubmit={submitManual}>
				<label for="nr" class="sr-only">Patrullnummer</label>
				<input id="nr" inputmode="numeric" pattern="[0-9]*" placeholder="Patrullnummer" bind:value={manual} autocomplete="off" />
				<button type="submit" class="ok" disabled={!manual}>Registrera</button>
			</form>
			{#if scanError}<p class="scan-error" role="alert">{scanError}</p>{/if}
		</div>

		{#if last && lastPatrol}
			{@const pr = prog(lastPatrol)}
			<div class="last" role="status" data-testid="last-scan">
				<div class="last-top">
					<span class="status-pill s-{last.status}">{LABEL[last.status].toUpperCase()} {hhmm(last.at)}</span>
					{#if last.groupId}<button type="button" class="undo" onclick={undoLast}><Icon name="undo" size={18} /> Ångra</button>{/if}
				</div>
				<span class="last-name">{lastPatrol.number} · {lastPatrol.name}</span>
				<span class="last-sub">{lastPatrol.track} · {lastPatrol.troop}{last.changed ? '' : ` — redan ${LABEL[last.status].toLowerCase()}`}</span>
				<div class="facts">
					<div><span class="fl">Kontroller</span><span class="fv">{pr?.stationsDone ?? 0}/{totalFor(lastPatrol)}</span></div>
					<div><span class="fl">Poäng</span><span class="fv">{pr?.points ?? 0}</span></div>
					<div><span class="fl">Tid ute</span><span class="fv">{timeOut(lastPatrol)}</span></div>
				</div>
			</div>
		{:else}
			<div class="last empty">Skanna ett patrullpass: Anmäld → På banan → I mål.</div>
		{/if}

		<div class="counts">
			<div><span class="cn">{counts.registered}</span><span class="cl">Anmälda</span></div>
			<div><span class="cn">{counts.active}</span><span class="cl">På banan</span></div>
			<div><span class="cn">{counts.camp}</span><span class="cl">I läger</span></div>
			<div><span class="cn">{counts.finished}</span><span class="cl">I mål</span></div>
			<div><span class="cn">{counts.resigned}</span><span class="cl">Återbud</span></div>
		</div>
	</aside>

	<main>
		<h1 class="sr-only">Start och mål</h1>
		<div class="toolbar">
			<div class="filters" role="tablist" aria-label="Filtrera">
				{#each filters as f (f.k)}
					<button type="button" role="tab" aria-selected={filter === f.k} onclick={() => (filter = f.k)}>{f.l}</button>
				{/each}
			</div>
			<div class="search">
				<label for="q" class="sr-only">Sök patrull</label>
				<Icon name="search" size={18} />
				<input id="q" type="search" placeholder="Sök patrull" bind:value={q} />
			</div>
		</div>

		<div class="table" role="table" aria-label="Patruller">
			<div class="tr th" role="row">
				<span role="columnheader">Patrull</span><span role="columnheader">Status</span><span role="columnheader">Kontroller</span><span role="columnheader"
					>Senast sedd</span
				><span role="columnheader"><span class="sr-only">Ring</span></span>
			</div>
			<div class="tbody">
				{#each rows as p (p.id)}
					{@const seen = lastSeen(p)}
					{@const st = statusOf(p)}
					<div class="tr" class:late={seen.late} role="row" data-testid="row-{p.number}">
						<span class="pcell" role="cell">
							<span class="pnr">{p.number}</span>
							<span class="pwho"
								><span class="pname">{p.name}</span><span class="psub"
									><TrackChip color={trackColor(p.trackId)} size={10} /> {p.track} · {shortTroop(p.troop)}</span
								></span
							>
						</span>
						<span role="cell">
							<span class="seg" role="radiogroup" aria-label="Status för {p.name}">
								{#each ORDER as s (s)}
									<button type="button" role="radio" aria-checked={st === s} class="s-{s}" class:on={st === s} onclick={() => set(p, s)}>{LABEL[s]}</button>
								{/each}
							</span>
						</span>
						<span class="done" role="cell">{prog(p)?.stationsDone ?? 0}/{totalFor(p)}</span>
						<span class="seen" class:red={seen.late} role="cell">{seen.text}</span>
						<span role="cell">
							{#if tel(p.phone)}
								<a class="call" href="tel:{tel(p.phone)}" aria-label="Ring kontakten för {p.name}"><Icon name="phone" size={20} /></a>
							{/if}
						</span>
					</div>
				{/each}
			</div>
		</div>
	</main>
</div>

<style>
	.desk {
		height: 100dvh;
		display: grid;
		grid-template-columns: 400px minmax(0, 1fr);
		overflow: hidden;
	}
	aside {
		background: var(--brand);
		color: #fff;
		padding: 18px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		min-height: 0;
		overflow-y: auto;
	}
	.brand {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.b {
		display: flex;
		align-items: center;
		gap: 10px;
		font-weight: 800;
		font-size: 20px;
	}
	.scanner {
		background: var(--brand-dark);
		border-radius: 20px;
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.manual {
		display: flex;
		gap: 8px;
	}
	.manual input {
		min-height: 56px;
		font-size: 22px;
		font-weight: 800;
		border-radius: 14px;
		border: 0;
	}
	.ok {
		min-height: 56px;
		padding: 0 18px;
		border-radius: 14px;
		border: 0;
		background: #fff;
		color: var(--brand);
		font-weight: 800;
		font-size: 17px;
	}
	.ok:disabled {
		background: transparent;
		box-shadow: inset 0 0 0 1.5px var(--line-on-brand);
		color: var(--on-brand-2);
	}
	.scan-error {
		margin: 0;
		background: var(--danger);
		padding: 8px 12px;
		border-radius: 10px;
		font-weight: 800;
	}
	.last {
		background: var(--surface);
		color: var(--ink);
		border-radius: 18px;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.last.empty {
		color: var(--ink-2);
		font-weight: 700;
		font-size: 16px;
	}
	.last-top {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.status-pill {
		font-size: 14px;
		font-weight: 800;
		padding: 6px 12px;
		border-radius: 999px;
	}
	.last-name {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 32px;
		letter-spacing: -0.02em;
		line-height: 1.1;
	}
	.last-sub {
		font-size: 15px;
		color: var(--ink-2);
	}
	.undo {
		min-height: 48px;
		padding: 0 14px;
		border-radius: 12px;
		border: 1.5px solid var(--line-strong);
		background: var(--surface);
		font-weight: 800;
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.facts {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 8px;
		border-top: 1px solid var(--tint);
		padding-top: 10px;
		margin-top: 4px;
	}
	.facts div {
		display: flex;
		flex-direction: column;
	}
	.fl {
		font-size: 13px;
		color: var(--ink-2);
		font-weight: 700;
	}
	.fv {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 24px;
	}
	.counts {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 6px;
		margin-top: auto;
	}
	.counts div {
		background: var(--brand-dark);
		border-radius: 14px;
		padding: 10px 6px;
		display: flex;
		flex-direction: column;
	}
	.cn {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 28px;
		line-height: 1.1;
	}
	.cl {
		font-size: 12px;
		color: var(--on-brand);
		font-weight: 700;
	}
	main {
		padding: 18px 20px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		min-width: 0;
		min-height: 0;
	}
	.toolbar {
		display: flex;
		gap: 10px;
		align-items: center;
		flex-wrap: wrap;
	}
	.filters {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}
	.filters button {
		min-height: 48px;
		padding: 0 16px;
		border-radius: 999px;
		border: 1.5px solid var(--line-strong);
		background: var(--surface);
		font-weight: 800;
		font-size: 15px;
	}
	.filters button[aria-selected='true'] {
		background: var(--ink);
		border-color: var(--ink);
		color: #fff;
	}
	.search {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 48px;
		padding: 0 12px;
		border-radius: 12px;
		background: var(--surface);
		border: 1.5px solid var(--line-strong);
		width: 220px;
		color: var(--ink-2);
	}
	.search :global(svg) {
		flex: none;
	}
	.search input {
		border: 0;
		outline: 0;
		min-height: 44px;
		padding: 0;
		background: transparent;
	}
	.table {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 18px;
		overflow: hidden;
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.tbody {
		overflow-y: auto;
		flex: 1;
	}
	.tr {
		display: grid;
		grid-template-columns: minmax(130px, 1fr) 330px 92px 96px 44px;
		gap: 8px;
		padding: 8px 12px;
		align-items: center;
		border-bottom: 1px solid var(--tint);
	}
	.th {
		font-size: 12px;
		font-weight: 800;
		color: var(--ink-2);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		border-bottom: 1px solid var(--line);
		padding: 12px 14px;
	}
	.tr.late {
		background: var(--danger-tint);
	}
	.pcell {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}
	.pnr {
		min-width: 46px;
		height: 38px;
		border-radius: 10px;
		background: var(--tint);
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 800;
		font-size: 16px;
	}
	.pwho {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.pname {
		font-weight: 800;
		font-size: 16px;
	}
	.psub {
		font-size: 12px;
		color: var(--ink-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.seg {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		background: var(--tint);
		border-radius: 12px;
		padding: 3px;
		gap: 3px;
	}
	.seg button {
		min-height: 48px;
		padding: 0 2px;
		border-radius: 9px;
		border: 0;
		background: transparent;
		color: var(--ink-2);
		font-weight: 800;
		font-size: 13px;
		white-space: nowrap;
		cursor: pointer;
	}
	.s-registered.on,
	.status-pill.s-registered {
		background: #fff;
		color: var(--ink);
		box-shadow: 0 0 0 1.5px var(--ink) inset;
	}
	.s-active.on,
	.status-pill.s-active {
		background: var(--orange);
		color: var(--ink);
	}
	/* I läger: light grey with a Scoutblå outline, lighter than På banan (orange) and I mål (Scoutblå). */
	.s-camp.on,
	.status-pill.s-camp {
		background: var(--st-camp);
		color: var(--brand);
		box-shadow: 0 0 0 1.5px var(--brand) inset;
	}
	.s-finished.on,
	.status-pill.s-finished {
		background: var(--brand);
		color: #fff;
	}
	.s-resigned.on,
	.status-pill.s-resigned {
		background: var(--st-resigned);
		color: #fff;
	}
	.done {
		font-weight: 800;
		font-size: 16px;
	}
	.seen {
		font-size: 14px;
		font-weight: 700;
		color: var(--ink-2);
	}
	.seen.red {
		color: var(--danger);
	}
	.call {
		width: 44px;
		height: 44px;
		border-radius: 10px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--tint);
		color: var(--brand);
	}
	@media (max-width: 900px) {
		.desk {
			grid-template-columns: 1fr;
			height: auto;
			overflow: visible;
		}
		.tr {
			grid-template-columns: minmax(0, 1fr) 90px;
		}
		.tr > :nth-child(2) {
			grid-column: 1 / -1;
			grid-row: 2;
		}
		.tr > :nth-child(4),
		.th > :nth-child(n + 3) {
			display: none;
		}
	}
</style>

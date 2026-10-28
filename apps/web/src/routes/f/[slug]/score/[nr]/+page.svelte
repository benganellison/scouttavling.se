<script lang="ts">
	import { onDestroy } from 'svelte';
	import { page } from '$app/state';
	import { selectableValues, styleValues, evaluate } from '@scouttavling/domain';
	import { useField, hhmm, shortTroop, UNDO_MS, type PackItem } from '#lib/field/app.svelte.ts';
	import TrackChip from '#lib/ui/brand/TrackChip.svelte';
	import Icon from '#lib/field/ui/Icon.svelte';

	const app = useField();
	const base = `/f/${app.slug}`;
	const patrol = $derived(app.patrolByNumber.get(Number(page.params.nr)) ?? null);

	let values = $state<Record<string, number | null>>({});
	let styles = $state<Record<string, number | null>>({});
	let note = $state('');
	let showNote = $state(false);
	let prefilled = $state<string | null>(null);
	let saved = $state<{ groupId: string; line: string; at: number } | null>(null);
	let undone = $state(false);
	let busy = $state(false);
	let tick = $state(Date.now());
	const timer = setInterval(() => (tick = Date.now()), 250);
	onDestroy(() => clearInterval(timer));

	// Pre-fill with the current values when editing ("Ändra poäng").
	$effect(() => {
		if (!patrol || prefilled === patrol.id || !app.items.length) return;
		const v: Record<string, number | null> = {};
		const s: Record<string, number | null> = {};
		for (const it of app.items) {
			const d = app.display(patrol.id, it.id);
			const active = d && d.state === 'active';
			v[it.id] = active ? d.raw.value : null;
			s[it.id] = active ? (d.raw.style ?? null) : null;
		}
		values = v;
		styles = s;
		prefilled = patrol.id;
	});

	const manual = $derived(app.items.filter((i) => i.mode !== 'AUTO_ON_SCAN' && i.mode !== 'CHECKIN'));
	const autoItems = $derived(app.items.filter((i) => i.mode === 'AUTO_ON_SCAN'));
	const checkin = $derived(app.items.length > 0 && app.items.every((i) => i.mode === 'CHECKIN' || i.mode === 'AUTO_ON_SCAN') && !manual.length);
	const single = $derived(manual.length === 1);

	function complete(it: PackItem) {
		return values[it.id] != null && (!it.styleEnabled || styles[it.id] != null);
	}
	const ready = $derived(checkin || (manual.length > 0 && manual.every(complete)));
	const totals = $derived.by(() => {
		let p = 0;
		let s = 0;
		for (const it of manual) {
			if (values[it.id] == null) continue;
			try {
				const r = evaluate(it, { value: values[it.id]!, style: it.styleEnabled ? (styles[it.id] ?? it.styleMin) : null });
				p += r.points;
				s += it.styleEnabled ? (styles[it.id] ?? 0) : 0;
			} catch {
				/* incomplete */
			}
		}
		return { p, s };
	});
	const anyStyle = $derived(manual.some((i) => i.styleEnabled));
	const sumText = $derived(anyStyle ? `${totals.p} + ${totals.s} = ${totals.p + totals.s} p` : `${totals.p} p`);
	const saveLabel = $derived.by(() => {
		if (checkin) return `Checka in ${patrol?.name ?? ''}`;
		if (ready) return `Spara ${sumText}`;
		const missing = manual.find((i) => values[i.id] == null);
		if (missing) return manual.length > 1 ? `Välj ${missing.name.toLowerCase()}` : 'Välj poäng';
		return 'Välj stilpoäng';
	});

	const already = $derived(patrol ? app.stationResult(patrol.id) : null);

	function cols(it: PackItem) {
		const n = selectableValues(it).length;
		return n <= 6 ? n : n <= 12 ? 4 : 5;
	}

	async function save() {
		if (!patrol || !ready || busy) return;
		busy = true;
		try {
			const entries = [
				...autoItems.filter((i) => app.display(patrol.id, i.id)?.state !== 'active').map((i) => ({ itemId: i.id, value: 0, style: null })),
				...app.items.filter((i) => i.mode === 'CHECKIN').map((i) => ({ itemId: i.id, value: 0, style: null })),
				...manual.map((i, idx) => ({
					itemId: i.id,
					value: values[i.id]!,
					style: i.styleEnabled ? styles[i.id]! : null,
					note: idx === 0 && note.trim() ? note.trim() : null
				}))
			];
			const groupId = await app.saveScores(patrol.id, entries);
			navigator.vibrate?.(80);
			tick = Date.now();
			saved = { groupId, at: tick, line: checkin ? `${patrol.name} incheckade ${hhmm(app.serverNow())}` : `${patrol.name} · ${sumText}` };
			undone = false;
		} finally {
			busy = false;
		}
	}

	const undoLeft = $derived(saved ? Math.max(0, Math.ceil((saved.at + UNDO_MS - tick) / 1000)) : 0);

	async function undo() {
		if (!saved) return;
		await app.undo(saved.groupId);
		saved = null;
		undone = true;
		prefilled = null;
	}

	function countStep(it: PackItem, d: number) {
		const cur = values[it.id];
		values[it.id] = cur == null ? (d > 0 ? Math.min(it.min + 1, it.max) : it.min) : Math.max(it.min, Math.min(it.max, cur + d));
	}
	function distinctLabel(it: PackItem, v: number) {
		const l = it.distinctValues?.find((d) => d.value === v)?.label;
		return l ? `${l} · ${v} p` : `${v} p`;
	}
</script>

{#if !patrol}
	<main class="missing">
		<h1>Patrull {page.params.nr} finns inte</h1>
		<a class="btn btn-primary" href="{base}/scan">Tillbaka</a>
	</main>
{:else}
	<div class="screen">
		<header inert={!!saved}>
			<a class="back" href="{base}/scan" aria-label="Tillbaka"><Icon name="back" /></a>
			<span class="pnr">{patrol.number}</span>
			<div class="pwho">
				<h1 class="pname">{patrol.name}</h1>
				<span class="psub"
					><TrackChip color={app.pack?.tracks.find((t) => t.id === patrol.trackId)?.color} size={11} />
					{patrol.track} · {shortTroop(patrol.troop)} · {app.station?.code}
					{app.station?.name}</span
				>
			</div>
		</header>

		<main class:single inert={!!saved}>
			{#if undone}<p class="undone" role="status">Ångrat — inget sparades. Välj igen eller gå tillbaka.</p>{/if}
			{#if already && !undone}
				<p class="editing">Ändrar rapport från {hhmm(already.at)}{already.by ? ` (${already.by})` : ''}</p>
			{/if}

			{#each autoItems as it (it.id)}
				{@const d = app.display(patrol.id, it.id)}
				<div class="auto">
					<span class="tick"><Icon name="check" size={20} stroke={3} /></span>
					<span class="auto-name">{it.name}</span>
					<span class="auto-at">{d && d.state === 'active' ? hhmm(d.at) : hhmm(app.now + (app.packRow?.offsetMs ?? 0))} · automatiskt</span>
				</div>
			{/each}

			{#if !checkin}
				<!-- A start/finish checkpoint can also have scored parts: saving checks the patrol in too. -->
				{#each app.items.filter((i) => i.mode === 'CHECKIN') as it (it.id)}
					<div class="auto">
						<span class="tick"><Icon name="check" size={20} stroke={3} /></span>
						<span class="auto-name">{it.name}</span>
						<span class="auto-at">checkas in när du sparar</span>
					</div>
				{/each}
			{/if}
			{#if checkin}
				<div class="checkin">
					<span class="eyebrow">Checkpoint · inga poäng</span>
					<span class="ck-big">{patrol.name} har kommit fram till {app.station?.name}</span>
					<span class="muted">Ett tryck checkar in patrullen. Tävlingsledningen ser att de är här.</span>
				</div>
			{/if}

			{#each manual as it (it.id)}
				<section class="item" class:grow={it.mode === 'RANGE' || (single && it.mode === 'DISTINCT')} aria-labelledby="h-{it.id}">
					<div class="item-head">
						<h2 id="h-{it.id}">
							{manual.length > 1 || it.name !== app.station?.name ? it.name : 'Poäng'}
							<span class="range"
								>{it.mode === 'RANGE' ? `${it.min}–${it.max}` : it.mode === 'COUNT' ? `${it.min}–${it.max} × ${it.countMultiplier ?? 1} p` : ''}</span
							>
						</h2>
						<span class="shown">{values[it.id] ?? '–'}</span>
					</div>

					{#if it.mode === 'RANGE'}
						<div class="grid" style="grid-template-columns: repeat({cols(it)}, minmax(0, 1fr))">
							{#each selectableValues(it) as v (v)}
								<button type="button" class="chip" aria-pressed={values[it.id] === v} onclick={() => (values[it.id] = v)}>{v}</button>
							{/each}
						</div>
					{:else if it.mode === 'DISTINCT'}
						<div class="stacked">
							{#each selectableValues(it) as v (v)}
								<button type="button" class="opt" aria-pressed={values[it.id] === v} onclick={() => (values[it.id] = v)}>{distinctLabel(it, v)}</button>
							{/each}
						</div>
					{:else if it.mode === 'COUNT'}
						<div class="stepper">
							<button type="button" class="step" aria-label="Minska {it.name}" onclick={() => countStep(it, -1)}
								><Icon name="minus" size={34} stroke={3} /></button
							>
							<span class="count" aria-live="polite">
								<span class="cnum">{values[it.id] ?? '–'} <span class="cmax">/ {it.max}</span></span>
								<span class="cpts">→ {values[it.id] == null ? '–' : values[it.id]! * (it.countMultiplier ?? 1)} p</span>
							</span>
							<button type="button" class="step" aria-label="Öka {it.name}" onclick={() => countStep(it, 1)}><Icon name="plus" size={34} stroke={3} /></button>
						</div>
					{/if}

					{#if it.styleEnabled}
						<div class="item-head style-head">
							<h3>Stilpoäng <span class="range">{it.styleMin}–{it.styleMax} · samarbete &amp; glädje</span></h3>
							<span class="shown">{styles[it.id] ?? '–'}</span>
						</div>
						<div class="style-row" style="grid-template-columns: repeat({styleValues(it).length}, minmax(0, 1fr))">
							{#each styleValues(it) as v (v)}
								<button type="button" class="chip style" aria-pressed={styles[it.id] === v} aria-label="Stil {v}" onclick={() => (styles[it.id] = v)}
									>{v}</button
								>
							{/each}
						</div>
					{/if}
				</section>
			{/each}

			{#if showNote}
				<label class="note">
					<span class="label">Anteckning</span>
					<textarea bind:value={note} rows="2" maxlength="500" aria-describedby="note-help"></textarea>
					<span class="help" id="note-help">Bara om poängen behöver förklaras. Skriv inte namn eller något om hälsa.</span>
				</label>
			{/if}
		</main>

		<footer inert={!!saved}>
			<button type="button" class="save" disabled={!ready || busy} onclick={save}>{saveLabel}</button>
			{#if !checkin && !showNote}
				<button type="button" class="add-note" onclick={() => (showNote = true)}>+ Anteckning (valfritt)</button>
			{/if}
		</footer>

		{#if saved}
			<div class="success">
				<span class="ring"><Icon name="check" size={64} stroke={3} /></span>
				<!-- Only this is announced (not the undo countdown, which changes every second). -->
				<div role="status" class="s-said">
					<span class="s-title">Sparat!</span>
					<span class="s-line">{saved.line}</span>
				</div>
				<span class="s-pill"><Icon name="check" size={14} stroke={2.8} /> Sparad i telefonen · skickas automatiskt</span>
				<div class="s-actions">
					<!-- svelte-ignore a11y_autofocus -->
					<a class="s-next" href="{base}/scan" autofocus>Skanna nästa patrull</a>
					{#if undoLeft > 0}
						<button type="button" class="s-undo" onclick={undo}><Icon name="undo" size={20} /> Ångra ({undoLeft} s)</button>
					{:else}
						<a class="s-undo" href={base}>Till kontrollen</a>
					{/if}
				</div>
			</div>
		{/if}
	</div>
{/if}

<style>
	.missing {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		gap: 16px;
		align-items: center;
		justify-content: center;
	}
	.screen {
		height: 100dvh;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		position: relative;
	}
	header {
		padding: 10px 12px;
		display: flex;
		align-items: center;
		gap: 10px;
		background: var(--surface);
		border-top: 4px solid var(--event-stripe, var(--orange));
		border-bottom: 1px solid var(--line);
		flex: none;
	}
	.back {
		width: 48px;
		height: 56px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--ink);
		flex: none;
	}
	.pnr {
		min-width: 56px;
		height: 56px;
		padding: 0 6px;
		border-radius: 15px;
		background: var(--brand);
		color: #fff;
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 21px;
		flex: none;
	}
	.pwho {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.pname {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 24px;
		line-height: 1.1;
	}
	.psub {
		font-size: 13px;
		color: var(--ink-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	main {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 12px 14px 4px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.undone,
	.editing {
		margin: 0;
		font-size: 14px;
		font-weight: 700;
		border-radius: 12px;
		padding: 10px 12px;
		background: var(--warn-tint);
		color: var(--warn-ink);
	}
	.editing {
		background: var(--tint);
		color: var(--brand);
	}
	.item {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.item.grow {
		flex: 1 0 auto;
	}
	.single .item.grow {
		min-height: 0;
		flex: 1 1 0;
	}
	.item-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}
	h2,
	h3 {
		font-family: var(--font-ui);
		font-size: 17px;
		font-weight: 800;
		letter-spacing: 0;
	}
	.range {
		font-weight: 600;
		color: var(--ink-2);
		font-size: 15px;
	}
	.shown {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 30px;
		line-height: 1;
		color: var(--brand);
	}
	.grid {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-auto-rows: minmax(56px, 1fr);
		gap: 8px;
	}
	.chip,
	.opt {
		min-height: 56px;
		border-radius: 16px;
		border: 1.5px solid var(--line-strong);
		background: var(--surface);
		color: var(--ink);
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 34px;
		cursor: pointer;
		touch-action: manipulation;
	}
	.chip[aria-pressed='true'],
	.opt[aria-pressed='true'] {
		background: var(--brand);
		border: 2px solid var(--brand);
		color: #fff;
	}
	.stacked {
		flex: 1;
		display: grid;
		grid-auto-rows: minmax(64px, 1fr);
		gap: 8px;
	}
	.opt {
		font-size: 22px;
		text-align: left;
		padding: 0 20px;
	}
	.style-head {
		margin-top: 4px;
	}
	.style-row {
		display: grid;
		gap: 8px;
	}
	.chip.style {
		height: 68px;
	}
	.stepper {
		display: grid;
		grid-template-columns: 84px 1fr 84px;
		gap: 10px;
		align-items: stretch;
	}
	.step {
		height: 84px;
		border-radius: 18px;
		border: 1.5px solid var(--line-strong);
		background: var(--surface);
		color: var(--ink);
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.step:active {
		background: var(--tint);
	}
	.count {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 18px;
	}
	.cnum {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 38px;
		line-height: 1;
	}
	.cmax {
		font-size: 22px;
		color: var(--ink-2);
	}
	.cpts {
		font-weight: 800;
		color: var(--brand);
		font-size: 17px;
	}
	.auto {
		display: flex;
		align-items: center;
		gap: 12px;
		background: var(--ok-tint);
		border-radius: 14px;
		padding: 12px 14px;
		min-height: 56px;
	}
	.tick {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		background: var(--brand);
		color: #fff;
		display: flex;
		align-items: center;
		justify-content: center;
		flex: none;
	}
	.auto-name {
		font-weight: 800;
		font-size: 17px;
		flex: 1;
	}
	.auto-at {
		font-size: 14px;
		font-weight: 700;
		color: var(--brand-2);
	}
	.checkin {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 20px;
		padding: 24px 20px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.eyebrow {
		font-size: 13px;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--warn-ink);
	}
	.ck-big {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 28px;
		line-height: 1.15;
	}
	.note {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	footer {
		padding: 10px 14px calc(12px + env(safe-area-inset-bottom));
		display: flex;
		flex-direction: column;
		gap: 4px;
		flex: none;
	}
	.save {
		min-height: 68px;
		border-radius: 18px;
		border: 0;
		background: var(--cta);
		color: #fff;
		font-weight: 800;
		font-size: 21px;
	}
	.save:disabled {
		background: var(--line);
		color: var(--ink-2);
	}
	.add-note {
		min-height: 44px;
		border: 0;
		background: none;
		color: var(--ink-2);
		font-weight: 700;
		font-size: 15px;
	}
	.success {
		position: absolute;
		inset: 0;
		background: var(--brand);
		color: #fff;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 16px;
		padding: 24px;
		text-align: center;
		z-index: 5;
	}
	.ring {
		width: 120px;
		height: 120px;
		border-radius: 50%;
		background: var(--ok);
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.s-title {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 44px;
		letter-spacing: -0.02em;
	}
	.s-line {
		font-size: 22px;
		font-weight: 700;
		color: var(--on-brand);
	}
	.s-pill {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 14px;
		font-weight: 700;
		color: var(--on-brand);
		background: var(--brand-2);
		padding: 8px 14px;
		border-radius: 999px;
	}
	.s-actions {
		display: flex;
		flex-direction: column;
		gap: 12px;
		width: 100%;
		margin-top: 20px;
	}
	.s-said {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
	}
	/* White on the Scoutblå overlay: clearly THE next step (the outlined undo is secondary). */
	.s-next {
		min-height: 68px;
		border-radius: 18px;
		background: #fff;
		color: var(--brand);
		font-weight: 800;
		font-size: 20px;
		display: flex;
		align-items: center;
		justify-content: center;
		text-decoration: none;
	}
	.s-next:hover {
		color: var(--brand);
	}
	.s-undo {
		min-height: 60px;
		border-radius: 18px;
		border: 1.5px solid var(--line-on-brand);
		background: transparent;
		color: #fff;
		font-weight: 800;
		font-size: 18px;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		text-decoration: none;
	}
	.s-undo:hover {
		color: #fff;
	}
</style>

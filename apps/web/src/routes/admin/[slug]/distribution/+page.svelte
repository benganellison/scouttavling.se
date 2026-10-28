<script lang="ts">
	import '#lib/ui/patrols/prep.css';
	import { enhance } from '$app/forms';
	import { distribute, type Strategy } from '@scouttavling/domain';
	import { needsOutline } from '#lib/brand/colors.ts';

	let { data, form } = $props();

	const STRATS: { k: Strategy; t: string; d: string; rec?: boolean }[] = [
		{ k: 'BALANCED', t: 'Jämnt & smart', d: 'Jämna grupper, blandade klasser, och ingen klass startar på en kontroll den inte gör.', rec: true },
		{ k: 'ALL', t: 'Alla tillsammans', d: 'Som Gokapp idag: alla patruller i en lång rad över kontrollerna.' },
		{ k: 'PER_TRACK', t: 'Klass för klass', d: 'Som Gokapp idag: varje klass börjar om från första kontrollen.' }
	];

	let strategy = $state<Strategy>('BALANCED');
	let seed = $state(1);
	let saving = $state(false);

	const classes = $derived([
		...data.tracks.map((t) => ({ id: t.id, name: t.name, color: data.trackColors[t.id] ?? '#b4bcc6' })),
		...(data.distPatrols.some((p) => !p.trackId) ? [{ id: '', name: 'Utan klass', color: '#b4bcc6' }] : [])
	]);
	const result = $derived(distribute(data.distPatrols, data.distStations, strategy, seed));
	const trackOf = $derived(new Map(data.distPatrols.map((p) => [p.id, p.trackId])));
	const bars = $derived(
		data.stations.map((s) => {
			const by = new Map<string, number>();
			for (const [pid, sid] of result.assignment) if (sid === s.id) by.set(trackOf.get(pid) ?? '', (by.get(trackOf.get(pid) ?? '') ?? 0) + 1);
			const excluded = s.trackIds ? classes.filter((c) => !s.trackIds!.includes(c.id)).map((c) => c.name) : [];
			return { ...s, total: result.counts.get(s.id) ?? 0, segs: classes.filter((c) => by.get(c.id)).map((c) => ({ ...c, n: by.get(c.id)! })), excluded };
		})
	);
	const totals = $derived(bars.map((b) => b.total));
	const maxN = $derived(totals.length ? Math.max(...totals) : 0);
	const minN = $derived(totals.length ? Math.min(...totals) : 0);
	const scale = $derived(maxN ? 220 / maxN : 0);
</script>

<svelte:head><title>Fördela start · {data.competition.name}</title></svelte:head>

<div class="prep">
	<header class="prep-head">
		<div>
			<h1>Fördela startkontroller</h1>
			<p>{data.patrolCount} patruller på {data.stations.length} startkontroller. Förhandsvisa — inget sparas förrän du bekräftar.</p>
		</div>
	</header>

	{#if data.stations.length === 0 || data.patrolCount === 0}
		<div class="card empty">
			{#if data.stations.length === 0}
				Det finns inga kontroller som kan vara start ännu. Lägg till kontroller först.
				<div class="row" style="justify-content:center;margin-top:12px">
					<a class="btn btn-primary" href="/admin/{data.competition.slug}/stations">Kontroller</a>
				</div>
			{:else}
				Inga patruller att fördela ännu.
				<div class="row" style="justify-content:center;margin-top:12px">
					<a class="btn btn-primary" href="/admin/{data.competition.slug}/import">Importera patruller</a>
				</div>
			{/if}
		</div>
	{:else}
		<fieldset class="strats">
			<legend class="sr-only">Strategi</legend>
			{#each STRATS as s (s.k)}
				<label class="strat" class:on={strategy === s.k}>
					<input type="radio" name="strategy-pick" value={s.k} bind:group={strategy} class="sr-only" />
					<span class="strat-top">
						<span class="strat-t">{s.t}</span>
						{#if s.rec}<span class="rec">Rekommenderas</span>{/if}
					</span>
					<span class="strat-d">{s.d}</span>
				</label>
			{/each}
		</fieldset>

		<section class="card chart" aria-labelledby="pv-h">
			<h2 id="pv-h" class="sr-only">Förhandsvisning</h2>
			<div class="chart-top">
				<div class="kpis-inline">
					<div><span>Största startgrupp</span><strong class:bad={maxN - minN > 1}>{maxN} {maxN === 1 ? 'patrull' : 'patruller'}</strong></div>
					<div><span>Minsta</span><strong>{minN}</strong></div>
					<div><span>På fel kontroll</span><strong class:bad={result.ineligible > 0} class:good={result.ineligible === 0}>{result.ineligible}</strong></div>
				</div>
				<ul class="legend" aria-label="Klasser">
					{#each classes as c (c.id)}
						<li><span class="sw" style="background:{c.color}" class:outline={needsOutline(c.color)}></span>{c.name}</li>
					{/each}
				</ul>
			</div>
			<div class="bars-scroll">
				<div
					class="bars"
					style="grid-template-columns: repeat({bars.length}, minmax(48px, 1fr))"
					role="img"
					aria-label="Patruller per startkontroll: {bars.map((b) => `${b.code} ${b.total}`).join(', ')}"
				>
					{#each bars as b (b.id)}
						<div class="bar">
							<span class="total">{b.total}</span>
							<div class="stack-col">
								{#each b.segs as g (g.id)}
									<span
										class="seg"
										class:outline={needsOutline(g.color)}
										style="height:{Math.max(4, g.n * scale - 3)}px;background:{g.color}"
										title="{g.name}: {g.n}"
									></span>
								{/each}
							</div>
						</div>
					{/each}
				</div>
				<div class="labels" style="grid-template-columns: repeat({bars.length}, minmax(48px, 1fr))">
					{#each bars as b (b.id)}
						<span title={b.name}
							><strong>{b.code}</strong>{#if b.excluded.length}<em>ej {b.excluded.join(', ')}</em>{/if}</span
						>
					{/each}
				</div>
			</div>
		</section>

		<form
			method="POST"
			action="?/save"
			class="card savebar"
			use:enhance={() => {
				saving = true;
				return async ({ update }) => {
					await update({ reset: false });
					saving = false;
				};
			}}
		>
			<input type="hidden" name="strategy" value={strategy} />
			<input type="hidden" name="seed" value={seed} />
			<div class="savetext">
				<strong>
					{#if form?.saved !== undefined}Fördelningen är sparad för {form.saved} patruller.{:else if data.saved}{data.saved} patruller har redan en startkontroll
						— sparar du skrivs den över.{:else}Ingen fördelning sparad ännu.{/if}
				</strong>
				<span class="muted">
					{#if data.locked}{data.locked} patruller du flyttat manuellt är låsta och behåller sin kontroll.{:else}Patruller som du låser behåller alltid sin
						kontroll.{/if}
				</span>
				{#if form?.message}<span class="error-text" role="alert" id="err-message">{form.message}</span>{/if}
			</div>
			<div class="row">
				<button type="button" class="btn" onclick={() => (seed = (seed * 7 + 13) % 100000)}>Slumpa om</button>
				<button class="btn btn-accent" disabled={saving}>{saving ? 'Sparar…' : 'Spara fördelning'}</button>
			</div>
		</form>
	{/if}
</div>

<style>
	.strats {
		border: 0;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: 12px;
	}
	.strat {
		min-height: 96px;
		padding: 14px 16px;
		border-radius: 16px;
		background: var(--surface);
		border: 1.5px solid var(--line-strong);
		display: flex;
		flex-direction: column;
		gap: 6px;
		cursor: pointer;
	}
	.strat:focus-within {
		outline: 3px solid var(--orange);
		outline-offset: 2px;
	}
	.strat.on {
		background: var(--brand);
		border-color: var(--brand);
		color: #fff;
	}
	.strat-top {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
	}
	.strat-t {
		font-weight: 800;
		font-size: 16px;
	}
	.strat-d {
		font-size: 13px;
		line-height: 1.4;
		opacity: 0.9;
	}
	.rec {
		font-size: 11px;
		font-weight: 800;
		padding: 3px 8px;
		border-radius: 999px;
		background: var(--orange);
		color: var(--ink);
		text-transform: uppercase;
	}
	.chart {
		display: flex;
		flex-direction: column;
		gap: 16px;
		border-radius: 20px;
		padding: 22px 24px;
	}
	.chart-top {
		display: flex;
		justify-content: space-between;
		align-items: center;
		flex-wrap: wrap;
		gap: 12px;
	}
	.kpis-inline {
		display: flex;
		gap: 28px;
		flex-wrap: wrap;
	}
	.kpis-inline div {
		display: flex;
		flex-direction: column;
	}
	.kpis-inline span {
		font-size: 12px;
		font-weight: 700;
		color: var(--ink-2);
	}
	.kpis-inline strong {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 28px;
	}
	.bad {
		color: var(--danger);
	}
	.good {
		color: var(--brand-2);
	}
	.legend {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		gap: 14px;
		flex-wrap: wrap;
		font-size: 13px;
		font-weight: 700;
	}
	.legend li {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.sw {
		width: 14px;
		height: 14px;
		border-radius: 4px;
		display: inline-block;
	}
	.outline {
		box-shadow: inset 0 0 0 1px #7d8794;
	}
	.bars-scroll {
		overflow-x: auto;
	}
	.bars,
	.labels {
		display: grid;
		gap: 10px;
		min-width: max-content;
	}
	.bars {
		height: 260px;
		align-items: end;
		border-bottom: 2px solid var(--ink);
	}
	.bar {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 4px;
	}
	.total {
		text-align: center;
		font-weight: 800;
		font-size: 14px;
	}
	.stack-col {
		display: flex;
		flex-direction: column-reverse;
		gap: 3px;
	}
	.seg {
		display: block;
		border-radius: 6px;
	}
	.labels {
		padding-top: 8px;
	}
	.labels span {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		font-size: 12px;
		color: var(--ink-2);
	}
	.labels strong {
		color: var(--ink);
		font-size: 14px;
	}
	.labels em {
		font-style: normal;
		font-size: 11px;
		line-height: 1.2;
	}
	.savebar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 16px;
		flex-wrap: wrap;
	}
	.savetext {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1 1 320px;
	}
	.savetext .muted {
		font-size: 14px;
	}
</style>

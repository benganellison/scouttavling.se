<script lang="ts">
	import StatsView from '#lib/ui/stats/StatsView.svelte';
	import DateBars from '#lib/ui/stats/DateBars.svelte';
	import LiveBadge from '#lib/ui/live/LiveBadge.svelte';
	import { LiveStream } from '#lib/ui/live/liveStore.svelte.ts';

	let { data } = $props();

	const live = new LiveStream(() => ({
		url: `/api/v1/live/${data.comp.slug}/events`,
		depends: `live:${data.comp.slug}`,
		debounceMs: 3000,
		maxWaitMs: 10_000,
		minIntervalMs: 10_000
	}));
	const s = $derived(data.stats);
	const pay = $derived(s.payments);
	const kr = (n: number) => `${n.toLocaleString('sv-SE')} kr`;
	const dateSv = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('sv-SE', { day: 'numeric', month: 'long' });
	const busiest = $derived([...s.registrations].sort((a, b) => b.count - a.count)[0] ?? null);
</script>

<svelte:head><title>Statistik · {data.comp.name}</title></svelte:head>

<div class="page stack">
	<header class="head">
		<div class="stack tight">
			<h1>Statistik</h1>
			<div class="row sub">
				<span class="muted">{data.comp.name}</span>
				{#if data.comp.status === 'live'}<LiveBadge status={live.status} />{/if}
			</div>
		</div>
		{#if data.comp.publicResults}
			<a class="btn" href="/r/{data.comp.slug}/statistik">Publik statistik</a>
		{/if}
	</header>

	<p class="card note muted small">
		{#if !data.comp.publicResults}
			Bara arrangörer ser den här sidan. Publicera resultaten för att också visa deltagande{data.comp.stationsPublic ? ', poäng per kontroll och tider' : ''} publikt.
		{:else if data.comp.stationsPublic}
			Publikt visas deltagande, poäng per kontroll och tider. Anmälningar och betalningar syns bara här.
		{:else}
			Publikt visas bara deltagandet just nu. Poäng per kontroll och tider blir publika när tävlingen avslutas (eller om du slår på "Visa poäng per kontroll
			under tävlingen" i Inställningar). Anmälningar och betalningar syns bara här.
		{/if}
	</p>

	<StatsView stats={s} trackColors={data.trackColors} hiddenNote="" />

	<section class="block" aria-labelledby="h-reg">
		<h2 id="h-reg">Anmälningar <span class="pill">Bara arrangörer</span></h2>
		{#if s.registrations.length === 0}
			<p class="muted">Inga patruller ännu.</p>
		{:else}
			<p class="muted small">
				Första anmälan {dateSv(s.registrations[0].date)}, senaste {dateSv(s.registrations.at(-1)!.date)}{#if busiest && busiest.count > 1}. Flest på en dag: {busiest.count}
					({dateSv(busiest.date)}){/if}.
				{#if s.window.opensOn || s.window.closesOn}Anmälan {s.window.opensOn ? `öppnade ${dateSv(s.window.opensOn)}` : ''}{s.window.opensOn && s.window.closesOn
						? ', '
						: ''}{s.window.closesOn ? `stänger ${dateSv(s.window.closesOn)}` : ''}.{/if}
				Importerade och manuellt tillagda patruller räknas den dag de lades in.
			</p>
			<DateBars rows={s.registrations} label="Anmälningar per dag, totalt {s.registrations.at(-1)?.total}" unit="anmälningar" />
		{/if}
	</section>

	<section class="block" aria-labelledby="h-pay">
		<h2 id="h-pay">Betalningar <span class="pill">Bara arrangörer</span></h2>
		<dl class="figures" data-testid="payments">
			<div data-k="fee">
				<dt>Avgift</dt>
				<dd>{pay.fee === null ? '–' : kr(pay.fee)}</dd>
				<span class="sub">per patrull</span>
			</div>
			<div data-k="paid">
				<dt>Betalda</dt>
				<dd>{pay.paid}</dd>
				{#if pay.received !== null}<span class="sub">{kr(pay.received)} inbetalt</span>{/if}
			</div>
			<div data-k="unpaid">
				<dt>Inte betalda</dt>
				<dd>{pay.unpaid}</dd>
				{#if pay.outstanding !== null}<span class="sub">{kr(pay.outstanding)} kvar att få in</span>{/if}
			</div>
		</dl>
		{#if pay.fee === null}
			<p class="muted small">
				Ingen avgift är satt. Lägg in en under <a href="/admin/{data.comp.slug}/settings#anmalan">Inställningar → Anmälan</a> för att se belopp.
			</p>
		{/if}
		<p class="muted small">
			"Betald" bockas i på <a href="/admin/{data.comp.slug}/patrols">Patruller</a>; datumet sparas då. Patruller som brutit räknas inte som obetalda.
		</p>
		{#if pay.byDate.length}
			<DateBars rows={pay.byDate} label="Betalningar per dag, totalt {pay.paid}" unit="betalningar" />
		{/if}
	</section>
</div>

<style>
	.head {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 16px;
		align-items: flex-start;
	}
	h1 {
		font-size: 34px;
	}
	.tight {
		gap: 6px;
	}
	.sub {
		gap: 10px;
	}
	.note {
		margin: 0;
	}
	.block {
		display: grid;
		gap: 12px;
	}
	h2 {
		margin: 8px 0 0;
		font-size: 22px;
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}
	h2 .pill {
		font-size: 12px;
	}
	.figures {
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: 10px;
	}
	.figures > div {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r-lg, 12px);
		padding: 12px 14px;
	}
	.figures dt {
		color: var(--ink-2);
		font-size: 13px;
		font-weight: 700;
	}
	.figures dd {
		margin: 2px 0 0;
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 30px;
		line-height: 1.1;
		font-variant-numeric: tabular-nums;
	}
	.figures .sub {
		color: var(--ink-2);
		font-size: 12px;
	}
	.small {
		font-size: 13px;
	}
	p {
		margin: 0;
	}
</style>

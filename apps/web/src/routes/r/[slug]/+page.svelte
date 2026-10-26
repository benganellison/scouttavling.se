<script lang="ts">
	import ScouternaSymbol from '#lib/ui/brand/ScouternaSymbol.svelte';
	import EventLogo from '#lib/ui/brand/EventLogo.svelte';
	import TrackChip from '#lib/ui/brand/TrackChip.svelte';
	import SenderFooter from '#lib/ui/brand/SenderFooter.svelte';
	import { accentStyle } from '#lib/brand/branding.ts';
	import Medal from '#lib/ui/live/Medal.svelte';
	import StationBreakdown from '#lib/ui/live/StationBreakdown.svelte';
	import { LiveStream } from '#lib/ui/live/liveStore.svelte.ts';
	import { RULE_TEXT } from '#lib/ui/live/format.ts';
	import type { PublicTrack } from '#lib/server/live.ts';

	let { data } = $props();

	let pushed = $state<PublicTrack[] | null>(null);
	const tracks = $derived(pushed ?? data.tracks);
	let tab = $state<string | null>(null);
	const current = $derived(tracks.find((t) => t.trackId === tab) ?? tracks[0] ?? null);
	/** Patrol numbers whose points per station are open (kept across live updates). */
	let open = $state<number[]>([]);
	const toggle = (n: number) => (open = open.includes(n) ? open.filter((x) => x !== n) : [...open, n]);

	const live = new LiveStream(() => ({
		url: `/api/v1/live/${data.comp.slug}/results`,
		events: ['results', 'closed'],
		onEvent: (type, d) => {
			if (type === 'results') pushed = (d as { tracks: PublicTrack[] }).tracks;
			if (type === 'closed') location.reload();
		}
	}));
</script>

<svelte:head>
	<title>Resultat · {data.comp.name}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="wrap" style={accentStyle(data.branding)}>
	<header class="top">
		<div class="brand">{#if data.branding.eventLogo}<EventLogo logo={data.branding.eventLogo} height={40} onDark />{:else}<ScouternaSymbol size={28} onDark />{/if} <span>{data.comp.name}</span></div>
		{#if data.comp.final}
			<p class="state final" data-testid="final">Slutresultat</p>
		{:else}
			<p class="state" data-status={live.status}><span class="dot" aria-hidden="true"></span> Preliminärt · live</p>
		{/if}
		<a class="stats-link" href="/r/{data.comp.slug}/statistik">Statistik</a>
	</header>

	<nav class="tabs" aria-label="Klasser">
		{#each tracks as t (t.trackId)}
			<button class="tab" aria-pressed={current?.trackId === t.trackId} onclick={() => (tab = t.trackId)}><TrackChip color={data.trackColors[t.trackId]} size={12} />{t.name}</button>
		{/each}
	</nav>

	<main>
		{#if current}
			<h1 class="sr-only">Resultat {current.name}</h1>
			<ol class="list" data-testid="public-list" style="--track:{data.trackColors[current.trackId] ?? 'var(--line)'}">
				{#each current.rows as r (r.number)}
					{@const expandable = current.stations.length > 0}
					{@const isOpen = expandable && open.includes(r.number)}
					<li class:top3={r.place <= 3} data-number={r.number} data-place={r.place}>
						{#snippet rowBody()}
							<Medal place={r.place} size={40} />
							<span class="who">
								<span class="name"><span class="nr">{r.number}</span> {r.name}</span>
								<span class="troop">{r.troop}</span>
								{#if r.tied}<span class="tie">Delad plats</span>{/if}
							</span>
							<span class="pts">
								<span class="total">{r.total}</span>
								{#if r.stylePoints}<span class="split">{r.scorePoints} + {r.stylePoints}</span>{/if}
							</span>
						{/snippet}
						{#if expandable}
							<button class="row-item btn-row" type="button" aria-expanded={isOpen} aria-controls="st-{r.number}" onclick={() => toggle(r.number)}>
								{@render rowBody()}
								<svg class="chev" class:up={isOpen} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
							</button>
						{:else}
							<div class="row-item">{@render rowBody()}</div>
						{/if}
						{#if isOpen}
							<div class="detail"><StationBreakdown id="st-{r.number}" stations={current.stations} cells={r.perStation} /></div>
						{/if}
					</li>
				{/each}
			</ol>
			{#if current.rows.length === 0}<p class="empty">Inga resultat i klassen ännu.</p>{/if}
			{#if current.stations.length > 0 && current.rows.length > 0}<p class="hint">Tryck på en patrull för poäng per kontroll.</p>{/if}
		{/if}
		<footer class="rule">
			<p>{RULE_TEXT}</p>
			{#if !data.comp.final}<p>Resultaten är preliminära tills tävlingsledningen har gått igenom alla rapporter.</p>{/if}
		</footer>
		<SenderFooter organiserName={data.branding.organiserName} organiserLogo={data.branding.organiserLogo} />
	</main>
</div>

<style>
	.wrap {
		min-height: 100dvh;
		background: var(--ground);
	}
	.top {
		background: var(--brand);
		color: #fff;
		padding: 18px 16px 16px;
		border-top: 6px solid var(--event-stripe);
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 10px;
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 22px;
	}
	.state {
		margin: 0;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-weight: 800;
		font-size: 14px;
		color: var(--on-brand);
	}
	.stats-link {
		align-self: flex-start;
		color: #fff;
		font-weight: 800;
		font-size: 14px;
		text-underline-offset: 3px;
	}
	.dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: var(--orange);
	}
	.state[data-status='open'] .dot {
		animation: pulse 2s infinite;
	}
	@keyframes pulse {
		50% {
			opacity: 0.35;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.state .dot {
			animation: none !important;
		}
		.chev {
			transition: none;
		}
	}
	.tabs {
		display: flex;
		gap: 8px;
		overflow-x: auto;
		padding: 12px 16px;
		background: var(--brand);
		scrollbar-width: none;
	}
	.tab {
		flex: none;
		min-height: var(--tap);
		padding: 0 18px;
		border-radius: 999px;
		border: 1.5px solid var(--line-on-brand);
		background: var(--brand);
		color: #fff;
		font-weight: 800;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}
	.tab[aria-pressed='true'] {
		background: #fff;
		border-color: #fff;
		color: var(--brand);
	}
	main {
		padding: 16px;
		max-width: 720px;
		margin: 0 auto;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		background: var(--surface);
		border: 1px solid var(--line);
		border-top: 6px solid var(--track);
		border-radius: var(--r-lg);
		overflow: hidden;
	}
	.list > li {
		border-top: 1px solid var(--line);
	}
	.list > li:first-child {
		border-top: 0;
	}
	.row-item {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 14px;
		width: 100%;
	}
	.btn-row {
		border: 0;
		background: none;
		font: inherit;
		color: inherit;
		text-align: left;
		cursor: pointer;
		min-height: var(--tap);
	}
	.btn-row:focus-visible {
		outline-offset: -3px;
	}
	.chev {
		flex: none;
		color: var(--ink-2);
		transition: transform 0.15s;
	}
	.chev.up {
		transform: rotate(180deg);
	}
	.detail {
		padding: 0 14px 12px 66px;
	}
	.hint {
		margin: 10px 0 0;
		font-size: 13px;
		color: var(--ink-2);
	}
	.who {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.name {
		font-weight: 800;
		font-size: 17px;
	}
	.nr {
		color: var(--ink-2);
		font-weight: 700;
	}
	.troop {
		color: var(--ink-2);
		font-size: 13px;
	}
	.tie {
		color: var(--warn-ink);
		font-size: 12px;
		font-weight: 800;
	}
	.pts {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
	}
	.total {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 26px;
		line-height: 1;
	}
	.split {
		font-size: 12px;
		color: var(--ink-2);
		font-variant-numeric: tabular-nums;
	}
	.empty {
		color: var(--ink-2);
	}
	.rule {
		margin-top: 18px;
		font-size: 13px;
		color: var(--ink-2);
	}
	.rule p {
		margin: 0 0 8px;
	}
</style>

<script lang="ts">
	import ScouternaSymbol from '#lib/ui/brand/ScouternaSymbol.svelte';
	import EventLogo from '#lib/ui/brand/EventLogo.svelte';
	import TrackChip from '#lib/ui/brand/TrackChip.svelte';
	import SenderFooter from '#lib/ui/brand/SenderFooter.svelte';
	import { accentStyle } from '#lib/brand/branding.ts';
	import Medal from '#lib/ui/live/Medal.svelte';
	import { LiveStream } from '#lib/ui/live/liveStore.svelte.ts';
	import { RULE_TEXT } from '#lib/ui/live/format.ts';
	import type { PublicTrack } from '#lib/server/live.ts';

	let { data } = $props();

	let pushed = $state<PublicTrack[] | null>(null);
	const tracks = $derived(pushed ?? data.tracks);
	let tab = $state<string | null>(null);
	const current = $derived(tracks.find((t) => t.trackId === tab) ?? tracks[0] ?? null);

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
		<p class="state" data-status={live.status}><span class="dot" aria-hidden="true"></span> Preliminärt · live</p>
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
					<li class="row-item" class:top3={r.place <= 3} data-number={r.number} data-place={r.place}>
						<Medal place={r.place} size={40} />
						<div class="who">
							<span class="name"><span class="nr">{r.number}</span> {r.name}</span>
							<span class="troop">{r.troop}</span>
							{#if r.tied}<span class="tie">Delad plats</span>{/if}
						</div>
						<div class="pts">
							<span class="total">{r.total}</span>
							{#if r.stylePoints}<span class="split">{r.scorePoints} + {r.stylePoints}</span>{/if}
						</div>
					</li>
				{/each}
			</ol>
			{#if current.rows.length === 0}<p class="empty">Inga resultat i klassen ännu.</p>{/if}
		{/if}
		<footer class="rule">
			<p>{RULE_TEXT}</p>
			<p>Resultaten är preliminära tills tävlingsledningen har gått igenom alla rapporter.</p>
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
	.row-item {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 14px;
		border-top: 1px solid var(--line);
	}
	.row-item:first-child {
		border-top: 0;
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

<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidate } from '$app/navigation';
	import PublicShell from '#lib/ui/public/PublicShell.svelte';
	import TrackChip from '#lib/ui/brand/TrackChip.svelte';
	import StatusPill from '#lib/ui/patrols/StatusPill.svelte';

	let { data } = $props();
	const POLL_MS = 10_000;

	onMount(() => {
		const refresh = () => document.visibilityState === 'visible' && void invalidate('folj:data');
		const timer = setInterval(refresh, POLL_MS);
		document.addEventListener('visibilitychange', refresh);
		return () => {
			clearInterval(timer);
			document.removeEventListener('visibilitychange', refresh);
		};
	});

	const pct = $derived(data.enabled && data.total ? Math.round((data.done / data.total) * 100) : 0);
</script>

<svelte:head>
	<title>{data.enabled ? `Följ ${data.patrol.name}` : 'Följ patrullen'} · {data.comp.name}</title>
	<meta name="robots" content="noindex, nofollow" />
	<meta name="referrer" content="no-referrer" />
</svelte:head>

<PublicShell title={data.comp.name} eyebrow="Följ patrullen" branding={data.branding}>
	{#snippet hero()}
		{#if data.enabled}
			<div class="hero">
				<span class="nr">{data.patrol.number}</span>
				<div class="who">
					<h1>{data.patrol.name}</h1>
					<span class="trk">{data.patrol.troop}{#if data.patrol.track}<span aria-hidden="true"> · </span><TrackChip color={data.trackColor} size={12} />{data.patrol.track}{/if}</span>
				</div>
			</div>
		{/if}
	{/snippet}

	{#if !data.enabled}
		<section class="card off" data-testid="follow-off">
			<h1>Följ patrullen är avstängt för den här tävlingen</h1>
			<p class="muted">Arrangören har inte slagit på funktionen. Länken börjar fungera när den slås på.</p>
		</section>
	{:else}
		<section class="card summary" aria-labelledby="h-sum" data-testid="follow-summary">
			<h2 id="h-sum" class="sr-only">Läget</h2>
			<div class="srow">
				<StatusPill status={data.patrol.status} detail={data.campAt ? `klar för dagen ${data.campAt}` : null} />
				<span class="muted small" aria-live="polite">Uppdaterad {data.updated}</span>
			</div>
			<p class="count"><strong data-testid="done-count">{data.done}</strong> av {data.total} kontroller klara</p>
			<div class="bar" role="progressbar" aria-valuemin={0} aria-valuemax={data.total} aria-valuenow={data.done} aria-label="Kontroller klara">
				<span style="width: {pct}%"></span>
			</div>
			{#if data.started || data.finished}
				<p class="muted small times">
					{#if data.started}Startade {data.started}{/if}{#if data.started && data.finished} · {/if}{#if data.finished}I mål {data.finished}{/if}
				</p>
			{/if}
			{#if data.placement}
				<div class="place" data-testid="placement">
					<div><span class="big">{data.placement.place}</span><span class="lbl">plats{data.placement.tied ? ' (delad)' : ''} av {data.placement.of}</span></div>
					<div><span class="big">{data.placement.total}</span><span class="lbl">poäng</span></div>
				</div>
				<p class="muted small">Preliminärt tills tävlingsledningen gått igenom alla rapporter.</p>
			{/if}
		</section>

		<section class="card" aria-labelledby="h-st">
			<h2 id="h-st">Kontroller</h2>
			<ol class="stations" data-testid="follow-stations">
				{#each data.stations as s (s.code)}
					<li class:done={s.done}>
						<span class="mark" aria-hidden="true">
							{#if s.done}<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>{/if}
						</span>
						<span class="sr-only">{s.done ? 'Klar:' : 'Inte besökt:'}</span>
						<span class="code">{s.code}</span>
						<span class="sname">{s.name}</span>
						<span class="right">
							{#if s.points !== null}<strong class="pts">{s.points} p</strong>{/if}
							<span class="time">{s.time ?? '–'}</span>
						</span>
					</li>
				{/each}
			</ol>
		</section>

		{#if data.comp.publicResults}
			<a class="btn wide" href="/r/{data.comp.slug}">Se alla resultat</a>
		{/if}
	{/if}
</PublicShell>

<style>
	.hero {
		margin-top: 16px;
		display: flex;
		align-items: center;
		gap: 14px;
	}
	.nr {
		flex: none;
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 40px;
		line-height: 1;
		background: #fff;
		color: var(--ink);
		border-radius: var(--r-md);
		padding: 8px 12px;
	}
	.who {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.who h1 {
		font-size: 30px;
		font-weight: 800;
		overflow-wrap: anywhere;
	}
	.who span {
		color: var(--on-brand);
		font-weight: 700;
	}
	.who .trk {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}
	.off h1 {
		font-size: 24px;
		font-weight: 800;
	}
	.off p {
		margin: 8px 0 0;
	}
	h2 {
		font-size: 20px;
		font-weight: 800;
		margin-bottom: 6px;
	}
	.summary {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.summary p {
		margin: 0;
	}
	.srow {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
	}
	.srow :global(.st) {
		font-size: 15px;
		padding: 6px 14px;
	}
	.count {
		font-size: 17px;
	}
	.count strong {
		font-family: var(--font-display);
		font-size: 36px;
	}
	.bar {
		height: 12px;
		border-radius: 999px;
		background: var(--tint);
		overflow: hidden;
	}
	.bar span {
		display: block;
		height: 100%;
		background: var(--brand);
		border-radius: 999px;
		transition: width 0.4s;
	}
	.small {
		font-size: 14px;
	}
	.place {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
		margin-top: 4px;
	}
	.place > div {
		background: var(--ok-tint);
		border-radius: var(--r-md);
		padding: 10px 14px;
		display: flex;
		flex-direction: column;
	}
	.big {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 34px;
		line-height: 1.05;
	}
	.lbl {
		font-size: 14px;
		color: var(--ink-2);
		font-weight: 700;
	}
	.stations {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.stations li {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 11px 0;
		border-top: 1px solid var(--line);
		min-height: 48px;
	}
	.stations li:first-child {
		border-top: 0;
	}
	.mark {
		flex: none;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		border: 2px solid var(--line-strong);
		display: flex;
		align-items: center;
		justify-content: center;
		color: #fff;
	}
	.done .mark {
		background: var(--ok);
		border-color: var(--ok);
	}
	.code {
		flex: none;
		min-width: 34px;
		font-family: var(--font-display);
		font-weight: 800;
	}
	.sname {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	li:not(.done) .sname,
	li:not(.done) .code {
		color: var(--ink-2);
	}
	.right {
		display: flex;
		gap: 10px;
		align-items: baseline;
		flex: none;
	}
	.time {
		color: var(--ink-2);
		font-variant-numeric: tabular-nums;
		font-size: 14px;
	}
	.pts {
		font-variant-numeric: tabular-nums;
	}
	.wide {
		width: 100%;
	}
</style>

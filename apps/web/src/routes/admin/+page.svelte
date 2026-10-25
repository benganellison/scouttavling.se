<script lang="ts">
	import ScouternaSymbol from '#lib/ui/brand/ScouternaSymbol.svelte';
	import Topbar from '#lib/ui/admin/Topbar.svelte';
	import StatusPill from '#lib/ui/admin/StatusPill.svelte';
	import { dateRange } from '#lib/ui/admin/format.ts';

	let { data } = $props();
	const first = $derived(data.user.name.split(/\s+/)[0]);
</script>

<svelte:head><title>Mina tävlingar · Scouttävling</title></svelte:head>

<div class="page">
	<Topbar userName={data.user.name} />

	<header class="head">
		<div class="stack tight">
			<span class="muted kicker">Hej {first}</span>
			<h1>Mina tävlingar</h1>
		</div>
		<a class="btn btn-accent" href="/admin/new">
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
			Ny tävling
		</a>
	</header>

	{#if data.competitions.length === 0}
		<section class="empty card">
			<ScouternaSymbol size={56} />
			<h2>Inga tävlingar än</h2>
			<p class="muted">Skapa din första tävling på tre minuter: namn, datum, klasser och kontroller. Detaljerna fixar du sen.</p>
			<a class="btn btn-accent" href="/admin/new">Skapa en tävling</a>
		</section>
	{:else}
		{#each data.groups as g (g.series?.slug ?? '')}
		<section class="group" aria-labelledby="g-{g.series?.slug ?? 'single'}" data-testid="group-{g.series?.slug ?? 'single'}">
			<div class="g-head">
				<h2 id="g-{g.series?.slug ?? 'single'}">{g.series ? g.series.name : 'Enskilda tävlingar'}</h2>
				{#if g.series}
					<span class="muted g-count">{g.competitions.length} år</span>
					<a class="g-link" href="/admin/series/{g.series.slug}">Hantera serien</a>
				{/if}
			</div>
		<ul class="grid" aria-label={g.series ? `${g.series.name}, alla år` : 'Enskilda tävlingar'}>
			{#each g.competitions as c (c.slug)}
				<li>
					<a class="comp card" href="/admin/{c.slug}">
						<div class="top">
							{#if c.anonymised}<span class="pill arch">Arkiverad</span>{:else}<StatusPill status={c.status} />{/if}
							<span class="kind">{c.multiDay ? 'Flera dagar' : 'En dag'}</span>
						</div>
						<h2>{c.name}</h2>
						<span class="meta">{dateRange(c.startDate, c.endDate)}{c.location ? ` · ${c.location}` : ''}</span>
						<div class="bottom">
							<span class="num"><strong>{c.patrols}</strong> {c.patrols === 1 ? 'patrull' : 'patruller'}</span>
							{#if c.owner}<span class="owner">{c.owner}</span>{/if}
						</div>
					</a>
				</li>
			{/each}
		</ul>
		</section>
		{/each}
	{/if}
</div>

<style>
	.page {
		max-width: 1180px;
		margin: 0 auto;
		padding: 28px 24px 64px;
		display: flex;
		flex-direction: column;
		gap: 28px;
	}
	.head {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		gap: 16px;
		flex-wrap: wrap;
	}
	.tight {
		gap: 4px;
	}
	.kicker {
		font-weight: 700;
		font-size: 15px;
	}
	h1 {
		font-size: clamp(32px, 5vw, 44px);
		font-weight: 800;
		letter-spacing: -0.03em;
	}
	.group {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.g-head {
		display: flex;
		align-items: baseline;
		gap: 12px;
		flex-wrap: wrap;
		padding-bottom: 6px;
		border-bottom: 2px solid var(--line);
	}
	.g-head h2 {
		font-size: 22px;
		font-weight: 800;
		margin: 0;
	}
	.g-count {
		font-size: 14px;
		font-weight: 700;
	}
	.g-link {
		margin-left: auto;
		font-weight: 800;
		min-height: 44px;
		display: inline-flex;
		align-items: center;
	}
	.arch {
		background: var(--tint);
		border: 1px solid var(--line);
		color: var(--ink);
	}
	.grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr));
		gap: 16px;
	}
	.comp {
		display: flex;
		flex-direction: column;
		gap: 8px;
		height: 100%;
		text-decoration: none;
		color: var(--ink);
		padding: 20px 22px;
		transition: border-color 0.15s, box-shadow 0.15s;
	}
	.comp:hover {
		border-color: var(--brand);
		box-shadow: 0 6px 20px rgb(0 0 0 / 0.08);
		color: var(--ink);
	}
	.top {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
	}
	.kind {
		font-size: 13px;
		font-weight: 700;
		color: var(--ink-2);
	}
	.comp h2 {
		font-size: 24px;
		font-weight: 800;
		margin-top: 6px;
	}
	.meta {
		font-size: 14px;
		color: var(--ink-2);
	}
	.bottom {
		margin-top: auto;
		padding-top: 14px;
		border-top: 1px solid var(--line);
		display: flex;
		justify-content: space-between;
		gap: 8px;
		flex-wrap: wrap;
		font-size: 14px;
	}
	.num strong {
		font-family: var(--font-display);
		font-size: 22px;
	}
	.owner {
		color: var(--ink-2);
		align-self: center;
	}
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 12px;
		padding: 56px 24px;
	}
	.empty p {
		max-width: 440px;
		margin: 0;
	}
	@media (max-width: 480px) {
		.page {
			padding: 18px 16px 48px;
		}
	}
</style>

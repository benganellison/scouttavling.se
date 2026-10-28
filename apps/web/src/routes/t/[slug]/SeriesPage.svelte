<script lang="ts">
	import PublicShell from '#lib/ui/public/PublicShell.svelte';
	import TrackChip from '#lib/ui/brand/TrackChip.svelte';
	import { dateRange, todayIso } from '#lib/ui/admin/format.ts';
	import type { PageData } from './$types';

	/** Public series page: branding, this year's edition up front, then "Tidigare år" with winners. */
	let { data }: { data: Extract<PageData, { kind: 'series' }> } = $props();
	const s = $derived(data.series);
	const cur = $derived(data.current);
	const first = $derived(data.archive.at(-1)?.year ?? cur?.year ?? null);
	const today = todayIso();
	const eyebrow = $derived(
		!cur ? '' : today >= cur.startDate && today <= cur.endDate ? 'Pågår nu' : today < cur.startDate ? 'Nästa tävling' : `${s.name} ${cur.year}`
	);
	const n = (v: number, one: string, many: string) => `${v} ${v === 1 ? one : many}`;
</script>

<svelte:head>
	<title>{s.name}</title>
	<meta name="description" content="{s.name}{s.organiser ? ` · ${s.organiser}` : ''} · resultat och kommande tävlingar" />
</svelte:head>

<PublicShell title="Scouttävling" branding={data.branding} showCover>
	{#snippet hero()}
		<div class="hero">
			{#if s.organiser}<p class="org">{s.organiser} arrangerar</p>{/if}
			<h1>{s.name}</h1>
			{#if first}<p class="since">Tävlingsserie sedan {first}</p>{/if}
		</div>
	{/snippet}

	{#if cur}
		<section class="card now" aria-labelledby="h-now" data-testid="series-current">
			<span class="eyebrow">{eyebrow}</span>
			<h2 id="h-now">{cur.name}</h2>
			<p class="when">{dateRange(cur.startDate, cur.endDate)}{cur.location ? ` · ${cur.location}` : ''}</p>
			{#if cur.window.state === 'open'}
				<p class="muted reg-text">{cur.window.text}{cur.window.spotsLeft !== null ? ` · ${n(cur.window.spotsLeft, 'plats kvar', 'platser kvar')}` : ''}</p>
				<a class="btn btn-accent cta" href="/t/{cur.slug}/anmal">Anmäl en patrull</a>
			{:else}
				<p class="muted reg-text">{cur.window.text}</p>
			{/if}
			<div class="now-links">
				{#if cur.publicResults}<a class="btn" href="/r/{cur.slug}">Liveresultat</a>{/if}
				<a class="btn btn-ghost" href="/t/{cur.slug}">Om tävlingen</a>
			</div>
		</section>
	{:else}
		<section class="card now" aria-labelledby="h-now">
			<h2 id="h-now">Nästa tävling planeras</h2>
			<p class="muted reg-text">Här kommer datum och anmälan när arrangören har publicerat nästa år.</p>
		</section>
	{/if}

	<section class="past" aria-labelledby="h-past" data-testid="series-archive">
		<h2 id="h-past">Tidigare år</h2>
		{#if data.archive.length === 0}
			<p class="muted">Inga avslutade tävlingar ännu.</p>
		{:else}
			<ol class="years">
				{#each data.archive as e (e.slug)}
					<li class="card year" data-testid="archive-{e.year}">
						<div class="y-head">
							<span class="y-num">{e.year}</span>
							<div class="y-meta">
								<strong>{e.name}</strong>
								<span class="muted">{dateRange(e.startDate, e.endDate)}{e.location ? ` · ${e.location}` : ''} · {n(e.patrols, 'patrull', 'patruller')}</span>
							</div>
						</div>
						{#if e.winners.length}
							<ul class="winners" aria-label="Vinnare {e.year}">
								{#each e.winners as w (w.track)}
									<li>
										<span class="w-track"><TrackChip color={w.color} />{w.track}</span>
										<span class="w-who">
											{#each w.patrols as p, i (p.number)}{i ? ' och ' : ''}<strong>{p.name}</strong> <span class="muted">{p.troop}</span>{/each}
										</span>
									</li>
								{/each}
							</ul>
						{/if}
						{#if e.results}
							<a class="y-link" href="/r/{e.slug}"
								>Resultat {e.year}<svg
									width="18"
									height="18"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2.6"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg
								></a
							>
						{/if}
					</li>
				{/each}
			</ol>
		{/if}
	</section>
</PublicShell>

<style>
	.hero {
		margin-top: 18px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.org,
	.since {
		margin: 0;
		color: var(--on-brand);
		font-weight: 700;
		font-size: 15px;
	}
	h1 {
		font-size: clamp(32px, 9vw, 48px);
		font-weight: 800;
		letter-spacing: -0.03em;
	}
	h2 {
		font-size: 20px;
		font-weight: 800;
	}
	.now {
		display: flex;
		flex-direction: column;
		gap: 10px;
		box-shadow: 0 6px 24px rgb(0 0 0 / 8%);
		border-top: 5px solid var(--event-stripe);
	}
	.now:first-child {
		margin-top: -26px;
	}
	.now h2 {
		font-size: 26px;
	}
	.eyebrow {
		font-size: 12px;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-2);
	}
	.when {
		margin: 0;
		font-weight: 700;
	}
	.reg-text {
		margin: 0;
	}
	.cta {
		min-height: 56px;
		font-size: 18px;
		width: 100%;
	}
	.now-links {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
	}
	.now-links .btn {
		flex: 1 1 140px;
	}
	.past {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.past > h2 {
		margin: 8px 0 0;
	}
	.years {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.year {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.y-head {
		display: flex;
		gap: 14px;
		align-items: center;
	}
	.y-num {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 30px;
		letter-spacing: -0.02em;
		color: var(--brand);
		flex: none;
	}
	.y-meta {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.y-meta .muted {
		font-size: 14px;
	}
	.winners {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.winners li {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 4px 12px;
		padding: 10px 0;
		border-top: 1px solid var(--line);
	}
	.w-track {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		font-weight: 800;
	}
	.w-who {
		text-align: right;
		flex: 1 1 180px;
	}
	.w-who .muted {
		font-size: 14px;
	}
	.y-link {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-weight: 800;
		min-height: 48px;
		align-self: flex-start;
	}
	@media (max-width: 560px) {
		.winners li {
			flex-direction: column;
			align-items: flex-start;
		}
		.w-who {
			text-align: left;
			flex: none;
			padding-left: 26px;
		}
	}
</style>

<script lang="ts">
	import PublicShell from '#lib/ui/public/PublicShell.svelte';
	import { dateRange } from '#lib/ui/admin/format.ts';
	import { dayMonth } from '#lib/registration/rules.ts';
	import TrackChip from '#lib/ui/brand/TrackChip.svelte';

	import type { PageData } from './$types';

	let { data }: { data: Extract<PageData, { kind: 'competition' }> } = $props();
	const c = $derived(data.comp);
	const w = $derived(data.window);
	const paragraphs = $derived((c.infoText ?? '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean));
</script>

<svelte:head>
	<title>{c.name}</title>
	<meta name="description" content="{c.name} · {dateRange(c.startDate, c.endDate)}{c.location ? ` · ${c.location}` : ''}" />
	{#if data.preview}<meta name="robots" content="noindex" />{/if}
</svelte:head>

<PublicShell title="Scouttävling" branding={data.branding} showCover>
	{#snippet hero()}
		<div class="hero">
			{#if c.organiser}<p class="org">{c.organiser} bjuder in till</p>{/if}
			<h1>{c.name}</h1>
			<ul class="facts">
				<li>
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
					<span>{dateRange(c.startDate, c.endDate)}{c.multiDay ? ' · flera dagar' : ''}</span>
				</li>
				{#if c.location}
					<li>
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>
						<span>{c.location}</span>
					</li>
				{/if}
			</ul>
		</div>
	{/snippet}

	{#if data.preview}
		<p class="preview" role="note"><strong>Förhandsvisning.</strong> Tävlingen är ett utkast och sidan syns bara för arrangörer. Gör tävlingen live på översikten för att publicera den.</p>
	{/if}

	<section class="card reg" aria-labelledby="h-reg" data-state={w.state}>
		<h2 id="h-reg" class="sr-only">Anmälan</h2>
		{#if w.state === 'open'}
			<p class="when">{w.text}</p>
			<a class="btn btn-accent cta" href="/t/{c.slug}/anmal">Anmäl en patrull</a>
			{#if w.spotsLeft !== null}
				<p class="spots" data-testid="spots"><strong>{w.spotsLeft}</strong> {w.spotsLeft === 1 ? 'plats kvar' : 'platser kvar'} av {c.maxPatrols}</p>
			{/if}
		{:else}
			<p class="status" data-testid="reg-status">{w.text}</p>
			{#if w.state === 'not_yet'}
				<p class="muted sub">Sista anmälningsdag är {dayMonth(w.closesOn, w.today)}.{w.spotsLeft !== null ? ` ${c.maxPatrols} platser.` : ''}</p>
			{:else if w.state === 'full'}
				<p class="muted sub">Alla {c.maxPatrols} platser är tagna. Kontakta arrangören om ni vill stå på reservlistan.</p>
			{/if}
		{/if}
	</section>

	{#if c.publicResults && c.status !== 'draft'}
		<a class="card results" href="/r/{c.slug}">
			<span class="dot" aria-hidden="true"></span>
			<span class="rt"><strong>{c.status === 'closed' ? 'Resultat' : 'Liveresultat'}</strong><span class="muted">Se ställningen i alla klasser</span></span>
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
		</a>
	{/if}

	{#if paragraphs.length}
		<section class="card info" aria-labelledby="h-info">
			<h2 id="h-info">Information</h2>
			<div class="prose">
				{#each paragraphs as p, i (i)}<p>{p}</p>{/each}
			</div>
		</section>
	{/if}

	<section class="card" aria-labelledby="h-tracks">
		<div class="th">
			<h2 id="h-tracks">Klasser</h2>
			<span class="muted">{data.patrolCount} {data.patrolCount === 1 ? 'patrull anmäld' : 'patruller anmälda'}</span>
		</div>
		{#if data.tracks.length}
			<ul class="tracks">
				{#each data.tracks as t (t.name)}
					<li><span class="tn"><TrackChip color={t.color} />{t.name}</span><span class="tc"><strong>{t.patrols}</strong> {t.patrols === 1 ? 'patrull' : 'patruller'}</span></li>
				{/each}
			</ul>
		{:else}
			<p class="muted">Klasserna är inte bestämda ännu.</p>
		{/if}
	</section>

	{#if data.series}
		<a class="series-link" href="/t/{data.series.slug}" data-testid="series-link">Alla år av {data.series.name}</a>
	{/if}
</PublicShell>

<style>
	.series-link {
		align-self: center;
		font-weight: 700;
		min-height: 48px;
		display: inline-flex;
		align-items: center;
	}
	.hero {
		margin-top: 18px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.org {
		margin: 0;
		color: var(--on-brand);
		font-weight: 700;
		font-size: 15px;
	}
	h1 {
		font-size: clamp(32px, 9vw, 44px);
		font-weight: 800;
		letter-spacing: -0.03em;
	}
	.facts {
		list-style: none;
		margin: 6px 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
		color: var(--on-brand);
		font-weight: 700;
	}
	.facts li {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.facts svg {
		color: var(--on-brand-hi);
		flex: none;
	}
	.preview {
		margin: 0;
		background: var(--warn-tint);
		border: 1px solid var(--orange);
		color: var(--warn-ink);
		border-radius: var(--r-md);
		padding: 12px 14px;
		font-size: 15px;
	}
	.reg {
		display: flex;
		flex-direction: column;
		gap: 12px;
		box-shadow: 0 6px 24px rgb(0 0 0 / 8%);
	}
	.reg:first-child {
		margin-top: -26px;
	}
	.when {
		margin: 0;
		font-weight: 700;
		color: var(--ink-2);
	}
	.cta {
		min-height: 56px;
		font-size: 18px;
		width: 100%;
	}
	.spots {
		margin: 0;
		color: var(--ink-2);
		text-align: center;
	}
	.spots strong {
		color: var(--ink);
	}
	.status {
		margin: 0;
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 24px;
	}
	.sub {
		margin: -4px 0 0;
	}
	.results {
		display: flex;
		align-items: center;
		gap: 12px;
		text-decoration: none;
		color: var(--ink);
		min-height: 64px;
	}
	.results:hover {
		border-color: var(--line-strong);
	}
	.rt {
		display: flex;
		flex-direction: column;
		flex: 1;
	}
	.rt .muted {
		font-size: 14px;
	}
	.dot {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: var(--event-accent);
		flex: none;
	}
	h2 {
		font-size: 20px;
		font-weight: 800;
	}
	.info {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.info .prose {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.info p {
		margin: 0;
		white-space: pre-line;
	}
	.th {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 8px;
		flex-wrap: wrap;
		margin-bottom: 6px;
	}
	.th .muted {
		font-size: 14px;
	}
	.tracks {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.tracks li {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 12px 0;
		border-top: 1px solid var(--line);
	}
	.tracks li:first-child {
		border-top: 0;
	}
	.tn {
		font-weight: 800;
		display: inline-flex;
		align-items: center;
		gap: 10px;
	}
	.tc {
		color: var(--ink-2);
	}
	.tc strong {
		color: var(--ink);
		font-family: var(--font-display);
		font-size: 18px;
	}
</style>

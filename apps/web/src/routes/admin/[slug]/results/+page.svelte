<script lang="ts">
	import { enhance } from '$app/forms';
	import Medal from '#lib/ui/live/Medal.svelte';
	import LiveBadge from '#lib/ui/live/LiveBadge.svelte';
	import { LiveStream } from '#lib/ui/live/liveStore.svelte.ts';
	import { RULE_TEXT } from '#lib/ui/live/format.ts';

	let { data } = $props();

	const live = new LiveStream(() => ({ url: `/api/v1/live/${data.comp.slug}/events`, depends: `live:${data.comp.slug}`, debounceMs: 800 }));
	const base = $derived(`/admin/${data.comp.slug}`);
</script>

<svelte:head><title>Resultat · {data.comp.name}</title></svelte:head>

<div class="page stack">
	<header class="head">
		<div class="stack tight">
			<h1>Resultat</h1>
			<div class="row sub">
				<span class="muted">{data.comp.name} · preliminärt</span>
				<LiveBadge status={live.status} />
			</div>
		</div>
		<div class="row">
			<a class="btn" href="{base}/results.csv" download>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 4v11m-5-5 5 5 5-5M5 20h14" /></svg>
				Exportera CSV
			</a>
			<a class="btn" href="/r/{data.comp.slug}/ceremony{data.current ? `?class=${data.current.trackId}` : ''}">Prisutdelning</a>
			<form method="POST" action="?/publish" use:enhance>
				<input type="hidden" name="on" value={data.comp.publicResults ? '0' : '1'} />
				{#if data.comp.publicResults}
					<button class="btn">Avpublicera</button>
				{:else}
					<button class="btn btn-accent">Publicera resultat</button>
				{/if}
			</form>
		</div>
	</header>

	{#if data.comp.publicResults}
		<p class="card pub">
			<span class="pill pill-ok">Publicerat</span>
			Resultaten visas för alla på <a href="/r/{data.comp.slug}">/r/{data.comp.slug}</a> och uppdateras live.
		</p>
	{/if}

	<nav class="tabs" aria-label="Klasser">
		{#each data.tabs as t (t.id)}
			<a href="?class={t.id}" class="tab" aria-current={data.current?.trackId === t.id ? 'page' : undefined} data-sveltekit-noscroll>
				{t.name} <span class="n">{t.count}</span>
			</a>
		{/each}
	</nav>

	{#if data.current}
		<div class="card table-card">
			<table>
				<thead>
					<tr>
						<th scope="col" class="c-place">Plats</th>
						<th scope="col">Patrull</th>
						<th scope="col" class="num">Totalt</th>
						{#if data.comp.styleEnabled}<th scope="col" class="num hide-s">Poäng + stil</th>{/if}
						<th scope="col" class="num hide-s">Kontroller</th>
					</tr>
				</thead>
				<tbody>
					{#each data.current.rows as r (r.patrolId)}
						<tr data-testid="result-row" data-number={r.number} data-place={r.place}>
							<td class="c-place"><Medal place={r.place} /></td>
							<td>
								<a class="pname" href="{base}/patrol/{r.number}"><span class="pnr">{r.number}</span> {r.name}</a>
								<span class="muted small troop">{r.troop}</span>
								{#if r.tieNote}<span class="tie small">{r.tieNote}</span>{/if}
							</td>
							<td class="num total">{r.total}</td>
							{#if data.comp.styleEnabled}<td class="num hide-s">{r.scorePoints} + {r.stylePoints} stil</td>{/if}
							<td class="num hide-s">{r.stationsDone}/{r.stationsTotal}</td>
						</tr>
					{/each}
				</tbody>
			</table>
			{#if data.current.rows.length === 0}<p class="muted">Inga patruller i klassen.</p>{/if}
		</div>
		<p class="muted small rule">{RULE_TEXT}</p>
	{:else}
		<p class="muted">Inga klasser ännu.</p>
	{/if}
</div>

<style>
	.head {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 16px;
		align-items: flex-start;
	}
	.head form {
		margin: 0;
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
	.pub {
		margin: 0;
		display: flex;
		gap: 10px;
		align-items: center;
		flex-wrap: wrap;
	}
	.tabs {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}
	.tab {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-height: 44px;
		padding: 0 16px;
		border-radius: 999px;
		border: 1.5px solid var(--line-strong);
		background: var(--surface);
		color: var(--ink);
		font-weight: 800;
		text-decoration: none;
	}
	.tab[aria-current='page'] {
		background: var(--forest);
		border-color: var(--forest);
		color: #fff;
	}
	.tab .n {
		font-size: 12px;
		opacity: 0.75;
	}
	.table-card {
		padding: 6px 20px;
		overflow-x: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
	}
	th {
		text-align: left;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--ink-2);
		padding: 12px 8px;
		border-bottom: 1px solid var(--line);
	}
	td {
		padding: 12px 8px;
		border-bottom: 1px solid var(--line);
		vertical-align: middle;
	}
	tr:last-child td {
		border-bottom: 0;
	}
	.c-place {
		width: 64px;
	}
	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.total {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 24px;
	}
	.pname {
		font-weight: 800;
		color: var(--ink);
		text-decoration: none;
	}
	.pnr {
		color: var(--ink-2);
		margin-right: 4px;
	}
	.troop,
	.tie {
		display: block;
	}
	.tie {
		color: var(--accent-ink);
		font-weight: 700;
	}
	.small {
		font-size: 13px;
	}
	.rule {
		margin: 0;
		max-width: 720px;
	}
	@media (max-width: 600px) {
		.hide-s {
			display: none;
		}
	}
</style>

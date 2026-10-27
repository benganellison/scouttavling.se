<script lang="ts">
	import StatusPill from '#lib/ui/admin/StatusPill.svelte';

	let { data } = $props();
	const when = (d: Date | string | null) => (d ? new Date(d).toLocaleDateString('sv-SE', { dateStyle: 'medium', timeZone: 'Europe/Stockholm' }) : '–');
</script>

<svelte:head><title>Plattformsadmin · Scouttävling</title></svelte:head>

<h1 class="sa-h1">Sök</h1>
<form class="search" method="GET" role="search">
	<div class="field grow">
		<label for="q">Tävling, serie, adress, namn eller medlemsnummer</label>
		<input id="q" name="q" type="search" value={data.q} placeholder="t.ex. gokopen eller 3000001" />
	</div>
	<button class="btn btn-primary">Sök</button>
</form>

{#if data.overdue.length}
	<section aria-labelledby="h-overdue" class="stack" data-testid="overdue">
		<h2 id="h-overdue" class="h2">Personuppgifter kvar <span class="muted n">{data.overdue.length}</span></h2>
		<p class="muted small">Tävlingar som slutade för mer än {data.overdueDays} dagar sedan men fortfarande har namn, kontaktuppgifter eller patrullänkar. Påminn ägarna, eller ta bort uppgifterna åt dem från tävlingens sida här (avslutade tävlingar).</p>
		<ul class="cards">
			{#each data.overdue as c (c.slug)}
				<li>
					<a class="card hit" href="/site-admin/c/{c.slug}" data-testid="overdue-{c.slug}">
						<div class="top"><strong class="name">{c.name}</strong><StatusPill status={c.status as 'draft' | 'live' | 'closed'} /></div>
						<span class="muted small">Slutade {when(c.endDate)} · {c.patrols} {c.patrols === 1 ? 'patrull' : 'patruller'} med personuppgifter · ägare {c.owners ?? 'saknas'}</span>
					</a>
				</li>
			{/each}
		</ul>
	</section>
{/if}

<section aria-labelledby="h-comps" class="stack">
	<h2 id="h-comps" class="h2">{data.q ? 'Tävlingar' : 'Senaste tävlingarna'} <span class="muted n">{data.competitions.length}</span></h2>
	{#if data.competitions.length === 0}<p class="muted">Inga tävlingar matchar.</p>{/if}
	<ul class="cards">
		{#each data.competitions as c (c.id)}
			<li>
				<a class="card hit" href="/site-admin/c/{c.slug}" data-testid="hit-{c.slug}">
					<div class="top">
						<strong class="name">{c.name}</strong>
						<span class="pills">
							{#if c.suspended}<span class="pill pill-bad">Avstängd</span>{/if}
							{#if c.anonymised}<span class="pill">Personuppgifter borttagna</span>{/if}
							<StatusPill status={c.status as 'draft' | 'live' | 'closed'} />
						</span>
					</div>
					<span class="muted small">/{c.slug}{c.seriesName ? ` · serie ${c.seriesName}` : ''} · {when(c.startDate)}</span>
					<dl>
						<div><dt>Ägare</dt><dd>{c.owners.join(', ') || 'Ingen'}</dd></div>
						<div><dt>Arrangörer</dt><dd>{c.organisers.join(', ') || '–'}</dd></div>
						<div><dt>Patruller</dt><dd>{c.patrols}</dd></div>
						<div><dt>Senast aktiv</dt><dd>{when(c.lastActivity)}</dd></div>
					</dl>
				</a>
			</li>
		{/each}
	</ul>
</section>

{#if data.series.length}
	<section aria-labelledby="h-series" class="stack">
		<h2 id="h-series" class="h2">Serier <span class="muted n">{data.series.length}</span></h2>
		<ul class="rows card">
			{#each data.series as s (s.id)}
				<li><a href="/site-admin/s/{s.slug}"><strong>{s.name}</strong></a><span class="muted small">/t/{s.slug} · {s.editions} år</span></li>
			{/each}
		</ul>
	</section>
{/if}

{#if data.users.length}
	<section aria-labelledby="h-users" class="stack">
		<h2 id="h-users" class="h2">Användare <span class="muted n">{data.users.length}</span></h2>
		<ul class="rows card">
			{#each data.users as u (u.id)}
				<li>
					<a href="/site-admin/u/{u.memberNo}"><strong>{u.name}</strong></a>
					<span class="muted small">Medlemsnr {u.memberNo} · {u.competitions} tävlingar · senast inloggad {when(u.lastLogin)}</span>
					{#if u.suspended}<span class="pill pill-bad">Avstängd</span>{/if}
					{#if u.siteAdmin}<span class="pill">Plattformsadmin</span>{/if}
				</li>
			{/each}
		</ul>
	</section>
{/if}

<style>
	.search {
		display: flex;
		gap: 10px;
		align-items: flex-end;
		flex-wrap: wrap;
	}
	.grow {
		flex: 1 1 260px;
	}
	.h2 {
		font-size: 20px;
		font-weight: 800;
		margin: 0;
	}
	.n {
		font-weight: 600;
		font-size: 16px;
	}
	.cards {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 330px), 1fr));
		gap: 14px;
	}
	.hit {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 16px 18px;
		text-decoration: none;
		color: inherit;
		height: 100%;
	}
	.hit:hover {
		border-color: var(--brand);
	}
	.top {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		align-items: flex-start;
	}
	.name {
		font-size: 18px;
	}
	.pills {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
		justify-content: flex-end;
	}
	dl {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px 12px;
		margin: 6px 0 0;
	}
	dt {
		font-size: 12px;
		color: var(--ink-3);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.small {
		font-size: 13px;
	}
	.rows {
		list-style: none;
		margin: 0;
		padding: 4px 18px;
	}
	.rows li {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 12px;
		align-items: center;
		padding: 12px 0;
		border-top: 1px solid var(--line);
	}
	.rows li:first-child {
		border-top: 0;
	}
</style>

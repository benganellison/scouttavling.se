<script lang="ts">
	import { enhance } from '$app/forms';
	import { LiveStream } from '#lib/ui/live/liveStore.svelte.ts';

	let { data, form } = $props();

	new LiveStream(() => ({ url: `/api/v1/live/${data.comp.slug}/events`, depends: `live:${data.comp.slug}` }));

	const ORIGIN = { device: 'Okänd enhet', admin: 'Ledningen', paper: 'Papper' } as Record<string, string>;
	type S = (typeof data.conflicts)[number]['existing'];
	const val = (s: S) => (s.state === 'void' ? 'Ångrad' : s.points === null ? '–' : s.stylePoints ? `${s.points} + ${s.stylePoints}` : `${s.points}`);
	const src = (s: S) => [s.device ?? (s.origin ? ORIGIN[s.origin] : null), s.reason].filter(Boolean).join(' · ');
</script>

<svelte:head><title>Konflikter · {data.comp.name}</title></svelte:head>

<div class="page stack">
	<header class="stack tight">
		<h1>Konflikter</h1>
		<p class="muted">
			När två rapporter för samma patrull och kontroll skiljer sig åt skriver vi aldrig över tyst. Välj vilken poäng som gäller.
		</p>
	</header>

	{#if form?.message}<p class="card msg" role="status">{form.message}</p>{/if}

	{#if data.conflicts.length === 0}
		<div class="card empty">
			<h2>Inga öppna konflikter</h2>
			<p class="muted">Alla rapporter stämmer överens.</p>
		</div>
	{:else}
		<ul class="list">
			{#each data.conflicts as c (c.id)}
				<li class="card conflict" data-testid="conflict">
					<div class="top">
						<div class="stack tight">
							<strong class="title"><a href="/admin/{data.comp.slug}/patrol/{c.patrolNumber}">{c.patrol}</a> · {c.where}</strong>
							<span class="muted small">{c.time}{c.kind === 'quarantine' ? ' · I karantän (spärrad enhet)' : ''}</span>
						</div>
						{#if c.kind === 'quarantine'}<span class="pill pill-bad">Karantän</span>{:else}<span class="pill pill-warn">Konflikt</span>{/if}
					</div>
					<div class="vs">
						<div class="side">
							<span class="label">Befintlig</span>
							<span class="v">{val(c.existing)}</span>
							<span class="muted small">{src(c.existing)}</span>
						</div>
						<span class="arrow" aria-hidden="true">→</span>
						<div class="side new">
							<span class="label">Ny rapport</span>
							<span class="v">{val(c.incoming)}</span>
							<span class="muted small">{src(c.incoming)}</span>
						</div>
					</div>
					<div class="row">
						<form method="POST" action="?/keep" use:enhance>
							<input type="hidden" name="id" value={c.id} />
							<button class="btn">Behåll</button>
						</form>
						<form method="POST" action="?/useNew" use:enhance>
							<input type="hidden" name="id" value={c.id} />
							<button class="btn btn-accent">Använd ny</button>
						</form>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.page {
		max-width: 900px;
	}
	.tight {
		gap: 4px;
	}
	h1 {
		font-size: 34px;
	}
	h2 {
		font-size: 20px;
	}
	.small {
		font-size: 13px;
	}
	.msg {
		margin: 0;
		font-weight: 700;
	}
	.empty p {
		margin: 6px 0 0;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.conflict {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.top {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		align-items: flex-start;
	}
	.title a {
		color: var(--ink);
	}
	.vs {
		display: flex;
		align-items: stretch;
		gap: 12px;
		flex-wrap: wrap;
	}
	.side {
		flex: 1 1 180px;
		display: flex;
		flex-direction: column;
		gap: 2px;
		background: var(--sage-tint);
		border-radius: var(--r-md);
		padding: 12px 14px;
	}
	.side.new {
		background: var(--accent-tint);
	}
	.v {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 30px;
	}
	.arrow {
		align-self: center;
		font-size: 22px;
		color: var(--ink-3);
	}
	form {
		margin: 0;
	}
</style>

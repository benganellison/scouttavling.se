<script lang="ts">
	import '#lib/ui/patrols/prep.css';
	import PatrolForm from '#lib/ui/patrols/PatrolForm.svelte';
	import type { PatrolFormData } from '#lib/ui/patrols/labels.ts';

	let { data, form } = $props();

	let confirmOpen = $state(false);
	const initial = $derived<PatrolFormData>((form?.values as PatrolFormData | undefined) ?? data.patrol);
	const list = $derived(`/admin/${data.competition.slug}/patrols`);
</script>

<svelte:head><title>{data.patrol.number} {data.patrol.name} · {data.competition.name}</title></svelte:head>

<div class="prep narrow">
	<header class="prep-head">
		<div>
			<a class="back" href={list}>← Patruller</a>
			<h1><span class="nr">{data.patrol.number}</span> {data.patrol.name}</h1>
		</div>
	</header>

	<PatrolForm {initial} tracks={data.tracks} errors={form?.errors ?? {}} submitLabel="Spara ändringar" cancelHref={list} />

	<section class="card danger stack" aria-labelledby="del">
		<h2 id="del">Ta bort patrullen</h2>
		<p class="muted">
			Patrullen, dess medlemmar{data.scoreCount ? ` och ${data.scoreCount} registrerade poäng` : ''} tas bort. Det går inte att ångra. Har patrullen lämnat återbud?
			Ändra hellre status till Återbud.
		</p>
		{#if !confirmOpen}
			<div><button type="button" class="btn" onclick={() => (confirmOpen = true)}>Ta bort patrull…</button></div>
		{:else}
			<form method="POST" action="?/delete" class="row">
				<button class="btn btn-danger">Ja, ta bort {data.patrol.name}</button>
				<!-- svelte-ignore a11y_autofocus -->
				<button type="button" class="btn btn-ghost" autofocus onclick={() => (confirmOpen = false)}>Avbryt</button>
			</form>
		{/if}
	</section>
</div>

<style>
	.narrow {
		max-width: 960px;
	}
	.back {
		font-weight: 700;
		text-decoration: none;
		font-size: 14px;
	}
	.nr {
		background: var(--ink);
		color: #fff;
		border-radius: 12px;
		padding: 2px 10px;
	}
	.danger h2 {
		font-size: 19px;
	}
	.danger p {
		margin: 0;
	}
	.btn-danger {
		background: var(--danger);
		border-color: var(--danger);
		color: #fff;
	}
	.btn-danger:hover {
		color: #fff;
		background: #8f1c13;
	}
</style>

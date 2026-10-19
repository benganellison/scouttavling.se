<script lang="ts">
	import '#lib/ui/patrols/print.css';
	import PrintBar from '#lib/ui/patrols/PrintBar.svelte';

	let { data } = $props();
</script>

<svelte:head><title>Startlistor · {data.competition.name}</title></svelte:head>

<div class="print-root">
	<PrintBar back="/admin/{data.competition.slug}/print" title="Startlistor" meta="{data.lists.length} sidor" />
	{#if data.unassigned.length}
		<div class="print-empty no-print">
			<strong>{data.unassigned.length} patruller saknar startkontroll.</strong>
			<a href="/admin/{data.competition.slug}/distribution">Fördela startkontroller</a>
		</div>
	{/if}
	<div class="sheets">
		{#each data.lists as l (l.id)}
			<section class="sheet sl" aria-label="Startlista {l.code}">
				<header>
					<span class="eyebrow">Startlista · {data.competition.name}</span>
					<h1><span class="code">{l.code}</span> {l.name}</h1>
					<span>{l.patrols.length} patruller startar här</span>
				</header>
				<table>
					<thead><tr><th scope="col">Nr</th><th scope="col">Patrull</th><th scope="col">Klass</th><th scope="col">Kår</th><th scope="col">Kontakt</th><th scope="col">Startat</th></tr></thead>
					<tbody>
						{#each l.patrols as p (p.nr)}
							<tr><td class="nr">{p.nr}</td><td class="pn">{p.name}</td><td>{p.track}</td><td>{p.troop}</td><td class="ct">{p.contact}</td><td><span class="box"></span></td></tr>
						{/each}
					</tbody>
				</table>
			</section>
		{/each}
	</div>
</div>

<style>
	.sl {
		gap: 14px;
	}
	header {
		border-bottom: 3px solid #0f1f17;
		padding-bottom: 10px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.eyebrow {
		font-size: 10pt;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	h1 {
		font-size: 30pt;
	}
	.code {
		background: #0f1f17;
		color: #fff;
		border-radius: 10px;
		padding: 0 10px;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12pt;
	}
	th {
		text-align: left;
		border-bottom: 2px solid #0f1f17;
		padding: 6px 4px;
	}
	td {
		border-bottom: 1px solid #8a978f;
		padding: 8px 4px;
	}
	.nr,
	.pn {
		font-weight: 800;
	}
	.ct {
		font-size: 11pt;
	}
	.box {
		display: inline-block;
		width: 18px;
		height: 18px;
		border: 1.5px solid #0f1f17;
		border-radius: 4px;
	}
</style>

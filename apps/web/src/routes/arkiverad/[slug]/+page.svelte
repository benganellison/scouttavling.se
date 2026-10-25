<script lang="ts">
	import PublicShell from '#lib/ui/public/PublicShell.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>Arkiverad · {data.comp.name}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<PublicShell title={data.comp.name} eyebrow="Arkiverad" branding={data.branding}>
	<section class="card box" data-testid="archived">
		<h2>Tävlingen är avslutad och arkiverad</h2>
		<p>Länken du följde gällde en patrull i {data.comp.name}. När tävlingen arkiverades togs anmälningar, kontaktuppgifter och patrullernas egna länkar bort, så den här sidan visar inte längre någon patrull.</p>
		<div class="links">
			{#if data.comp.publicResults}<a class="btn btn-primary" href="/r/{data.comp.slug}">Se resultaten</a>{/if}
			{#if data.series}<a class="btn" href="/t/{data.series.slug}">Mer om {data.series.name}</a>{/if}
		</div>
	</section>
</PublicShell>

<style>
	.box {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 22px;
	}
	h2 {
		font-size: 22px;
		margin: 0;
	}
	p {
		margin: 0;
		line-height: 1.5;
	}
	.links {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
	}
</style>

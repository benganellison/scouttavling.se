<script lang="ts">
	import Flag from '#lib/ui/Flag.svelte';
	import Ceremony from '#lib/ui/live/Ceremony.svelte';

	let { data } = $props();
</script>

<svelte:head><title>Prisutdelning · {data.comp.name}</title></svelte:head>

{#if data.ceremony}
	{#key data.ceremony.classId + data.ceremony.takenAt}
		<Ceremony
			compName={data.comp.name}
			className={data.ceremony.className}
			rows={data.ceremony.rows}
			takenAt={data.ceremony.takenAt}
			refreshHref="?class={data.ceremony.classId}&fresh=1"
			backHref="/r/{data.comp.slug}/ceremony"
		/>
	{/key}
{:else}
	<div class="pick">
		<div class="inner stack">
			<div class="row brand"><Flag size={36} onDark /> <span>{data.comp.name}</span></div>
			<h1>Prisutdelning</h1>
			<p>Välj klass. Resultatet fryses när prisutdelningen startar, så sena ändringar påverkar inte avslöjandet.</p>
			<ul>
				{#each data.classes as c (c.id)}
					<li><a class="btn cls" href="?class={c.id}">{c.name} <span>{c.count} patruller</span></a></li>
				{/each}
			</ul>
			<a class="back" href="/admin/{data.comp.slug}/results">← Till resultaten</a>
		</div>
	</div>
{/if}

<style>
	.pick {
		min-height: 100dvh;
		background: var(--forest-dark);
		color: #fff;
		display: grid;
		place-items: center;
		padding: 32px 16px;
	}
	.inner {
		width: min(640px, 100%);
	}
	.brand {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 22px;
	}
	h1 {
		font-size: 56px;
	}
	p {
		color: var(--on-forest);
		font-size: 18px;
		margin: 0;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.cls {
		width: 100%;
		justify-content: space-between;
		min-height: 64px;
		font-size: 20px;
	}
	.cls span {
		font-size: 14px;
		color: var(--ink-2);
	}
	.back {
		color: var(--on-forest);
		font-weight: 700;
	}
</style>

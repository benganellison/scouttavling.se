<script lang="ts">
	let { data, form } = $props();
</script>

<svelte:head><title>Pappersinmatning · {data.comp.name}</title></svelte:head>

<div class="stack wrap">
	<a href="/admin/{data.comp.slug}/live" class="back">← Ledningscentralen</a>
	<h1>Registrera papperslappar</h1>
	<p class="muted">
		Under reservläge skriver funktionärerna poängen på papper. Snabbinmatning per kontroll kommer i en senare version; tills dess matar du in poängen patrull
		för patrull.
	</p>
	<form method="POST" action="?/go" class="card row">
		<div class="field grow">
			<label for="nr">Patrullnummer</label>
			<input id="nr" name="nr" type="number" inputmode="numeric" min="1" required />
		</div>
		<button class="btn btn-accent">Öppna patrull</button>
	</form>
	{#if form?.message}<p class="error-text">{form.message}</p>{/if}
</div>

<style>
	.wrap {
		max-width: 640px;
	}
	.grow {
		flex: 1 1 200px;
	}
	.row {
		align-items: flex-end;
	}
	.back {
		font-weight: 700;
		text-decoration: none;
	}
	h1 {
		font-size: 32px;
	}
</style>

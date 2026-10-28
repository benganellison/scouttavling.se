<script lang="ts">
	import ScouternaSymbol from '#lib/ui/brand/ScouternaSymbol.svelte';

	let { userName, siteAdmin = false }: { userName: string; siteAdmin?: boolean } = $props();
</script>

<header class="topbar">
	<a class="brand" href="/admin"><ScouternaSymbol size={34} /> <span>Scouttävling</span></a>
	<div class="right">
		{#if siteAdmin}<a class="btn btn-ghost" href="/site-admin">Plattformsadmin</a>{/if}
		<span class="who">{userName}</span>
		<form method="POST" action="/auth/logout">
			<button class="btn btn-ghost" type="submit">Logga ut</button>
		</form>
	</div>
</header>

<style>
	.topbar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 16px;
		flex-wrap: wrap;
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 12px;
		text-decoration: none;
		color: var(--ink);
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 22px;
	}
	.right {
		flex-wrap: wrap;
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.who {
		font-weight: 700;
		color: var(--ink-2);
	}
</style>

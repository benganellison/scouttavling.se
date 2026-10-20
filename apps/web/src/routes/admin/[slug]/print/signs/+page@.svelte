<script lang="ts">
	import '#lib/ui/patrols/print.css';
	import { enhance } from '$app/forms';
	import PrintBar from '#lib/ui/patrols/PrintBar.svelte';

	let { data } = $props();
</script>

<svelte:head><title>Kontrollskyltar · {data.competition.name}</title></svelte:head>

<div class="print-root">
	<PrintBar back="/admin/{data.competition.slug}/print" title="Kontrollskyltar" meta="{data.signs.length} sidor · A4 stående" />
	{#if data.missing}
		<form method="POST" action="?/createMissing" class="print-empty no-print stack" use:enhance>
			<strong>{data.missing} kontroller saknar QR-kod för funktionärer.</strong>
			<span class="muted">Skapa inbjudningar för dem så kommer QR-koden med på skylten.</span>
			<div><button class="btn btn-accent">Skapa koder för {data.missing} kontroller</button></div>
		</form>
	{/if}
	<div class="sheets">
		{#each data.signs as s (s.id)}
			<section class="sheet sign" aria-label="Skylt {s.code} {s.name}">
				<header>
					<svg width="96" height="96" viewBox="0 0 32 32" aria-hidden="true"><rect x="2" y="2" width="28" height="28" rx="2" fill="#fff" stroke="#0F1F17" stroke-width="1.2"></rect><polygon points="3,29 29,3 29,29" fill="#F26B2A"></polygon></svg>
					<span class="comp">{data.competition.name}</span>
				</header>
				<div class="code" class:long={s.code.length > 2}>{s.code}</div>
				<h1 class="name">{s.name}</h1>
				<footer>
					{#if s.qr}
						<div class="qr">{@html s.qr}</div>
					{:else}
						<div class="qr none">Ingen QR-kod ännu</div>
					{/if}
					<p><strong>Funktionär?</strong> Skanna för att öppna kontrollen i mobilen. Inget konto behövs.</p>
				</footer>
			</section>
		{/each}
	</div>
</div>

<style>
	.sign {
		padding: 18mm;
		gap: 8mm;
	}
	.sign header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
	}
	.comp {
		font-weight: 700;
		font-size: 14pt;
	}
	.code {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 260pt;
		line-height: 0.85;
		letter-spacing: -0.05em;
	}
	.code.long {
		font-size: 180pt;
	}
	.name {
		font-size: 44pt;
		line-height: 1;
	}
	.sign footer {
		margin-top: auto;
		display: flex;
		gap: 10mm;
		align-items: center;
		border-top: 3px solid #0f1f17;
		padding-top: 8mm;
	}
	.qr {
		width: 62mm;
		height: 62mm;
		flex: none;
	}
	.qr :global(svg) {
		width: 100%;
		height: 100%;
		display: block;
	}
	.qr.none {
		border: 2px dashed #8a978f;
		display: flex;
		align-items: center;
		justify-content: center;
		text-align: center;
		font-size: 12pt;
	}
	.sign footer p {
		margin: 0;
		font-size: 20pt;
		line-height: 1.3;
	}
	.stack {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
</style>

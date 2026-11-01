<script lang="ts">
	import ScouternaLogo from './ScouternaLogo.svelte';
	import type { BrandImage } from '#lib/brand/branding.ts';

	/**
	 * "Arrangeras av <organiser> · Scouterna": the organiser's logo next to Scouterna's,
	 * Scouterna as a clear sender (profile: kårer and events always show Scouterna).
	 */
	let {
		organiserName = null,
		organiserLogo = null,
		onDark = false,
		tagline = true
	}: { organiserName?: string | null; organiserLogo?: BrandImage | null; onDark?: boolean; tagline?: boolean } = $props();
</script>

<footer class="sender" class:dark={onDark} aria-label="Avsändare">
	<div class="org">
		{#if organiserLogo}
			<img class="org-logo" src={organiserLogo.url} alt={organiserLogo.alt} width={organiserLogo.width} height={organiserLogo.height} />
		{/if}
		<p class="by">
			{#if organiserName}Arrangeras av <strong>{organiserName}</strong> · Scouterna{:else}Arrangeras inom Scouterna{/if}
		</p>
	</div>
	<ScouternaLogo {onDark} {tagline} />
</footer>

<style>
	.sender {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 8px 24px;
		padding: 16px 0 8px;
		border-top: 1px solid var(--line);
		margin-top: 32px;
		color: var(--ink-2);
	}
	.sender.dark {
		border-top-color: rgb(255 255 255 / 0.25);
		color: var(--on-brand);
	}
	.org {
		display: flex;
		align-items: center;
		gap: 14px;
		min-width: 0;
	}
	.org-logo {
		max-height: 56px;
		max-width: 140px;
		width: auto;
		height: auto;
		object-fit: contain;
	}
	.by {
		margin: 0;
		font-size: 14px;
	}
	.dark strong {
		color: #fff;
	}
	@media (max-width: 420px) {
		.sender {
			justify-content: center;
			text-align: center;
		}
		.org {
			flex-direction: column;
		}
	}
</style>

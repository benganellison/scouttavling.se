<script lang="ts">
	import type { LiveStatus } from './liveStore.svelte.ts';

	let { status, label = 'Live' }: { status: LiveStatus; label?: string } = $props();
</script>

<span class="live {status}" data-testid="live-status" data-status={status}>
	<span class="dot" aria-hidden="true"></span>
	{status === 'open' ? label : status === 'connecting' ? 'Ansluter…' : 'Återansluter…'}
</span>

<style>
	.live {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		font-weight: 800;
		padding: 4px 10px;
		border-radius: 999px;
		background: var(--sage-tint);
		color: var(--ink-2);
	}
	.live.open {
		background: var(--moss-tint);
		color: var(--forest-2);
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--ink-3);
	}
	.open .dot {
		background: var(--moss);
		animation: pulse 2s infinite;
	}
	@keyframes pulse {
		50% {
			opacity: 0.35;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.open .dot {
			animation: none;
		}
	}
</style>

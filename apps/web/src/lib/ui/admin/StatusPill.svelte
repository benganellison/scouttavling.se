<script lang="ts">
	import { STATUS_LABEL, type CompStatus } from './format.ts';

	let { status }: { status: CompStatus } = $props();
</script>

<span class="status {status}">
	{#if status === 'live'}<span class="dot" aria-hidden="true"></span>{/if}
	{STATUS_LABEL[status]}
</span>

<style>
	.status {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		font-weight: 800;
		padding: 4px 10px;
		border-radius: 999px;
		white-space: nowrap;
	}
	.draft {
		background: var(--surface);
		color: var(--ink);
		box-shadow: inset 0 0 0 1.5px var(--ink-3);
	}
	.live {
		background: var(--flag);
		color: var(--ink);
	}
	.closed {
		background: var(--forest);
		color: #fff;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--ink);
	}
</style>

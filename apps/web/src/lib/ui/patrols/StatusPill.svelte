<script lang="ts">
	import { STATUS_LABEL, type PatrolStatus } from './labels.ts';

	let { status }: { status: PatrolStatus } = $props();
</script>

<span class="st st-{status}">{STATUS_LABEL[status]}</span>

<style>
	.st {
		display: inline-flex;
		align-items: center;
		font-size: 12px;
		font-weight: 800;
		padding: 3px 10px;
		border-radius: 999px;
		white-space: nowrap;
		border: 1.5px solid transparent;
	}
	.st-registered {
		background: var(--surface);
		border-color: var(--ink);
		color: var(--ink);
	}
	.st-active {
		background: var(--flag);
		color: var(--ink);
	}
	.st-finished {
		background: var(--forest);
		color: #fff;
	}
	.st-resigned {
		background: #5b6660;
		color: #fff;
	}
</style>

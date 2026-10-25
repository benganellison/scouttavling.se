<script lang="ts">
	import { STATUS_LABEL, type PatrolStatus } from './labels.ts';

	/** `detail` follows the label, e.g. "klar för dagen 18:42" → "I läger · klar för dagen 18:42". */
	let { status, detail = null }: { status: PatrolStatus; detail?: string | null } = $props();
</script>

<span class="st st-{status}" data-status={status}>{detail ? `${STATUS_LABEL[status]} · ${detail}` : STATUS_LABEL[status]}</span>

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
		background: var(--orange);
		color: var(--ink);
	}
	/* I läger: light neutral grey with a Scoutblå outline, clearly lighter than På banan and I mål. */
	.st-camp {
		background: var(--st-camp);
		border-color: var(--brand);
		color: var(--brand);
	}
	.st-finished {
		background: var(--brand);
		color: #fff;
	}
	.st-resigned {
		background: var(--st-resigned);
		color: #fff;
	}
</style>

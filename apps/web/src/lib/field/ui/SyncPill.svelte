<script lang="ts">
	import Icon from './Icon.svelte';
	import { hhmm, useField } from '../app.svelte.ts';
	const app = useField();
	const pill = $derived(
		app.conflictCount > 0
			? { cls: 'bad', icon: 'alert' as const, text: 'Konflikt' }
			: app.rejectedCount > 0
				? { cls: 'bad', icon: 'alert' as const, text: app.rejectedCount === 1 ? 'Nekad' : `${app.rejectedCount} nekade` }
			: app.pendingCount > 0
				? { cls: 'warn', icon: 'clock' as const, text: !app.online || app.lastFailedAt ? `${app.pendingCount} väntar på täckning` : `${app.pendingCount} väntar` }
				: app.lastSyncAt
					? { cls: 'ok', icon: 'check' as const, text: `Synkad ${hhmm(app.lastSyncAt)}` }
					: !app.online
						? { cls: 'warn', icon: 'offline' as const, text: 'Ingen täckning' }
						: { cls: 'ok', icon: 'clock' as const, text: 'Synkar…' }
	);
</script>

<span class="sync {pill.cls}" role="status" data-testid="sync-pill"><Icon name={pill.icon} size={14} stroke={2.8} />{pill.text}</span>

<style>
	.sync {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		font-weight: 800;
		padding: 6px 11px;
		border-radius: 999px;
		white-space: nowrap;
	}
	.ok {
		background: var(--ok-tint);
		color: var(--brand-2);
	}
	.warn {
		background: var(--warn-tint);
		color: var(--warn-ink);
	}
	.bad {
		background: #fde2de;
		color: var(--danger);
	}
</style>

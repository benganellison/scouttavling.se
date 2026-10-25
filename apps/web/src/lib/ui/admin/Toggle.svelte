<script lang="ts">
	/**
	 * A labelled on/off switch. It is a native checkbox (role="switch") so it
	 * posts with forms and works with Space/keyboard without JS.
	 */
	let {
		name,
		label,
		description = '',
		checked = $bindable(false),
		value = 'on',
		disabled = false,
		compact = false,
		id: idProp
	}: {
		name?: string;
		label: string;
		description?: string;
		checked?: boolean;
		value?: string;
		disabled?: boolean;
		compact?: boolean;
		id?: string;
	} = $props();
	const uid = $props.id();
	const id = $derived(idProp ?? `t-${uid}`);
</script>

<div class="toggle" class:compact>
	<label for={id} class="text">
		<span class="t">{label}</span>
		{#if description}<span class="d">{description}</span>{/if}
	</label>
	<input {id} type="checkbox" role="switch" {name} {value} bind:checked {disabled} />
</div>

<style>
	.toggle {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 18px;
		padding: 12px 0;
	}
	.compact {
		padding: 4px 0;
	}
	.text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		cursor: pointer;
	}
	.t {
		font-weight: 800;
		font-size: 15px;
	}
	.compact .t {
		font-size: 14px;
	}
	.d {
		font-size: 14px;
		color: var(--ink-2);
	}
	input {
		appearance: none;
		flex: none;
		width: 56px;
		height: 32px;
		border-radius: 999px;
		background: var(--line-strong);
		position: relative;
		cursor: pointer;
		margin: 0;
		transition: background 0.15s;
	}
	input::after {
		content: '';
		position: absolute;
		top: 3px;
		left: 3px;
		width: 26px;
		height: 26px;
		border-radius: 50%;
		background: #fff;
		transition: transform 0.15s;
	}
	input:checked {
		background: var(--brand);
	}
	input:checked::after {
		transform: translateX(24px);
	}
	input:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>

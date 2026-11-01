<script lang="ts">
	/**
	 * What the volunteer will see for a station's first scorable item: the field app's own input
	 * (ItemInput), shrunk and inert, so the preview can never drift from the real screen.
	 */
	import type { ScoreItemDef } from '@scouttavling/domain';
	import ItemInput from '#lib/field/ui/ItemInput.svelte';

	let {
		code,
		name,
		item,
		checkpoint,
		count,
		index = 1
	}: { code: string; name: string; item: ScoreItemDef | null; checkpoint: boolean; count: number; index?: number } = $props();
</script>

<div class="wrap">
	<span class="cap">Så ser funktionären det</span>
	<div class="phone" aria-hidden="true">
		<span class="title">{code} · {name || 'Namnlös'}</span>
		{#if item}
			<span class="sub">{item.name}{count > 1 ? ` · del ${index} av ${count}` : ''}</span>
			<div class="screen" inert>
				<ItemInput {item} heading={count > 1 ? item.name : 'Poäng'} />
			</div>
			<span class="cta">Spara</span>
		{:else if checkpoint}
			<span class="msg">Patrullen checkas in med ett tryck. Inga poäng.</span>
			<span class="cta">Checka in</span>
		{:else}
			<span class="msg">Patrullen registreras automatiskt när funktionären skannar QR-koden.</span>
			<span class="cta">Skanna</span>
		{/if}
	</div>
</div>

<style>
	.wrap {
		display: flex;
		flex-direction: column;
		gap: 10px;
		align-items: center;
	}
	.cap {
		font-size: 12px;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-2);
	}
	.phone {
		width: 230px;
		height: 420px;
		border-radius: 30px;
		border: 8px solid var(--ink);
		background: var(--ground);
		padding: 16px 12px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		overflow: hidden;
	}
	.title {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 15px;
		line-height: 1.2;
	}
	.sub {
		font-size: 11px;
		color: var(--ink-2);
		margin-top: -4px;
	}
	/* The real 360 px screen at 55 %. */
	.screen {
		width: 360px;
		zoom: 0.55;
		flex: none;
	}
	.msg {
		font-size: 13px;
		color: var(--ink-2);
		line-height: 1.4;
	}
	.cta {
		margin-top: auto;
		min-height: 38px;
		border-radius: 10px;
		background: var(--cta);
		color: #fff;
		font-weight: 800;
		font-size: 12px;
		display: flex;
		align-items: center;
		justify-content: center;
		flex: none;
	}
</style>

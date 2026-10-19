<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from './Icon.svelte';
	import { startScanner, type ScannerHandle } from '../scanner.ts';

	let {
		onCode,
		active = true,
		compact = false,
		hint = 'Rikta mot QR-koden på patrullpasset',
		onUnavailable
	}: { onCode: (text: string) => void; active?: boolean; compact?: boolean; hint?: string; onUnavailable?: (msg: string) => void } = $props();

	let video = $state<HTMLVideoElement>();
	let handle = $state<ScannerHandle | null>(null);
	let problem = $state<string | null>(null);
	let torchOn = $state(false);
	let starting = $state(false);

	async function start() {
		if (!video || handle || starting) return;
		starting = true;
		problem = null;
		try {
			handle = await startScanner(video, (t) => onCode(t));
		} catch (e) {
			const name = e instanceof Error ? e.name : '';
			problem = name === 'NotAllowedError' ? 'Kameran är blockerad. Tillåt kameran i webbläsaren eller använd nummer.' : 'Kameran är inte tillgänglig. Använd nummer i stället.';
			onUnavailable?.(problem);
		} finally {
			starting = false;
		}
	}

	function stop() {
		handle?.stop();
		handle = null;
		torchOn = false;
	}

	$effect(() => {
		if (active) void start();
		else stop();
	});

	onMount(() => stop);

	async function toggleTorch() {
		if (!handle?.torch.supported) return;
		torchOn = !torchOn;
		await handle.torch.set(torchOn).catch(() => (torchOn = false));
	}
</script>

<div class="cam" class:compact>
	<div class="finder">
		<!-- svelte-ignore a11y_media_has_caption -->
		<video bind:this={video} playsinline muted></video>
		<span class="c tl"></span><span class="c tr"></span><span class="c bl"></span><span class="c br"></span>
		{#if problem}
			<div class="problem">
				<Icon name="alert" size={30} />
				<p>{problem}</p>
				<button type="button" class="retry" onclick={start}>Försök igen</button>
			</div>
		{:else if !handle}
			<div class="problem"><Icon name="scan" size={40} /><p>Startar kameran…</p></div>
		{/if}
	</div>
	<p class="hint">{hint}</p>
	{#if handle?.torch.supported}
		<button type="button" class="torch" aria-pressed={torchOn} aria-label="Ficklampa" onclick={toggleTorch}><Icon name="torch" /></button>
	{/if}
</div>

<style>
	.cam {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
	}
	.finder {
		position: relative;
		width: min(78vw, 300px);
		aspect-ratio: 1;
		border-radius: 20px;
		overflow: hidden;
		background: #14211a;
	}
	.compact .finder {
		width: 100%;
		aspect-ratio: 16 / 10;
	}
	video {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.c {
		position: absolute;
		width: 48px;
		height: 48px;
		border: 0 solid var(--flag);
	}
	.tl {
		left: 0;
		top: 0;
		border-left-width: 5px;
		border-top-width: 5px;
		border-top-left-radius: 20px;
	}
	.tr {
		right: 0;
		top: 0;
		border-right-width: 5px;
		border-top-width: 5px;
		border-top-right-radius: 20px;
	}
	.bl {
		left: 0;
		bottom: 0;
		border-left-width: 5px;
		border-bottom-width: 5px;
		border-bottom-left-radius: 20px;
	}
	.br {
		right: 0;
		bottom: 0;
		border-right-width: 5px;
		border-bottom-width: 5px;
		border-bottom-right-radius: 20px;
	}
	.problem {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 24px;
		text-align: center;
		color: var(--on-forest);
		font-weight: 700;
	}
	.problem p {
		margin: 0;
	}
	.retry {
		min-height: 48px;
		padding: 0 18px;
		border-radius: 12px;
		border: 1.5px solid var(--on-forest-2);
		background: transparent;
		color: #fff;
		font-weight: 800;
	}
	.hint {
		margin: 0;
		color: var(--on-forest);
		font-weight: 600;
		font-size: 16px;
		text-align: center;
	}
	.torch {
		position: absolute;
		top: 10px;
		right: 10px;
		width: 52px;
		height: 52px;
		border-radius: 50%;
		border: 0;
		background: rgba(15, 31, 23, 0.7);
		color: #fff;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.torch[aria-pressed='true'] {
		background: var(--flag);
		color: var(--ink);
	}
</style>

<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { useField, hhmm, type PackPatrol } from '#lib/field/app.svelte.ts';
	import Icon from '#lib/field/ui/Icon.svelte';
	import CameraView from '#lib/field/ui/CameraView.svelte';

	const app = useField();
	const base = `/f/${app.slug}`;

	let mode = $state<'cam' | 'pad'>('cam');
	let typed = $state('');
	let found = $state<PackPatrol | null>(null);
	let scanError = $state<string | null>(null);

	// Deep link from the /p/<code> landing page or "Väntas snart".
	$effect(() => {
		const nr = Number(page.url.searchParams.get('nr'));
		if (nr && !found) {
			const p = app.patrolByNumber.get(nr);
			if (p) found = p;
		}
	});

	const matches = $derived.by(() => {
		if (!typed) return [];
		const list = app.patrols.filter((p) => String(p.number).startsWith(typed));
		return list.sort((a, b) => Number(app.eligible(b)) - Number(app.eligible(a)) || a.number - b.number).slice(0, 4);
	});

	const result = $derived(found ? app.stationResult(found.id) : null);
	const styleOn = $derived(app.items.some((i) => i.styleEnabled));
	const checkin = $derived(app.items.length > 0 && app.items.every((i) => i.mode === 'CHECKIN'));

	async function onCode(text: string) {
		if (found) return;
		const r = await app.resolveCode(text);
		if (!r) return; // foreign QR: ignore
		if ('error' in r) {
			scanError = r.error;
			setTimeout(() => (scanError = null), 3500);
			return;
		}
		navigator.vibrate?.(60);
		found = r.patrol;
	}

	function press(k: string) {
		if (k === 'C') typed = '';
		else if (k === '⌫') typed = typed.slice(0, -1);
		else if (typed.length < 5) typed = (typed + k).replace(/^0+/, '');
	}

	const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'];
</script>

<svelte:window onkeydown={(e) => found && e.key === 'Escape' && (found = null)} />
<div class="screen">
	<header inert={!!found}>
		<h1 class="sr-only">Välj patrull</h1>
		<a class="round" href={base} aria-label="Stäng"><Icon name="close" /></a>
		<div class="seg" role="tablist" aria-label="Sätt att välja patrull">
			<button type="button" role="tab" aria-selected={mode === 'cam'} onclick={() => (mode = 'cam')}>Kamera</button>
			<button type="button" role="tab" aria-selected={mode === 'pad'} onclick={() => (mode = 'pad')}>Nummer</button>
		</div>
		<span class="round placeholder" aria-hidden="true"></span>
	</header>

	{#if mode === 'cam'}
		<div class="cam-area" inert={!!found}>
			<CameraView {onCode} active={mode === 'cam' && !found} />
			{#if scanError}<p class="scan-error" role="alert">{scanError}</p>{/if}
			<button type="button" class="to-pad" onclick={() => (mode = 'pad')}>Skriv numret i stället</button>
		</div>
	{:else}
		<div class="pad-area" inert={!!found}>
			<div class="display">
				<span class="lbl">Patrullnummer</span>
				<span class="typed" data-testid="typed">{typed}<span class="caret">_</span></span>
			</div>
			<ul class="matches" aria-live="polite">
				{#each matches as m (m.id)}
					<li>
						<button type="button" class="match" onclick={() => (found = m)}>
							<span class="mnr">{m.number}</span>
							<span class="mwho"><span class="mname">{m.name}</span><span class="msub">{m.track} · {m.troop}</span></span>
							<Icon name="chevron" />
						</button>
					</li>
				{:else}
					{#if typed}<li class="none">Ingen patrull med nummer {typed}</li>{/if}
				{/each}
			</ul>
			<div class="keys">
				{#each keys as k (k)}
					<button type="button" class="key" class:fn={k === 'C' || k === '⌫'} aria-label={k === 'C' ? 'Rensa' : k === '⌫' ? 'Radera' : k} onclick={() => press(k)}>
						{#if k === '⌫'}<Icon name="backspace" size={30} />{:else}{k}{/if}
					</button>
				{/each}
			</div>
		</div>
	{/if}

	{#if found}
		<div class="scrim" aria-hidden="true" onclick={() => (found = null)}></div>
		<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="found-name">
			<span class="grab" aria-hidden="true"></span>
			<div class="who">
				<span class="bignr">{found.number}</span>
				<div>
					<h2 id="found-name">{found.name}</h2>
					<span class="sub">{found.track} · {found.troop}</span>
				</div>
			</div>
			{#if !app.eligible(found)}
				<div class="warn"><Icon name="alert" /><span><strong>{found.track}</strong> går inte den här kontrollen enligt planen.</span></div>
			{/if}
			{#if app.patrolStatus(found) === 'resigned'}
				<div class="warn"><Icon name="alert" /><span>Patrullen är markerad som <strong>återbud</strong>.</span></div>
			{/if}
			{#if result}
				<div class="warn">
					<Icon name="alert" />
					<span><strong>Redan rapporterad här</strong> {hhmm(result.at)}{result.by ? ` av ${result.by}` : ''} — {checkin ? 'incheckad' : styleOn ? `${result.points} + ${result.style} p` : `${result.total} p`}. Vill du ändra?</span>
				</div>
			{/if}
			<!-- svelte-ignore a11y_autofocus -->
			<button type="button" class="btn-go" autofocus onclick={() => goto(`${base}/score/${found!.number}`)}>{result ? 'Ändra poäng' : 'Ja, sätt poäng'}</button>
			<button type="button" class="btn-wrong" onclick={() => ((found = null), (typed = ''))}>Fel patrull</button>
		</div>
	{/if}
</div>

<style>
	.screen {
		height: 100dvh;
		background: #0d1014;
		color: #fff;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		position: relative;
	}
	header {
		padding: 12px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	.round {
		width: 56px;
		height: 56px;
		border-radius: 50%;
		background: #1f252c;
		color: #fff;
		display: flex;
		align-items: center;
		justify-content: center;
		flex: none;
	}
	.placeholder {
		background: transparent;
	}
	.seg {
		display: flex;
		background: #1f252c;
		border-radius: 999px;
		padding: 4px;
	}
	.seg button {
		min-height: 48px;
		padding: 0 22px;
		border-radius: 999px;
		border: 0;
		background: transparent;
		color: var(--on-brand);
		font-weight: 800;
		font-size: 16px;
	}
	.seg button[aria-selected='true'] {
		background: #fff;
		color: var(--ink);
	}
	.cam-area {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 18px;
		padding: 0 20px 40px;
	}
	.scan-error {
		margin: 0;
		background: var(--danger);
		color: #fff;
		font-weight: 800;
		padding: 10px 16px;
		border-radius: 12px;
	}
	.to-pad {
		min-height: 56px;
		padding: 0 22px;
		border-radius: 16px;
		border: 1.5px solid var(--line-on-brand);
		background: transparent;
		color: #fff;
		font-weight: 800;
		font-size: 17px;
	}
	.pad-area {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		padding: 0 16px 16px;
		gap: 10px;
		/* Landscape or large system text: scroll rather than cut off the bottom keys. */
		overflow-y: auto;
	}
	.display {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
	}
	.lbl {
		font-size: 15px;
		color: var(--on-brand);
		font-weight: 700;
	}
	.typed {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 64px;
		line-height: 1;
		letter-spacing: 0.04em;
		min-height: 64px;
	}
	.caret {
		color: var(--orange);
	}
	.matches {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}
	.match {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 60px;
		padding: 8px 14px;
		border: 0;
		border-radius: 14px;
		background: #1f252c;
		color: #fff;
		text-align: left;
	}
	.mnr {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 22px;
		min-width: 52px;
	}
	.mwho {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
	}
	.mname {
		font-weight: 800;
		font-size: 17px;
	}
	.msub {
		font-size: 13px;
		color: var(--on-brand);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.none {
		color: var(--on-brand);
		text-align: center;
		padding: 12px;
	}
	.keys {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 10px;
		flex: none;
	}
	.key {
		/* Big by default; smaller (never under 48px) when the screen is short. */
		height: clamp(48px, 11dvh, 76px);
		border-radius: 16px;
		border: 0;
		background: #1f252c;
		color: #fff;
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.key:active {
		background: #2a3139;
	}
	.key.fn {
		color: var(--on-brand-hi);
	}
	.scrim {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.45);
	}
	.sheet {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		background: var(--surface);
		color: var(--ink);
		border-radius: 26px 26px 0 0;
		padding: 12px 20px calc(22px + env(safe-area-inset-bottom));
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.grab {
		align-self: center;
		width: 44px;
		height: 5px;
		border-radius: 999px;
		background: #c9cfd6;
	}
	.who {
		display: flex;
		align-items: center;
		gap: 14px;
	}
	.bignr {
		min-width: 68px;
		height: 68px;
		padding: 0 8px;
		border-radius: 18px;
		background: var(--brand);
		color: #fff;
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 26px;
	}
	h2 {
		font-size: 30px;
	}
	.sub {
		font-size: 15px;
		color: var(--ink-2);
	}
	.warn {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		background: var(--warn-tint);
		border-radius: 12px;
		padding: 12px;
		font-size: 15px;
		line-height: 1.4;
	}
	.warn :global(svg) {
		color: var(--cta);
		flex: none;
	}
	.btn-go {
		min-height: 64px;
		border-radius: 18px;
		border: 0;
		background: var(--brand);
		color: #fff;
		font-weight: 800;
		font-size: 19px;
	}
	.btn-wrong {
		min-height: 52px;
		border: 0;
		background: none;
		color: var(--ink-2);
		font-weight: 700;
		font-size: 16px;
	}
</style>

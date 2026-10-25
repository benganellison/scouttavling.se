<script lang="ts">
	import ScouternaSymbol from '#lib/ui/brand/ScouternaSymbol.svelte';
	import EventLogo from '#lib/ui/brand/EventLogo.svelte';
	import ScouternaLogo from '#lib/ui/brand/ScouternaLogo.svelte';
	import type { BrandImage } from '#lib/brand/branding.ts';
	import { placeWord } from './format.ts';

	interface Row {
		number: number;
		name: string;
		troop: string;
		place: number;
		total: number;
		tied: boolean;
		tieNote: string | null;
		scorePoints: number;
		stylePoints: number;
	}

	let {
		compName,
		className,
		rows,
		takenAt,
		refreshHref,
		backHref,
		eventLogo = null,
		classColor = null,
		stripe = 'var(--orange)'
	}: {
		compName: string;
		className: string;
		rows: Row[];
		takenAt: string;
		refreshHref: string;
		backHref: string;
		eventLogo?: BrandImage | null;
		/** The class colour (decoration: a bar beside the class name). */
		classColor?: string | null;
		/** The event accent (or Äventyrarorange) for the highlight ring. */
		stripe?: string;
	} = $props();

	/** Reveal from the lowest shown place up to the winner. */
	const order = $derived([...rows].reverse());
	let step = $state(0);
	const current = $derived(step > 0 ? order[step - 1] : null);
	const next = $derived(order[step] ?? null);
	const isRevealed = (r: Row) => order.indexOf(r) < step;

	let w = $state(1920);
	let h = $state(1080);
	const scale = $derived(Math.min(w / 1920, h / 1080));

	const forward = () => {
		if (step < order.length) step++;
	};
	const back = () => {
		if (step > 0) step--;
	};
	/** Presentation clickers send arrows/PageUp/PageDown to the document, so listen there. */
	function onkeydown(e: KeyboardEvent) {
		if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
		const t = e.target as HTMLElement | null;
		if (t?.closest('input, textarea, select, [contenteditable]')) return;
		// Space on a focused button/link activates it natively; don't step twice.
		if (e.key === ' ' && t?.closest('button, a')) return;
		if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
			e.preventDefault();
			forward();
		} else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
			e.preventDefault();
			back();
		}
	}
</script>

<svelte:window {onkeydown} />

<div class="viewport" bind:clientWidth={w} bind:clientHeight={h} role="region" aria-label="Prisutdelning {className}" aria-roledescription="presentation">
	<div class="stage" style="transform: translate(-50%, -50%) scale({scale}); --stripe: {stripe}">

		<header class="top">
			<div class="brand">{#if eventLogo}<EventLogo logo={eventLogo} height={64} onDark />{:else}<ScouternaSymbol size={44} onDark />{/if} <span>{compName}</span></div>
			<span class="snap">Resultat fryst {takenAt} · <a href={refreshHref}>Uppdatera</a> · <a href={backHref}>Byt klass</a></span>
		</header>

		<div class="body">
			<section class="main">
				<p class="eyebrow">Prisutdelning</p>
				<h1 class="cls">{#if classColor}<span class="cbar" style="background:{classColor}" aria-hidden="true"></span>{/if}{className}</h1>

				<div class="card" aria-live="polite" data-testid="reveal-card">
					{#if current}
						<p class="place">{placeWord(current.place, current.tied)}</p>
						<p class="pname" data-testid="reveal-name">{current.name}</p>
						<p class="troop">{current.number} · {current.troop}</p>
						<div class="pts">
							<span class="total">{current.total}</span>
							<span class="unit">poäng</span>
							{#if current.stylePoints}<span class="split">{current.scorePoints} + {current.stylePoints} stil</span>{/if}
						</div>
						{#if current.tieNote}<p class="tie">{current.tieNote}</p>{/if}
					{:else}
						<p class="place">Strax dags</p>
						<p class="pname intro">{rows.length} patruller</p>
						<p class="troop">Vi avslöjar placeringarna från plats {order[0]?.place ?? 1} och uppåt.</p>
					{/if}
				</div>
			</section>

			<aside class="side">
				<ol class="places">
					{#each rows as r (r.number)}
						<li class:shown={isRevealed(r)} class:now={current === r} data-testid="place-item">
							<span class="medal m{r.place}">{r.place}</span>
							{#if isRevealed(r)}
								<span class="lname">{r.name}</span>
								<span class="ltotal">{r.total}</span>
							{:else}
								<span class="lname hidden">? ? ?</span>
							{/if}
						</li>
					{/each}
				</ol>
				<div class="sender"><ScouternaLogo onDark width={300} /></div>
				<div class="controls">
					<button class="cbtn" onclick={back} disabled={step === 0}>Tillbaka</button>
					<button class="cbtn primary" onclick={forward} disabled={!next}>
						{next && next.place === 1 && order.slice(step).every((r) => r.place === 1) ? 'Avslöja vinnaren' : next ? 'Avslöja nästa' : 'Klart'}
					</button>
				</div>
			</aside>
		</div>
	</div>
</div>

<style>
	.viewport {
		position: fixed;
		inset: 0;
		overflow: hidden;
		background: var(--brand-dark);
		outline: none;
	}
	.stage {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 1920px;
		height: 1080px;
		transform-origin: center;
		background: var(--brand);
		color: #fff;
		overflow: hidden;
	}
	.top {
		position: relative;
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 48px 80px 0;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 16px;
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 34px;
	}
	.snap {
		color: var(--on-brand-2);
		font-size: 20px;
	}
	.snap a {
		color: var(--on-brand);
	}
	.body {
		position: relative;
		display: grid;
		grid-template-columns: 1fr 560px;
		gap: 64px;
		padding: 40px 80px 64px;
		height: calc(1080px - 92px);
	}
	.eyebrow {
		margin: 0;
		color: var(--on-brand-hi);
		font-weight: 800;
		font-size: 28px;
		text-transform: uppercase;
		letter-spacing: 0.12em;
	}
	.cls {
		font-size: 150px;
		line-height: 1;
		margin: 6px 0 40px;
		display: flex;
		align-items: center;
		gap: 32px;
	}
	.cbar {
		width: 22px;
		align-self: stretch;
		border-radius: 8px;
		flex: none;
	}
	.sender {
		display: flex;
		justify-content: flex-end;
		margin-right: -20px;
	}
	.card {
		background: #fff;
		color: var(--ink);
		border-radius: 32px;
		padding: 48px 56px;
		box-shadow: 0 30px 80px rgb(0 0 0 / 0.35);
		min-height: 470px;
	}
	.card p {
		margin: 0;
	}
	.place {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 40px;
		color: var(--cta);
	}
	.pname {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 110px;
		line-height: 1.02;
		letter-spacing: -0.03em;
		margin: 8px 0 !important;
	}
	.pname.intro {
		font-size: 90px;
	}
	.troop {
		font-size: 32px;
		color: var(--ink-2);
	}
	.pts {
		display: flex;
		align-items: baseline;
		gap: 14px;
		margin-top: 22px;
	}
	.total {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 80px;
		line-height: 1;
	}
	.unit {
		font-size: 30px;
		font-weight: 700;
	}
	.split {
		font-size: 26px;
		color: var(--ink-2);
		margin-left: 16px;
	}
	.tie {
		margin-top: 18px !important;
		font-size: 26px;
		font-weight: 700;
		color: var(--warn-ink);
		background: var(--warn-tint);
		border-radius: 14px;
		padding: 10px 18px;
		display: inline-block;
	}
	.side {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		gap: 24px;
		padding-top: 30px;
	}
	.places {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.places li {
		display: flex;
		align-items: center;
		gap: 18px;
		background: transparent;
		box-shadow: inset 0 0 0 2px var(--line-on-brand);
		border-radius: 18px;
		padding: 10px 18px;
		font-size: 28px;
		font-weight: 700;
		min-height: 66px;
	}
	.places li.now {
		background: #fff;
		color: var(--ink);
		box-shadow: inset 0 0 0 4px var(--stripe);
	}
	.medal {
		width: 46px;
		height: 46px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 22px;
		background: transparent;
		box-shadow: inset 0 0 0 2px var(--line-on-brand);
		color: #fff;
		flex: none;
	}
	.m1 {
		background: #f2c14e;
		color: var(--ink);
	}
	.m2 {
		background: #d5dbd7;
		color: var(--ink);
	}
	.m3 {
		background: #e3a574;
		color: var(--ink);
	}
	.lname {
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.lname.hidden {
		color: var(--on-brand-2);
		letter-spacing: 0.2em;
	}
	.ltotal {
		font-family: var(--font-display);
		font-weight: 800;
	}
	.controls {
		display: flex;
		gap: 16px;
	}
	.cbtn {
		flex: 1;
		min-height: 84px;
		border-radius: 20px;
		border: 2px solid var(--line-on-brand);
		background: transparent;
		color: #fff;
		font-weight: 800;
		font-size: 28px;
		cursor: pointer;
	}
	.cbtn.primary {
		flex: 1.6;
		background: #fff;
		border-color: #fff;
		color: var(--brand);
	}
	.cbtn:disabled {
		background: transparent;
		border-color: var(--line-on-brand);
		color: var(--on-brand-2);
		cursor: not-allowed;
	}
</style>

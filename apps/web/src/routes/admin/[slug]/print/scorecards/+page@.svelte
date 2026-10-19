<script lang="ts">
	import '#lib/ui/patrols/print.css';
	import { page } from '$app/state';
	import PrintBar from '#lib/ui/patrols/PrintBar.svelte';

	let { data } = $props();
	const toggleHref = $derived(data.showNames ? page.url.pathname : `${page.url.pathname}?names=1`);
</script>

<svelte:head><title>Poängkort · {data.competition.name}</title></svelte:head>

<div class="print-root">
	<PrintBar back="/admin/{data.competition.slug}/print" title="Poängkort" meta="{data.sheets.length} ark · 2 kort per A4">
		<a class="btn btn-ghost" href={toggleHref} data-sveltekit-noscroll>{data.showNames ? 'Dölj kontrollnamn' : 'Visa kontrollnamn'}</a>
	</PrintBar>
	{#if !data.sheets.length}
		<div class="print-empty">Inga patruller ännu.</div>
	{/if}
	<div class="sheets">
		{#each data.sheets as sheet, si (si)}
			<div class="sheet cards">
				{#each sheet as k (k.id)}
					<section class="scard" aria-label="Poängkort {k.nr} {k.name}">
						<header>
							<div class="who">
								<span class="nr">{k.nr}</span>
								<div>
									<span class="eyebrow">Poängkort · {data.competition.name}</span>
									<h2>{k.name}</h2>
									<span class="sub">{k.sub}</span>
								</div>
							</div>
							<div class="qrbox">
								<span>Visa kortet på varje kontroll. Funktionären fyller i och signerar.</span>
								<div class="qr" role="img" aria-label="QR-kod patrull {k.nr}">{@html k.qr}</div>
							</div>
						</header>
						<div class="days">
							{#each k.days as d, di (di)}
								<div class="day">
									{#if d.label}<span class="dlabel">{d.label}</span>{/if}
									<div class="grid" style="grid-template-columns: repeat({data.cols}, minmax(0, 1fr))">
										{#each d.cells as c (c.id)}
											<div class="cell" class:na={c.na}>
												<span class="ctop"><strong class:big={data.multi}>{c.code}</strong>{#if c.checkpoint}<span class="tag">CP</span>{/if}</span>
												{#if data.showNames}<span class="cname">{c.name}</span>{/if}
												{#if c.na}
													<span class="state">Ingår ej</span>
												{:else if c.checkpoint}
													<span class="state small">Bara signatur</span>
													<span class="sign">Sign.</span>
												{:else}
													<span class="fill">Poäng<span class="max">max {c.max}</span></span>
													{#if c.style}<span class="fill">Stil</span>{/if}
													<span class="sign">Sign.</span>
												{/if}
											</div>
										{/each}
									</div>
								</div>
							{/each}
						</div>
						<footer>
							<span>{#if k.start}{`Start: ${k.start} · `}{/if}Tappat kortet? Gå till närmaste kontroll{#if data.competition.hqPhone} eller ring {data.competition.hqPhone}{/if}.</span>
							<strong>Summa: ________</strong>
						</footer>
					</section>
				{/each}
			</div>
		{/each}
	</div>
</div>

<style>
	.cards {
		padding: 9mm 11mm;
	}
	.scard {
		flex: 0 0 50%;
		height: 50%;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 5mm 0;
		border-bottom: 2px dashed #8a978f;
		overflow: hidden;
	}
	.scard:last-child {
		border-bottom: 0;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
	}
	.who {
		display: flex;
		gap: 12px;
		align-items: center;
	}
	.nr {
		min-width: 18mm;
		height: 18mm;
		padding: 0 6px;
		border-radius: 12px;
		background: #0f1f17;
		color: #fff;
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 20pt;
	}
	.eyebrow {
		font-size: 9pt;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	h2 {
		font-size: 22pt;
		line-height: 1;
	}
	.sub {
		font-size: 11pt;
	}
	.qrbox {
		display: flex;
		gap: 10px;
		align-items: center;
	}
	.qrbox > span {
		font-size: 9pt;
		max-width: 40mm;
		text-align: right;
		line-height: 1.3;
	}
	.qr {
		width: 22mm;
		height: 22mm;
		flex: none;
	}
	.qr :global(svg) {
		width: 100%;
		height: 100%;
		display: block;
	}
	.days {
		display: flex;
		flex-direction: column;
		gap: 5px;
		flex: 1;
		min-height: 0;
	}
	.day {
		display: flex;
		gap: 6px;
		flex: 1;
		min-height: 0;
	}
	.dlabel {
		writing-mode: vertical-rl;
		transform: rotate(180deg);
		font-size: 9pt;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		text-align: center;
		border-left: 2px solid #0f1f17;
		padding-right: 3px;
	}
	.grid {
		display: grid;
		gap: 5px;
		flex: 1;
		grid-auto-rows: 1fr;
	}
	.cell {
		border: 1.5px solid #0f1f17;
		border-radius: 7px;
		padding: 4px 6px;
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-height: 0;
		font-size: 9pt;
	}
	.cell.na {
		background: #e4e9e5;
		border-color: #e4e9e5;
		color: #44524a;
	}
	.ctop {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}
	.ctop strong {
		font-family: var(--font-display);
		font-size: 12pt;
	}
	.ctop strong.big {
		font-size: 15pt;
	}
	.tag {
		font-size: 8pt;
		font-weight: 800;
	}
	.cname {
		font-size: 8.5pt;
		line-height: 1.15;
	}
	.state {
		font-weight: 700;
		font-size: 9.5pt;
	}
	.state.small {
		font-weight: 600;
	}
	.fill {
		display: flex;
		justify-content: space-between;
		border-bottom: 1px solid #0f1f17;
		padding-bottom: 1px;
	}
	.fill .max {
		font-size: 7.5pt;
		white-space: nowrap;
		align-self: flex-end;
	}
	.sign {
		margin-top: auto;
		font-size: 8pt;
		border-top: 1px solid #8a978f;
		padding-top: 1px;
	}
	footer {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		font-size: 10pt;
	}
</style>

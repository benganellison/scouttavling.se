<script lang="ts">
	import TrackChip from '#lib/ui/brand/TrackChip.svelte';
	import Histogram from './Histogram.svelte';
	import type { Stats } from '#lib/server/stats.ts';

	/**
	 * Participation, points per station and times. Shared by the organiser's "Statistik" page and the
	 * public statistics page; what is in `stats` is already decided by the server.
	 */
	let { stats, trackColors, hiddenNote }: { stats: Stats; trackColors: Record<string, string>; hiddenNote: string } = $props();

	let scopeId = $state<string | null>(null);
	const scope = $derived(stats.scopes.find((s) => s.trackId === scopeId) ?? stats.scopes[0]);
	const p = $derived(scope.participation);

	const num = (x: number) => x.toLocaleString('sv-SE');
	function minutes(m: number) {
		if (m < 60) return `${m} min`;
		const h = Math.floor(m / 60);
		return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
	}
	const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : '–');
</script>

{#if stats.scopes.length > 2}
	<nav class="tabs" aria-label="Klasser">
		{#each stats.scopes as s (s.trackId ?? 'all')}
			<button class="tab" aria-pressed={scope.trackId === s.trackId} onclick={() => (scopeId = s.trackId)}>
				{#if s.trackId}<TrackChip color={trackColors[s.trackId]} size={12} />{/if}{s.name}
			</button>
		{/each}
	</nav>
{/if}

<section class="block" aria-labelledby="h-part">
	<h2 id="h-part">Deltagande</h2>
	<dl class="figures" data-testid="participation">
		<div data-k="registered">
			<dt>Anmälda</dt>
			<dd>{p.registered}</dd>
		</div>
		<div data-k="started">
			<dt>Startade</dt>
			<dd>{p.started}</dd>
			<span class="sub">{pct(p.started, p.registered)} av anmälda</span>
		</div>
		<div data-k="finished">
			<dt>Gick i mål</dt>
			<dd>{p.finished}</dd>
			<span class="sub">{pct(p.finished, p.started)} av startade</span>
		</div>
		<div data-k="resigned">
			<dt>Bröt</dt>
			<dd>{p.resigned}</dd>
		</div>
	</dl>
	{#if scope.trackId === null && stats.scopes.length > 2}
		<div class="table-wrap">
			<table class="plain">
				<thead
					><tr
						><th scope="col">Klass</th><th scope="col" class="num">Anmälda</th><th scope="col" class="num">Startade</th><th scope="col" class="num">I mål</th
						><th scope="col" class="num">Bröt</th></tr
					></thead
				>
				<tbody>
					{#each stats.scopes.slice(1) as s (s.trackId)}
						<tr
							><th scope="row"><TrackChip color={trackColors[s.trackId!]} size={12} /> {s.name}</th><td class="num">{s.participation.registered}</td><td
								class="num">{s.participation.started}</td
							><td class="num">{s.participation.finished}</td><td class="num">{s.participation.resigned}</td></tr
						>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>

<section class="block" aria-labelledby="h-st">
	<h2 id="h-st">Poäng per kontroll</h2>
	{#if !stats.stationsShown}
		<p class="muted" data-testid="stations-hidden">{hiddenNote}</p>
	{:else if scope.stations.length === 0}
		<p class="muted">Inga kontroller med poäng{scope.trackId ? ' i klassen' : ''}.</p>
	{:else}
		<p class="muted small">Poäng utan stil, för patruller som har rapporterats på kontrollen. Staplarna visar hur många patruller som fick varje poäng.</p>
		<ol class="stations" data-testid="station-stats" style={scope.trackId && trackColors[scope.trackId] ? `--track:${trackColors[scope.trackId]}` : undefined}>
			{#each scope.stations as s (s.code)}
				<li class="st" data-code={s.code}>
					<div class="st-head">
						<span class="code">{s.code}</span>
						<span class="st-name">{s.name}</span>
						{#if s.pctOfMax !== null}<span class="pct" title="Snitt i procent av maxpoäng">{s.pctOfMax} %</span>{/if}
					</div>
					{#if s.points}
						<div class="st-body">
							<Histogram buckets={s.buckets} label="Fördelning för {s.name}: {s.points.n} patruller, median {num(s.points.median)} av {s.max}" />
							<dl class="nums">
								<div>
									<dt>Median</dt>
									<dd>{num(s.points.median)}</dd>
								</div>
								<div>
									<dt>Snitt</dt>
									<dd>{num(s.points.mean)}</dd>
								</div>
								<div>
									<dt>Min–max</dt>
									<dd>{s.points.min}–{s.points.max}</dd>
								</div>
								<div>
									<dt>Std.avv.</dt>
									<dd>{num(s.points.sd)}</dd>
								</div>
								<div>
									<dt>Patruller</dt>
									<dd>{s.points.n}</dd>
								</div>
								{#if s.styleMean !== null}<div>
										<dt>Stil, snitt</dt>
										<dd>{num(s.styleMean)}</dd>
									</div>{/if}
							</dl>
						</div>
						<p class="max small muted">Max {s.max} poäng</p>
					{:else}
						<p class="muted small">Inga rapporter ännu.</p>
					{/if}
				</li>
			{/each}
		</ol>
	{/if}
</section>

{#if stats.stationsShown && scope.times}
	{@const t = scope.times}
	<section class="block" aria-labelledby="h-time">
		<h2 id="h-time">Tider</h2>
		{#if t.timedPatrols === 0}
			<p class="muted">
				Inga tider{scope.trackId ? ' i klassen' : ''} ännu. Tider finns bara för rapporter från funktionärernas telefoner (pappersprotokoll och ändringar i ledningen
				saknar tid).
			</p>
		{:else}
			<p class="muted small">
				Från funktionärernas telefoner: {t.timedPatrols}
				{t.timedPatrols === 1 ? 'patrull' : 'patruller'} med tider. Pappersprotokoll saknar tid och räknas inte.
			</p>
			{#if t.course.length}
				<h3>Tid på banan</h3>
				<p class="muted small">Från första till sista kontrollen{t.course.length > 1 ? ' per dag' : ''}.</p>
				<div class="table-wrap">
					<table class="plain" data-testid="course-times">
						<thead
							><tr
								>{#if t.course.length > 1 || t.course[0].day}<th scope="col">Dag</th>{/if}<th scope="col" class="num">Snabbast</th><th scope="col" class="num"
									>Median</th
								><th scope="col" class="num">Långsammast</th><th scope="col" class="num" title="Antal patruller">Antal</th></tr
							></thead
						>
						<tbody>
							{#each t.course as c, i (i)}
								<tr
									>{#if t.course.length > 1 || c.day}<th scope="row">{c.day ?? '–'}</th>{/if}<td class="num">{minutes(c.minutes.min)}</td><td class="num"
										>{minutes(Math.round(c.minutes.median))}</td
									><td class="num">{minutes(c.minutes.max)}</td><td class="num">{c.minutes.n}</td></tr
								>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
			{#if t.legs.length}
				{@const common = t.legs.filter((l) => l.minutes.n >= 2)}
				{@const rare = t.legs.filter((l) => l.minutes.n < 2)}
				<h3>Mellan kontrollerna</h3>
				<p class="muted small">Tid från en rapport till nästa, för varje sträcka patrullerna har gått (vanligaste först). Tiden på kontrollen ingår.</p>
				{#snippet legTable(legs: typeof t.legs, testid: string)}
					<div class="table-wrap">
						<table class="plain" data-testid={testid}>
							<thead
								><tr
									><th scope="col">Sträcka</th><th scope="col" class="num">Snabbast</th><th scope="col" class="num">Median</th><th scope="col" class="num"
										>Långsammast</th
									><th scope="col" class="num" title="Antal patruller">Antal</th></tr
								></thead
							>
							<tbody>
								{#each legs as l (l.from + l.to)}
									<tr>
										<th scope="row"
											><span class="code">{l.from}</span> → <span class="code">{l.to}</span>
											<span class="muted small legname">{l.fromName} → {l.toName}</span></th
										>
										<td class="num">{minutes(l.minutes.min)}</td><td class="num">{minutes(Math.round(l.minutes.median))}</td><td class="num"
											>{minutes(l.minutes.max)}</td
										><td class="num">{l.minutes.n}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/snippet}
				{#if common.length}{@render legTable(common, 'leg-times')}{/if}
				{#if rare.length}
					<details class="rare">
						<summary>{common.length ? `Visa ${rare.length} sträckor till` : `Visa ${rare.length} sträckor`} som bara en patrull gick</summary>
						{@render legTable(rare, common.length ? 'leg-times-rare' : 'leg-times')}
					</details>
				{/if}
			{/if}
		{/if}
	</section>
{/if}

<style>
	.tabs {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}
	.tab {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-height: 44px;
		padding: 0 16px;
		border-radius: 999px;
		border: 1.5px solid var(--line-strong);
		background: var(--surface);
		color: var(--ink);
		font: inherit;
		font-weight: 800;
		cursor: pointer;
	}
	.tab[aria-pressed='true'] {
		background: var(--brand);
		border-color: var(--brand);
		color: #fff;
	}
	.block {
		display: grid;
		gap: 12px;
	}
	h2 {
		margin: 8px 0 0;
		font-size: 22px;
	}
	h3 {
		margin: 8px 0 0;
		font-size: 17px;
	}
	.figures {
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 10px;
	}
	.figures > div {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r-lg, 12px);
		padding: 12px 14px;
	}
	.figures dt {
		color: var(--ink-2);
		font-size: 13px;
		font-weight: 700;
	}
	.figures dd {
		margin: 2px 0 0;
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 30px;
		line-height: 1.1;
		font-variant-numeric: tabular-nums;
	}
	.sub {
		color: var(--ink-2);
		font-size: 12px;
	}
	.table-wrap {
		overflow-x: auto;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r-lg, 12px);
		padding: 4px 12px;
	}
	table.plain {
		width: 100%;
		border-collapse: collapse;
	}
	.plain th,
	.plain td {
		padding: 10px 8px;
		border-bottom: 1px solid var(--line);
		text-align: left;
		vertical-align: middle;
	}
	.plain thead th {
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--ink-2);
	}
	.plain tbody tr:last-child > * {
		border-bottom: 0;
	}
	.plain tbody th {
		font-weight: 700;
	}
	.num {
		text-align: right !important;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.rare summary {
		cursor: pointer;
		font-weight: 700;
		min-height: var(--tap, 44px);
		display: flex;
		align-items: center;
	}
	.rare[open] summary {
		margin-bottom: 8px;
	}
	@media (max-width: 600px) {
		.plain th,
		.plain td {
			padding: 8px 5px;
		}
		.table-wrap {
			padding: 2px 8px;
		}
	}
	.legname {
		display: block;
		font-weight: 400;
	}
	.stations {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr));
		gap: 10px;
	}
	.st {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r-lg, 12px);
		padding: 12px 14px;
		display: grid;
		gap: 8px;
	}
	.st-head {
		display: flex;
		align-items: baseline;
		gap: 8px;
	}
	.code {
		font-weight: 800;
		color: var(--ink-2);
		font-variant-numeric: tabular-nums;
	}
	.st-name {
		flex: 1;
		font-weight: 800;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.pct {
		font-weight: 800;
		font-size: 13px;
		padding: 2px 8px;
		border-radius: 999px;
		background: var(--ground);
		border: 1px solid var(--line);
	}
	.st-body {
		display: flex;
		gap: 14px;
		align-items: flex-start;
		flex-wrap: wrap;
	}
	.nums {
		margin: 0;
		display: grid;
		grid-template-columns: repeat(3, auto);
		gap: 4px 14px;
	}
	.nums dt {
		font-size: 11px;
		color: var(--ink-2);
		font-weight: 700;
	}
	.nums dd {
		margin: 0;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
	}
	.max {
		margin: 0;
	}
	.small {
		font-size: 13px;
	}
	.muted {
		color: var(--ink-2);
	}
	p {
		margin: 0;
	}
</style>

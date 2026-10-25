<script lang="ts">
	import { enhance } from '$app/forms';
	import { selectableValues, styleValues } from '@scouttavling/domain';
	import StatusPill from '#lib/ui/patrols/StatusPill.svelte';
	import Medal from '#lib/ui/live/Medal.svelte';
	import { LiveStream } from '#lib/ui/live/liveStore.svelte.ts';

	let { data, form } = $props();

	new LiveStream(() => ({ url: `/api/v1/live/${data.comp.slug}/events`, depends: `live:${data.comp.slug}` }));

	let selectedId = $state<string | null>(null);
	const selected = $derived(data.stations.find((s) => s.id === selectedId) ?? null);
	let saving = $state(false);

	type Cell = (typeof data.stations)[number];
	const active = (c: Cell) => c.items.filter((i) => i.score?.state === 'active');
	const cellState = (c: Cell) => (!c.applies ? 'na' : active(c).length > 0 ? 'done' : c.checkpoint ? 'cp' : 'todo');
	const cellScore = (c: Cell) => {
		const a = active(c);
		if (!a.length) return '';
		if (c.checkpoint && a.every((i) => i.score!.points === 0)) return 'OK';
		const p = a.reduce((s, i) => s + i.score!.points, 0);
		const st = a.reduce((s, i) => s + i.score!.stylePoints, 0);
		return st ? `${p} + ${st}` : `${p}`;
	};
	const countLabel = (mode: string, v: number, mult: number | undefined) => (mode === 'COUNT' && mult && mult !== 1 ? `${v}×${mult}` : `${v}`);
	const tel = (s: string) => s.replace(/[^\d+]/g, '');
</script>

<svelte:head><title>{data.patrol.number} {data.patrol.name} · {data.comp.name}</title></svelte:head>

<div class="page stack">
	<a class="back" href="/admin/{data.comp.slug}/live">← Ledningscentralen</a>

	<header class="card head">
		<div class="nr">{data.patrol.number}</div>
		<div class="who stack">
			<div class="row">
				<h1>{data.patrol.name}</h1>
				<StatusPill status={data.patrol.status} detail={data.patrol.campAt ? `klar för dagen ${data.patrol.campAt}` : null} />
			</div>
			<p class="muted meta">
				{data.patrol.troop} · {data.patrol.track}
				{#if data.patrol.startStation} · Startar på {data.patrol.startStation.code} {data.patrol.startStation.name}{/if}
			</p>
			{#if data.members.length}<p class="meta">{data.members.join(', ')}</p>{/if}
		</div>
		<div class="score">
			{#if data.result}
				<div class="row">
					<Medal place={data.result.place} size={44} />
					<div class="stack tight">
						<span class="big" data-testid="patrol-total">{data.result.total}</span>
						<span class="muted small">plats {data.result.place}{data.result.tied ? ' (delad)' : ''} av {data.patrol.trackCount}</span>
					</div>
				</div>
			{/if}
			{#if data.patrol.contactPhone}
				<a class="btn btn-primary" href="tel:{tel(data.patrol.contactPhone)}">
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 3h4l2 5-3 2a12 12 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2A18 18 0 0 1 3 5a2 2 0 0 1 2-2z" /></svg>
					Ring {data.patrol.contactName ?? data.patrol.contactPhone}
				</a>
			{/if}
		</div>
	</header>

	<div class="cols">
		<section class="stack" aria-labelledby="grid-h">
			<div class="row between">
				<h2 id="grid-h">Kontroller</h2>
				<ul class="legend" aria-label="Förklaring">
					<li><span class="sw done"></span>Rapporterad</li>
					<li><span class="sw todo"></span>Kvar</li>
					<li><span class="sw cp"></span>Passage</li>
					<li><span class="sw na"></span>Inte för klassen</li>
				</ul>
			</div>
			<div class="grid">
				{#each data.stations as c (c.id)}
					<button
						class="cell {cellState(c)}"
						class:sel={selectedId === c.id}
						disabled={!c.applies}
						aria-pressed={selectedId === c.id}
						aria-label="{c.code} {c.name}{cellScore(c) ? `: ${cellScore(c)}` : ''}"
						data-code={c.code}
						onclick={() => (selectedId = selectedId === c.id ? null : c.id)}
					>
						<span class="ccode">{c.code}</span>
						<span class="cscore">{cellScore(c) || (c.applies ? '–' : '')}</span>
					</button>
				{/each}
			</div>

			{#if selected}
				<section class="card stack edit" aria-labelledby="edit-h">
					<div class="row between">
						<h3 id="edit-h">{selected.code} · {selected.name}</h3>
						<button class="btn btn-ghost" onclick={() => (selectedId = null)}>Stäng</button>
					</div>
					{#each selected.items as it (it.id)}
						{@const values = selectableValues(it.def)}
						{@const styles = styleValues(it.def)}
						<form
							method="POST"
							action="?/save"
							class="stack item"
							use:enhance={() => {
								saving = true;
								return async ({ update }) => {
									await update({ reset: false });
									saving = false;
								};
							}}
						>
							<input type="hidden" name="itemId" value={it.id} />
							<input type="hidden" name="baseVersion" value={it.version ?? ''} />
							<div class="row between">
								<strong>{it.name}</strong>
								<span class="muted small">
									{#if it.score?.state === 'active'}Nu: {it.score.points}{it.score.stylePoints ? ` + ${it.score.stylePoints} stil` : ''} · version {it.score.version}{:else if it.score}Ångrad{:else}Ej rapporterad{/if}
								</span>
							</div>
							{#if values.length}
								<fieldset>
									<legend class="label">{it.def.mode === 'COUNT' ? 'Antal' : 'Poäng'}</legend>
									<div class="chips">
										{#each values as v (v)}
											<label class="chip">
												<input type="radio" name="value" value={v} checked={it.score?.state === 'active' && it.score.raw.value === v} required />
												<span>{countLabel(it.def.mode, v, it.def.countMultiplier)}</span>
											</label>
										{/each}
									</div>
								</fieldset>
							{:else}
								<input type="hidden" name="value" value="0" />
								<p class="muted small">Passage utan poäng — spara för att markera patrullen som passerad.</p>
							{/if}
							{#if styles.length}
								<fieldset>
									<legend class="label">Stil</legend>
									<div class="chips">
										{#each styles as v (v)}
											<label class="chip">
												<input type="radio" name="style" value={v} checked={it.score?.state === 'active' && it.score.raw.style === v} required />
												<span>{v}</span>
											</label>
										{/each}
									</div>
								</fieldset>
							{/if}
							<div class="field">
								<label for="reason-{it.id}">Anledning</label>
								<input id="reason-{it.id}" name="reason" type="text" placeholder="t.ex. fel patrull vald" maxlength="200" />
							</div>
							<div class="row">
								<button class="btn btn-accent" disabled={saving}>Spara ändring</button>
								{#if form?.itemId === it.id && form?.message}
									<span class={form && 'saved' in form && form.saved ? 'ok-text' : 'error-text'} role="status">{form.message}</span>
								{/if}
							</div>
						</form>
					{/each}
				</section>
			{/if}
		</section>

		<section class="card stack" aria-labelledby="ev-h">
			<h2 id="ev-h">Händelser</h2>
			{#if data.events.length === 0}
				<p class="muted small">Inga händelser ännu.</p>
			{:else}
				<ol class="timeline" data-testid="timeline">
					{#each data.events as e, i (i)}
						<li class={e.kind}>
							<span class="time">{e.time}</span>
							<span class="etext">{e.text}{#if e.reason} · <em>'{e.reason}'</em>{/if}</span>
						</li>
					{/each}
				</ol>
			{/if}
		</section>
	</div>
</div>

<style>
	.page {
		gap: 20px;
	}
	.back {
		font-weight: 700;
		text-decoration: none;
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		gap: 20px;
		align-items: center;
	}
	.nr {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 44px;
		background: var(--brand);
		color: #fff;
		border-radius: var(--r-md);
		padding: 8px 16px;
		line-height: 1;
	}
	.who {
		flex: 1 1 300px;
		gap: 4px;
		min-width: 0;
	}
	h1 {
		font-size: 30px;
	}
	h2 {
		font-size: 20px;
	}
	h3 {
		font-size: 18px;
	}
	.meta {
		margin: 0;
		font-size: 14px;
	}
	.score {
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
		align-items: center;
	}
	.tight {
		gap: 0;
	}
	.big {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 34px;
		line-height: 1;
	}
	.small {
		font-size: 13px;
		margin: 0;
	}
	.between {
		justify-content: space-between;
	}
	.cols {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(280px, 380px);
		gap: 20px;
		align-items: start;
	}
	@media (max-width: 1000px) {
		.cols {
			grid-template-columns: 1fr;
		}
	}
	.legend {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		margin: 0;
		padding: 0;
		font-size: 13px;
		color: var(--ink-2);
	}
	.legend li {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.sw {
		width: 14px;
		height: 14px;
		border-radius: 4px;
		display: inline-block;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		gap: 8px;
	}
	@media (max-width: 600px) {
		.grid {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}
	.cell {
		min-height: 76px;
		border-radius: var(--r-md);
		border: 1.5px solid var(--line-strong);
		background: var(--surface);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
		cursor: pointer;
		padding: 6px 4px;
	}
	.ccode {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 18px;
	}
	.cscore {
		font-weight: 800;
		font-size: 15px;
		font-variant-numeric: tabular-nums;
	}
	.cell.done,
	.sw.done {
		background: var(--brand);
		border-color: var(--brand);
		color: #fff;
	}
	.cell.todo,
	.sw.todo {
		border-style: dashed;
		color: var(--ink-2);
		border-color: var(--ink-3);
	}
	.sw.todo {
		border: 1.5px dashed var(--ink-3);
	}
	.cell.cp,
	.sw.cp {
		background: var(--warn-tint);
		border: 1.5px dashed var(--orange);
		color: var(--warn-ink);
	}
	.cell.na,
	.sw.na {
		background: var(--line);
		border-color: var(--line);
		color: var(--ink-3);
		cursor: not-allowed;
	}
	.cell.sel {
		outline: 3px solid var(--orange);
		outline-offset: 2px;
	}
	.edit {
		gap: 14px;
	}
	.item {
		gap: 10px;
		border-top: 1px solid var(--line);
		padding-top: 12px;
	}
	fieldset {
		border: 0;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.chip input {
		position: absolute;
		opacity: 0;
		width: 1px;
		height: 1px;
	}
	.chip span {
		display: inline-grid;
		place-items: center;
		min-width: 48px;
		min-height: 48px;
		padding: 0 10px;
		border-radius: var(--r-sm);
		border: 1.5px solid var(--line-strong);
		font-weight: 800;
		cursor: pointer;
		background: var(--surface);
	}
	.chip input:checked + span {
		background: var(--brand);
		border-color: var(--brand);
		color: #fff;
	}
	.chip input:focus-visible + span {
		outline: 3px solid var(--orange);
		outline-offset: 2px;
	}
	.ok-text {
		color: var(--brand-2);
		font-weight: 700;
		font-size: 14px;
	}
	.timeline {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.timeline li {
		display: grid;
		grid-template-columns: 46px 1fr;
		gap: 8px;
		padding: 9px 0 9px 10px;
		border-top: 1px solid var(--line);
		border-left: 3px solid var(--line-strong);
		font-size: 14px;
	}
	.timeline li.edit {
		border-left-color: var(--orange);
	}
	.timeline li.void {
		border-left-color: var(--danger);
	}
	.timeline li.status {
		border-left-color: var(--brand);
	}
	.time {
		color: var(--ink-2);
		font-variant-numeric: tabular-nums;
	}
</style>

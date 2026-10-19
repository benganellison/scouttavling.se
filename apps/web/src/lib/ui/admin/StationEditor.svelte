<script lang="ts" module>
	import type { DistinctValue, ItemMode } from '@scouttavling/domain';

	export interface EditItem {
		id: string | null;
		name: string;
		mode: ItemMode;
		min: number;
		max: number;
		distinctValues: DistinctValue[];
		countMultiplier: number;
		styleEnabled: boolean;
		styleMin: number;
		styleMax: number;
		countsForTiebreak: boolean;
		scores: number;
	}
	export interface EditStation {
		id: string;
		name: string;
		customCode: string | null;
		dayId: string | null;
		allTracks: boolean;
		trackIds: string[];
		startable: boolean;
		invited: boolean;
		items: EditItem[];
	}
</script>

<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ScoreItemDef } from '@scouttavling/domain';
	import PhonePreview from './PhonePreview.svelte';
	import Toggle from './Toggle.svelte';
	import { MODE_LABEL } from './format.ts';

	let {
		station,
		days,
		tracks,
		compStyle,
		multiDay,
		suggestCode,
		errors = {},
		saved = false,
		invitesHref
	}: {
		station: EditStation;
		days: { id: string; name: string; prefix: string; date: string }[];
		tracks: { id: string; name: string }[];
		compStyle: boolean;
		multiDay: boolean;
		suggestCode: (dayId: string | null, name: string) => string;
		errors?: Record<string, string>;
		saved?: boolean;
		invitesHref: string;
	} = $props();

	// Local editable copy (the parent re-keys this component when server data changes).
	// svelte-ignore state_referenced_locally
	const init = structuredClone($state.snapshot(station)) as EditStation;
	let name = $state(init.name);
	let customCode = $state(init.customCode ?? '');
	// svelte-ignore state_referenced_locally
	let dayId = $state(init.dayId ?? days[0]?.id ?? null);
	let allTracks = $state(init.allTracks);
	let trackIds = $state<string[]>(init.trackIds);
	let startable = $state(init.startable);
	let items = $state<EditItem[]>(init.items);
	let confirmDelete = $state(false);
	let saving = $state(false);
	let newValue = $state<Record<number, { value: string; label: string }>>({});

	const auto = $derived(suggestCode(multiDay ? dayId : null, name));
	const code = $derived(customCode.trim().toUpperCase() || auto);
	const payload = $derived(
		JSON.stringify({ id: station.id, name, customCode, dayId: multiDay ? dayId : null, allTracks, trackIds, startable, items })
	);
	const dirty = $derived(
		payload !==
			JSON.stringify({
				id: init.id, name: init.name, customCode: init.customCode ?? '', dayId: multiDay ? (init.dayId ?? days[0]?.id ?? null) : null,
				allTracks: init.allTracks, trackIds: init.trackIds, startable: init.startable, items: init.items
			})
	);
	const scorable = (m: ItemMode) => m === 'RANGE' || m === 'DISTINCT' || m === 'COUNT';
	const firstScorable = $derived(items.find((i) => scorable(i.mode)));
	const previewItem = $derived<ScoreItemDef | null>(
		firstScorable
			? {
					id: 'preview',
					name: firstScorable.name,
					mode: firstScorable.mode,
					min: firstScorable.min,
					max: firstScorable.max,
					distinctValues: firstScorable.distinctValues,
					countMultiplier: firstScorable.countMultiplier,
					styleEnabled: compStyle && firstScorable.styleEnabled,
					styleMin: firstScorable.styleMin,
					styleMax: firstScorable.styleMax,
					countsForTiebreak: firstScorable.countsForTiebreak
				}
			: null
	);
	const totalScores = $derived(items.reduce((a, i) => a + i.scores, 0));
	const MODES: { k: ItemMode; d: string }[] = [
		{ k: 'RANGE', d: 'min–max' },
		{ k: 'DISTINCT', d: 't.ex. 0/5/10' },
		{ k: 'COUNT', d: 'antal × poäng' },
		{ k: 'CHECKIN', d: 'inga poäng' },
		{ k: 'AUTO_ON_SCAN', d: 'vid skanning' }
	];

	function addItem() {
		items.push({
			id: null, name: items.length ? `Del ${items.length + 1}` : name, mode: 'RANGE', min: 0, max: 20, distinctValues: [], countMultiplier: 1,
			styleEnabled: false, styleMin: 0, styleMax: 5, countsForTiebreak: true, scores: 0
		});
		queueMicrotask(() => document.getElementById(`it-${items.length - 1}-name`)?.focus());
	}
	function setMode(i: number, m: ItemMode) {
		const it = items[i];
		it.mode = m;
		if (!scorable(m)) {
			it.styleEnabled = false;
			it.countsForTiebreak = false;
		} else if (m === 'DISTINCT' && it.distinctValues.length === 0) {
			it.distinctValues = [0, 5, 10, 15, 20].map((value) => ({ value }));
		} else if (m === 'COUNT' && it.max > 50) {
			it.max = 10;
		}
		if (scorable(m) && it.min >= it.max) {
			it.min = 0;
			it.max = m === 'COUNT' ? 10 : 20;
		}
	}
	function addValue(i: number) {
		const nv = newValue[i] ?? { value: '', label: '' };
		const n = Number(nv.value);
		if (nv.value === '' || !Number.isInteger(n)) return;
		const list = items[i].distinctValues.filter((d) => d.value !== n);
		list.push(nv.label.trim() ? { value: n, label: nv.label.trim() } : { value: n });
		items[i].distinctValues = list.sort((a, b) => a.value - b.value);
		newValue[i] = { value: '', label: '' };
	}
	function toggleTrack(id: string) {
		trackIds = trackIds.includes(id) ? trackIds.filter((t) => t !== id) : [...trackIds, id];
	}
	const err = (k: string) => errors[k];
</script>

<section class="editor card" aria-labelledby="ed-title">
	<form
		method="POST"
		action="?s={station.id}&/save"
		class="form"
		novalidate
		use:enhance={() => {
			saving = true;
			return async ({ update }) => {
				await update({ reset: false });
				saving = false;
			};
		}}
	>
		<input type="hidden" name="payload" value={payload} />
		<div class="ed-head">
			<h2 id="ed-title"><span class="code">{code}</span> {name || 'Namnlös kontroll'}</h2>
			{#if saved && !dirty}<span class="pill pill-ok" role="status">Sparat</span>{:else if dirty}<span class="pill pill-warn">Ej sparat</span>{/if}
		</div>
		{#if err('form')}<p class="error-text" role="alert">{err('form')}</p>{/if}

		<div class="cols">
			<div class="fields">
				<div class="row3">
					<div class="field">
						<label for="st-code">Kod på papper</label>
						<input id="st-code" bind:value={customCode} placeholder={auto} maxlength="6" class="strong" aria-describedby="st-code-help" aria-invalid={err('customCode') ? 'true' : undefined} />
					</div>
					<div class="field">
						<label for="st-name">Namn</label>
						<input id="st-name" bind:value={name} class="lg" aria-invalid={err('name') ? 'true' : undefined} />
					</div>
				</div>
				<span id="st-code-help" class="help">Tom = förslag {auto}. Skriv en egen kod om ni vill.</span>
				{#if err('customCode')}<span class="error-text">{err('customCode')}</span>{/if}
				{#if err('name')}<span class="error-text">{err('name')}</span>{/if}

				{#if multiDay}
					<fieldset class="fs">
						<legend class="label">Dag</legend>
						<div class="seg" style="--n: {days.length}">
							{#each days as d (d.id)}
								<label class="opt" class:on={dayId === d.id}>
									<input type="radio" name="st-day" value={d.id} bind:group={dayId} />
									<span class="ot">{d.name}</span><span class="od">{d.prefix}-koder</span>
								</label>
							{/each}
						</div>
						<span class="help">Koden föreslås av dag + ordning (start = {days.find((d) => d.id === dayId)?.prefix}S, mål = {days.find((d) => d.id === dayId)?.prefix}M).</span>
						{#if err('dayId')}<span class="error-text">{err('dayId')}</span>{/if}
					</fieldset>
				{/if}

				<fieldset class="fs">
					<legend class="label">Vilka klasser gör kontrollen?</legend>
					<div class="chips">
						<label class="tchip" class:on={allTracks}>
							<input type="checkbox" bind:checked={allTracks} />Alla klasser
						</label>
						{#if !allTracks}
							{#each tracks as t (t.id)}
								<label class="tchip" class:on={trackIds.includes(t.id)}>
									<input type="checkbox" checked={trackIds.includes(t.id)} onchange={() => toggleTrack(t.id)} />{t.name}
								</label>
							{/each}
						{/if}
					</div>
					{#if err('tracks')}<span class="error-text">{err('tracks')}</span>{/if}
				</fieldset>
				<Toggle bind:checked={startable} compact label="Kan vara startkontroll" description="Av för checkpoints som lunch eller mål." />

				<div class="items-head">
					<h3>Delar och poängregler</h3>
					<span class="help">{items.length === 1 ? 'En del' : `${items.length} delar`}. Funktionären fyller i varje del.</span>
				</div>
				{#if err('items')}<span class="error-text" role="alert">{err('items')}</span>{/if}

				<ol class="items">
					{#each items as it, i (i)}
						<li class="item">
							<div class="item-top">
								<span class="badge" aria-hidden="true">{i + 1}</span>
								<div class="field grow">
									<label for="it-{i}-name">Namn på del {i + 1}</label>
									<input id="it-{i}-name" bind:value={it.name} aria-invalid={err(`items.${i}.name`) ? 'true' : undefined} />
									{#if err(`items.${i}.name`)}<span class="error-text">{err(`items.${i}.name`)}</span>{/if}
								</div>
								{#if items.length > 1}
									<button type="button" class="btn btn-ghost rm" onclick={() => items.splice(i, 1)} aria-label="Ta bort del {i + 1}, {it.name}" disabled={it.scores > 0} title={it.scores ? 'Har registrerade poäng' : undefined}>
										<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
									</button>
								{/if}
							</div>

							<fieldset class="fs">
								<legend class="label">Hur sätts poäng?</legend>
								<div class="modes">
									{#each MODES as m (m.k)}
										<label class="opt" class:on={it.mode === m.k}>
											<input type="radio" name="mode-{i}" value={m.k} checked={it.mode === m.k} onchange={() => setMode(i, m.k)} />
											<span class="ot">{MODE_LABEL[m.k]}</span><span class="od">{m.d}</span>
										</label>
									{/each}
								</div>
							</fieldset>

							{#if it.mode === 'RANGE' || it.mode === 'COUNT'}
								<div class="nums">
									<div class="field">
										<label for="it-{i}-min">{it.mode === 'COUNT' ? 'Lägsta antal' : 'Lägsta poäng'}</label>
										<input id="it-{i}-min" type="number" bind:value={it.min} aria-invalid={err(`items.${i}.range`) ? 'true' : undefined} />
									</div>
									<div class="field">
										<label for="it-{i}-max">{it.mode === 'COUNT' ? 'Högsta antal' : 'Högsta poäng'}</label>
										<input id="it-{i}-max" type="number" bind:value={it.max} aria-invalid={err(`items.${i}.range`) ? 'true' : undefined} />
									</div>
									{#if it.mode === 'COUNT'}
										<div class="field">
											<label for="it-{i}-mult">Poäng per styck</label>
											<input id="it-{i}-mult" type="number" min="1" bind:value={it.countMultiplier} aria-invalid={err(`items.${i}.mult`) ? 'true' : undefined} />
										</div>
									{/if}
								</div>
								{#if err(`items.${i}.range`)}<span class="error-text">{err(`items.${i}.range`)}</span>{/if}
								{#if err(`items.${i}.mult`)}<span class="error-text">{err(`items.${i}.mult`)}</span>{/if}
								{#if it.mode === 'COUNT'}<span class="help">Ger {it.min * it.countMultiplier}–{it.max * it.countMultiplier} poäng.</span>{/if}
							{:else if it.mode === 'DISTINCT'}
								<div class="dv">
									<span class="label">Tillåtna poäng</span>
									<ul class="vals" aria-label="Tillåtna poäng för {it.name}">
										{#each it.distinctValues as d (d.value)}
											<li class="val">
												<strong>{d.value}</strong>{#if d.label}<span class="vl">{d.label}</span>{/if}
												<button type="button" aria-label="Ta bort värdet {d.value}" onclick={() => (it.distinctValues = it.distinctValues.filter((x) => x.value !== d.value))}>×</button>
											</li>
										{/each}
									</ul>
									<div class="addval">
										<div class="field small">
											<label for="it-{i}-nv">Värde</label>
											<input id="it-{i}-nv" type="number" value={newValue[i]?.value ?? ''} oninput={(e) => (newValue[i] = { value: e.currentTarget.value, label: newValue[i]?.label ?? '' })} onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), addValue(i))} />
										</div>
										<div class="field grow">
											<label for="it-{i}-nl">Etikett (valfri)</label>
											<input id="it-{i}-nl" value={newValue[i]?.label ?? ''} placeholder="t.ex. Oöppnat" oninput={(e) => (newValue[i] = { value: newValue[i]?.value ?? '', label: e.currentTarget.value })} onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), addValue(i))} />
										</div>
										<button type="button" class="btn dashed" onclick={() => addValue(i)}>+ värde</button>
									</div>
									{#if err(`items.${i}.distinct`)}<span class="error-text">{err(`items.${i}.distinct`)}</span>{/if}
								</div>
							{:else if it.mode === 'CHECKIN'}
								<p class="note">Funktionären checkar bara in patrullen. Räknas inte i poäng eller skiljeregeln, passar för lunch, övernattning eller vattenstation.</p>
							{:else}
								<p class="note">Registreras automatiskt när patrullens QR-kod skannas, t.ex. målgång. Inga poäng.</p>
							{/if}

							{#if scorable(it.mode)}
								<div class="flags">
									{#if compStyle}
										<Toggle bind:checked={it.styleEnabled} compact label="Stilpoäng" description="Av = funktionären ser bara poäng" />
										{#if it.styleEnabled}
											<div class="nums">
												<div class="field">
													<label for="it-{i}-smin">Stilpoäng från</label>
													<input id="it-{i}-smin" type="number" bind:value={it.styleMin} aria-invalid={err(`items.${i}.style`) ? 'true' : undefined} />
												</div>
												<div class="field">
													<label for="it-{i}-smax">Stilpoäng till</label>
													<input id="it-{i}-smax" type="number" bind:value={it.styleMax} aria-invalid={err(`items.${i}.style`) ? 'true' : undefined} />
												</div>
											</div>
											{#if err(`items.${i}.style`)}<span class="error-text">{err(`items.${i}.style`)}</span>{/if}
										{/if}
									{/if}
									<Toggle bind:checked={it.countsForTiebreak} compact label="Räknas i skiljeregeln" description="Vid lika poäng jämförs bästa resultat på delarna." />
								</div>
							{/if}
							{#if it.scores}<span class="help">{it.scores} registrerade poäng på den här delen.</span>{/if}
						</li>
					{/each}
				</ol>
				<div><button type="button" class="btn dashed" onclick={addItem}>+ Lägg till del</button></div>

				<div class="vol" class:missing={!station.invited}>
					<span class="vt"><strong>Funktionär</strong><span>{station.invited ? 'Inbjudan skapad' : 'Ingen inbjudan ännu'}</span></span>
					<a class="btn sm" class:btn-accent={!station.invited} href={invitesHref}>{station.invited ? 'Visa' : 'Bjud in'}</a>
				</div>
			</div>

			<div class="preview">
				<PhonePreview {code} {name} item={previewItem} checkpoint={items.some((i) => i.mode === 'CHECKIN')} count={items.length} index={items.findIndex((i) => scorable(i.mode)) + 1} />
			</div>
		</div>

		<div class="actions">
			<button class="btn btn-primary" type="submit" disabled={saving}>{saving ? 'Sparar …' : 'Spara kontrollen'}</button>
			{#if !confirmDelete}
				<button type="button" class="btn btn-ghost danger" onclick={() => (confirmDelete = true)}>Ta bort kontroll</button>
			{/if}
		</div>
	</form>
	{#if confirmDelete}
		<form method="POST" action="?/delete" class="confirm" use:enhance>
			<input type="hidden" name="id" value={station.id} />
			<p role="alert">
				Ta bort <strong>{code} {name}</strong> och dess {items.length === 1 ? 'del' : `${items.length} delar`}?
				{#if totalScores}Den har {totalScores} registrerade poäng och kan inte tas bort.{:else}Det går inte att ångra.{/if}
			</p>
			<div class="row">
				<button class="btn danger-solid" type="submit" disabled={totalScores > 0}>Ja, ta bort</button>
				<button class="btn" type="button" onclick={() => (confirmDelete = false)}>Avbryt</button>
			</div>
		</form>
	{/if}
</section>

<style>
	.editor {
		border-radius: 20px;
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 16px;
		min-width: 0;
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.ed-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
	}
	.ed-head h2 {
		font-size: 24px;
		font-weight: 800;
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.code {
		min-width: 44px;
		height: 36px;
		padding: 0 8px;
		border-radius: 9px;
		background: var(--forest);
		color: #fff;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 16px;
		flex: none;
	}
	.cols {
		display: flex;
		flex-wrap: wrap;
		gap: 24px;
		align-items: flex-start;
	}
	.fields {
		flex: 999 1 340px;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.preview {
		flex: 1 1 230px;
		display: flex;
		justify-content: center;
	}
	@media (min-width: 1100px) {
		.preview {
			position: sticky;
			top: 20px;
		}
	}
	.row3 {
		display: grid;
		grid-template-columns: 120px minmax(0, 1fr);
		gap: 12px;
	}
	input.strong {
		font-weight: 800;
		font-size: 17px;
		text-transform: uppercase;
	}
	input.lg {
		font-size: 17px;
	}
	.help {
		font-size: 13px;
		color: var(--ink-2);
	}
	.fs {
		border: 0;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
	}
	.fs legend {
		padding: 0;
		margin-bottom: 8px;
	}
	.seg {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
		gap: 8px;
	}
	.modes {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 128px), 1fr));
		gap: 8px;
	}
	.opt {
		position: relative;
		min-height: 56px;
		padding: 8px 10px;
		border-radius: 12px;
		border: 1.5px solid var(--line-strong);
		background: var(--surface);
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 2px;
		cursor: pointer;
	}
	.opt input,
	.tchip input {
		position: absolute;
		opacity: 0;
		inset: 0;
		margin: 0;
		cursor: pointer;
	}
	.opt:has(input:focus-visible),
	.tchip:has(input:focus-visible) {
		outline: 3px solid var(--flag);
		outline-offset: 2px;
	}
	.opt.on {
		background: var(--forest);
		border-color: var(--forest);
		color: #fff;
	}
	.ot {
		font-weight: 800;
		font-size: 14px;
		line-height: 1.2;
	}
	.od {
		font-size: 12px;
		opacity: 0.85;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.tchip {
		position: relative;
		min-height: 40px;
		padding: 0 14px;
		border-radius: 999px;
		border: 1.5px solid var(--line-strong);
		background: var(--surface);
		font-weight: 800;
		font-size: 14px;
		display: inline-flex;
		align-items: center;
		cursor: pointer;
	}
	.tchip.on {
		background: var(--forest);
		border-color: var(--forest);
		color: #fff;
	}
	.items-head {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-top: 8px;
		padding-top: 16px;
		border-top: 1px solid var(--line);
	}
	.items-head h3 {
		font-size: 18px;
		font-weight: 800;
	}
	.items {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.item {
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		padding: 14px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		background: #fbfcfb;
	}
	.item-top {
		display: flex;
		align-items: flex-end;
		gap: 10px;
	}
	.badge {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		background: var(--sage-tint);
		color: var(--forest);
		font-weight: 800;
		display: flex;
		align-items: center;
		justify-content: center;
		flex: none;
		margin-bottom: 8px;
	}
	.grow {
		flex: 1;
		min-width: 0;
	}
	.rm {
		padding: 0 12px;
		color: var(--danger);
	}
	.nums {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
		gap: 12px;
	}
	.dv {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.vals {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.val {
		min-height: 40px;
		padding: 0 4px 0 12px;
		border-radius: 10px;
		background: var(--sage-tint);
		border: 1.5px solid #cfddd3;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 16px;
	}
	.vl {
		font-size: 13px;
		color: var(--ink-2);
	}
	.val button {
		width: 32px;
		height: 32px;
		border: 0;
		border-radius: 8px;
		background: transparent;
		cursor: pointer;
		color: var(--ink-2);
		font-size: 18px;
	}
	.val button:hover {
		background: #fff;
		color: var(--danger);
	}
	.addval {
		display: flex;
		align-items: flex-end;
		gap: 8px;
		flex-wrap: wrap;
	}
	.field.small {
		width: 90px;
	}
	.dashed {
		border-style: dashed;
		color: var(--forest);
	}
	.note {
		margin: 0;
		font-size: 14px;
		line-height: 1.5;
		color: var(--ink-2);
		background: var(--ground);
		border-radius: 12px;
		padding: 12px 14px;
	}
	.flags {
		display: flex;
		flex-direction: column;
		gap: 4px;
		border-top: 1px dashed var(--line);
		padding-top: 6px;
	}
	.vol {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		background: var(--ground);
		border-radius: var(--r-md);
		padding: 12px 14px;
		flex-wrap: wrap;
	}
	.vol.missing {
		background: var(--danger-tint);
	}
	.vt {
		display: flex;
		flex-direction: column;
		font-size: 14px;
	}
	.vt span {
		color: var(--ink-2);
		font-size: 13px;
	}
	.btn.sm {
		min-height: 40px;
		font-size: 14px;
		padding: 0 14px;
	}
	.actions {
		display: flex;
		gap: 10px;
		justify-content: space-between;
		flex-wrap: wrap;
		border-top: 1px solid var(--line);
		padding-top: 16px;
	}
	.danger {
		color: var(--danger);
	}
	.confirm {
		background: var(--danger-tint);
		border: 1px solid #f3c3bd;
		border-radius: var(--r-md);
		padding: 14px 16px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.confirm p {
		margin: 0;
	}
	.danger-solid {
		background: var(--danger);
		border-color: var(--danger);
		color: #fff;
	}
	.danger-solid:hover {
		color: #fff;
		background: #8f1c13;
	}
	[aria-invalid='true'] {
		border-color: var(--danger);
	}
	@media (max-width: 480px) {
		.editor {
			padding: 18px 14px;
		}
		.row3 {
			grid-template-columns: 1fr;
		}
	}
</style>

<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { stationCodes } from '@scouttavling/domain';
	import StationEditor from '#lib/ui/admin/StationEditor.svelte';
	import { shortDate, stationSummary, tracksText } from '#lib/ui/admin/format.ts';

	let { data, form } = $props();

	const c = $derived(data.competition);
	const base = $derived(`/admin/${c.slug}`);
	const multi = $derived(c.multiDay && data.days.length > 1);
	const codes = $derived(
		stationCodes(
			data.stations.map((s) => ({ id: s.id, dayId: s.dayId, order: s.sort, name: s.name, customCode: s.customCode })),
			data.days.map((d) => ({ id: d.id, prefix: d.prefix }))
		)
	);
	const groups = $derived(
		multi
			? [
					...data.days.map((d) => ({ key: d.id, label: `${d.name} ${shortDate(d.date).replace(/^\S+ /, '')}`, dayId: d.id as string | null, items: data.stations.filter((s) => s.dayId === d.id) })),
					{ key: 'none', label: 'Ingen dag', dayId: null, items: data.stations.filter((s) => !data.days.some((d) => d.id === s.dayId)) }
				].filter((g) => g.dayId || g.items.length)
			: [{ key: 'all', label: '', dayId: null as string | null, items: data.stations }]
	);
	const selectedId = $derived(page.url.searchParams.get('s') ?? data.stations[0]?.id ?? null);
	const selected = $derived(data.stations.find((s) => s.id === selectedId) ?? data.stations[0] ?? null);
	const selKey = $derived(selected ? JSON.stringify(selected) : '');
	const errors = $derived(form && 'errors' in form && form.stationId === selected?.id ? (form.errors as Record<string, string>) : {});
	const listError = $derived(form && 'errors' in form && form.stationId !== selected?.id ? (form.errors as Record<string, string>).form : '');
	const saved = $derived(Boolean(form && 'saved' in form && form.saved === selected?.id));

	function summary(s: (typeof data.stations)[number]) {
		return stationSummary(s.items, c.styleEnabled, tracksText(s.allTracks, s.trackIds, data.tracks));
	}
	function isCheckpoint(s: (typeof data.stations)[number]) {
		return s.items.length > 0 && s.items.every((i) => i.mode === 'CHECKIN' || i.mode === 'AUTO_ON_SCAN');
	}
	function suggestCode(dayId: string | null, name: string) {
		if (!selected) return '';
		const m = stationCodes(
			data.stations.map((s) =>
				s.id === selected.id
					? { id: s.id, dayId: multi ? dayId : s.dayId, order: s.sort, name, customCode: null }
					: { id: s.id, dayId: s.dayId, order: s.sort, name: s.name, customCode: s.customCode }
			),
			data.days.map((d) => ({ id: d.id, prefix: d.prefix }))
		);
		return m.get(selected.id) ?? '';
	}
	const subtitle = $derived(
		multi
			? `${data.stations.length} kontroller över ${data.days.length} dagar`
			: `${data.stations.length} kontroller · ändra ordning med pilarna`
	);
</script>

<svelte:head><title>Kontroller · {c.name}</title></svelte:head>

<header class="head">
	<div class="ht">
		<h1>Kontroller</h1>
		<span class="muted">{subtitle}</span>
	</div>
	<div class="row">
		<a class="btn sm" href="{base}/settings#klasser">Klasser ({data.tracks.length})</a>
		<form method="POST" action="?/create" use:enhance>
			{#if multi && selected?.dayId}<input type="hidden" name="dayId" value={selected.dayId} />{/if}
			<button class="btn btn-primary sm" type="submit">+ Ny kontroll</button>
		</form>
	</div>
</header>

{#if listError}<p class="error-text" role="alert">{listError}</p>{/if}

{#if data.stations.length === 0}
	<section class="card empty">
		<h2>Inga kontroller än</h2>
		<p class="muted">Lägg till den första kontrollen. Varje kontroll kan ha en eller flera delar med egna poängregler.</p>
		<form method="POST" action="?/create" use:enhance><button class="btn btn-accent">+ Ny kontroll</button></form>
	</section>
{:else}
	<div class="split">
		<nav class="list card" aria-label="Kontroller">
			{#each groups as g (g.key)}
				{#if g.label}
					<div class="gh"><span class="gl">{g.label}</span><span class="gc">{g.items.length} st</span></div>
				{/if}
				<ul>
					{#each g.items as s, i (s.id)}
						{@const cur = s.id === selected?.id}
						<li class:cur>
							<a href="?s={s.id}" class="pick" aria-current={cur ? 'true' : undefined} data-sveltekit-noscroll data-sveltekit-replacestate>
								<span class="code" class:cp={isCheckpoint(s)}>{codes.get(s.id)}</span>
								<span class="txt">
									<span class="nm">{s.name}</span>
									<span class="sub">{summary(s)}</span>
								</span>
								{#if !s.invited}<span class="novol" title="Saknar funktionär"><span class="sr-only">Saknar funktionär</span></span>{/if}
							</a>
							<form method="POST" action="?s={selected?.id ?? s.id}&/move" class="mv" use:enhance={() => async ({ update }) => update({ reset: false })}>
								<input type="hidden" name="id" value={s.id} />
								<button name="dir" value="up" disabled={i === 0} aria-label="Flytta {s.name} upp">
									<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
								</button>
								<button name="dir" value="down" disabled={i === g.items.length - 1} aria-label="Flytta {s.name} ner">
									<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
								</button>
							</form>
						</li>
					{/each}
				</ul>
				{#if multi && g.dayId}
					<form method="POST" action="?/create" class="addday" use:enhance>
						<input type="hidden" name="dayId" value={g.dayId} />
						<button class="linkish" type="submit">+ Kontroll på {g.label.split(' ')[0].toLowerCase()}</button>
					</form>
				{/if}
			{/each}
			{#if data.stations.some((x) => !x.invited)}
				<p class="legend"><span class="novol" aria-hidden="true"></span> = saknar funktionär (ingen inbjudan)</p>
			{/if}
		</nav>

		<div class="edit">
			{#if selected}
				{#key selKey}
					<StationEditor
						station={selected}
						days={data.days}
						tracks={data.tracks}
						compStyle={c.styleEnabled}
						multiDay={multi}
						{suggestCode}
						{errors}
						{saved}
						invitesHref="{base}/invites"
					/>
				{/key}
			{/if}
		</div>
	</div>
{/if}

<style>
	.head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 16px;
		flex-wrap: wrap;
	}
	.ht {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	h1 {
		font-size: 34px;
		font-weight: 800;
		letter-spacing: -0.03em;
	}
	.btn.sm {
		min-height: 44px;
		font-size: 14px;
		padding: 0 16px;
	}
	.split {
		display: flex;
		flex-wrap: wrap;
		gap: 18px;
		align-items: flex-start;
	}
	.list {
		flex: 1 1 320px;
		min-width: 0;
		padding: 6px;
		display: flex;
		flex-direction: column;
	}
	@media (min-width: 1100px) {
		.list {
			position: sticky;
			top: 16px;
			max-height: calc(100dvh - 32px);
			overflow-y: auto;
		}
	}
	.edit {
		flex: 999 1 520px;
		min-width: 0;
	}
	.gh {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		padding: 12px 10px 4px;
	}
	.gl {
		font-size: 12px;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--forest);
	}
	.gc {
		font-size: 12px;
		color: var(--ink-2);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	li {
		display: flex;
		align-items: center;
		border-radius: 12px;
		gap: 2px;
	}
	li:hover {
		background: var(--sage-tint);
	}
	li.cur {
		background: var(--moss-tint);
		box-shadow: inset 0 0 0 2px var(--forest);
	}
	.pick {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 6px 8px 10px;
		min-height: 52px;
		text-decoration: none;
		color: var(--ink);
		border-radius: 12px;
	}
	.pick:hover {
		color: var(--ink);
	}
	.code {
		min-width: 40px;
		height: 32px;
		padding: 0 4px;
		border-radius: 9px;
		background: var(--sage-tint);
		color: var(--forest);
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 800;
		font-size: 14px;
		flex: none;
	}
	.cur .code {
		background: #fff;
	}
	.code.cp {
		background: #ffe3d3;
		color: var(--accent-ink);
	}
	.txt {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
	}
	.nm {
		font-weight: 800;
		font-size: 14px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sub {
		font-size: 12px;
		color: var(--ink-2);
	}
	.novol {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--accent);
		flex: none;
	}
	.legend {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--ink-2);
		padding: 10px 10px 6px;
		border-top: 1px solid var(--line);
		margin-top: 6px;
	}
	.mv {
		display: flex;
		flex-direction: column;
		padding-right: 4px;
	}
	.mv button {
		width: 36px;
		height: 24px;
		border: 0;
		border-radius: 6px;
		background: transparent;
		color: var(--ink-2);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.mv button:hover:not(:disabled) {
		background: #fff;
		color: var(--forest);
	}
	.mv button:disabled {
		opacity: 0.25;
		cursor: default;
	}
	.addday {
		padding: 2px 10px 8px;
	}
	.linkish {
		border: 0;
		background: none;
		color: var(--forest);
		font-weight: 800;
		font-size: 13px;
		cursor: pointer;
		padding: 6px 0;
		min-height: 32px;
	}
	.linkish:hover {
		text-decoration: underline;
	}
	.empty {
		display: flex;
		flex-direction: column;
		gap: 10px;
		align-items: flex-start;
		padding: 32px;
	}
	.empty p {
		margin: 0;
	}
</style>

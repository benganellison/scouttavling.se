<script lang="ts">
	import TrackChip from '#lib/ui/brand/TrackChip.svelte';
	import '#lib/ui/patrols/prep.css';
	import StatusPill from '#lib/ui/patrols/StatusPill.svelte';
	import { PATROL_STATUS_LABEL, STATUS_ORDER } from '#lib/ui/patrols/labels.ts';
	import { enhance } from '$app/forms';

	let { data } = $props();

	let q = $state('');
	let track = $state('');
	let status = $state('');

	const base = $derived(`/admin/${data.competition.slug}`);
	const shown = $derived(
		data.patrols.filter((p) => {
			if (track === '__none' ? p.trackId : track && p.trackId !== track) return false;
			if (status && p.status !== status) return false;
			if (!q.trim()) return true;
			const needle = q.trim().toLowerCase();
			return [String(p.number), p.name, p.troop, p.contactName, p.track].some((s) => s.toLowerCase().includes(needle));
		})
	);
	const memberTotal = $derived(data.patrols.reduce((a, p) => a + p.members, 0));
</script>

<svelte:head><title>Patruller · {data.competition.name}</title></svelte:head>

<div class="prep">
	<header class="prep-head">
		<div>
			<h1>Patruller</h1>
			<p>{data.patrols.length} patruller · {memberTotal} scouter</p>
		</div>
		<div class="row">
			<a class="btn" href="{base}/import">Importera</a>
			<a class="btn btn-accent" href="{base}/patrols/new">+ Lägg till patrull</a>
		</div>
	</header>

	<div class="filters row">
		<div class="field grow">
			<label for="q">Sök</label>
			<input id="q" type="text" bind:value={q} placeholder="Nummer, namn, kår eller kontakt" autocomplete="off" />
		</div>
		<div class="field">
			<label for="track">Klass</label>
			<select id="track" bind:value={track}>
				<option value="">Alla klasser</option>
				{#each data.tracks as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
				<option value="__none">Utan klass</option>
			</select>
		</div>
		<div class="field">
			<label for="status">Status</label>
			<select id="status" bind:value={status}>
				<option value="">Alla</option>
				{#each STATUS_ORDER as s (s)}<option value={s}>{PATROL_STATUS_LABEL[s]}</option>{/each}
			</select>
		</div>
	</div>

	<div class="prep-table-wrap">
		{#if data.patrols.length === 0}
			<div class="empty stack">
				<strong>Inga patruller ännu.</strong>
				<span>Importera från Scoutnet eller ett kalkylark, eller lägg till en i taget.</span>
				<div class="row" style="justify-content:center">
					<a class="btn btn-primary" href="{base}/import">Importera patruller</a>
				</div>
			</div>
		{:else}
			<table class="prep-table">
				<thead>
					<tr>
						<th scope="col">Nr</th>
						<th scope="col">Patrull</th>
						<th scope="col">Klass</th>
						<th scope="col">Kår</th>
						<th scope="col">Kontakt</th>
						<th scope="col">Scouter</th>
						<th scope="col">Status</th>
						<th scope="col">Start</th>
						<th scope="col">Betald</th>
					</tr>
				</thead>
				<tbody>
					{#each shown as p (p.id)}
						<tr>
							<td class="num nr">{p.number}</td>
							<td><a class="name" href="{base}/patrols/{p.number}/edit">{p.name}</a></td>
							<td
								>{#if p.track}<span class="trk"><TrackChip color={p.trackId ? data.trackColors[p.trackId] : null} />{p.track}</span>{:else}<span
										class="pill pill-warn">Ingen klass</span
									>{/if}</td
							>
							<td>{p.troop}</td>
							<td>
								<span class="contact">{p.contactName}</span>
								{#if p.contactPhone}<span class="muted small">{p.contactPhone}</span>{/if}
							</td>
							<td class="num">{p.members}</td>
							<td><StatusPill status={p.status} /></td>
							<td>
								{#if p.start}
									<span class="code" title={p.start.name}>{p.start.code}</span>
									{#if p.startLocked}<span class="sr-only">(låst)</span><svg
											width="14"
											height="14"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2.2"
											aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path></svg
										>{/if}
								{:else}<span class="muted">—</span>{/if}
							</td>
							<td>
								<form method="POST" action="?/togglePaid" use:enhance>
									<input type="hidden" name="id" value={p.id} />
									<input type="hidden" name="paid" value={p.paid ? '0' : '1'} />
									<button class="paid" class:on={p.paid} aria-pressed={p.paid} aria-label="Betald: {p.name}">{p.paid ? 'Ja' : 'Nej'}</button>
								</form>
							</td>
						</tr>
					{:else}
						<tr><td colspan="9" class="empty">Inga patruller matchar sökningen.</td></tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
</div>

<style>
	.filters {
		align-items: flex-end;
	}
	.grow {
		flex: 1 1 280px;
	}
	.filters .field:not(.grow) {
		flex: 0 1 220px;
	}
	.nr {
		font-size: 18px;
	}
	.name {
		font-weight: 800;
		text-decoration: none;
	}
	.name:hover {
		text-decoration: underline;
	}
	.contact {
		display: block;
	}
	.small {
		font-size: 12px;
	}
	.code {
		font-weight: 800;
		background: var(--tint);
		border-radius: 8px;
		padding: 3px 8px;
		margin-right: 4px;
	}
	.paid {
		min-height: 36px;
		min-width: 56px;
		border-radius: 10px;
		border: 1.5px solid var(--line-strong);
		background: var(--surface);
		font-weight: 800;
		cursor: pointer;
	}
	.paid.on {
		background: var(--ok-tint);
		border-color: var(--ok);
		color: var(--brand-2);
	}
	.trk {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}
</style>

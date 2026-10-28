<script lang="ts">
	import AuditList from '#lib/ui/admin/AuditList.svelte';

	let { data } = $props();
</script>

<svelte:head><title>Händelselogg · Plattformsadmin</title></svelte:head>

<h1 class="sa-h1">Händelselogg</h1>
<p class="muted lead">
	Allt som rör ägare, plattformsadmin och borttagning av personuppgifter. Loggen kan inte ändras eller raderas. Namn visas som de är i dag; loggen sparar bara
	id:n.
</p>

<form method="GET" class="filters card">
	<div class="field">
		<label for="f-action">Händelse</label>
		<select id="f-action" name="action">
			{#each Object.entries(data.groups) as [k, label] (k)}<option value={k} selected={data.filter.action === k}>{label}</option>{/each}
		</select>
	</div>
	<div class="field">
		<label for="f-who">Vem</label>
		<select id="f-who" name="who">
			<option value="" selected={data.filter.who === ''}>Alla</option>
			<option value="admin" selected={data.filter.who === 'admin'}>Bara plattformsadmin</option>
		</select>
	</div>
	<div class="field">
		<label for="f-slug">Tävlingens eller seriens adress</label>
		<input id="f-slug" name="slug" value={data.filter.slug} placeholder="t.ex. gokopen-2027" />
	</div>
	<div class="field">
		<label for="f-from">Från</label>
		<input id="f-from" name="from" type="date" value={data.filter.from} />
	</div>
	<div class="field">
		<label for="f-to">Till</label>
		<input id="f-to" name="to" type="date" value={data.filter.to} />
	</div>
	<div class="btns">
		<button class="btn btn-primary">Filtrera</button>
		<a class="btn btn-ghost" href="/site-admin/audit">Rensa</a>
	</div>
</form>

{#if data.notFound}<p class="error-text" role="alert">Ingen tävling eller serie har adressen {data.filter.slug}.</p>{/if}
<section class="card list" aria-label="Händelser">
	<p class="muted small">{data.rows.length} händelser{data.rows.length === 300 ? ' (de senaste 300)' : ''}</p>
	<AuditList rows={data.rows} showTarget siteLinks />
</section>

<style>
	.lead {
		margin: -8px 0 0;
		max-width: 760px;
	}
	.filters {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 190px), 1fr));
		gap: 12px;
		padding: 16px 18px;
		align-items: end;
	}
	.btns {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.list {
		padding: 8px 18px 4px;
	}
	.small {
		font-size: 13px;
		margin: 6px 0;
	}
</style>

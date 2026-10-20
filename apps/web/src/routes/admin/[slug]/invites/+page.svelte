<script lang="ts">
	import '#lib/ui/patrols/prep.css';
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	const LABEL: Record<string, { t: string; cls: string }> = {
		joined: { t: 'Har gått med', cls: 'pill-ok' },
		invited: { t: 'Inbjuden', cls: '' },
		missing: { t: 'Saknas', cls: 'pill-warn' }
	};

	let copied = $state(false);
	let confirmRotate = $state(false);
	const sel = $derived(data.selected);
	const isSF = $derived(sel.id === 'startfinish');
	const joinedCount = $derived(data.rows.filter((r) => r.status === 'joined').length);

	async function copy() {
		if (!sel.link) return;
		try {
			await navigator.clipboard.writeText(sel.link);
			copied = true;
			setTimeout(() => (copied = false), 2500);
		} catch {
			copied = false;
		}
	}
</script>

<svelte:head><title>Funktionärer · {data.competition.name}</title></svelte:head>

<div class="prep">
	<header class="prep-head">
		<div>
			<h1>Funktionärer</h1>
			<p>Inga konton att skapa. Varje kontroll har en egen QR-kod — den som skannar den hamnar direkt på rätt kontroll.</p>
		</div>
		<nav class="tabs" aria-label="Roll">
			<a href="?s={data.rows[0]?.id ?? 'startfinish'}" data-sveltekit-noscroll aria-current={!isSF ? 'page' : undefined}>Kontroller · {data.rows.length}</a>
			<a href="?s=startfinish" data-sveltekit-noscroll aria-current={isSF ? 'page' : undefined}>Start &amp; mål</a>
		</nav>
	</header>

	<div class="split">
		<section class="list" aria-labelledby="list-h">
			<h2 id="list-h" class="sr-only">Kontroller och funktionärer</h2>
			<table class="prep-table">
				<thead>
					<tr><th scope="col">Kontroll</th><th scope="col">Funktionärer</th><th scope="col">Status</th></tr>
				</thead>
				<tbody>
					{#each [...data.rows, data.startFinish] as r (r.id)}
						<tr class:on={r.id === sel.id} class:sf={r.id === 'startfinish'}>
							<td>
								<a class="rowlink" href="?s={r.id}" data-sveltekit-noscroll data-sveltekit-keepfocus aria-current={r.id === sel.id ? 'true' : undefined}>
									<span class="code">{r.code}</span>
									<span class="sname">{r.name}</span>
								</a>
							</td>
							<td class:muted={!r.devices.length}>{r.devices.length ? r.devices.join(', ') : '— ingen ännu'}</td>
							<td><span class="pill {LABEL[r.status].cls}">{LABEL[r.status].t}</span></td>
						</tr>
					{/each}
				</tbody>
			</table>
			<p class="foot muted">{joinedCount} av {data.rows.length} kontroller har en funktionär som gått med.</p>
		</section>

		<section class="panel" aria-labelledby="inv-h">
			<div>
				<span class="eyebrow">Inbjudan{#if sel.generation > 1} · kod {sel.generation}{/if}</span>
				<h2 id="inv-h">{isSF ? 'Start & mål' : `${sel.code} · ${sel.name}`}</h2>
			</div>
			{#if sel.qr && sel.link}
				<div class="qr" role="img" aria-label="QR-kod för att gå med {isSF ? 'i start och mål' : `på kontroll ${sel.code}`}">
					{@html sel.qr}
				</div>
				<p class="hint">Skanna med mobilkameran. Fungerar för flera funktionärer på samma {isSF ? 'station' : 'kontroll'}.</p>
				<div class="linkbox">
					<label for="invlink" class="sr-only">Inbjudningslänk</label>
					<input id="invlink" type="text" readonly value={sel.link} onfocus={(e) => e.currentTarget.select()} />
				</div>
				<button type="button" class="btn btn-accent" onclick={copy}>{copied ? 'Länken är kopierad' : 'Kopiera länk'}</button>
				<span class="sr-only" role="status">{copied ? 'Länken är kopierad' : ''}</span>
				{#if !isSF}<a class="printlink" href="/admin/{data.competition.slug}/print/signs">QR-koden finns också på kontrollskylten i utskrifterna</a>{/if}
				{#if !confirmRotate}
					<button type="button" class="rotate" onclick={() => (confirmRotate = true)}>Skapa ny kod (gamla slutar fungera)</button>
				{:else}
					<form method="POST" action="?s={sel.id}&/rotate" class="confirm" use:enhance={() => async ({ update }) => { await update(); confirmRotate = false; }}>
						<input type="hidden" name="target" value={sel.id} />
						<span>Den gamla QR-koden och länken slutar fungera. Utskrivna skyltar måste skrivas ut igen.</span>
						<div class="row">
							<button class="btn btn-accent btn-sm">Ja, skapa ny kod</button>
							<button type="button" class="btn btn-onforest btn-sm" onclick={() => (confirmRotate = false)}>Avbryt</button>
						</div>
					</form>
				{/if}
			{:else}
				<p class="hint">
					{sel.hasInvite ? 'Den här koden kan inte visas igen. Skapa en ny kod för att få en QR-kod.' : 'Ingen inbjudan ännu. Skapa en kod och ge den till funktionären — via skylten, sms eller e-post.'}
				</p>
				<form method="POST" action="?s={sel.id}&/rotate" use:enhance>
					<input type="hidden" name="target" value={sel.id} />
					<button class="btn btn-accent wide">{sel.hasInvite ? 'Skapa ny kod' : 'Skapa inbjudan'}</button>
				</form>
			{/if}
			{#if form?.message}<p class="error-text" role="alert">{form.message}</p>{/if}
		</section>
	</div>
</div>

<style>
	.tabs {
		display: flex;
		gap: 6px;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 4px;
	}
	.tabs a {
		padding: 10px 16px;
		border-radius: 999px;
		color: var(--ink-2);
		font-weight: 700;
		font-size: 14px;
		text-decoration: none;
	}
	.tabs a[aria-current] {
		background: var(--forest);
		color: #fff;
		font-weight: 800;
	}
	.split {
		display: flex;
		flex-wrap: wrap;
		gap: 18px;
		align-items: flex-start;
	}
	.list {
		flex: 999 1 480px;
		min-width: 0;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		overflow-x: auto;
	}
	.list tr.on td {
		background: var(--moss-tint);
	}
	.list tr.on td:first-child {
		box-shadow: inset 4px 0 0 var(--forest);
	}
	.list tr.sf td {
		border-top: 2px solid var(--line);
	}
	.rowlink {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 40px;
		text-decoration: none;
		color: var(--ink);
	}
	.rowlink:hover .sname {
		text-decoration: underline;
	}
	.code {
		min-width: 36px;
		height: 30px;
		padding: 0 6px;
		border-radius: 8px;
		background: var(--sage-tint);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-weight: 800;
		font-size: 13px;
		flex: none;
	}
	.sname {
		font-weight: 800;
	}
	.foot {
		margin: 0;
		padding: 12px 18px;
		font-size: 13px;
		border-top: 1px solid var(--line);
	}
	.panel {
		flex: 1 1 340px;
		min-width: 0;
		background: var(--forest);
		color: #fff;
		border-radius: 20px;
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		position: sticky;
		top: 16px;
	}
	.eyebrow {
		font-size: 12px;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--flag-soft);
	}
	.panel h2 {
		font-size: 26px;
		margin-top: 2px;
	}
	.qr {
		background: #fff;
		border-radius: 18px;
		padding: 18px;
		display: flex;
		justify-content: center;
	}
	.qr :global(svg) {
		width: 220px;
		height: 220px;
		display: block;
	}
	.hint {
		margin: 0;
		font-size: 14px;
		color: var(--on-forest);
		text-align: center;
		line-height: 1.45;
	}
	.linkbox input {
		background: var(--forest-dark);
		border-color: #4e7d66;
		color: #fff;
		font-size: 13px;
	}
	.printlink {
		color: #fff;
		font-weight: 700;
		font-size: 14px;
		text-align: center;
	}
	.printlink:hover {
		color: var(--flag-soft);
	}
	.rotate {
		min-height: 44px;
		border: 0;
		background: transparent;
		color: var(--flag-soft);
		font-weight: 800;
		font-size: 14px;
		cursor: pointer;
	}
	.confirm {
		display: flex;
		flex-direction: column;
		gap: 10px;
		background: var(--forest-dark);
		border-radius: 14px;
		padding: 14px;
		font-size: 14px;
		color: var(--on-forest);
	}
	.btn-onforest {
		background: transparent;
		border-color: #4e7d66;
		color: #fff;
	}
	.btn-onforest:hover {
		color: #fff;
		border-color: #fff;
	}
	.wide {
		width: 100%;
	}
	.panel .error-text {
		color: var(--flag-soft);
	}
</style>

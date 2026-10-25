<script lang="ts">
	import { enhance } from '$app/forms';
	import Kpi from '#lib/ui/admin/Kpi.svelte';
	import LiveBadge from '#lib/ui/live/LiveBadge.svelte';
	import { LiveStream } from '#lib/ui/live/liveStore.svelte.ts';

	let { data } = $props();

	const live = new LiveStream(() => ({ url: `/api/v1/live/${data.comp.slug}/events`, depends: `live:${data.comp.slug}`, refreshMs: 60_000 }));

	const base = $derived(`/admin/${data.comp.slug}`);
	const pct = (done: number, expected: number) => (expected ? Math.min(100, Math.round((done / expected) * 100)) : 0);
</script>

<svelte:head><title>Ledningscentralen · {data.comp.name}</title></svelte:head>

<div class="page stack">
	<header class="head">
		<div class="stack tight">
			<h1>Ledningscentralen</h1>
			<div class="row sub">
				<span class="muted">{data.comp.name}</span>
				<LiveBadge status={live.status} />
			</div>
		</div>
		<div class="row actions">
			<a class="btn" href="{base}/messages">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 5h16v11H8l-4 4z" /></svg>
				Skicka meddelande
			</a>
			<form method="POST" action="?/backup" use:enhance>
				<input type="hidden" name="on" value={data.comp.backupMode ? '0' : '1'} />
				<button class="btn backup" class:on={data.comp.backupMode} aria-pressed={data.comp.backupMode}>
					<span class="switch" aria-hidden="true"></span>
					{data.comp.backupMode ? 'Avsluta reservläge' : 'Starta reservläge'}
				</button>
			</form>
		</div>
	</header>

	{#if data.comp.backupMode}
		<div class="banner" role="alert">
			<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M12 3 2 21h20zM12 10v5M12 18v.5" /></svg>
			<div>
				<strong>Reservläge är på.</strong> Alla funktionärer har uppmanats att skriva poäng på papperslappar tills reservläget avslutas.
			</div>
			<a href="{base}/live/paper">Registrera papperslappar →</a>
		</div>
	{/if}

	<section class="kpis" aria-label="Läget just nu">
		<Kpi label="På banan" value={data.kpi.active} />
		{#if data.comp.multiDay || data.kpi.camp}<Kpi label="I läger" value={data.kpi.camp} note="klara för dagen" />{/if}
		<Kpi label="I mål" value={data.kpi.finished} />
		<Kpi label="Ej startade" value={data.kpi.registered} />
		<Kpi label="Återbud" value={data.kpi.resigned} />
		<Kpi label="Rapporter" value={data.kpi.reports} />
		<Kpi label="Funktionärer online" value={data.kpi.devicesOnline} of={data.kpi.devicesTotal ? ` / ${data.kpi.devicesTotal}` : ''} />
	</section>

	<div class="cols">
		<section class="stack" aria-labelledby="st-h">
			<h2 id="st-h">Kontroller</h2>
			<ul class="tiles">
				{#each data.tiles as t (t.id)}
					<li class="tile {t.state}" class:cp={t.checkpoint}>
						<div class="t-top">
							<span class="code">{t.code}</span>
							<span class="dot {t.state}" title={t.state === 'online' ? 'Online' : t.state === 'none' ? 'Ingen enhet' : 'Offline'}></span>
						</div>
						<span class="name">{t.name}</span>
						{#if t.finishSets}<span class="role">Sätter {t.finishSets === 'camp' ? 'I läger' : 'I mål'}</span>{/if}
						<div class="bar" role="progressbar" aria-valuemin={0} aria-valuemax={t.expected} aria-valuenow={t.done} aria-label="{t.name}: {t.done} av {t.expected}">
							<span style="width: {pct(t.done, t.expected)}%"></span>
						</div>
						<div class="t-foot">
							<span class="num">{t.done}/{t.expected}</span>
							<span class="note">
								{#if t.state === 'offline'}
									Offline {t.offlineMinutes !== null ? `${t.offlineMinutes} min` : ''}
								{:else if t.state === 'stale'}
									Tyst {t.offlineMinutes} min
								{:else if t.state === 'none'}
									Ingen enhet
								{:else if t.expected - t.done > 0}
									{t.expected - t.done} kvar
								{:else}
									Klar
								{/if}
							</span>
						</div>
					</li>
				{/each}
			</ul>
		</section>

		<aside class="stack side">
			<section class="card stack alarms" aria-labelledby="al-h">
				<div class="row between">
					<h2 id="al-h">Behöver uppmärksamhet</h2>
					{#if data.alarms.length}<span class="count">{data.alarms.length}</span>{/if}
				</div>
				{#if data.alarms.length === 0}
					<p class="muted small">Inget att åtgärda just nu.{data.acknowledged ? ` ${data.acknowledged} kvitterade.` : ''}</p>
				{:else}
					<ul class="alist">
						{#each data.alarms as a (a.key)}
							<li class="alarm {a.kind}">
								<div class="a-text">
									{#if a.href}<a href={a.href}><strong>{a.title}</strong></a>{:else}<strong>{a.title}</strong>{/if}
									<span class="muted small">{a.detail}</span>
								</div>
								<form method="POST" action="?/ack" use:enhance>
									<input type="hidden" name="key" value={a.key} />
									<button class="btn ack">Kvittera</button>
								</form>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<section class="card stack" aria-labelledby="feed-h">
				<h2 id="feed-h">Senaste rapporter</h2>
				{#if data.feed.length === 0}
					<p class="muted small">Inga rapporter ännu.</p>
				{:else}
					<ol class="feed" data-testid="feed">
						{#each data.feed as f (f.id)}
							<li>
								<span class="time">{f.time}</span>
								<span class="fcode">{f.code}</span>
								<span class="fmain">
									<a href="{base}/patrol/{f.patrolNumber}">{f.patrol}</a>
									<span class="muted small">{f.what} · {f.by}{f.edited ? ' · ändrad' : ''}</span>
								</span>
								<span class="fpts">
									{f.state === 'void' ? 'ångrad' : f.stylePoints ? `${f.points} + ${f.stylePoints}` : `${f.points}`}
								</span>
							</li>
						{/each}
					</ol>
				{/if}
			</section>
		</aside>
	</div>
</div>

<style>
	.page {
		gap: 22px;
	}
	.tight {
		gap: 6px;
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
		justify-content: space-between;
		align-items: flex-start;
	}
	h1 {
		font-size: 34px;
	}
	h2 {
		font-size: 20px;
	}
	.sub {
		gap: 10px;
	}
	.actions form {
		margin: 0;
	}
	.backup .switch {
		width: 34px;
		height: 20px;
		border-radius: 999px;
		background: var(--line-strong);
		position: relative;
		flex: none;
	}
	.backup .switch::after {
		content: '';
		position: absolute;
		top: 3px;
		left: 3px;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: #fff;
		transition: left 0.15s;
	}
	.backup.on {
		border-color: var(--danger);
		color: var(--danger);
	}
	.backup.on .switch {
		background: var(--danger);
	}
	.backup.on .switch::after {
		left: 17px;
	}
	.banner {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 12px 16px;
		background: var(--danger);
		color: #fff;
		border-radius: var(--r-lg);
		padding: 14px 20px;
	}
	.banner div {
		flex: 1 1 320px;
	}
	.banner a {
		color: #fff;
		font-weight: 800;
	}
	.role {
		font-size: 12px;
		font-weight: 700;
		color: var(--ink-2);
	}
	.kpis {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 12px;
	}
	.cols {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(300px, 400px);
		gap: 22px;
		align-items: start;
	}
	@media (max-width: 1100px) {
		.cols {
			grid-template-columns: 1fr;
		}
	}
	.tiles {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
		gap: 12px;
	}
	.tile {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		padding: 14px 16px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}
	/* Checkpoints are told apart neutrally; tints are reserved for tiles that need attention. */
	.tile.cp {
		border-style: dashed;
		border-color: var(--line-strong);
	}
	.tile.stale {
		border: 2px solid var(--orange);
	}
	.tile.offline {
		border: 2px solid var(--danger);
		background: var(--danger-tint);
	}
	.t-top {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.code {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 26px;
		line-height: 1;
	}
	.dot {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: var(--line-strong);
	}
	.dot.online {
		background: var(--ok);
		box-shadow: 0 0 0 4px var(--ok-tint);
	}
	.dot.stale {
		background: var(--orange);
	}
	.dot.offline {
		background: var(--danger);
	}
	.name {
		font-weight: 700;
		font-size: 14px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.bar {
		height: 8px;
		border-radius: 999px;
		background: var(--tint);
		overflow: hidden;
	}
	.bar span {
		display: block;
		height: 100%;
		background: var(--brand);
		border-radius: 999px;
	}
	.t-foot {
		display: flex;
		justify-content: space-between;
		font-size: 13px;
		font-weight: 700;
	}
	.num {
		font-variant-numeric: tabular-nums;
	}
	.note {
		color: var(--ink-2);
	}
	.offline .note {
		color: var(--danger);
	}
	.stale .note {
		color: var(--warn-ink);
	}
	.between {
		justify-content: space-between;
	}
	.count {
		background: var(--cta);
		color: #fff;
		font-weight: 800;
		border-radius: 999px;
		min-width: 28px;
		height: 28px;
		display: inline-grid;
		place-items: center;
		padding: 0 8px;
	}
	.small {
		font-size: 13px;
		margin: 0;
	}
	.alist,
	.feed {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.alarm {
		display: flex;
		gap: 12px;
		align-items: center;
		padding: 10px 0 10px 12px;
		border-left: 4px solid var(--orange);
		border-top: 1px solid var(--line);
	}
	.alarm.offline {
		border-left-color: var(--danger);
	}
	.alarm.conflict {
		border-left-color: var(--cta);
	}
	.a-text {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.a-text a {
		color: var(--ink);
	}
	.alarm form {
		margin: 0;
	}
	.ack {
		min-height: 40px;
		padding: 0 12px;
		font-size: 14px;
	}
	.feed li {
		display: grid;
		grid-template-columns: 44px 40px 1fr auto;
		gap: 8px;
		align-items: center;
		padding: 9px 0;
		border-top: 1px solid var(--line);
	}
	.time {
		font-size: 13px;
		color: var(--ink-2);
		font-variant-numeric: tabular-nums;
	}
	.fcode {
		font-family: var(--font-display);
		font-weight: 800;
	}
	.fmain {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.fmain a {
		font-weight: 700;
		color: var(--ink);
		text-decoration: none;
	}
	.fpts {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 18px;
		white-space: nowrap;
	}
</style>

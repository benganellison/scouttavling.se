<script lang="ts">
	import { enhance } from '$app/forms';
	import Topbar from '#lib/ui/admin/Topbar.svelte';
	import StatusPill from '#lib/ui/admin/StatusPill.svelte';
	import BrandingEditor from '#lib/ui/admin/BrandingEditor.svelte';
	import ColorField from '#lib/ui/brand/ColorField.svelte';
	import { dateRange } from '#lib/ui/admin/format.ts';

	let { data, form } = $props();
	const s = $derived(data.series);
	const errs = (section: string): Record<string, string> => (form && form.section === section && 'errors' in form ? (form.errors as Record<string, string>) : {});
	const ok = (section: string) => Boolean(form && form.section === section && 'ok' in form && form.ok);
	const nextExists = $derived(data.next ? data.editions.find((e) => e.name === data.next!.name) : null);
	const keep = () => async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => update({ reset: false });
</script>

<svelte:head><title>{s.name} · Serie</title></svelte:head>

<div class="page">
	<Topbar userName={data.user.name} />

	<header class="head">
		<div class="stack tight">
			<a class="back" href="/admin">Mina tävlingar</a>
			<span class="muted kicker">Tävlingsserie</span>
			<h1>{s.name}</h1>
			<span class="muted">Publik sida: <a href="/t/{s.slug}">scouttavling.se/t/{s.slug}</a></span>
		</div>
		{#if data.next && !nextExists}
			<a class="btn btn-accent" href="/admin/{data.next.from}/next-edition" data-testid="series-next">Skapa {data.next.name}</a>
		{/if}
	</header>

	<section class="card sec" aria-labelledby="h-eds">
		<h2 id="h-eds">År</h2>
		<p class="muted lead">Varje år är en egen tävling. Avslutade år visas under "Tidigare år" på seriens sida, med vinnarna i varje klass, om du inte döljer dem.</p>
		{#if errs('editions').editions}<p class="error-text" role="alert">{errs('editions').editions}</p>{/if}
		<ul class="eds">
			{#each data.editions as e (e.slug)}
				<li data-testid="edition-{e.year}">
					<span class="y">{e.year}</span>
					<div class="e-main">
						<a class="e-name" href="/admin/{e.slug}">{e.name}</a>
						<span class="muted small">{dateRange(e.startDate, e.endDate)}{e.location ? ` · ${e.location}` : ''} · {e.patrols} {e.patrols === 1 ? 'patrull' : 'patruller'}</span>
					</div>
					<div class="e-side">
						{#if e.anonymised}<span class="pill arch">Arkiverad</span>{:else}<StatusPill status={e.status} />{/if}
						{#if e.status === 'closed'}
							<form method="POST" action="?/archive" use:enhance={keep}>
								<input type="hidden" name="edition" value={e.slug} />
								<input type="hidden" name="show" value={e.archivePublic ? '0' : '1'} />
								<button class="btn btn-ghost sm" aria-label="{e.archivePublic ? 'Dölj' : 'Visa'} {e.year} i det publika arkivet">
									{e.archivePublic ? 'Dölj i arkivet' : 'Visa i arkivet'}
								</button>
							</form>
							{#if !e.archivePublic}<span class="muted small" data-testid="hidden-{e.year}">Dold</span>{/if}
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	</section>

	<section class="card sec" id="utseende" aria-labelledby="h-look">
		<h2 id="h-look">Utseende för hela serien</h2>
		<BrandingEditor
			level="series"
			name={s.name}
			organiserName={s.ownerGroupName}
			accentColor={s.accentColor}
			coverFit={s.coverFit}
			branding={data.branding}
			canEdit
			errors={errs('appearance')}
			saved={ok('appearance')}
			uploaded={form && 'uploaded' in form ? String(form.uploaded) : null}
		/>
	</section>

	<section class="card sec" aria-labelledby="h-cls">
		<h2 id="h-cls">Klassfärger</h2>
		<p class="muted lead">Färgen följer klassens namn till varje nytt år. Ett år kan ändå ge en klass en egen färg under sina inställningar.</p>
		<form method="POST" action="?/classColors" class="stack" use:enhance={keep}>
			<ul class="cls">
				{#each data.classes as k (k.name)}
					<li>
						<input type="hidden" name="class" value={k.name} />
						<span class="cls-name">{k.name}</span>
						<ColorField id="cc-{k.name}" name="color_{k.name}" label={k.name} value={k.color ?? ''} fallback={k.fallback ?? '#5c6570'} compact />
						{#if errs('classes')[`color_${k.name}`]}<span class="error-text">{errs('classes')[`color_${k.name}`]}</span>{/if}
					</li>
				{/each}
			</ul>
			<div class="act">
				<button class="btn btn-primary">Spara klassfärger</button>
				{#if ok('classes')}<span class="pill pill-ok" role="status">Sparat</span>{/if}
			</div>
		</form>
	</section>
</div>

<style>
	.page {
		max-width: 1000px;
		margin: 0 auto;
		padding: 28px 24px 64px;
		display: flex;
		flex-direction: column;
		gap: 22px;
	}
	.head {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		gap: 16px;
		flex-wrap: wrap;
	}
	.tight {
		gap: 4px;
	}
	.back {
		font-weight: 700;
		color: var(--ink-2);
		margin-bottom: 6px;
	}
	.kicker {
		font-weight: 700;
		font-size: 14px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	h1 {
		font-size: clamp(32px, 5vw, 44px);
		font-weight: 800;
		letter-spacing: -0.03em;
	}
	.sec {
		padding: 22px 24px;
		border-radius: 20px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.sec h2 {
		font-size: 20px;
		margin: 0;
	}
	.lead {
		margin: -8px 0 0;
	}
	.small {
		font-size: 13px;
	}
	.sm {
		min-height: 40px;
		font-size: 14px;
	}
	.eds,
	.cls {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.eds li {
		display: flex;
		gap: 16px;
		align-items: center;
		flex-wrap: wrap;
		padding: 12px 0;
		border-top: 1px solid var(--line);
	}
	.eds li:first-child {
		border-top: 0;
	}
	.y {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 26px;
		color: var(--brand);
		width: 64px;
	}
	.e-main {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1 1 220px;
		min-width: 0;
	}
	.e-name {
		font-weight: 800;
		font-size: 17px;
	}
	.e-side {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}
	.e-side form {
		margin: 0;
	}
	.arch {
		background: var(--tint);
		border: 1px solid var(--line);
		color: var(--ink);
	}
	.cls {
		gap: 10px;
	}
	.cls li {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
		padding-bottom: 10px;
		border-bottom: 1px solid var(--line);
	}
	.cls-name {
		font-weight: 800;
		min-width: 120px;
	}
	.act {
		display: flex;
		gap: 10px;
		align-items: center;
		flex-wrap: wrap;
	}
	@media (max-width: 480px) {
		.page {
			padding: 18px 16px 48px;
		}
	}
</style>

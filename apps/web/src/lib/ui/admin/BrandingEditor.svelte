<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import ColorField from '#lib/ui/brand/ColorField.svelte';
	import EventLogo from '#lib/ui/brand/EventLogo.svelte';
	import ScouternaLogo from '#lib/ui/brand/ScouternaLogo.svelte';
	import ScouternaSymbol from '#lib/ui/brand/ScouternaSymbol.svelte';
	import { SCOUTBLA, parseHex, readableText } from '#lib/brand/colors.ts';
	import { effectiveCoverFit, type AssetKind, type BrandPart, type Branding } from '#lib/brand/branding.ts';

	/**
	 * "Utseende" editor, shared by an edition's settings and the series page. Posts to the page's
	 * ?/appearance, ?/upload and ?/removeImage actions. On an edition of a series, empty values fall
	 * back to the series (shown as "Från serien"); on a series or a one-off, to the Scouterna base.
	 */
	let {
		level,
		name,
		organiserName,
		accentColor,
		coverFit,
		branding: b,
		canEdit,
		errors = {},
		saved = false,
		uploaded = null
	}: {
		level: 'edition' | 'series';
		name: string;
		organiserName: string | null;
		/** This level's own stored values. */
		accentColor: string | null;
		coverFit: 'contain' | 'cover' | null;
		branding: Branding;
		canEdit: boolean;
		errors?: Record<string, string>;
		saved?: boolean;
		uploaded?: string | null;
	} = $props();

	const own = $derived(level === 'edition' ? 'edition' : 'series');
	const fromSeries = $derived(level === 'edition' && b.inherited ? b.inherited : null);
	const fallbackAccent = $derived(fromSeries?.accent ?? SCOUTBLA);

	let accent = $state(untrack(() => accentColor ?? ''));
	let savedAccent = $state(untrack(() => accentColor ?? ''));
	$effect(() => {
		const v = accentColor ?? '';
		if (v !== untrack(() => savedAccent)) {
			savedAccent = v;
			accent = v;
		}
	});
	const accentHex = $derived(parseHex(accent) ?? fallbackAccent);
	const accentCustom = $derived(!!parseHex(accent) || !!fromSeries?.accent);
	const stripe = $derived(accentCustom ? accentHex : 'var(--orange)');
	const chipText = $derived(readableText(accentHex).text);
	let fit = $state<string>(untrack(() => coverFit ?? ''));
	const previewFit = $derived(fit === 'contain' || fit === 'cover' ? fit : effectiveCoverFit(fromSeries?.coverFit ?? null, b.cover));
	const IMAGES: { kind: AssetKind; part: BrandPart; title: string; help: string }[] = [
		{ kind: 'event_logo', part: 'eventLogo', title: 'Tävlingens logga', help: 'Visas i sidhuvudet på tävlingssidan, funktionärernas telefoner, utskrifter och i menyn här.' },
		{ kind: 'organiser_logo', part: 'organiserLogo', title: 'Arrangörens logga', help: 'Kårens eller distriktets logga. Visas i sidfoten bredvid Scouternas logga.' },
		{ kind: 'cover', part: 'cover', title: 'Omslagsbild', help: 'Stor bild överst på tävlingssidan. Ingen text läggs ovanpå bilden.' }
	];
	const current = (k: AssetKind) => (k === 'event_logo' ? b.eventLogo : k === 'organiser_logo' ? b.organiserLogo : b.cover);
	const fitLabel = (f: 'contain' | 'cover' | null) => (f === 'contain' ? 'visa hela bilden' : f === 'cover' ? 'fyll ytan' : 'automatiskt');
	const keep = () => async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => update({ reset: false });
</script>

{#if level === 'series'}
	<p class="muted lead">Gäller alla år i serien. Ett enskilt år kan ändå få en egen färg eller bild under årets Inställningar.</p>
{:else if fromSeries}
	<p class="muted lead" data-testid="series-branding-note">
		Utseendet ärvs från serien <a href="/admin/series/{fromSeries.seriesSlug}">{fromSeries.seriesName}</a>. Ändra här bara om {name} ska se annorlunda ut än övriga år.
	</p>
{:else}
	<p class="muted lead">Grunden följer Scouternas grafiska profil. Tävlingens egen logga, färg och bild syns på tävlingssidan, patrullpasset, följ-sidan, resultaten, funktionärernas telefoner och utskrifterna. Scouternas logga står alltid med som avsändare.</p>
{/if}

<form method="POST" action="?/appearance" class="stack" use:enhance={keep} novalidate>
	<ColorField
		id="accentColor"
		name="accentColor"
		label={level === 'series' ? 'Seriens färg' : 'Tävlingens färg'}
		bind:value={accent}
		fallback={fallbackAccent}
		fallbackLabel={fromSeries?.accent ? 'Seriens färg (standard)' : 'Scoutblå (standard)'}
		showContrast
		disabled={!canEdit}
	/>
	{#if errors.accentColor}<span class="error-text" id="err-accentColor">{errors.accentColor}</span>{/if}
	<p class="muted small">Färgen används som rand och markering. Sidhuvuden och knappar är alltid Scoutblå, så Scouterna syns tydligt.</p>
	<fieldset class="fit" disabled={!canEdit}>
		<legend class="label">Omslagsbild</legend>
		<label><input type="radio" name="coverFit" value="" bind:group={fit} /> {fromSeries ? `Som serien` : 'Automatiskt'} <span class="muted small">({fromSeries ? fitLabel(fromSeries.coverFit) : 'breda banderoller visas hela'})</span></label>
		<label><input type="radio" name="coverFit" value="contain" bind:group={fit} /> Visa hela bilden <span class="muted small">(text i bilden beskärs aldrig)</span></label>
		<label><input type="radio" name="coverFit" value="cover" bind:group={fit} /> Fyll ytan (beskär)</label>
	</fieldset>
	<div class="act">
		<button class="btn btn-primary" disabled={!canEdit}>Spara utseende</button>
		{#if saved && !uploaded}<span class="pill pill-ok" role="status">Sparat</span>{/if}
	</div>
</form>

<div class="imgs">
	{#each IMAGES as im (im.kind)}
		{@const cur = current(im.kind)}
		{@const mine = b.sources[im.part] === own}
		<div class="img" data-testid="img-{im.kind}">
			<div class="img-prev" class:cover={im.kind === 'cover'}>
				{#if cur}<img src={cur.url} alt={cur.alt} />{:else}<span class="muted small">Ingen bild</span>{/if}
			</div>
			<div class="img-txt">
				<strong>{im.title}{#if cur && !mine && fromSeries}<span class="pill inherit">Från serien</span>{/if}</strong>
				<span class="muted small">{im.help}</span>
				<form method="POST" action="?/upload" enctype="multipart/form-data" class="up" use:enhance>
					<input type="hidden" name="kind" value={im.kind} />
					<label class="sr-only" for="file-{im.kind}">Välj bild: {im.title}</label>
					<input id="file-{im.kind}" type="file" name="file" accept="image/png,image/jpeg,image/webp" disabled={!canEdit} />
					<button class="btn sm" disabled={!canEdit}>{mine ? 'Byt bild' : cur ? 'Egen bild i år' : 'Ladda upp'}</button>
				</form>
				{#if cur && mine}
					<form method="POST" action="?/removeImage" use:enhance>
						<input type="hidden" name="kind" value={im.kind} />
						<button class="btn btn-ghost rm sm" disabled={!canEdit}>{fromSeries ? `Använd seriens ${im.title.toLowerCase()}` : `Ta bort ${im.title.toLowerCase()}`}</button>
					</form>
				{/if}
				{#if errors[im.kind]}<span class="error-text" role="alert">{errors[im.kind]}</span>{/if}
				{#if uploaded === im.kind}<span class="pill pill-ok" role="status">Uppladdad</span>{/if}
			</div>
		</div>
	{/each}
	<p class="muted small">PNG, JPEG eller WebP, högst 2 MB. SVG går inte (av säkerhetsskäl). Bildinformation som plats och kamera tas bort vid uppladdning. Bilderna är publika och sparas i arkivet: använd inte bilder där scouter går att känna igen.</p>
</div>

<div class="previews" aria-label="Förhandsvisning">
	<div class="pv-web">
		<span class="pv-label">Tävlingssidan</span>
		<div class="pv-frame" data-testid="preview-public">
			{#if b.cover}<img class="pv-cover {previewFit}" src={b.cover.url} alt="" data-testid="preview-cover" />{/if}
			<div class="pv-top" style="border-bottom-color:{accentCustom ? accentHex : 'transparent'}">
				<div class="pv-brand">
					{#if b.eventLogo}<EventLogo logo={b.eventLogo} height={30} onDark />{:else}<ScouternaSymbol size={22} onDark />{/if}
					<span>{name}</span>
				</div>
				{#if chipText && accentCustom}<span class="pv-chip" style="background:{accentHex};color:{chipText}">Anmälan öppen</span>{/if}
			</div>
			<div class="pv-foot">
				{#if b.organiserLogo}<img class="pv-org" src={b.organiserLogo.url} alt="" />{/if}
				<span class="small">Arrangeras av {organiserName ?? '…'} · Scouterna</span>
			</div>
		</div>
	</div>
	<div class="pv-phone">
		<span class="pv-label">Funktionärens telefon</span>
		<div class="pv-ph" data-testid="preview-phone" style="border-top-color:{stripe}">
			<div class="pv-ph-top">
				{#if b.eventLogo}<EventLogo logo={b.eventLogo} height={24} />{/if}
				<span class="small muted">Hej Anna · {name}</span>
			</div>
			<strong class="pv-ph-h">K3 · Kojbygge</strong>
			<span class="pv-ph-btn">Skanna patrull</span>
		</div>
	</div>
</div>
<div class="sender-row">
	<span class="muted small">Avsändare i sidfoten:</span>
	<ScouternaLogo tagline />
</div>

<style>
	.lead {
		margin: -8px 0 0;
	}
	.act {
		display: flex;
		gap: 10px;
		align-items: center;
		flex-wrap: wrap;
	}
	.sm {
		min-height: 40px;
		font-size: 14px;
	}
	.small {
		font-size: 13px;
	}
	.rm {
		color: var(--danger);
	}
	.inherit {
		margin-left: 8px;
		font-size: 11px;
		vertical-align: middle;
	}
	.imgs {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.img {
		display: flex;
		gap: 14px;
		align-items: flex-start;
		flex-wrap: wrap;
		padding: 12px 0;
		border-top: 1px solid var(--line);
	}
	.img-prev {
		width: 120px;
		height: 72px;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--tint);
		display: grid;
		place-items: center;
		overflow: hidden;
		flex: none;
	}
	.img-prev img {
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
	}
	.img-prev.cover img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.img-txt {
		display: flex;
		flex-direction: column;
		gap: 6px;
		flex: 1 1 260px;
		min-width: 0;
	}
	.up {
		display: flex;
		gap: 8px;
		align-items: center;
		flex-wrap: wrap;
	}
	.up input[type='file'] {
		max-width: 100%;
		font-size: 14px;
	}
	.previews {
		display: flex;
		gap: 18px;
		flex-wrap: wrap;
		align-items: flex-start;
	}
	.pv-label {
		display: block;
		font-size: 12px;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--ink-2);
		margin-bottom: 6px;
	}
	.pv-web {
		flex: 1 1 320px;
		min-width: 0;
	}
	.pv-frame {
		border: 1px solid var(--line);
		border-radius: 14px;
		overflow: hidden;
		background: var(--ground);
	}
	.pv-cover {
		display: block;
		width: 100%;
		height: 90px;
		object-fit: cover;
		background: var(--brand);
	}
	.pv-cover.contain {
		object-fit: contain;
	}
	.fit {
		border: 0;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.fit label {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 40px;
	}
	.pv-top {
		background: var(--brand);
		color: #fff;
		padding: 12px 14px;
		border-bottom: 5px solid transparent;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.pv-brand {
		display: flex;
		align-items: center;
		gap: 8px;
		font-weight: 800;
	}
	.pv-chip {
		align-self: flex-start;
		font-size: 12px;
		font-weight: 800;
		padding: 3px 10px;
		border-radius: 999px;
	}
	.pv-foot {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 14px;
		color: var(--ink-2);
	}
	.pv-org {
		height: 24px;
		width: auto;
	}
	.pv-phone {
		flex: 0 0 200px;
	}
	.pv-ph {
		width: 200px;
		border: 2px solid var(--ink);
		border-top: 6px solid var(--orange);
		border-radius: 18px;
		background: var(--ground);
		padding: 10px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.pv-ph-top {
		display: flex;
		gap: 6px;
		align-items: center;
		min-width: 0;
	}
	.pv-ph-top span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.pv-ph-h {
		font-family: var(--font-display);
		font-size: 18px;
	}
	.pv-ph-btn {
		background: var(--brand);
		color: #fff;
		border-radius: 12px;
		padding: 12px;
		text-align: center;
		font-weight: 800;
		font-size: 14px;
	}
	.sender-row {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
</style>

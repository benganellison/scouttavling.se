<script lang="ts">
	import { onMount as onMountSw } from 'svelte';
	import { registerFieldServiceWorker } from '#lib/field/registerSw.ts';
	onMountSw(registerFieldServiceWorker);
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { distinctList } from '@scouttavling/domain';
	import ScouternaSymbol from '#lib/ui/brand/ScouternaSymbol.svelte';
	import Icon from '#lib/field/ui/Icon.svelte';
	import { generateDeviceKey } from '#lib/field/protocol.ts';
	import { storeJoin } from '#lib/field/app.svelte.ts';

	let { data } = $props();
	const inv = $derived(data.invite);

	let name = $state('');
	let busy = $state(false);
	let err = $state<string | null>(null);

	const scored = $derived((inv?.items ?? []).filter((i) => i.mode === 'RANGE' || i.mode === 'DISTINCT' || i.mode === 'COUNT'));
	const pointsText = $derived.by(() => {
		if (!inv?.items.length) return '–';
		if (!scored.length) return 'Incheckning';
		if (scored.length > 1) return `${scored.length} moment`;
		const it = scored[0];
		if (it.mode === 'DISTINCT') return distinctList(it).join('/');
		if (it.mode === 'COUNT') return `${it.min}–${it.max} × ${it.countMultiplier ?? 1}`;
		return `${it.min}–${it.max}`;
	});
	const styleText = $derived.by(() => {
		const st = scored.filter((i) => i.styleEnabled);
		return st.length ? `${st[0].styleMin}–${st[0].styleMax}` : 'Nej';
	});

	async function join(e: SubmitEvent) {
		e.preventDefault();
		if (!inv || !name.trim()) return;
		busy = true;
		err = null;
		try {
			if (!crypto?.subtle) throw new Error('Webbläsaren saknar stöd för säker inloggning. Använd en nyare webbläsare.');
			const key = await generateDeviceKey();
			const res = await fetch('/api/v1/join', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ secret: page.params.secret, displayName: name.trim(), publicJwk: key.publicJwk })
			});
			const out = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(out.message ?? 'Det gick inte att gå med');
			await storeJoin({
				slug: out.slug, grant: out.grant, deviceId: out.deviceId, privateKey: key.privateKey, publicJwk: key.publicJwk,
				displayName: out.displayName, role: out.role, stations: out.stations, exp: out.exp
			});
			await goto(out.role === 'startfinish' ? `/f/${out.slug}/desk` : `/f/${out.slug}`, { replace: true });
		} catch (e2) {
			err = e2 instanceof TypeError ? 'Ingen täckning. Du behöver internet en gång för att gå med.' : e2 instanceof Error ? e2.message : String(e2);
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Gå med som funktionär</title>
	<meta name="robots" content="noindex" />
</svelte:head>

{#if !inv}
	<main class="screen center">
		<ScouternaSymbol size={48} />
		<h1>Inbjudan fungerar inte</h1>
		<p class="muted">Länken är ogiltig eller har ersatts av en ny kod. Be tävlingsledningen om en ny QR-kod.</p>
	</main>
{:else}
	<form class="screen" onsubmit={join}>
		<div class="brand"><ScouternaSymbol size={28} /><span>{inv.competition.name} · Funktionär</span></div>

		<div class="intro">
			<span class="by">{inv.inviter} i tävlingsledningen bjuder in dig till</span>
			<h1>{#if inv.station}{inv.station.code} · {inv.station.name}{:else}Start &amp; mål{/if}</h1>
		</div>

		{#if inv.station}
			<div class="rules">
				<div><span class="rl">Poäng</span><span class="rv">{pointsText}</span></div>
				<div><span class="rl">Stilpoäng</span><span class="rv">{styleText}</span></div>
				<div><span class="rl">Klasser</span><span class="rv">{inv.tracks ? inv.tracks.join(', ') : 'Alla'}</span></div>
			</div>
		{:else}
			<div class="rules one"><span class="rv">Registrera start och målgång för alla patruller.</span></div>
		{/if}

		<div class="field">
			<label for="nm">Vad heter du?</label>
			<input id="nm" name="name" bind:value={name} autocomplete="name" maxlength="60" required placeholder="T.ex. Anna" />
			<span class="help">Förnamn räcker. Så vet tävlingsledningen vem som står på kontrollen.</span>
		</div>

		<ul class="perks">
			<li><span class="ck"><Icon name="check" size={18} stroke={2.8} /></span>Ingen app, inget konto, inget lösenord</li>
			<li><span class="ck"><Icon name="check" size={18} stroke={2.8} /></span>Fungerar utan täckning — synkar själv</li>
			<li><span class="ck"><Icon name="check" size={18} stroke={2.8} /></span>Lägg till på hemskärmen med ett tryck</li>
		</ul>
		<p class="privacy"><a href="/personuppgifter?t={inv.competition.slug}">Så hanterar vi personuppgifter</a></p>

		<div class="bottom">
			{#if err}<p class="error-text" role="alert">{err}</p>{/if}
			{#if inv.closed}<p class="error-text">Tävlingen är avslutad.</p>{/if}
			<button type="submit" class="go" disabled={busy || !name.trim() || inv.closed}>{busy ? 'Kopplar telefonen…' : 'Öppna min kontroll'}</button>
		</div>
	</form>
{/if}

<style>
	.screen {
		min-height: 100dvh;
		max-width: 520px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 20px;
		padding: 24px 20px calc(22px + env(safe-area-inset-bottom));
	}
	.center {
		justify-content: center;
		align-items: center;
		text-align: center;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 10px;
		font-weight: 700;
		font-size: 15px;
		color: var(--ink-2);
	}
	.intro {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.by {
		font-size: 16px;
		color: var(--ink-2);
	}
	h1 {
		font-size: 36px;
		font-weight: 800;
		line-height: 1.05;
	}
	.rules {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		padding: 14px 16px;
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 10px;
	}
	.rules.one {
		grid-template-columns: 1fr;
	}
	.rules div {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.rl {
		font-size: 13px;
		font-weight: 700;
		color: var(--ink-2);
	}
	.rv {
		font-weight: 800;
		font-size: 19px;
		overflow-wrap: anywhere;
	}
	.field label {
		font-size: 16px;
	}
	.field input {
		min-height: 60px;
		border-radius: var(--r-md);
		font-size: 19px;
		padding: 0 16px;
	}
	.help {
		font-size: 14px;
		color: var(--ink-2);
	}
	.perks {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
		font-size: 16px;
	}
	.perks li {
		display: flex;
		gap: 12px;
		align-items: center;
	}
	.ck {
		width: 32px;
		height: 32px;
		border-radius: 9px;
		background: var(--ok-tint);
		color: var(--brand-2);
		display: flex;
		align-items: center;
		justify-content: center;
		flex: none;
	}
	.bottom {
		margin-top: auto;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.go {
		min-height: 64px;
		border-radius: 18px;
		border: 0;
		background: var(--brand);
		color: #fff;
		font-weight: 800;
		font-size: 19px;
	}
	.go:disabled {
		background: var(--line);
		color: var(--ink-2);
	}
</style>

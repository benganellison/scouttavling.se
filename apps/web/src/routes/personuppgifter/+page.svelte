<script lang="ts">
	import PublicShell from '#lib/ui/public/PublicShell.svelte';

	let { data } = $props();
	const org = $derived(data.competition?.organiser ?? 'kåren eller distriktet som arrangerar tävlingen');
	const op = $derived(data.operator.name ?? 'driftansvarig för scouttavling.se');
</script>

<svelte:head>
	<title>Personuppgifter · scouttavling.se</title>
</svelte:head>

<PublicShell
	title="Personuppgifter"
	eyebrow={data.competition?.name ?? 'scouttavling.se'}
	href={data.competition ? `/t/${data.competition.slug}` : null}
	branding={data.branding}
>
	<article class="prose" data-testid="privacy">
		<h1>Så hanterar vi personuppgifter</h1>
		<p class="lead">
			{#if data.competition}<strong>{data.competition.name}</strong> arrangeras av <strong>{org}</strong>.{/if}
			Här står vilka uppgifter som sparas, varför, vem som ser dem och hur länge.
		</p>

		<h2>Vem ansvarar?</h2>
		<p>
			<strong>Personuppgiftsansvarig</strong> är {org}. Det är dit du vänder dig med frågor eller om du vill se, rätta eller ta bort uppgifter.
			<strong>Personuppgiftsbiträde</strong> är {op}, som driver tjänsten åt arrangören{#if data.operator.email}
				(<a href="mailto:{data.operator.email}">{data.operator.email}</a>){/if}.
		</p>

		<h2>Vilka uppgifter och varför</h2>
		<ul>
			<li><strong>Patrullen:</strong> namn, kår, klass, poäng och var den har varit under tävlingen, för att genomföra tävlingen och visa resultat.</li>
			<li><strong>Scouterna i patrullen:</strong> för- och efternamn och kår. Vi sparar aldrig personnummer, födelsedatum eller ålder.</li>
			<li><strong>Kontaktperson:</strong> namn, telefon och e-post, så att arrangören kan nå patrullen före och under tävlingen.</li>
			<li><strong>Funktionärer:</strong> förnamn (det man skriver när man går med) och vilken kontroll man rapporterar från.</li>
			<li><strong>Arrangörer:</strong> namn, medlemsnummer, e-post och kårtillhörighet från ScoutID, för inloggning och behörigheter.</li>
		</ul>
		<p>Rättslig grund är arrangörens berättigade intresse av att genomföra tävlingen som anmälan gäller.</p>

		<h2>Vem ser vad</h2>
		<ul>
			<li><strong>Alla:</strong> patrullens namn, kår, klass och resultat (resultatsidan och arkivet).</li>
			<li><strong>Arrangörer och tävlingsledning:</strong> allt ovan.</li>
			<li>
				<strong>Funktionärer vid start och mål:</strong> kontaktpersonens namn och telefon, för att kunna ringa om något händer på banan. Övriga funktionärer ser
				bara patrullens nummer, namn och kår.
			</li>
			<li><strong>Följ-länken:</strong> var patrullen är och hur det går, men inga namn på scouterna eller kontaktuppgifter.</li>
		</ul>
		<p>
			Uppgifterna säljs inte och lämnas inte till någon annan. Tjänsten har ingen annonsering eller statistikspårning, och den enda kakan är inloggningen för
			arrangörer.
		</p>

		<h2>Hur länge</h2>
		<ul>
			<li>Efter tävlingen tar arrangören bort personuppgifterna. Kvar i arkivet finns patrullens namn, kår, klass och resultat.</li>
			<li>Säkerhetskopior: kopiorna på servern roteras inom ett dygn och externa kopior inom åtta veckor. Därefter är uppgifterna borta överallt.</li>
			<li>Funktionärernas telefoner glömmer tävlingen när behörigheten kopplas från eller går ut, senast en vecka efter tävlingen.</li>
			<li>Arrangörers konton finns kvar så länge de används.</li>
		</ul>

		<h2>Dina rättigheter</h2>
		<p>
			Du har rätt att få veta vilka uppgifter som finns om dig, få dem rättade eller borttagna och invända mot behandlingen. Kontaktpersonen kan själv ändra
			uppgifterna via patrullens länk fram till att anmälan stänger. Kontakta annars {org}: arrangören kan ta ut alla uppgifter om patrullen som fil, rätta dem
			och ta bort dem. Du kan också klaga hos Integritetsskyddsmyndigheten (IMY).
		</p>
	</article>
</PublicShell>

<style>
	.prose {
		display: grid;
		gap: 10px;
		max-width: 680px;
		line-height: 1.55;
	}
	.prose h1 {
		margin: 0;
		font-size: 28px;
	}
	.prose h2 {
		margin: 14px 0 0;
		font-size: 19px;
	}
	.prose p,
	.prose ul {
		margin: 0;
	}
	.prose ul {
		padding-left: 20px;
		display: grid;
		gap: 6px;
	}
	.lead {
		font-size: 17px;
	}
</style>

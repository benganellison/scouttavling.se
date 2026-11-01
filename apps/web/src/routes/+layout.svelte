<script lang="ts">
	import '@fontsource-variable/libre-franklin';
	import '@fontsource-variable/eb-garamond';
	import '#lib/styles/global.css';

	let { children } = $props();
</script>

<svelte:head>
	<!-- Scouterna's scout symbol, scaled only (static/icons/). -->
	<link rel="icon" type="image/png" sizes="32x32" href="/icons/scouterna-32.png" />
	<link rel="icon" type="image/png" sizes="48x48" href="/icons/scouterna-48.png" />
	<link rel="apple-touch-icon" href="/icons/scouterna-180.png" />
	<title>Scouttävling</title>
</svelte:head>

{@render children()}

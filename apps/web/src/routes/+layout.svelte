<script lang="ts">
	import '@fontsource-variable/libre-franklin';
	import '@fontsource-variable/eb-garamond';
	import '#lib/styles/global.css';
	import favicon from '#lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Scouttävling</title>
</svelte:head>

{@render children()}

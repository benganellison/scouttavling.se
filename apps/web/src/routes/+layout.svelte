<script lang="ts">
	import '@fontsource-variable/figtree';
	import '@fontsource-variable/bricolage-grotesque/opsz.css';
	import '#lib/styles/global.css';
	import favicon from '#lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Scouttävling</title>
</svelte:head>

{@render children()}

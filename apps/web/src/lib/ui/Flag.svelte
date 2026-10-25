<script lang="ts">
	/**
	 * The app's own wordmark symbol: an orienteering control flag in profile colours
	 * (white + Äventyrarorange, Scoutblå outline). Scouterna's logo is separate: see ScouternaLogo.svelte.
	 */
	let { size = 32, onDark = false }: { size?: number; onDark?: boolean } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
	<rect x="2" y="2" width="28" height="28" rx="6" fill="#FFFFFF" stroke={onDark ? 'none' : '#003660'} stroke-width="2"></rect>
	<polygon points="5,27 27,5 27,27" fill="#E95F13"></polygon>
</svg>

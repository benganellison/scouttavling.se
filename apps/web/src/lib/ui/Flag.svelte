<script lang="ts">
	/** The orienteering control flag logo. */
	let { size = 32, onDark = false }: { size?: number; onDark?: boolean } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
	<rect x="2" y="2" width="28" height="28" rx="6" fill="#FFFFFF" stroke={onDark ? 'none' : '#0F1F17'} stroke-width="2"></rect>
	<polygon points="5,27 27,5 27,27" fill="#F26B2A"></polygon>
</svg>

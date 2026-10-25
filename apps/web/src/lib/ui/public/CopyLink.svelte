<script lang="ts">
	/** A link shown in full with a copy button (patrol-leader pages). */
	let { url, label, testid = undefined }: { url: string; label: string; testid?: string } = $props();
	let copied = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;

	async function copy() {
		try {
			await navigator.clipboard.writeText(url);
			copied = true;
			clearTimeout(timer);
			timer = setTimeout(() => (copied = false), 2500);
		} catch {
			/* clipboard blocked: the link is selectable */
		}
	}
</script>

<div class="cl">
	<span class="label">{label}</span>
	<div class="box">
		<a href={url} class="url" data-testid={testid} rel="noreferrer">{url}</a>
		<button type="button" class="btn copy" onclick={copy} aria-live="polite">{copied ? 'Kopierad' : 'Kopiera'}</button>
	</div>
</div>

<style>
	.cl {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}
	.box {
		display: flex;
		gap: 8px;
		align-items: stretch;
		min-width: 0;
	}
	.url {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		padding: 8px 12px;
		border: 1.5px dashed var(--line-strong);
		border-radius: var(--r-sm);
		background: var(--tint);
		font-size: 14px;
		font-weight: 700;
		word-break: break-all;
		color: var(--brand);
	}
	.copy {
		flex: none;
		min-width: 92px;
	}
</style>

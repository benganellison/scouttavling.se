<script lang="ts">
	import { useField, hhmm } from '#lib/field/app.svelte.ts';
	import Icon from '#lib/field/ui/Icon.svelte';
	import SyncPill from '#lib/field/ui/SyncPill.svelte';
	import TabBar from '#lib/field/ui/TabBar.svelte';

	const app = useField();
	let open = $state<string | null>(null);
	const messages = $derived(app.pack?.messages ?? []);

	function toggle(id: string, read: boolean) {
		open = open === id ? null : id;
		if (!read) void app.markRead(id);
	}
</script>

<div class="screen">
	<header>
		<div class="top">
			<span class="sub">{app.pack?.competition.name}</span>
			<SyncPill />
		</div>
		<h1>Meddelanden</h1>
	</header>
	<main>
		{#if messages.length}
			<ul class="list">
				{#each messages as m (m.id)}
					<li class:unread={!m.read} class:important={m.important}>
						<button type="button" class="row" aria-expanded={open === m.id} onclick={() => toggle(m.id, m.read)}>
							<span class="dot" aria-hidden="true"></span>
							<span class="body">
								<span class="title">{m.title}{#if !m.read}<span class="sr-only"> (oläst)</span>{/if}</span>
								<span class="meta">{m.important ? 'Viktigt · ' : ''}{hhmm(m.createdAt)}</span>
								{#if open === m.id}<span class="text">{m.body}</span>{/if}
							</span>
							<Icon name="chevron" />
						</button>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="empty">Inga meddelanden från tävlingsledningen.</p>
		{/if}
	</main>
	<TabBar current="messages" />
</div>

<style>
	.screen {
		height: 100dvh;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	header {
		padding: 14px 16px 10px;
	}
	.top {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.sub {
		font-size: 14px;
		font-weight: 700;
		color: var(--ink-2);
	}
	h1 {
		font-size: 30px;
		font-weight: 800;
	}
	main {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 4px 16px 16px;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.row {
		width: 100%;
		display: flex;
		gap: 12px;
		align-items: flex-start;
		text-align: left;
		min-height: 64px;
		padding: 14px;
		border-radius: var(--r-md);
		border: 1px solid var(--line);
		background: var(--surface);
		cursor: pointer;
	}
	.important .row {
		border: 1.5px solid #f7b48f;
		background: var(--accent-tint);
	}
	.dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		margin-top: 7px;
		flex: none;
	}
	.unread .dot {
		background: var(--accent);
	}
	.body {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.title {
		font-weight: 600;
		font-size: 17px;
	}
	.unread .title {
		font-weight: 800;
	}
	.meta {
		font-size: 13px;
		color: var(--ink-2);
	}
	.text {
		margin-top: 8px;
		font-size: 16px;
		white-space: pre-wrap;
	}
	.empty {
		color: var(--ink-2);
		text-align: center;
		margin-top: 40px;
	}
</style>

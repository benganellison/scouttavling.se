<script lang="ts">
	import { MAX_MEMBERS } from '#lib/registration/rules.ts';

	/** Member rows (first + last name only). Posts repeated `firstName` / `lastName` fields. */
	let { members = $bindable(), errors = {} }: { members: { firstName: string; lastName: string }[]; errors?: Record<string, string> } = $props();

	function add() {
		if (members.length < MAX_MEMBERS) members.push({ firstName: '', lastName: '' });
		queueMicrotask(() => document.getElementById(`m-first-${members.length - 1}`)?.focus());
	}
	function remove(i: number) {
		members.splice(i, 1);
		if (members.length === 0) members.push({ firstName: '', lastName: '' });
	}
</script>

<ol class="members">
	{#each members as m, i (i)}
		{@const err = errors[`member_${i}_firstName`] ?? errors[`member_${i}_lastName`]}
		<li class="member">
			<span class="nr" aria-hidden="true">{i + 1}</span>
			<div class="names">
				<div class="field">
					<label for="m-first-{i}" class="sr-only">Förnamn scout {i + 1}</label>
					<input
						id="m-first-{i}"
						name="firstName"
						placeholder="Förnamn"
						autocomplete="off"
						bind:value={m.firstName}
						aria-invalid={errors[`member_${i}_firstName`] ? 'true' : undefined}
						aria-describedby={err ? `m-err-${i}` : undefined}
					/>
				</div>
				<div class="field">
					<label for="m-last-{i}" class="sr-only">Efternamn scout {i + 1}</label>
					<input
						id="m-last-{i}"
						name="lastName"
						placeholder="Efternamn"
						autocomplete="off"
						bind:value={m.lastName}
						aria-invalid={errors[`member_${i}_lastName`] ? 'true' : undefined}
						aria-describedby={err ? `m-err-${i}` : undefined}
					/>
				</div>
				{#if err}<span class="error-text" id="m-err-{i}">{err}</span>{/if}
			</div>
			<button type="button" class="btn btn-ghost rm" onclick={() => remove(i)} aria-label="Ta bort scout {i + 1}{m.firstName ? ` (${m.firstName})` : ''}">
				<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"
					><path d="M6 6l12 12M18 6L6 18" /></svg
				>
			</button>
		</li>
	{/each}
</ol>
{#if errors.members}<p class="error-text" role="alert">{errors.members}</p>{/if}
<button type="button" class="btn add" onclick={add} disabled={members.length >= MAX_MEMBERS}>
	<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"
		><path d="M12 5v14M5 12h14" /></svg
	>
	Lägg till scout
</button>

<style>
	.members {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.member {
		display: flex;
		gap: 10px;
		align-items: flex-start;
	}
	.nr {
		flex: none;
		width: 30px;
		height: var(--tap);
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: var(--font-display);
		font-weight: 800;
		color: var(--ink-3);
	}
	.names {
		flex: 1;
		min-width: 0;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}
	.names .error-text {
		grid-column: 1 / -1;
	}
	.rm {
		flex: none;
		width: var(--tap);
		padding: 0;
		color: var(--ink-3);
	}
	.rm:hover {
		color: var(--danger);
	}
	.add {
		align-self: flex-start;
		border-style: dashed;
	}
	[aria-invalid='true'] {
		border-color: var(--danger);
	}
	@media (max-width: 360px) {
		.names {
			grid-template-columns: 1fr;
		}
	}
</style>

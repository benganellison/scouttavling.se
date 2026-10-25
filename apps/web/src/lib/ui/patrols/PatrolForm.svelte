<script lang="ts">
	import { enhance } from '$app/forms';
	import { STATUS_LABEL, STATUS_ORDER, type PatrolFormData } from './labels.ts';

	let {
		initial,
		tracks,
		errors = {},
		submitLabel,
		cancelHref
	}: {
		initial: PatrolFormData;
		tracks: { id: string; name: string }[];
		errors?: Record<string, string>;
		submitLabel: string;
		cancelHref: string;
	} = $props();

	// The form owns its values from here on (seeded once from `initial`).
	// svelte-ignore state_referenced_locally
	let members = $state(initial.members.length ? initial.members.map((m) => ({ ...m })) : [{ firstName: '', lastName: '', troopText: '' }]);
	let submitting = $state(false);

	function addMember() {
		members.push({ firstName: '', lastName: '', troopText: '' });
	}
	function removeMember(i: number) {
		members.splice(i, 1);
	}
	const err = (k: string) => errors[k];
</script>

<form
	method="POST"
	action="?/save"
	class="pform"
	novalidate
	use:enhance={() => {
		submitting = true;
		return async ({ update }) => {
			await update({ reset: false });
			submitting = false;
		};
	}}
>
	{#if Object.keys(errors).length}
		<p class="error-text" role="alert">Rätta fälten som är markerade nedan.</p>
	{/if}

	<section class="card stack">
		<h2>Patrullen</h2>
		<div class="grid">
			<div class="field span2">
				<label for="name">Patrullnamn</label>
				<input id="name" name="name" type="text" value={initial.name} required aria-invalid={!!err('name')} aria-describedby={err('name') ? 'name-err' : undefined} />
				{#if err('name')}<span id="name-err" class="error-text">{err('name')}</span>{/if}
			</div>
			<div class="field">
				<label for="number">Nummer</label>
				<input id="number" name="number" type="number" inputmode="numeric" min="1" value={initial.number} aria-invalid={!!err('number')} aria-describedby={err('number') ? 'number-err' : undefined} />
				{#if err('number')}<span id="number-err" class="error-text">{err('number')}</span>{/if}
			</div>
			<div class="field">
				<label for="trackId">Klass</label>
				<select id="trackId" name="trackId" value={initial.trackId} aria-invalid={!!err('trackId')}>
					<option value="">Ingen klass</option>
					{#each tracks as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
				</select>
				{#if err('trackId')}<span class="error-text">{err('trackId')}</span>{/if}
			</div>
			<div class="field span2">
				<label for="troop">Kår</label>
				<input id="troop" name="troop" type="text" value={initial.troop} />
			</div>
			<div class="field">
				<label for="status">Status</label>
				<select id="status" name="status" value={initial.status}>
					{#each STATUS_ORDER as s (s)}<option value={s}>{STATUS_LABEL[s]}</option>{/each}
				</select>
			</div>
			<label class="check">
				<input type="checkbox" name="paid" checked={initial.paid} />
				Avgiften är betald
			</label>
		</div>
	</section>

	<section class="card stack">
		<h2>Kontaktperson</h2>
		<div class="grid">
			<div class="field span2">
				<label for="contactName">Namn</label>
				<input id="contactName" name="contactName" type="text" autocomplete="off" value={initial.contactName} />
			</div>
			<div class="field">
				<label for="contactPhone">Mobil</label>
				<input id="contactPhone" name="contactPhone" type="tel" value={initial.contactPhone} aria-invalid={!!err('contactPhone')} aria-describedby={err('contactPhone') ? 'phone-err' : undefined} />
				{#if err('contactPhone')}<span id="phone-err" class="error-text">{err('contactPhone')}</span>{/if}
			</div>
			<div class="field">
				<label for="contactEmail">E-post</label>
				<input id="contactEmail" name="contactEmail" type="email" value={initial.contactEmail} aria-invalid={!!err('contactEmail')} aria-describedby={err('contactEmail') ? 'email-err' : undefined} />
				{#if err('contactEmail')}<span id="email-err" class="error-text">{err('contactEmail')}</span>{/if}
			</div>
			<div class="field span2">
				<label for="contactMemberNo">Medlemsnummer i Scoutnet</label>
				<input id="contactMemberNo" name="contactMemberNo" type="text" inputmode="numeric" value={initial.contactMemberNo} aria-invalid={!!err('contactMemberNo')} aria-describedby="memberno-help" />
				<span id="memberno-help" class="muted hint">Kopplar patrullen till kontaktpersonens ScoutID-inloggning.</span>
				{#if err('contactMemberNo')}<span class="error-text">{err('contactMemberNo')}</span>{/if}
			</div>
		</div>
	</section>

	<section class="card stack">
		<div class="row between">
			<h2>Medlemmar <span class="muted count">{members.filter((m) => m.firstName || m.lastName).length}</span></h2>
			<button type="button" class="btn btn-sm" onclick={addMember}>+ Lägg till medlem</button>
		</div>
		{#if err('members')}<span class="error-text">{err('members')}</span>{/if}
		<ol class="members">
			{#each members as m, i (i)}
				<li class="mrow">
					<div class="field">
						<label for="mf{i}" class:sr-only={i > 0}>Förnamn</label>
						<input id="mf{i}" name="memberFirst" type="text" bind:value={m.firstName} autocomplete="off" />
					</div>
					<div class="field">
						<label for="ml{i}" class:sr-only={i > 0}>Efternamn</label>
						<input id="ml{i}" name="memberLast" type="text" bind:value={m.lastName} autocomplete="off" />
					</div>
					<div class="field">
						<label for="mt{i}" class:sr-only={i > 0}>Kår</label>
						<input id="mt{i}" name="memberTroop" type="text" bind:value={m.troopText} autocomplete="off" />
					</div>
					<button type="button" class="btn btn-ghost btn-sm remove" onclick={() => removeMember(i)} aria-label="Ta bort medlem {i + 1}">
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg>
					</button>
				</li>
			{/each}
		</ol>
	</section>

	<div class="row actions">
		<a class="btn" href={cancelHref}>Avbryt</a>
		<button class="btn btn-accent" disabled={submitting}>{submitLabel}</button>
	</div>
</form>

<style>
	.pform {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	h2 {
		font-size: 19px;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 14px 16px;
		align-items: start;
	}
	.span2 {
		grid-column: span 2;
	}
	@media (max-width: 760px) {
		.grid {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		}
	}
	@media (max-width: 480px) {
		.grid {
			grid-template-columns: minmax(0, 1fr);
		}
		.span2 {
			grid-column: auto;
		}
	}
	.check {
		display: flex;
		align-items: center;
		gap: 10px;
		font-weight: 700;
		min-height: var(--tap);
		align-self: end;
	}
	.check input {
		width: 22px;
		height: 22px;
		accent-color: var(--brand);
	}
	.hint {
		font-size: 13px;
	}
	.between {
		justify-content: space-between;
	}
	.count {
		font-size: 16px;
	}
	.members {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.mrow {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) 48px;
		gap: 10px;
		align-items: end;
	}
	@media (max-width: 600px) {
		.mrow {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 48px;
		}
		.mrow .field:nth-child(3) {
			grid-column: 1 / 3;
			grid-row: 2;
		}
	}
	.remove {
		min-height: var(--tap);
		padding: 0;
	}
	.actions {
		justify-content: flex-end;
	}
</style>

<script lang="ts">
	import { enhance } from '$app/forms';

	/**
	 * "Ägare och arrangörer": the people who run a competition or a series. Server actions (same names
	 * everywhere): memberAdd, memberRole, memberRemove, memberLeave, memberTransfer, and for site admins
	 * ownerReplace. The ≥ 1 owner rule is enforced on the server (#lib/server/ownership.ts); the UI only
	 * explains it. `power`: 'owner' | 'organiser' (own role), 'platform' (site admin, reason required), null = read only.
	 */
	interface Member {
		userId: string;
		name: string;
		memberNo: string;
		role: 'owner' | 'organiser';
		suspended?: boolean;
	}
	let {
		members,
		meId,
		power,
		form,
		scopeText = 'tävlingen',
		action = '',
		lead = ''
	}: {
		members: Member[];
		meId: string;
		power: 'owner' | 'organiser' | 'platform' | null;
		form: unknown;
		scopeText?: 'tävlingen' | 'serien';
		action?: string;
		lead?: string;
	} = $props();

	type Kind = 'remove' | 'transfer' | 'leave' | 'selfDemote' | 'replace';
	let confirming = $state<{ userId: string; kind: Kind } | null>(null);
	let reason = $state('');
	let addRole = $state<'organiser' | 'owner'>('organiser');
	let memberNo = $state('');

	const f = $derived(
		(form && typeof form === 'object' && (form as { section?: string }).section === 'members' ? form : null) as null | {
			ok?: boolean;
			message?: string;
			errors?: Record<string, string>;
			memberNo?: string;
		}
	);
	const errors = $derived(f?.errors ?? {});
	// After a failed add, keep what was typed (the server echoes it back).
	$effect(() => {
		if (f?.memberNo !== undefined && !f.ok) memberNo = f.memberNo;
	});
	const owners = $derived(members.filter((m) => m.role === 'owner'));
	const onlyOwner = (m: Member) => m.role === 'owner' && owners.length === 1;
	const platform = $derived(power === 'platform');
	const canOwners = $derived(power === 'owner' || power === 'platform');
	const canAdd = $derived(power !== null);
	const done =
		() =>
		async ({ update, result }: { update: (o?: { reset?: boolean }) => Promise<void>; result: { type: string } }) => {
			await update({ reset: false });
			if (result.type === 'success') {
				confirming = null;
				memberNo = '';
			}
		};
	const roleText = (r: string) => (r === 'owner' ? 'Ägare' : 'Arrangör');
	const ask = (userId: string, kind: Kind) => (confirming = confirming?.userId === userId && confirming.kind === kind ? null : { userId, kind });
	const isAsking = (userId: string, kind?: Kind) => confirming?.userId === userId && (!kind || confirming.kind === kind);
</script>

<div class="panel">
	{#if lead}<p class="muted lead">{lead}</p>{/if}

	{#if platform}
		<div class="field reason">
			<label for="mp-reason">Anledning (krävs, minst 10 tecken)</label>
			<textarea
				id="mp-reason"
				rows="2"
				bind:value={reason}
				aria-invalid={errors.reason ? 'true' : undefined}
				aria-describedby="mp-reason-help"
				placeholder="t.ex. Ärende från distriktet: ägaren har slutat"></textarea>
			<span id="mp-reason-help" class="muted small">Sparas i händelseloggen. Skriv inte namn på patrullmedlemmar.</span>
			{#if errors.reason}<span class="error-text" role="alert" id="err-reason">{errors.reason}</span>{/if}
		</div>
	{/if}

	<ul class="members" aria-label="Ägare och arrangörer">
		{#each members as m (m.userId)}
			{@const self = m.userId === meId}
			<li data-testid="member-{m.memberNo}">
				<div class="who">
					<span class="mn">
						<strong>{m.name}{self ? ' (du)' : ''}</strong>
						<span class="muted small">Medlemsnr {m.memberNo}{m.suspended ? ' · avstängd' : ''}</span>
					</span>
					<span class="pill" class:pill-owner={m.role === 'owner'}>{roleText(m.role)}</span>
				</div>
				<div class="acts">
					{#if self && power && power !== 'platform'}
						{#if m.role === 'owner'}
							<button type="button" class="btn btn-ghost sm" disabled={onlyOwner(m)} onclick={() => ask(m.userId, 'selfDemote')}>Bli arrangör</button>
						{/if}
						<button type="button" class="btn btn-ghost sm danger" disabled={onlyOwner(m)} onclick={() => ask(m.userId, 'leave')}>Lämna</button>
					{:else if !self && canOwners}
						{#if m.role === 'organiser'}
							<form method="POST" action="{action}?/memberRole" use:enhance={done}>
								<input type="hidden" name="userId" value={m.userId} /><input type="hidden" name="role" value="owner" /><input
									type="hidden"
									name="reason"
									value={reason}
								/>
								<button class="btn btn-ghost sm">Gör till ägare</button>
							</form>
							{#if power === 'owner'}
								<button type="button" class="btn btn-ghost sm" onclick={() => ask(m.userId, 'transfer')}>Överlåt ägarskapet</button>
							{/if}
						{:else}
							<form method="POST" action="{action}?/memberRole" use:enhance={done}>
								<input type="hidden" name="userId" value={m.userId} /><input type="hidden" name="role" value="organiser" /><input
									type="hidden"
									name="reason"
									value={reason}
								/>
								<button class="btn btn-ghost sm" disabled={onlyOwner(m)}>Gör till arrangör</button>
							</form>
							{#if platform}
								<button type="button" class="btn btn-ghost sm" onclick={() => ask(m.userId, 'replace')}>Ersätt ägare</button>
							{/if}
						{/if}
						<button type="button" class="btn btn-ghost sm danger" disabled={onlyOwner(m)} onclick={() => ask(m.userId, 'remove')}>Ta bort</button>
					{:else if !self && power === 'organiser' && m.role === 'organiser'}
						<button type="button" class="btn btn-ghost sm danger" onclick={() => ask(m.userId, 'remove')}>Ta bort</button>
					{/if}
				</div>
				{#if onlyOwner(m) && power}
					<span class="muted small full" data-testid="only-owner">
						{platform
							? 'Enda ägaren. Använd "Ersätt ägare" för att byta i ett steg.'
							: self
								? `Du är enda ägaren. Lägg till en ägare innan du lämnar ${scopeText}.`
								: 'Enda ägaren.'}
					</span>
				{/if}

				{#if isAsking(m.userId)}
					<div class="confirm full" role="group" aria-label="Bekräfta">
						{#if isAsking(m.userId, 'remove')}
							<p><strong>Ta bort {m.name}?</strong> {m.name} förlorar åtkomsten till {scopeText} direkt.</p>
							<form method="POST" action="{action}?/memberRemove" use:enhance={done}>
								<input type="hidden" name="userId" value={m.userId} /><input type="hidden" name="reason" value={reason} />
								<button class="btn btn-primary sm danger-bg">Ja, ta bort</button>
								<button type="button" class="btn btn-ghost sm" onclick={() => (confirming = null)}>Avbryt</button>
							</form>
						{:else if isAsking(m.userId, 'transfer')}
							<p><strong>Överlåt ägarskapet till {m.name}?</strong> {m.name} blir ägare och du blir arrangör. Sedan kan du inte längre ändra ägare.</p>
							<form method="POST" action="{action}?/memberTransfer" use:enhance={done}>
								<input type="hidden" name="userId" value={m.userId} />
								<button class="btn btn-primary sm">Ja, överlåt</button>
								<button type="button" class="btn btn-ghost sm" onclick={() => (confirming = null)}>Avbryt</button>
							</form>
						{:else if isAsking(m.userId, 'leave')}
							<p><strong>Lämna {scopeText}?</strong> Du förlorar åtkomsten direkt. En ägare kan bjuda in dig igen.</p>
							<form method="POST" action="{action}?/memberLeave" use:enhance>
								<button class="btn btn-primary sm danger-bg">Ja, lämna</button>
								<button type="button" class="btn btn-ghost sm" onclick={() => (confirming = null)}>Avbryt</button>
							</form>
						{:else if isAsking(m.userId, 'selfDemote')}
							<p><strong>Bli arrangör?</strong> Du kan fortfarande ändra allt utom ägarna.</p>
							<form method="POST" action="{action}?/memberRole" use:enhance={done}>
								<input type="hidden" name="userId" value={m.userId} /><input type="hidden" name="role" value="organiser" />
								<button class="btn btn-primary sm">Ja, bli arrangör</button>
								<button type="button" class="btn btn-ghost sm" onclick={() => (confirming = null)}>Avbryt</button>
							</form>
						{:else if isAsking(m.userId, 'replace')}
							<p><strong>Ersätt {m.name} som ägare.</strong> Den nya ägaren läggs till och {m.name} tas bort i samma steg.</p>
							<form method="POST" action="{action}?/ownerReplace" class="row-form" use:enhance={done}>
								<input type="hidden" name="userId" value={m.userId} /><input type="hidden" name="reason" value={reason} />
								<div class="field grow">
									<label for="rep-{m.userId}">Ny ägares medlemsnummer</label>
									<input id="rep-{m.userId}" name="memberNo" inputmode="numeric" placeholder="t.ex. 3000002" />
								</div>
								<button class="btn btn-primary sm">Ersätt</button>
								<button type="button" class="btn btn-ghost sm" onclick={() => (confirming = null)}>Avbryt</button>
							</form>
							{#if errors.replace}<span class="error-text" role="alert" id="err-replace">{errors.replace}</span>{/if}
						{/if}
					</div>
				{/if}
			</li>
		{:else}
			<li class="muted">Inga ägare eller arrangörer.</li>
		{/each}
	</ul>

	{#if errors.members}<p class="error-text" role="alert">{errors.members}</p>{/if}
	{#if f?.ok && f.message}<p class="pill pill-ok msg" role="status">{f.message}</p>{/if}

	{#if canAdd}
		<form method="POST" action="{action}?/memberAdd" class="row-form add" use:enhance={done} novalidate>
			<input type="hidden" name="reason" value={reason} />
			<div class="field grow">
				<label for="memberNo">Bjud in med medlemsnummer</label>
				<input
					id="memberNo"
					name="memberNo"
					inputmode="numeric"
					bind:value={memberNo}
					placeholder="t.ex. 3000002"
					aria-invalid={errors.memberNo ? 'true' : undefined}
					aria-describedby="mn-help"
				/>
			</div>
			{#if canOwners}
				<div class="field">
					<label for="mp-role">Roll</label>
					<select id="mp-role" name="role" bind:value={addRole}>
						<option value="organiser">Arrangör</option>
						<option value="owner">Ägare</option>
					</select>
				</div>
			{:else}
				<input type="hidden" name="role" value="organiser" />
			{/if}
			<button class="btn btn-accent">{addRole === 'owner' ? 'Lägg till ägare' : 'Lägg till arrangör'}</button>
			<span id="mn-help" class="muted small full"
				>Personen måste ha loggat in på scouttavling.se minst en gång. Ägare kan ändra allt, även vilka som är ägare. Arrangörer kan ändra allt utom ägarna.</span
			>
			{#if errors.memberNo}<span class="error-text full" role="alert">{errors.memberNo}</span>{/if}
		</form>
	{/if}
</div>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.lead {
		margin: -8px 0 0;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
		padding: 12px 0;
		border-top: 1px solid var(--line);
	}
	.who {
		display: flex;
		align-items: center;
		gap: 12px;
		flex: 1 1 240px;
		min-width: 0;
	}
	.mn {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
	}
	.acts {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.acts form {
		display: contents;
	}
	.pill-owner {
		background: var(--brand);
		color: #fff;
		border-color: var(--brand);
	}
	.sm {
		min-height: 44px;
		font-size: 14px;
		padding-inline: 12px;
	}
	.danger {
		color: var(--danger);
	}
	.danger-bg {
		background: var(--danger);
		border-color: var(--danger);
	}
	.small {
		font-size: 13px;
	}
	.full {
		flex-basis: 100%;
	}
	.confirm {
		background: var(--tint);
		border-radius: var(--r-md);
		padding: 12px 14px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.confirm p {
		margin: 0;
	}
	.confirm form {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.row-form {
		display: flex;
		gap: 10px;
		align-items: flex-end;
		flex-wrap: wrap;
	}
	.grow {
		flex: 1 1 180px;
	}
	.reason textarea {
		min-height: 64px;
	}
	.msg {
		align-self: flex-start;
		margin: 0;
	}
	button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	[aria-invalid='true'] {
		border-color: var(--danger);
	}
</style>

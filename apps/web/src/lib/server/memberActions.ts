import { fail } from '@sveltejs/kit';
import { OwnershipError, changeMembers, transferOwnership, userByMemberNo, type ManagedRole, type OwnershipActor, type Scope } from './ownership.ts';
import { reasonError } from './audit.ts';

/**
 * Form actions behind the "Ägare och arrangörer" panel (#lib/ui/admin/MembersPanel.svelte), shared by
 * an edition's settings, the series page and /site-admin. All checks live in ownership.ts.
 * Fields: memberNo + role (add), userId + role (role), userId (remove, transfer), reason (site admin).
 */

export type MemberAction = 'add' | 'role' | 'remove' | 'leave' | 'transfer';

const role = (v: FormDataEntryValue | null): ManagedRole | null => (v === 'owner' || v === 'organiser' ? v : null);

export async function memberAction(kind: MemberAction, f: FormData, scope: Scope, actor: OwnershipActor, names: Map<string, string> = new Map()) {
	const userId = String(f.get('userId') ?? '');
	const memberNo = String(f.get('memberNo') ?? '');
	if (actor.kind === 'site_admin' && !actor.accessRole) {
		actor = { ...actor, reason: String(f.get('reason') ?? '').trim() };
		const e = reasonError(actor.reason);
		if (e) return fail(400, { section: 'members', errors: { reason: e } as Record<string, string>, memberNo });
	}
	try {
		switch (kind) {
			case 'add': {
				const r = role(f.get('role')) ?? 'organiser';
				const found = await userByMemberNo(memberNo);
				if ('error' in found) return fail(400, { section: 'members', errors: { memberNo: found.error } as Record<string, string>, memberNo });
				const u = found.user;
				await changeMembers(scope, actor, [{ op: 'set', userId: u.id, role: r }]);
				return { section: 'members', ok: true, message: `${u.name} är nu ${r === 'owner' ? 'ägare' : 'arrangör'}.`, added: u.name };
			}
			case 'role': {
				const r = role(f.get('role'));
				if (!r || !userId) return fail(400, { section: 'members', errors: { members: 'Välj en roll.' } as Record<string, string> });
				await changeMembers(scope, actor, [{ op: 'set', userId, role: r }]);
				return { section: 'members', ok: true, message: `${names.get(userId) ?? 'Personen'} är nu ${r === 'owner' ? 'ägare' : 'arrangör'}.` };
			}
			case 'remove': {
				if (!userId) return fail(400, { section: 'members', errors: { members: 'Välj en person.' } as Record<string, string> });
				await changeMembers(scope, actor, [{ op: 'remove', userId }]);
				return { section: 'members', ok: true, message: `${names.get(userId) ?? 'Personen'} är borttagen.` };
			}
			case 'leave': {
				if (!actor.userId) return fail(400, { section: 'members', errors: { members: 'Ingen användare.' } as Record<string, string> });
				await changeMembers(scope, actor, [{ op: 'remove', userId: actor.userId }]);
				return { section: 'members', ok: true, left: true, message: 'Du har lämnat.' };
			}
			case 'transfer': {
				await transferOwnership(scope, actor, userId);
				return { section: 'members', ok: true, message: `${names.get(userId) ?? 'Personen'} är nu ägare, och du är arrangör.` };
			}
		}
	} catch (e) {
		if (e instanceof OwnershipError) return fail(e.code === 'forbidden' ? 403 : 400, { section: 'members', errors: { members: e.message } as Record<string, string>, memberNo });
		throw e;
	}
}

/**
 * "Ersätt ägare" for a site admin: add `memberNo` as owner and remove the old owner in ONE
 * transaction, so a competition whose only owner is gone never has zero owners.
 */
export async function replaceOwner(f: FormData, scope: Scope, actor: OwnershipActor) {
	const memberNo = String(f.get('memberNo') ?? '');
	const oldUserId = String(f.get('userId') ?? '');
	const reason = String(f.get('reason') ?? '').trim();
	const e = reasonError(reason);
	if (e) return fail(400, { section: 'members', errors: { reason: e } as Record<string, string>, memberNo });
	const found = await userByMemberNo(memberNo);
	if ('error' in found) return fail(400, { section: 'members', errors: { replace: found.error } as Record<string, string>, memberNo });
	if (found.user.id === oldUserId) return fail(400, { section: 'members', errors: { replace: 'Välj en annan person än den nuvarande ägaren.' } as Record<string, string>, memberNo });
	try {
		await changeMembers(
			scope,
			{ ...actor, reason },
			[
				{ op: 'set', userId: found.user.id, role: 'owner' },
				{ op: 'remove', userId: oldUserId }
			],
			{ summary: { action: 'owner.replace', details: { userId: found.user.id, replaced: oldUserId } } }
		);
	} catch (err) {
		if (err instanceof OwnershipError) return fail(400, { section: 'members', errors: { replace: err.message } as Record<string, string>, memberNo });
		throw err;
	}
	return { section: 'members', ok: true, message: `${found.user.name} är nu ägare.` };
}

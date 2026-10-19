import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateDevice, markMessageRead } from '#lib/server/field.ts';

/** Marks an HQ message as read by this device (inserts message_read). */
export const POST: RequestHandler = async ({ request, params }) => {
	const ctx = await authenticateDevice(request, params.slug);
	const body = (await request.json().catch(() => ({}))) as { messageId?: unknown };
	if (typeof body.messageId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.messageId)) return json({ message: 'messageId saknas' }, { status: 400 });
	await markMessageRead(ctx, body.messageId);
	return json({ ok: true });
};

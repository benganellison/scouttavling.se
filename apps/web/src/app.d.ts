import type { SessionUser } from '#lib/server/auth.ts';

declare global {
	namespace App {
		interface Locals {
			user: SessionUser | null;
		}
		interface PageData {
			/** Public domain for addresses shown as text (admin/+layout.server.ts; admin pages only). */
			siteHost?: string;
		}
		interface Error {
			message: string;
		}
	}
}

export {};

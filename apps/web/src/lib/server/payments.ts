import { sql } from 'drizzle-orm';
import { schema } from './db/index.ts';

/**
 * patrol.paid_at follows patrol.paid: set the first time "Betald" is ticked (re-saving keeps the
 * date), cleared when unticked. Use in every UPDATE that writes `paid`.
 */
export const paidAtFor = (paid: boolean) => (paid ? sql`coalesce(${schema.patrol.paidAt}, now())` : null);

/** For INSERTs (no previous date to keep). */
export const paidAtNew = (paid: boolean) => (paid ? new Date() : null);

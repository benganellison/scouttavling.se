# Database migrations: the complete runbook

Every schema change goes through this document. If something here is unclear or wrong, fix this file in the same PR.

## 1. How it works

| Piece | What it is |
|---|---|
| `apps/web/src/lib/server/db/schema.ts` | The schema in TypeScript (Drizzle). The **desired** state. |
| `apps/web/drizzle/NNNN_<name>.sql` | Versioned SQL migrations. The **path** to that state. Committed, reviewed, never edited after merge. |
| `apps/web/drizzle/meta/` | Drizzle's journal (`_journal.json`, the order of migrations) and snapshots (what the schema looked like after each one). Committed. Never hand-edit unless §8 says so. |
| `__drizzle_migrations` table | Which migrations a database has already applied (one row per file, keyed by hash). |
| `apps/web/scripts/migrate.ts` | Applies pending migrations in order, each in a transaction. Idempotent: already-applied files are skipped. |

**History starts at `0000_initial.sql`.** Before anything was deployed, the eleven development migrations were collapsed into it (2026-10-27; the resulting schema was diffed against the old chain and is identical apart from column order). From the first deploy on, merged migrations are never edited, collapsed or renumbered.

**Migrations are forward-only.** There are no "down" migrations. Undoing means deploying a fix-forward migration, or restoring a backup (§9).

**Where migrations run:**

| Environment | Who runs them | Backup first? |
|---|---|---|
| Dev | You, with `npm run db:migrate` or `npm run db:reset` | ✅ Automatic dump to `apps/web/.db-backups/` |
| CI | The UAT job, against a throwaway database | — (nothing to keep) |
| Production | `scripts/deploy.sh` (one-shot `migrate` container, before the app is replaced) | ✅ Automatic: `backup-before-migrate` must succeed first |

Nothing migrates silently. `npm run dev` does **not** migrate. You decide when.

## 2. Golden rules

1. **Never edit `schema.ts` without generating and committing the matching migration in the same PR.** CI fails if you forget.
2. **Read every generated SQL file before committing.** The generator guesses your intent, and some guesses destroy data (§5).
3. **Never edit or delete a migration that has been merged to `main`.** Fix forward with a new migration.
4. **Every migration must work with the previous app version still running** (expand → migrate → contract, §6). In production the new migration runs while the old app is still serving.
5. **No schema changes on competition weekends** (deploy freeze).
6. **Never use `drizzle-kit push`.** It changes the database without a migration file, and in non-interactive shells it stalls on prompts.

## 3. Day-to-day workflow (dev)

Prerequisite: the dev database is running (`docker compose -f compose.dev.yaml up -d`). Run commands in `apps/web`.

1. **Change the schema** in `src/lib/server/db/schema.ts`.
2. **Generate the migration:**
   ```sh
   npm run db:generate -- --name=<short_description>     # e.g. --name=patrol_add_note
   ```
   This writes `drizzle/NNNN_<short_description>.sql` and updates `drizzle/meta/`. It needs no database.
3. **Review the SQL** against the checklist in §4. If drizzle-kit asks whether a column was renamed or created, answer carefully (§5).
4. **Apply it locally:**
   ```sh
   npm run db:migrate          # dumps the DB to .db-backups/ first, then migrates
   ```
5. **Test:** run the app, `npx svelte-check`, `npx vitest run` (from the repo root), and the relevant e2e spec.
6. **Commit `schema.ts` + `drizzle/` together**, with a Conventional Commit message (`feat:` / `fix:`; add `!` if the change breaks old app versions).

If a migration went wrong locally: `npm run db:restore` (restores the newest dump, after first dumping the current state).

### Dev command reference

| Command | Does | Backup first? |
|---|---|---|
| `npm run db:generate -- --name=x` | Writes a migration from `schema.ts` changes | — |
| `npm run db:migrate` | Applies pending migrations | ✅ |
| `npm run db:reset` | Drops everything → migrates → seeds demo data | ✅ |
| `npm run db:seed` | Recreates the demo competitions only | ✗ (only touches demo rows) |
| `npm run db:backup -- <label>` | Dumps the DB to `.db-backups/<time>-<label>.dump` | — |
| `npm run db:restore [-- <file>]` | Restores the newest (or the given) dump | ✅ (current state) |

Dumps live in `apps/web/.db-backups/` (gitignored); the newest 20 are kept. The backup step refuses to continue if the dev database container isn't running. `SKIP_BACKUP=1` overrides that, but only use it when you're sure you don't care about the data.

## 4. Review checklist (every generated SQL file)

- [ ] **Does it do only what I intended?** No unexpected `DROP`.
- [ ] **Renames:** does a rename appear as `DROP COLUMN` + `ADD COLUMN`? If so, that deletes data (§5).
- [ ] **New `NOT NULL` column on an existing table:** does it have a `DEFAULT`? Otherwise it fails on tables with rows.
- [ ] **New `UNIQUE`/`PRIMARY KEY`/`FOREIGN KEY`:** could existing data violate it? If so, write a data-fix step first (§7).
- [ ] **Type changes** (`ALTER COLUMN … TYPE`): is the conversion lossless? Is a `USING` clause needed?
- [ ] **Enum changes:** adding a value is safe; removing or renaming one is not (§6).
- [ ] **Locking:** could it lock a big table for long? Fine at our scale (thousands of rows), but say so in the PR if unsure.
- [ ] **Backward compatible:** does the *previous* app version still work after this runs? (§6)
- [ ] **Privacy:** no columns for birth dates, personnummer or addresses (product decision).
- [ ] **Triggers, functions, data fixes** are in a custom migration (§7), not in a script.

CI posts no review for you; reviewers check this list on the PR.

## 5. Dangerous patterns and how to do them safely

| You want | The generator may produce | Do instead |
|---|---|---|
| Rename a column | `DROP` + `ADD` (data lost) | Answer "rename" when drizzle-kit asks. Check the SQL says `RENAME COLUMN`. In production prefer expand/contract (§6). |
| Rename a table | `DROP TABLE` + `CREATE TABLE` | Same: choose rename, verify `ALTER TABLE … RENAME TO`. |
| Make a column `NOT NULL` | `SET NOT NULL` (fails if NULLs exist) | Custom step first: `UPDATE … SET col = <value> WHERE col IS NULL;` then `SET NOT NULL`. |
| Add a unique constraint | `ADD CONSTRAINT … UNIQUE` (fails on duplicates) | Custom step to resolve duplicates first. |
| Change a column type | `ALTER … TYPE` (may fail or truncate) | Add a new column, backfill, switch the code, drop the old one later. |
| Remove an enum value | Not supported directly | Map rows to another value, then recreate the enum in a custom migration. |
| Delete a column/table | `DROP …` | Only in the *contract* step, at least one release after the code stopped using it. |

## 6. Backward compatibility: expand → migrate → contract

The new migration runs **before** the new app starts, while the old app may still be serving (and offline phones may send old-format commands for a whole weekend). So every migration must leave the schema usable by the **previous** release.

Example: rename `patrol.troop` to `patrol.group_name`.

| Release | Migration | App code |
|---|---|---|
| N (expand) | `ADD COLUMN group_name text;` + backfill `UPDATE patrol SET group_name = troop;` | Writes **both** columns, reads `group_name` (falls back to `troop`) |
| N+1 (contract) | `ALTER TABLE patrol DROP COLUMN troop;` | Uses only `group_name` |

Never do expand and contract in the same release.

## 7. Custom migrations (triggers, functions, data fixes)

Anything Drizzle can't express goes in a hand-written migration, so it's versioned and runs everywhere in order:

```sh
npx drizzle-kit generate --custom --name=<what>     # creates an empty NNNN_<what>.sql
```

- Separate statements with `--> statement-breakpoint` lines (see the trigger functions at the end of `0000_initial.sql`).
- Make it re-runnable where possible (`CREATE OR REPLACE`, `DROP … IF EXISTS`, `WHERE` guards on updates).
- Data fixes belong here too (e.g. backfills), not in ad-hoc scripts run by hand.

## 8. Fixing a migration before it's merged

If the migration is **only on your branch** (not on `main`, not deployed):

1. `npm run db:restore` to roll your local DB back to before you applied it (or `npm run db:reset`).
2. Delete the SQL file, its entry in `drizzle/meta/_journal.json`, and its `drizzle/meta/NNNN_snapshot.json`.
3. Fix `schema.ts` and run `npm run db:generate` again.

Once merged to `main`: **never** edit or delete it. Write a new migration that corrects it.

## 9. Two branches both added a migration

Both branches create `NNNN_…` with the same number and conflicting journal/snapshot files.

1. Merge or rebase `main` into your branch.
2. Keep `main`'s migration files and journal. Delete **your** migration file, its journal entry and its snapshot.
3. `npm run db:restore` (or `db:reset`), then `npm run db:migrate` to apply `main`'s migrations.
4. `npm run db:generate -- --name=<yours>` to regenerate yours on top, with the next number.
5. Review again, commit.

CI's drift check fails if the journal and `schema.ts` disagree, so a botched merge doesn't slip through.

## 10. Production deploy

**Always deploy with `scripts/deploy.sh`.** Never run a bare `docker compose up -d`. Compose stops the old app container *before* it waits for `migrate`, so a failing migration takes the site down. This was tested: the site stopped responding. The script orders the steps so that never happens:

```sh
# APP_IMAGE in .env.prod set to the new release (version or @sha256 digest)
scripts/deploy.sh                       # uses .env.prod + compose.yaml + compose.prod.yaml
```

| Step | On failure |
|---|---|
| 1. Pull images | Stops. Nothing changed. |
| 2. Database up and healthy | Stops. Nothing changed. |
| 3. **`backup-before-migrate`** writes `/backups/pre-migrate-<time>.dump` | Stops. No migration without a dump. |
| 4. **`migrate`** applies pending migrations from the new image | Stops. **The old app keeps serving** (tested). The dump from step 3 is available. |
| 5. Replace the app, wait until healthy | Stops. Roll back (§11 option A). |
| 6. Start/refresh the other services (Traefik, periodic backups) | — |

To try the same flow locally: `ENV_FILE=.env COMPOSE_FILES="compose.yaml" scripts/deploy.sh`.

Before deploying:
- [ ] Not a competition weekend (deploy freeze).
- [ ] Read the release notes for migrations (the release PR lists the commits) and their review (§4).
- [ ] The latest scheduled dump has been copied offsite (the `backup` service writes dumps every 15 min to the same disk).

After deploying:
- [ ] The script ends with "✓ Deployed".
- [ ] `https://<domain>/healthz` returns `ok`.
- [ ] Log in and open one competition.

## 11. Rolling back in production

**Option A: redeploy the previous image** (preferred). This works when the migration was backward compatible (rule 4). Set `APP_IMAGE` back to the previous version or digest and run `scripts/deploy.sh` again. The schema stays migrated, which is fine because the old app tolerates it (and step 4 is a no-op). Then fix forward.

**Option B: restore the pre-migrate dump.** Only when the migration damaged data. **Everything written after the dump is lost**, so use this before an event starts, or reconcile with paper protocols afterwards.

```sh
C="docker compose --env-file .env.prod -f compose.yaml -f compose.prod.yaml"
$C stop app
$C run --rm --no-deps --entrypoint sh backup-before-migrate -c 'ls -1t /backups/pre-migrate-*.dump | head -3'   # pick one
$C run --rm --no-deps --entrypoint sh backup-before-migrate -c \
  'psql -c "drop schema public cascade; create schema public;" && pg_restore --no-owner --exit-on-error -d "$PGDATABASE" /backups/pre-migrate-<time>.dump'
# set APP_IMAGE back to the release that matches the dump, then
$C up -d --no-deps --wait app
```

> Status: the restore *mechanics* (`pg_restore` of these dumps) are tested via `npm run db:restore` in dev, but this exact production sequence has **not** been drill-tested yet. Do the restore drill on a staging copy (docs/architecture/04 §8) before the first real competition.

## 12. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| CI: "schema.ts has changes without a migration" | Run `npm run db:generate -- --name=…`, review, commit `drizzle/`. |
| `db-backup: the dev database container is not running` | `docker compose -f compose.dev.yaml up -d`, then retry. |
| Migration fails locally with a constraint error | Existing data violates the new rule. Add a custom data-fix step (§5, §7), then `npm run db:restore` and retry. |
| `relation … already exists` right after pulling the collapsed `0000_initial.sql` | Your dev DB still has the old 0000–0010 recorded. `npm run db:reset` (it takes a backup first). |
| `relation … already exists` | The DB was changed outside migrations (e.g. an old `push`). In dev: `npm run db:reset`. In production: investigate, never reset. |
| Production: deploy script stopped at "Applying migrations" | The old app is still serving. Read the output, fix forward in a new release. The pre-migrate dump is in the `backups` volume. |
| Someone ran plain `docker compose up -d` and migrate failed | The app is down. Deploy the previous `APP_IMAGE` with `scripts/deploy.sh` (§11 A). |

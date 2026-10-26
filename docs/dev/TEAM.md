# Developer team handbook (v0.1 build)

Read this first. Architecture: `docs/architecture/` (01-overview.md is binding). UI design for every screen: https://claude.ai/artifact/53qBCbWvJdNHSihkWFGqd6. The design is mirrored in prose in each agent brief, and the tokens are in `apps/web/src/lib/styles/global.css`.

## Ground rules
- **Swedish UI** text; code, comments and identifiers in English.
- **Never commit, push or touch git.** The lead does that.
- **Only edit files you own** (see Ownership). Need a change elsewhere? Say so in your final report. Shared files may get **small additive edits** with the Edit tool, never a full rewrite.
- **No personal data.** Never read or copy the `.xls` in the repo root. Seed and test data are invented.
- **Latest stable versions.** Dependencies are already installed. If you truly need a new one, pin the exact latest version, run `npm install <pkg>@<ver> -w apps/web` from the repo root, and report it.
- Mobile first, touch targets ≥48px (≥56px in field screens), WCAG AA contrast, real `<button>`/`<a>`/`<label>`.

## SvelteKit 3 gotchas (they cost time, learn them)
- Imports from `src/lib` use **`#lib/...` with an explicit `.ts` extension**: `import { db } from '#lib/server/db/index.ts'`. `$lib` no longer exists. `.svelte`, `.css` and `.svg` imports keep their own extension.
- Env vars: declared in `src/env.ts` and read via `import { X } from '$app/env/private'`. Every variable is required unless declared with `schema: optional`.
- Hook types: `import type { Handle } from '@sveltejs/kit/hooks'`.
- There is no `svelte.config.js`; kit config lives in `vite.config.ts`. Runes mode is forced: use `$props`, `$state`, `$derived`, `$effect` and `{@render}`.
- tsconfig: `verbatimModuleSyntax` is on, so type-only imports need `import type`.
- Type check: `cd apps/web && npx svelte-check --tsconfig ./tsconfig.json --threshold error`. Fix your own errors before reporting.

## Running things
- DB: PostgreSQL 18.6 **in Docker**: `docker compose -f compose.dev.yaml up -d` (port 5544). `.env` in `apps/web` is already set.
- Schema changes: follow **[MIGRATIONS.md](MIGRATIONS.md)**. In short: edit `schema.ts` → `npm run db:generate -- --name=…` → review the SQL against the checklist → `npm run db:migrate` (takes a backup first) → commit `schema.ts` and `drizzle/` together. Never use `drizzle-kit push`.
- Migrations must stay **backward compatible for one release** (expand → migrate data → contract in a later release), because a new release's migration runs while the previous app version is still serving.
- `change_log.seq` is **per competition** and assigned by a DB trigger. Never set it yourself; always filter by `competition_id`.
- Demo data: `cd apps/web && npm run db:seed`. It wipes and recreates the series `gokopen` (branding, class colours; editions `gokopen-2026`: closed, archived, with results, and the current `gokopen-2027`) and `gokhajk`. `gokopen-2027` (single day, 14 stations including "Mål" with 4 items, 14 patrols, some scores, a tie between 112 and 137) and `gokhajk-2027` (3 days, F/L/S codes).
- Dev server: **use your own port** with `PORT=<your port> scripts/dev-server.sh start|stop` (run in `apps/web`). Never `pkill -f vite`: it kills other agents' servers. The log is `.dev-server-<port>.log`.
- Log in (dev): POST `/login?/dev` with `who=bengt`. In a browser, `/login` → "Logga in som Bengt". Bengt owns both demo competitions.
- Unit tests: `npx vitest run` (root). Put tests next to code as `*.test.ts`.
- Browser checks: Playwright 1.64.1 is installed (`@playwright/test`, browsers cached). Write e2e specs as `apps/web/e2e/<area>.e2e.ts`. Use a phone viewport (390×844) for field screens.

## Shared code (owned by lead; use it, don't fork it)
- `packages/domain`: score evaluation (`evaluate`, `selectableValues`, `styleValues`), `rank` (shared places 1,2,2,4), `stationCodes`/`daysBetween`, `distribute` (BALANCED/ALL/PER_TRACK), patrol QR (`patrolCodeUrl`, `parsePatrolCode`, `verifyPatrolCode`), import parsing (`parseFileText`, `guessColumns`, `buildImport`, `mergeTroops`, `isScoutnetExport`).
- `apps/web/src/lib/server/scores.ts`: **the only way to write scores**, `writeScore` / `voidScore`, including versioning, conflicts, audit and change feed. It is used by field sync, HQ edits and paper entry. `itemDef(itemRow, comp)` maps DB → domain.
- `apps/web/src/lib/server/changes.ts`: `recordChange(tx, competitionId, kind, entityId)` appends to `change_log` + `pg_notify('changes')`. Call it for every write that live screens should see.
- `apps/web/src/lib/server/auth.ts`: `requireUser(event)`, `requireCompetition(event, slug, roles?)`, session helpers, and `safeNext(path)`. Use `safeNext` for **every** redirect target that comes from user input (open-redirect guard). Hooks enforce CSRF (`x-csrf-token` = `locals.user.csrf`) on unsafe `/api/*` requests, except `/api/v1/join` and `/api/v1/field/*`. Prefer SvelteKit **form actions** for organiser pages; they are CSRF-protected by Kit's origin check.
- `apps/web/src/lib/server/series.ts` (series, `requireSeries`, next edition, archive), `anonymise.ts` ("Ta bort personuppgifter"), `assetStore.ts` (the only module touching image bytes) and `assets.ts` (`loadBranding`: edition → series → Scouterna base). See docs/architecture/05-series-and-archive.md. An anonymised edition is read-only: `requireCompetition` refuses non-GET requests.
- `apps/web/src/lib/server/ownership.ts`: **the only way to change owners/organisers** of a competition or series (`changeMembers`, `transferOwnership`; ≥ 1 owner, row-locked, audited). `audit.ts` (`writeAudit`, append-only `audit_log`; ids only, never participant names in `reason`), `siteAdmin.ts` (`requireSiteAdmin` → 404, suspension, temporary access). `requireCompetition` also returns `access` (a site admin's temporary access) and refuses writes on a suspended competition (423). See docs/architecture/04 §10.
- Global CSS building blocks: `.btn .btn-primary .btn-accent .btn-ghost .card .pill(-ok/-warn/-bad) .field .label .muted .stack .row .sr-only .error-text`, plus CSS variables (`--brand`, `--cta`, `--orange`, `--ink-2`, `--line`, `--r-md` …). There is no invented app mark: Scouterna's logo is `#lib/ui/brand/ScouternaLogo.svelte` (where there is room) and the scout symbol `#lib/ui/brand/ScouternaSymbol.svelte` (small square spots); an uploaded event logo takes the event spot.

## Visual language (Scouterna's graphic profile; see `apps/web/static/brand/scouterna/README.md`)
- Scoutblå (`--brand` #003660) dominates: sidebars, headers, primary buttons. Never tinted or transparent; light surfaces are neutral greys (`--ground` #F4F6F8, `--tint`). White cards, 1px `--line`, 18px radius.
- Complementary colours (`--orange` Äventyrarorange etc.) are decoration only; text on them is black/white via `readableText()` in `#lib/brand/colors.ts`.
- Fonts (fontsource, self-hosted): Libre Franklin (headings + UI), EB Garamond (`.prose`, long public body text only).
- Scouterna's logo via `#lib/ui/brand/ScouternaLogo.svelte` (blue on light, white on dark, ≥250 px / 35 mm); event pages use `PublicShell` + `SenderFooter`. Event branding (`loadBranding`) and class colours (`trackColors`, layout data `trackColors`) are shared helpers.
- Statuses: Anmäld (white, dark outline), På banan (`--orange`, black text), I läger (`--st-camp`, Scoutblå outline), I mål (Scoutblå, white text), Återbud (`--st-resigned`, white text).
- Status flow (decided in `packages/domain/src/patrolStatus.ts`, applied in `scores.ts` for every accepted score): Anmäld → **På banan** at the first score; a check-in at a station with role `finish` (or an AUTO_ON_SCAN item) → **I läger** (`camp`, light grey) on a day that isn't the last, or **I mål** on the last day / single-day; I läger → På banan at the first score from a *later* day. Återbud is never touched; I mål is never downgraded. "Not seen for 45 min" alarms only look at På banan. Stations have an explicit `role` (`start`/`finish`/null).
- No emoji. Icons are inline stroke SVGs with `aria-hidden="true"`.

## Ownership and routes

| Area | Agent | Owns |
|---|---|---|
| Organiser setup | **admin-setup** | `src/routes/admin/+page*`, `src/routes/admin/new/**`, `src/routes/admin/[slug]/+layout*` (**sidebar nav for all admin pages**), `src/routes/admin/[slug]/+page*` (overview checklist), `src/routes/admin/[slug]/stations/**`, `src/routes/admin/[slug]/settings/**`, `src/lib/ui/admin/**` |
| Patrols & prep | **admin-patrols** | `src/routes/admin/[slug]/patrols/**`, `…/import/**`, `…/distribution/**`, `…/invites/**`, `…/print/**`, `src/lib/ui/patrols/**` |
| Field (volunteer + start/finish) | **field** | `src/routes/j/**`, `src/routes/f/**`, `src/routes/p/**`, `src/routes/api/v1/join/**`, `src/routes/api/v1/field/**`, `src/lib/field/**` (client: Dexie, signing, outbox), `src/lib/server/field.ts` (grants), `src/service-worker.ts` |
| Live, results, HQ | **live** | `src/routes/admin/[slug]/live/**`, `…/patrol/[nr]/**`, `…/conflicts/**`, `…/messages/**`, `…/results/**`, `src/routes/r/**` (public results + ceremony), `src/routes/api/v1/live/**` (SSE), `src/lib/server/live.ts`, `src/lib/ui/live/**` |

Sidebar nav entries that admin-setup must render, linking to other agents' routes:
- **Före:** Översikt `/admin/[slug]`, Kontroller `/stations`, Patruller `/patrols`, Importera `/import`, Fördela start `/distribution`, Funktionärer `/invites`, Utskrifter `/print`, Inställningar `/settings`.
- **Tävlingsdag:** Ledningscentral `/live`, Start & mål (opens `/invites` for a start/finish invite), Meddelanden `/messages`.
- **Efter:** Resultat `/results`, Prisutdelning `/r/[slug]/ceremony`.

Pages under `admin/[slug]/` get the layout automatically. Each page renders only its main content.

## Cross-agent contracts
- **Station ids, item ids and patrol numbers** are the shared vocabulary.
- **Field sync endpoints** (contract C1, adapted to slug URLs):
  - `GET /api/v1/field/[slug]/snapshot?since=<seq>` returns the device's station pack plus deltas.
  - `POST /api/v1/field/[slug]/sync/commands` takes ≤100 JWS commands and returns per-command `accepted{version} | duplicate | conflict{server} | quarantined{reason} | rejected{reason}`.
- **Invites:** admin-patrols creates rows in `invite` (secret shown once). The field agent's `/j/[secret]` redeems it. Secret = 128-bit random base64url; store `sha256` (same helper as `auth.ts`). Link: `${ORIGIN}/j/<secret>`.
- **Patrol QR** on passes and scorecards: `patrolCodeUrl(origin, comp.patrolCodeKey, comp.slug, patrol.number)`. Field scanners parse and verify it offline.
- **Live updates:** anything that changes scores, patrols or messages must call `recordChange` (scores.ts already does). The live agent's SSE reads `change_log` after a cursor.
- **Patrol status changes** (start/finish desk) are done by the field agent: update `patrol.status`, insert `status_event`, `recordChange(…,'patrol')`.

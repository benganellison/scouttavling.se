# Contributing to scouttavling.se

Welcome! scouttavling.se is built and run by volunteers. This page gets you from a fresh clone to a merged pull request. What the system is and why it looks the way it does: [docs/architecture/](docs/architecture/README.md) (start with **01 §0 "As built"**). Every screen and user journey is on the UI design canvas: https://claude.ai/artifact/53qBCbWvJdNHSihkWFGqd6.

## Ground rules

- **Never use real personal data.** Seed, test and demo data are invented. Never commit a Scoutnet export or a gokapp database (`*.xls`, `*.csv` and `.local-data/` are gitignored for that reason), and never copy names from one into code, docs or tests.
- **Swedish UI** text; code, comments and identifiers in English.
- **Accessible by default:** mobile first, touch targets ≥ 48 px (≥ 56 px in the field app), WCAG 2.2 AA contrast, real `<button>`/`<a>`/`<label>`, error texts linked with `aria-describedby` (03 "Accessibility review").
- **Pinned, current dependencies.** Add one with an exact version: `npm install -E <pkg>@<version> -w apps/web`.
- **Schema changes only through migrations** ([MIGRATIONS.md](docs/dev/MIGRATIONS.md)); never `drizzle-kit push`.

## Getting started

Needs Node 24 and Docker.

```sh
npm install
npm run db:up                                  # PostgreSQL 18.6 on 127.0.0.1:5544
cd apps/web
cp .env.example .env                           # DEV_LOGIN=1 gives you "Logga in som Bengt"
npm run db:reset                               # migrate + demo data (backup first)
npm run dev                                    # http://localhost:5173 → /login → "Logga in som Bengt"
```

Demo data (`npm run db:seed` re-creates it): the series **GökOpen** with the closed, archived `gokopen-2026` and the current `gokopen-2027` (single day, 14 stations including a "Mål" with 4 items, 14 patrols, some scores, a tie between 112 and 137), and **GökHajk** with `gokhajk-2027` (3 days). Bengt owns both; Anna is a second, invented user.

Running several dev servers (e.g. one for e2e): `PORT=5204 scripts/dev-server.sh start|stop` in `apps/web`. Don't `pkill` vite.

## Checks and tests

| What | Command | In CI |
|---|---|---|
| Types (app, scripts, e2e, domain) | `npm run check` | every PR |
| Lint, incl. module boundaries | `npm run lint` | every PR |
| Formatting | `npm run format` (fix) · `npm run format:check` | every PR |
| Unit + property tests | `npm test` | every PR |
| Database tests (`*.db.test.ts`) | `npm test` with the dev DB running; skipped without one (`REQUIRE_DB=1` makes that an error) | every PR |
| e2e against a dev server | `npm run e2e` (all suites, fresh seed each) or `apps/web/scripts/e2e-dev.sh field stats` | nightly |
| UAT on a production build | start commands in the header of `apps/web/e2e/uat.e2e.ts` | every PR |
| Lifecycle UAT, README demo videos | headers of `e2e/lifecycle.e2e.ts`, `e2e/demo.e2e.ts` | by hand |

Put unit tests next to the code as `*.test.ts`. A database test uses `#lib/server/testing/dbTestEnv.ts` and removes the rows it creates. e2e specs are `apps/web/e2e/<area>.e2e.ts` with a `<area>.config.ts`; shared helpers (login, browser) are in `e2e/support.ts`, and the address comes from `E2E_BASE_URL`. Use a phone viewport (390×844) for field screens.

## Branches, commits and releases

- Short-lived branch from `main`, pull request, CI green, **squash merge**.
- **Conventional Commits** (`feat:`, `fix:`, `docs:`, `refactor:`, `feat!:` …): they decide the next version. release-please keeps a release PR; merging it tags the release and publishes the image (README "Versions and releases").
- Schema change: `schema.ts` and the generated `drizzle/` SQL in the same commit.

## Where things are

```
apps/web/src/
  routes/          pages and endpoints: admin/ (organisers), f/ + j/ (field app), t/ (public competition and registration),
                   r/ (results, ceremony), m/ + folj/ (patrol manage and follow links), site-admin/, api/v1/
  lib/server/      server only: db/, auth, scores (the only score writer), field (sync), live (results, SSE), …
  lib/field/       the offline field app (Dexie outbox, signing) and the sync protocol shared with the server
  lib/ui/          components; lib/styles/global.css holds the design tokens
packages/domain/   pure TypeScript: ranking, score rules, patrol status, distribution, import parsing, gokapp mapping
```

The boundaries between these are lint rules (01 §0): `packages/domain` stays pure, `src/lib` doesn't import routes, server code doesn't import UI, client code doesn't import `#lib/server`.

## SvelteKit 3 gotchas (they cost time, learn them)
- Imports from `src/lib` use **`#lib/...` with an explicit `.ts` extension**: `import { db } from '#lib/server/db/index.ts'`. `$lib` no longer exists. `.svelte`, `.css` and `.svg` imports keep their own extension.
- Env vars: declared in `src/env.ts` and read via `import { X } from '$app/env/private'`. Every variable is required unless declared with `schema: optional`.
- Hook types: `import type { Handle } from '@sveltejs/kit/hooks'`.
- There is no `svelte.config.js`; kit config lives in `vite.config.ts`. Runes mode is forced: use `$props`, `$state`, `$derived`, `$effect` and `{@render}`.
- tsconfig: `verbatimModuleSyntax` is on, so type-only imports need `import type`.
- Type check: `npm run check` (repo root).

## Running things

- Schema changes: follow **[MIGRATIONS.md](docs/dev/MIGRATIONS.md)**. In short: edit `schema.ts` → `npm run db:generate -- --name=…` → review the SQL against the checklist → `npm run db:migrate` (takes a backup first) → commit. Migrations stay **backward compatible for one release** (expand → migrate data → contract later), because a new release's migration runs while the previous version still serves.
- `change_log.seq` is **per competition** and assigned by a DB trigger. Never set it yourself; always filter by `competition_id`.
- Log in (dev): `/login` → "Logga in som Bengt", or POST `/login?/dev` with `who=bengt`.

## Shared code (use it, don't copy it)
- `packages/domain`: score evaluation (`evaluate`, `selectableValues`, `styleValues`), `rank` (shared places 1,2,2,4), `stationCodes`/`daysBetween`, `distribute` (BALANCED/ALL/PER_TRACK), patrol QR (`patrolCodeUrl`, `parsePatrolCode`, `verifyPatrolCode`), import parsing (`parseFileText`, `guessColumns`, `buildImport`, `mergeTroops`, `isScoutnetExport`).
- `apps/web/src/lib/server/scores.ts`: **the only way to write scores**, `writeScore` / `voidScore`, including versioning, conflicts, audit and change feed. It is used by field sync, HQ edits and paper entry. `itemDef(itemRow, comp)` maps DB → domain.
- `apps/web/src/lib/server/changes.ts`: `recordChange(tx, competitionId, kind, entityId)` appends to `change_log` + `pg_notify('changes')`. Call it for every write that live screens should see.
- `apps/web/src/lib/server/auth.ts`: `requireUser(event)`, `requireCompetition(event, slug, roles?)`, session helpers, and `safeNext(path)`. Use `safeNext` for **every** redirect target that comes from user input (open-redirect guard). Hooks enforce CSRF (`x-csrf-token` = `locals.user.csrf`) on unsafe `/api/*` requests, except `/api/v1/join` and `/api/v1/field/*`. Prefer SvelteKit **form actions** for organiser pages; they are CSRF-protected by Kit's origin check.
- `apps/web/src/lib/server/invites.ts` (invite links and QR), `sealed.ts` (secrets the server must show again), `qr.ts`, and `#lib/time.ts` (dates in Europe/Stockholm).
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

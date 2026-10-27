# scouttavling.se

Patrol competitions for scouts: registration, stations, scoring in the forest (offline), live HQ, results with points per station, statistics and the prize ceremony. A rebuild of [gokapp](https://github.com/erydberg/gokapp).

<p align="center">
  <img src="docs/media/poang-pa-kontroll.gif" width="300" alt="En funktionär knappar in patrull 108, sätter 12 + 4 poäng och sparar. Poängen sparas i telefonen och väntar på täckning.">
</p>

## Se det i aktion

Recorded at a calm pace, with captions explaining each step. All data is invented. They come from `apps/web/e2e/demo.e2e.ts`.

**Funktionären på kontrollen, även utan täckning.** Join via QR, score, undo, two patrols scored offline, then everything syncs.

https://github.com/user-attachments/assets/f7b04113-e1a6-4daf-bc87-677b7a048de6

**Ledningscentralen live.** The volunteer saves a score and HQ sees it without reloading. HQ then corrects a score with a reason and sends a message that pops up on the phone.

https://github.com/user-attachments/assets/a2c7683a-e966-4c85-8ac7-046dacfbca13

**Mål med flera delar.** One scan, all parts on one screen: finish registration, nödbrev, händighet and orientering.

https://github.com/user-attachments/assets/1e534450-c4d5-4695-b8cd-5e6ea453e462

**Prisutdelning på storbild.** Places are revealed one at a time; tied patrols share a place.

https://github.com/user-attachments/assets/b4eab240-ab46-4f01-ad2e-9d9f8a7c9faf

**Tävlingens eget utseende.** Each competition gets its own logo, accent colour and cover image, with the organiser's logo and Scouterna as sender: settings, the public page, registration, the patrol pass, the follow page, live results and the printed scorecards.

https://github.com/user-attachments/assets/a90eeadc-7c25-4b93-9bdf-9043a9cea715

<!--
The videos are GitHub user-attachments (not stored in git). To refresh them after UI changes,
re-cut the clips and upload them as described in docs/media/README.md, then swap the URLs above.
-->

## About

- Architecture: [`docs/architecture/`](docs/architecture/README.md). Start with 01-overview.md.
- Developer handbook: [`docs/dev/TEAM.md`](docs/dev/TEAM.md)
- Stack: SvelteKit 3 + Svelte 5 (TypeScript 6), PostgreSQL 18, Drizzle, Node 24 LTS.

## Develop

```sh
npm install
docker compose -f compose.dev.yaml up -d      # PostgreSQL 18.6 on 127.0.0.1:5544
cd apps/web
cp .env.example .env
npm run db:reset                              # migrate + demo data (GökOpen, GökHajk)
npm run dev                                   # http://localhost:5173 → /login → "Logga in som Bengt"
```

| Task | Command (in `apps/web`) |
|---|---|
| Type check | `npx svelte-check --tsconfig ./tsconfig.json` |
| Unit tests | `npx vitest run` (repo root) |
| Schema change | follow [docs/dev/MIGRATIONS.md](docs/dev/MIGRATIONS.md) (generate → review → migrate with auto-backup → commit) |
| Apply migrations | `npm run db:migrate` |
| UAT (production build) | see the header of `e2e/uat.e2e.ts` |

## Run with Docker

```sh
cp .env.example .env                                         # set GRANT_SIGNING_KEY:
npm run gen:grant-key -w apps/web
docker compose up -d --build                                 # http://localhost:3000
```

Production (Traefik + Let's Encrypt + periodic DB dumps). Hosting is not decided yet; this is one option:

```sh
cp .env.example .env.prod                                    # DOMAIN, ACME_EMAIL, passwords, keys, APP_IMAGE
scripts/deploy.sh          # backup → migrate → replace app; a failing migration never stops the running app
```

Schema changes, backups, deploys and rollback: **[docs/dev/MIGRATIONS.md](docs/dev/MIGRATIONS.md)**.

### Site admin (platform operator)

Granted and revoked only on the server's command line (never from the web). The person must have logged in once. Every grant/revoke is written to the audit log.

```sh
# dev (in apps/web)
npm run site-admin:grant  -- <memberNo> --reason "Driftansvarig för scouttavling.se"
npm run site-admin:revoke -- <memberNo> --reason "Slutar som driftansvarig"
npm run site-admin:list
# production: inside the running app container
docker compose --env-file .env.prod -f compose.yaml -f compose.prod.yaml exec -e SITE_ADMIN_OPERATOR="$USER" \
  app npm run site-admin:grant -- <memberNo> --reason "…"
```

Site admins get `/site-admin` (search, owners, suspension, personal-data removal, temporary access, audit log). Details: [docs/architecture/04 §10](docs/architecture/04-security-and-operations.md).

### Old years from gokapp

Imports one gokapp database as an archived year of a series: patrol name, kår, class and points per station only. Dry run first; add `--commit` to write.

```sh
# the password stays out of the process list and shell history
read -rs GOKAPP_SOURCE && export GOKAPP_SOURCE   # mysql://user:pass@host:3306/gokapp
npm run gokapp:import -- --series hajk-dm --series-name "Hajk-DM" --year 2023 --owner <memberNo>
npm run gokapp:import -- --series hajk-dm --series-name "Hajk-DM" --year 2023 --owner <memberNo> --commit
```

Details and what is read: [docs/architecture/02 §9](docs/architecture/02-backend-and-domain.md).

`ORIGIN` is baked into the image at build time, so each public domain needs its own build. Released images are built by CI with the repository variable `PUBLIC_ORIGIN`.

## Versions and releases

- **SemVer**: 0.x during development and pilot. `1.0.0` is the first real competition. After that, patch = fixes, minor = features, major = breaking changes (e.g. the offline sync format).
- **Conventional Commits** (`feat:`, `fix:`, `feat!:` …) drive the version. Work on short-lived branches and merge to `main` through pull requests. CI must pass.
- **release-please** keeps a release PR with the changelog up to date. Merging it tags `vX.Y.Z`, creates the GitHub Release and publishes `ghcr.io/benganellison/scouttavling:X.Y.Z` (also `X.Y` and `sha-…`, never `latest`) with build provenance.
- **Deploy** by setting `APP_IMAGE` to a version or `@sha256:` digest. Roll back by pointing at the previous one. Migrations run in the one-shot `migrate` container before the app starts. Deploy freeze on competition weekends.
- The first release PR proposes **0.1.0** (`release-as` in `release-please-config.json`). Remove that line after v0.1.0 is released.

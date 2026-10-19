# scouttavling.se

Patrol competitions for scouts: registration, stations, scoring in the forest (offline), live HQ, results and the prize ceremony. A rebuild of [gokapp](https://github.com/erydberg/gokapp).

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
npm run dev                                   # http://localhost:5173 → /login → "Logga in som Erik"
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

`ORIGIN` is baked into the image at build time, so each public domain needs its own build. Released images are built by CI with the repository variable `PUBLIC_ORIGIN`.

## Versions and releases

- **SemVer**: 0.x during development and pilot. `1.0.0` is the first real competition. After that, patch = fixes, minor = features, major = breaking changes (e.g. the offline sync format).
- **Conventional Commits** (`feat:`, `fix:`, `feat!:` …) drive the version. Work on short-lived branches and merge to `main` through pull requests. CI must pass.
- **release-please** keeps a release PR with the changelog up to date. Merging it tags `vX.Y.Z`, creates the GitHub Release and publishes `ghcr.io/benganellison/scouttavling:X.Y.Z` (also `X.Y` and `sha-…`, never `latest`) with build provenance.
- **Deploy** by setting `APP_IMAGE` to a version or `@sha256:` digest. Roll back by pointing at the previous one. Migrations run in the one-shot `migrate` container before the app starts. Deploy freeze on competition weekends.
- The first release PR proposes **0.1.0** (`release-as` in `release-please-config.json`). Remove that line after v0.1.0 is released.

# syntax=docker/dockerfile:1
# scouttavling.se — production image (SvelteKit adapter-node, Node 24 LTS).
#
# ORIGIN is baked in at build time (SvelteKit 3's CSRF origin check reads it
# from the build), so build one image per public domain:
#   docker build --build-arg ORIGIN=https://scouttavling.se -t scouttavling .

ARG NODE_IMAGE=node:24.22.0-bookworm-slim

# ---------- deps: install all workspaces from the lockfile ----------
FROM ${NODE_IMAGE} AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/domain/package.json packages/domain/package.json
RUN npm ci --no-audit --no-fund

# ---------- build ----------
FROM deps AS build
ARG ORIGIN
ENV ORIGIN=${ORIGIN}
# Route analysis validates env vars; nothing connects at build time. Not carried into the runtime stage.
ENV DATABASE_URL=postgres://build:build@127.0.0.1:5432/build
COPY . .
RUN npx --workspace apps/web svelte-kit sync \
	&& npm run build -w apps/web \
	&& npm prune --omit=dev --workspaces --include-workspace-root

# ---------- runtime ----------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
	PORT=3000 \
	HOST=0.0.0.0 \
	BODY_SIZE_LIMIT=3M
WORKDIR /app

# Runtime deps (pruned), the built server, migrations, the migrate script, the site-admin CLI and the
# gokapp importer (`npm run gokapp:import`, 02 §9)
# (`docker compose exec app npm run site-admin:grant -- <memberNo> --reason "…"`, docs/architecture/04 §10).
COPY --from=build --chown=node:node /repo/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/packages ./packages
COPY --from=build --chown=node:node /repo/apps/web/build ./apps/web/build
COPY --from=build --chown=node:node /repo/apps/web/package.json ./apps/web/package.json
COPY --from=build --chown=node:node /repo/apps/web/drizzle ./apps/web/drizzle
COPY --from=build --chown=node:node /repo/apps/web/scripts/migrate.ts ./apps/web/scripts/migrate.ts
COPY --from=build --chown=node:node /repo/apps/web/scripts/site-admin.ts ./apps/web/scripts/site-admin.ts
COPY --from=build --chown=node:node /repo/apps/web/scripts/gokapp-import.ts ./apps/web/scripts/gokapp-import.ts
COPY --from=build --chown=node:node /repo/apps/web/src/lib/server/gokappImport.ts ./apps/web/src/lib/server/gokappImport.ts
COPY --from=build --chown=node:node /repo/apps/web/src/lib/server/db/schema.ts ./apps/web/src/lib/server/db/schema.ts
COPY --from=build --chown=node:node /repo/apps/web/src/lib/routing/slugs.ts ./apps/web/src/lib/routing/slugs.ts
COPY --from=build --chown=node:node /repo/package.json ./package.json

USER node
WORKDIR /app/apps/web
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=4 \
	CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "build/index.js"]

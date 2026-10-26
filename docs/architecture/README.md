# Architecture

Proposal for scouttavling.se, a rebuild of gokapp. Start with the overview: it summarises every decision and settles the points where the sections differ.

| Doc | Contents |
|---|---|
| [01 Overview](01-overview.md) | System diagram, key decisions (TypeScript end-to-end, hosting deferred), **binding cross-section contracts**, version baseline, open questions, build order |
| [02 Backend & domain](02-backend-and-domain.md) | SvelteKit-server stack (Drizzle, Postgres, shared `packages/domain`/`schema`), domain model (ER diagram), REST + SSE API with LISTEN/NOTIFY fan-out, offline sync protocol, ranking, start distribution, import pipeline, background jobs (pg-boss), gokapp migration, tests |
| [03 Client](03-client.md) | SvelteKit app topology (same app serves the API), offline architecture, state & realtime, design system tokens, QR scanning, printing, import wizard, client auth, accessibility, performance, testing |
| [05 Series & archive](05-series-and-archive.md) | Competition series and yearly editions, branding resolution, "Skapa nästa år", "Ta bort personuppgifter" (column-by-column decisions), public archive, image storage threshold |
| [06 Statistics](06-statistics.md) | Organiser and public statistics per class: participation, points per station, times between stations (phone visit times), registrations and payments (internal only) |
| [04 Security & operations](04-security-and-operations.md) | ScoutID (OIDC, openid-client BFF) integration + registration email, volunteer device grants, role × permission matrix, threat model, GDPR & retention, hosting requirements & options with costs, CI/CD, event-day runbook, rollout plan |

UI design canvas: https://claude.ai/artifact/53qBCbWvJdNHSihkWFGqd6

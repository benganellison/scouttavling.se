# 03 – Client architecture

Status: proposal · Scope: web/PWA clients, offline, UI architecture · Related: 02-backend (domain/API, same codebase), 04-security-operations

This section decides how the browser side of scouttavling.se is built. It covers the patrol leader's phone, the station volunteer's phone in the forest, the start/finish tablet, the organiser's and HQ's desktop, the public results page, the projector, and paper. Each section starts with the decision, then gives the reasons and the alternatives we considered. The same SvelteKit app also runs the server side (API, BFF, sync, SSE; 02 §1), and client and server share `packages/domain` and `packages/schema`. Interfaces with server modules and security are collected in §15.

All versions were checked against the npm registry, nodejs.org and cdn.sheetjs.com on **2026-10-15** and pinned exactly. Renovate keeps them current (§13).

---

## 1. What we learned from gokapp

The current app (Spring Boot + Thymeleaf, ~270 lines of plain JS) works, but the client design causes most of its usability problems:

| gokapp behaviour | Problem in the field | New approach |
|---|---|---|
| `<select>` with every patrol plus a numpad that filters `option.hidden` (`score.js`) | Tiny dropdown on a phone, wrong patrol easy to pick, slow with gloves | Full-screen scan, or a big number pad that live-filters *expected* patrols and shows name + class |
| Score form is a server POST, `alert(msg)` on return | No coverage = lost score; alert dialogs | Local-first write, outbox, success screen with undo |
| Separate pages to report vs. correct a score | Two flows to learn | Inline edit in the station log |
| Cyclic status icon REGISTERED→ACTIVE→FINISHED→RESIGNED on click (`start_finish.js`) | One mis-tap resigns a patrol; status shown by colour/icon only | Explicit segmented control with text labels, plus continuous scanning |
| `html5-qrcode@2.3.8` from unpkg at runtime | Library unmaintained since 2023; needs network | Native `BarcodeDetector` + WASM polyfill, bundled and precached |
| QR rendered server-side (ZXing) as data URLs in print templates | Fine for print, unavailable offline | SVG QR generated on the client; server keeps the same payload format |
| Manual reload for messages and results | Stale HQ view | SSE realtime channel |
| Sticker print page with mm settings in localStorage | This works well | Keep the idea: HTML/CSS print with user-tunable label grids |

---

## 2. App topology and framework

### Decision
**One SvelteKit application** (`apps/web`) with role-based route groups. Each group has its own rendering mode, layout and bundle. Toolchain:

- SvelteKit **3.1.0**, Svelte **5.57.2** (runes), `@sveltejs/vite-plugin-svelte` **7.3.1**, Vite **8.3.4**
- `@sveltejs/adapter-node` **6.0.0**. One Node server renders SSR pages and serves the API, BFF, sync and SSE (02 §1), shipped as one container.
- TypeScript **6.0.3**. SvelteKit 3's peer range is `typescript ^6.0.0`, so we cannot use TypeScript 7.0.2 (the native compiler) yet. We move when the peer range allows it.
- Node.js **24.22.1 LTS "Krypton"** for build and the server. Node 26.12.0 is "Current" and becomes LTS at the end of October 2026. We switch at the first 26.x LTS release.
- npm workspaces (the npm bundled with Node 24.22.1)

SvelteKit 3.0.0 shipped on 2026-10-01. If the first spike hits a blocking 3.x bug, the fallback is SvelteKit 2.70.3 with the same architecture. The route design does not depend on anything that is new in 3.x.

### Route groups

| Group | Paths (Swedish slugs) | Rendering | Offline | Device |
|---|---|---|---|---|
| `(public)` | `/`, `/t/[slug]` competition page, `/t/[slug]/resultat`, `/t/[slug]/folj/[patrol]` | SSR + hydration, cacheable | Read-only, cached last view | Phone |
| `(leader)` | `/t/[slug]/anmalan`, `/t/[slug]/pass/[patrol]` | SSR shell, CSR forms | Pass page works offline | Phone |
| `(field)` | `/j/[token]` join, `/station/…`, `/startmal/…` | CSR only (`ssr = false`), prerendered shell | **Full offline** | Phone / tablet |
| `(admin)` | `/admin/…` setup, stations, import, print centre | CSR behind auth, SSR off | Online-only (drafts kept locally) | Desktop, responsive |
| `(hq)` | `/hq/[comp]/…` dashboard, patrol detail, messages | CSR, realtime | Degrades to read-only | Desktop |
| `(print)` | `/print/[comp]/[artifact]` | SSR, print CSS | n/a | Desktop printer |
| `(stage)` | `/scen/[comp]` prize ceremony | CSR, fixed 1920×1080 stage | Works after load | Projector |

### Why one app instead of several
- **Small volunteer team.** One repo, one language, one build, one deploy (client *and* server), one design system, one set of shared schemas. Separate apps would multiply CI, dependency updates and auth integration for no user-visible gain.
- **Shared code is large.** Score-entry components appear in the volunteer app, in HQ patrol detail (editing) and in the station editor's *live preview*. The patrol number pad is used in the volunteer app, start/finish and paper bulk entry. The QR renderer is used by the pass, print and invites.
- **Isolation is still achieved where it matters.** SvelteKit code-splits per route. The `(field)` bundle never loads admin code, and the service worker precaches **only** the field and leader shells (§3.1). A volunteer's phone downloads about 100 KB, not the organiser suite.

### Alternatives considered

| Option | For | Against | Verdict |
|---|---|---|---|
| **SvelteKit 3.1 (chosen)** | Smallest runtime and fast on low-end Android; SSR and CSR per route in one framework; first-class `src/service-worker.ts`; low ceremony, easy for occasional contributors | Smaller ecosystem than React; 3.x is new | Chosen |
| React 19.3.1 + React Router 8.4.0 (framework mode) or Next.js 16.4.1 | Largest talent pool and ecosystem | Heavier baseline JS on cheap phones; Next's server-centric model fights offline-first CSR; more boilerplate (memo, effects) | Strong runner-up if contributors only know React |
| Astro 7.4.0 + Svelte islands (`@astrojs/svelte` 9.1.0) | Excellent for the public SSR pages | Two mental models; the field and admin apps are app-shaped, not content-shaped | Rejected |
| Keep Thymeleaf + htmx | Reuses gokapp's Java skills, which the maintainer does not have | Offline-first, local queue and undo are practically impossible | Rejected |
| Native apps / Capacitor | Best camera and storage guarantees | Violates "no install from a QR link"; app store overhead | Rejected (the PWA can be wrapped later if needed) |

---

## 3. Offline architecture (field apps)

Rule: **the field UI never waits for the network.** Every read in `(field)` comes from IndexedDB, and every write goes to the outbox first.

### 3.1 Service worker
- Hand-written `src/service-worker.ts` (SvelteKit native), using Workbox **7.4.1** modules (`workbox-precaching`, `workbox-routing`, `workbox-strategies`). We do **not** use `@vite-pwa/sveltekit` 1.1.0 because its peer range is `@sveltejs/kit ^1 || ^2` and it does not support Kit 3. If it adds Kit 3 support, we can reconsider it on top of `vite-plugin-pwa` **2.0.0**.
- **Precache** (revisioned at build time): the field/leader route shells, their JS/CSS chunks, fonts, the zxing WASM binary (§6), the offline fallback page and icons.
- **Runtime caching:**
  - `GET /api/v1/…/sync/snapshot` → network-first with a 4 s timeout, then cache.
  - Public results → stale-while-revalidate.
  - Images → cache-first with an LRU cap.
  - Mutations are **never** handled in the SW. The outbox lives in app code, so the UI can show and control it.
- **Scope.** The SW controls the whole origin, but its fetch handler only acts on `(field)`, `(leader)`, `(public)` and `/api/v1/competitions/*/sync/*`. Admin and HQ requests pass straight through, so stale admin code cannot be served.
- **Web App Manifest**: `start_url` = `/station`, `display: standalone`, `theme_color` `#17402F`. Add to home screen is offered but optional.

### 3.2 Local storage
- **Dexie 4.4.6** on IndexedDB. It gives typed tables, versioned migrations, transactions and `liveQuery` for reactive reads.
- One database per device: `st-field`. Tables:
  - `session`: deviceId, invite scope, server clock offset
  - `snapshot`: competition, classes, stations, patrols, expected-patrol list, each with a `snapshotVersion`
  - `scores`: local projection of this station's scores
  - `outbox`: pending commands
  - `messages`: HQ messages and read flags
  - `log`: append-only, UI history
- **Persistence.** On join we call `navigator.storage.persist()` and show the result on the station home: "Lagring skyddad" or a warning with "Lägg till på hemskärmen" (on iOS, installed PWAs are exempt from Safari's 7-day eviction of script-writable storage). `navigator.storage.estimate()` is checked; snapshot plus a full day of scores is well under 5 MB.
- **Last-resort export.** "Exportera osynkade" shares the outbox as a JSON file (Web Share API) or shows it as a sequence of QR codes that HQ can scan. Together with the paper reserve protocol (§7), this is how we keep "never lose a score" when a phone is about to die.

### 3.3 Outbox / command model
Every user action becomes an immutable **command**. The canonical envelope, command names and signing live in `packages/domain/command` (02 §4, 01 C3), and this local view adds outbox state:

```ts
type Command = {
  commandId: string;        // UUIDv7 (uuid 14.0.3) – idempotency key, time-ordered
  deviceId: string;         // stable per install, created at join
  deviceSeq: number;        // monotonic per device, detects gaps
  type: 'score.set' | 'score.retract' | 'patrol.status.set' | 'checkpoint.pass' | 'message.read' | …;
  payload: unknown;         // validated with the shared Valibot schema (packages/schema)
  baseVersion?: number;     // server version of the aggregate the user saw (for edits)
  createdAt: { device: string; serverEstimate: string; monotonicMs: number };
  schemaVersion: number;
  state: 'pending' | 'sending' | 'acked' | 'rejected' | 'conflict';
};
```

- **Scores are set, not incremented.** `score.set {patrol, station, points, stylePoints}` is idempotent, so replaying it is harmless.
- **Edit** = a new `score.set` with `baseVersion`.
- **Undo** = delete the command if it is still `pending`. If it is already `acked`, enqueue `score.retract`.

### 3.4 Sync loop
- A single **sync leader** per origin uses the Web Locks API (`navigator.locks.request('sync', …)`), so two open tabs cannot double-send.
- **Triggers:** enqueue, the `online` event, `visibilitychange` to visible, a successful SSE reconnect, and a timer (15 s, exponential backoff up to 2 min with jitter). Background Sync is used opportunistically on Chromium. It is never relied on, because Safari and Firefox don't support it.
- **Push:** `POST /api/v1/competitions/{cid}/sync/commands` with up to 100 device-signed commands in `deviceSeq` order (01 C1). The response gives a per-command result: `accepted {version}` | `duplicate` | `conflict {server}` | `quarantined {reason}` | `rejected {reason}`. The client predicts likely outcomes with the same `packages/domain/sync` rules the server runs.
- **Pull:** `GET /api/v1/competitions/{cid}/sync/snapshot?since=<cursor>` returns a delta (new patrols, changed station config, HQ messages, backup-mode flag).
- **Visible sync state** is shown in the station header on every screen:
  - "Synkad 14:02"
  - "3 i kö · offline sedan 13:40"
  - "Konflikt – åtgärda"

  It uses icon, text and colour, never colour alone. The same numbers go to HQ in a device heartbeat (§15).

### 3.5 Conflicts
- The server flags a conflict when a `score.set` carries a `baseVersion` older than the current version **and** the newer write came from a different device. A typical case is HQ correcting a score while the volunteer was offline.
- The client shows the conflict in the **log**, not as a modal. The row shows "Din: 14 · HQ: 16 (Anna, 13:55)" and two big buttons, "Behåll HQ:s" and "Skicka min igen". Choosing the latter sends a `score.set` with the fresh `baseVersion`.
- Unresolved conflicts keep the sync badge orange. HQ sees the same conflict on its side.
- Rejected commands (e.g. "patrol resigned") get the same inline treatment with an explanation.

### 3.6 App updates during a competition
- The SW update is detected via `registration.update()` on every sync. The new worker installs, but it **waits**. We never call `skipWaiting()` automatically.
- A non-blocking banner, "Ny version finns", is offered only when the outbox is empty and no score entry is open. HQ can also push "uppdatera nu" over the realtime channel.
- **Compatibility contract.** Commands carry `schemaVersion`. The backend must accept N-1 for at least the competition's duration, and it returns `minClientVersion` in the snapshot. If the client is below it, the banner becomes blocking, but only **after** the outbox is flushed.
- **Dexie migrations** are additive within a release line. Destructive migrations require an empty outbox, and they are never shipped while a competition the device is joined to is active.

### 3.7 Device clock
- Cheap phones drift, and some have the wrong time zone or date. On every sync response we compute `offset = serverTime – (deviceNow – rtt/2)` and store it.
- Every command records device time, server-estimated time and `performance.now()`-based monotonic time since the last sync.
- Start/finish times use server-estimated time. If `|offset| > 2 min`, the station home shows "Telefonens klocka går fel – tider justeras automatiskt", and HQ gets a flag.
- For start/finish, the authoritative timestamp is the corrected client time of the scan (not server receive time), because the tablet may be offline at the finish line.

---

## 4. State management, data fetching and realtime

**Decision:** two kinds of state, deliberately separated.

1. **Field apps:** IndexedDB is the source of truth. Svelte components read Dexie `liveQuery` results, wrapped into a small `$state` adapter. The network layer only drains the outbox and applies snapshot deltas into Dexie. No in-memory cache library is needed, and a reload loses nothing.
2. **Online areas** (admin, HQ, public, leader): **TanStack Svelte Query 6.3.3** handles server state (caching, deduping, retries, background refetch). Svelte 5 runes (`$state`, `$derived`) are used for local UI state. There is no global store library. Shared cross-route state (current competition, user) lives in context set by the layout.
3. **API client:** there is no code generation. A small typed `fetch` wrapper (`lib/api`) takes request and response types from `packages/schema` (`v.InferInput`/`v.InferOutput`), the same **Valibot 1.5.0** schemas the server handlers parse with. A schema change breaks the build on both sides at once. Valibot was chosen over Zod 4.6.7 because it tree-shakes much better, which matters in the field bundle. The same schemas validate import rows (§8). Responses are re-validated in dev and test builds only.

### Realtime
- **Decision: Server-Sent Events** (`EventSource`), one stream per competition and audience: `/api/v1/competitions/{id}/events?topics=…`.
- **Why SSE over WebSocket:** traffic is one-way (server→client), it works through proxies and over HTTP/2 and HTTP/3, it reconnects automatically, it supports `Last-Event-ID` resume, and it needs no extra protocol. Client→server already goes through REST and the outbox.
- **Events** (stream recycled by the server about every 55 min, resumed with `Last-Event-ID`; 02 §3) are small "something changed" notices carrying the new version and, where cheap, the payload (`score.changed`, `patrol.status.changed`, `station.heartbeat`, `message.posted`, `message.read`, `results.updated`, `competition.mode.changed`).
- **Handling:** the client patches the Query cache when it can, otherwise it invalidates. After a gap, it falls back to a refetch.
- **Users:**
  - HQ dashboard: station tiles, alarms, feed, read receipts.
  - Public results and "följ min patrull": a throttled `results.updated` at most every 10 s. Cached polling every 10–30 s is the fallback when SSE fails (some captive Wi-Fi blocks streams), and it is the default for anonymous viewers on hosts that cap per-instance concurrency (02 §3).
  - Volunteer: HQ message banner and config changes.

### Optimistic UI and undo
- Field: optimistic by construction. The local write happens immediately and the success screen ("Sparat – Patrull 12 Vargarna, 15 p") shows an **Ångra** button for 10 s, which stays available afterwards from the log.
- Admin/HQ edits use Query's optimistic mutations with rollback on error. Score edits in HQ always show the audit trail returned by the backend.

---

## 5. Design system

### Tokens (CSS custom properties, `packages/ui/tokens.css`)

```css
:root {
  /* colour – from the canvas */
  --c-forest: #17402F;  --c-ink: #0F1F17;  --c-ground: #F3F5F1;  --c-paper: #FFFFFF;
  --c-signal: #F26B2A;          /* decor/flag only – 3.04:1 on white, never text */
  --c-signal-strong: #C2410C;   /* buttons, white text 5.18:1 (AA) */
  --c-ok: …; --c-warn: …; --c-danger: …; --c-muted: …;   /* each verified ≥4.5:1 on ground and paper */
  /* type */
  --font-display: "Bricolage Grotesque Variable", system-ui, sans-serif;
  --font-ui: "Figtree Variable", system-ui, sans-serif;
  --fs-0: 1rem; --fs-1: 1.125rem; --fs-2: 1.375rem; --fs-3: 1.75rem; --fs-4: 2.25rem; --fs-5: 3rem;
  /* spacing (4px grid) */
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-6: 24px; --sp-8: 32px; --sp-12: 48px;
  /* radii */
  --r-sm: 6px; --r-md: 10px; --r-lg: 16px; --r-pill: 999px;
  /* touch */
  --touch-min: 56px; --touch-field: 64px; --touch-chip: 72px;
}
```

Measured contrast: ink on ground 15.6:1, forest on ground 10.6:1, white on `#C2410C` 5.18:1, `#C2410C` on ground 4.72:1 (passes AA for normal text, but we use it for large/bold text only). `#F26B2A` is reserved for the control-flag motif and focus decorations, and always sits next to ink.

- **Fonts:** self-hosted via `@fontsource-variable/bricolage-grotesque` **5.3.0** and `@fontsource-variable/figtree` **5.3.0**. Latin subset only (it covers å ä ö), `font-display: swap`, precached for offline. The field app may use the system font fallback on the first ever load, which is acceptable.
- **Styling approach:** plain CSS custom properties plus Svelte component-scoped styles, with a small set of global utility classes for layout (stack, cluster, grid). We decided against Tailwind 4.3.3. It works well with tokens via `@theme`, but scoped CSS keeps markup readable for occasional contributors and avoids another toolchain. This is a team-preference call and is reversible.
- **Component library:** headless primitives from **Bits UI 2.19.5** (Dialog, Popover, Combobox, Tabs, ToggleGroup for the status segmented control, Toast, DropdownMenu) give correct ARIA and focus handling. All visuals are our own. Domain components live in `packages/ui`:
  - `ScoreChips` (range 0–20, distinct values, checkpoint toggle, style points)
  - `PatrolPad` (number pad with live expected-patrol filtering)
  - `SyncBadge`, `ScanView`, `PatrolCard`, `StationTile`
  - `QrCode` (SVG via `uqr` **0.1.3**, no canvas)
  - `PrintSheet`
- **Component catalogue:** a `/dev/ui` route (dev builds only), so we don't need to maintain Storybook.

### Modes
- **Light** (default) and **dark** (`prefers-color-scheme`), the latter for HQ evenings and the projector option.
- **"Sol" / sunlight high-contrast mode:** a toggle in the field header, and also auto-applied via `prefers-contrast: more`. Pure white background, ink text, 2px borders, no tinted surfaces, no greys below 7:1, larger type step (+1), and selected chips filled ink with a white checkmark rather than relying on hue.
- `forced-colors: active` is respected (system colours, borders kept).

### Field ergonomics guidelines
1. Targets ≥ 56 px (`--touch-min`). Score chips are 72 px with ≥ 8 px gaps, sized for gloves.
2. The primary action sits in the bottom thumb zone and stays fixed (on landscape tablets, the right edge). One primary action per screen.
3. No hover, long-press, swipe-only or double-tap interactions. Every destructive action can be undone instead of asking for confirmation.
4. Base font 18 px in the field, and patrol numbers shown at ≥ 36 px.
5. Feedback on every scan or save: visual flash, a short WebAudio tone (mutable) and `navigator.vibrate(30)` where supported.
6. The Screen Wake Lock API keeps the screen on during scanning and start/finish.
7. `overscroll-behavior: contain` prevents accidental pull-to-refresh.
8. Wet screens cause ghost taps, so the score is committed by an explicit "Spara" tap, not just by tapping a chip.
9. Status uses explicit text labels ("Ej startad / Ute / I mål / Utgått"), never a cycling icon.

---

## 6. QR scanning

### Decision
The native **`BarcodeDetector`** where available (Chrome/Android, Samsung Internet). Elsewhere (iOS Safari, Firefox) the **`barcode-detector` 3.2.2** polyfill, backed by **`zxing-wasm` 3.1.5**. We drive our own `getUserMedia` → `requestVideoFrameCallback` loop, which samples every 2nd frame on low-end devices and uses a centred region of interest.

- We replace `html5-qrcode` 2.3.8 (last released 2023) and avoid `qr-scanner` 1.4.2 (stale). Both bundle UI we don't want.
- The WASM binary (~1 MB uncompressed) is lazily imported, but it is **precached right after join** so scanning works offline from the first use.

### QR payload
QR codes contain a URL, `https://scouttavling.se/p/ST1.<comp>.<nr>.<check>` (01 C6). A normal phone camera opens a neutral landing page ("open in the scoring app"), not the follow page, which stays behind its own secret `/f/…` link. The scanner parses and verifies the code offline with `packages/domain/qr`, the same code the server uses, and ignores foreign codes with a friendly message. The format is identical on print and pass.

### Camera permission UX
1. Before calling `getUserMedia`, we show an explainer: "Kameran används bara för att läsa patrullens QR-kod". The real browser prompt follows a deliberate tap.
2. If permission is denied, we show browser-specific instructions (Android Chrome, Samsung, iOS Safari) and fall straight through to the number pad. The pad is always one tap away on the scan screen.
3. The rear camera is preferred (`facingMode: environment`), with a torch toggle where `track.getCapabilities().torch` is available.
4. The camera stops on `visibilitychange` hidden to save battery.

### Numeric fallback (`PatrolPad`)
- Digits filter the station's **expected** patrols live. When exactly one matches, its card (number, name, class, troop) is shown big with "Välj".
- Unexpected patrols are still allowed, with a soft warning ("Patrull 31 är inte väntad här").

### Start/finish continuous mode
- The camera runs continuously. The same code is ignored for 3 s.
- Each scan appends to a visible queue with a big status toggle defaulting to the station's role (start → "Ute", finish → "I mål").
- **Samlad målgång:** one scan opens the patrol's finish sheet with all finish sub-items (nödbrev 0/20, händighet 0–20, orientering count stepper). Each item becomes its own command in the shared outbox, so a partially filled sheet is never lost.

---

## 7. Printing and projector

**Decision: browser HTML/CSS print is the only path in v1** for every artifact, including "Save as PDF" for archives. Server PDF is an optional, separate renderer added only if files must be emailed (02 §8).

Why browser print:
- It reuses our components and fonts.
- The organiser sees an exact preview.
- It works for ad-hoc paper sizes.
- gokapp's sticker page already proves the model.

Implementation:
- Print routes render server-side with `@page` sizes in mm, `break-inside: avoid`, and `print-color-adjust: exact` for the flag motif.
- QR codes are SVG for crisp output at any DPI.
- Paged.js (0.4.3, last released 2023) is **not** used. Modern Chromium and Firefox handle `@page` margins well enough for our layouts.

| Artifact | Format | Approach |
|---|---|---|
| A4 reserve protocol per station (circle numbers, QR to photo upload) | A4 portrait | HTML print; QR links to `/upload/{stationToken}` |
| Patrol scorecards (custom paper codes per day, optional names) | A4 / A5, N per sheet | HTML print, per-day code columns from station grouping |
| QR stickers | Configurable label grid (mm, cols/rows, margins) | HTML print; settings per organisation (server), not just localStorage |
| Station signs (control flag + number + name) | A4 landscape | HTML print |
| Volunteer invite QR sheets | A4, one per station | HTML print. Tokens are minted at print time, and the sheet is marked "Hemlig – ger åtkomst" |
| Start lists / distribution | A4 | HTML print |
| Results / diplomas archive | PDF | Browser "Save as PDF" in v1. Later, optionally, the separate `pdf-renderer` container renders the same print route with headless Chromium for email (02 §8). |

The print centre shows a live scaled preview (CSS `zoom` of the print route in an iframe) with a "Skriv ut" button. A Playwright PDF snapshot test guards each template (§12).

### Ceremony / projector mode (`/scen/[comp]`)
- A fixed 1920×1080 stage, scaled to the viewport with a CSS transform, entered via the Fullscreen API.
- "Lås resultat" freezes a results snapshot when the ceremony starts, so late corrections cannot reorder a live reveal.
- Reveal is one step at a time (from last to first place per class), controlled by space/arrow keys and presentation clickers (they send PageDown).
- A presenter view in a second window shows the next reveal, synced via `BroadcastChannel`.
- Animations respect `prefers-reduced-motion`. The page works offline once loaded, which matters in a hall with bad Wi-Fi.

---

## 8. Import wizard (client-side parsing)

### Decision
Parse in the browser, inside a **Web Worker**:

- **SheetJS CE 0.20.3**, installed from `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`. The npm `xlsx` package is frozen at 0.18.5 with known advisories, so it must not be used.
- **PapaParse 5.7.0** for CSV.

The worker posts back **only the mapped, normalized fields**. Raw cells never reach the main thread, IndexedDB or the network.

### Steps
1. **File:** drag/drop or picker (`.xls`, `.xlsx`, `.csv`).
   - We sniff the first bytes. Scoutnet's "xls" export is actually an HTML table, which SheetJS reads as HTML.
   - CSV encoding is detected by trying UTF-8 with `TextDecoder('utf-8', {fatal:true})` and falling back to `windows-1252`.
2. **Column mapping:**
   - The worker first returns **only headers plus row count**.
   - The user maps headers to target fields: patrol name, patrol leader name, troop (kår), class, member count, contact e-mail of leader, and the free-text "patrull" grouping column.
   - **Mapping templates** (e.g. "Scoutnet – anmälningslista") match normalized header names (lowercase, diacritics folded, whitespace collapsed) and are stored per organisation on the server. A template contains header names only, never data.
   - **Sensitive-column guard:** headers matching a deny-list (personnummer, födelsedatum, födelseår, allergi/kost, sjukdom/medicin, adress, telefon, målsman, …) are greyed out, cannot be mapped, and are dropped in the worker before any further processing. Trailing birth years inside free-text member lists are stripped too (no birth data is stored).
3. **Review / fix:**
   - Normalization happens in the worker: trim, Unicode NFC, name casing, troop name matched against known troops, grouping participant rows into patrols, de-duplication, and class inference from age band if the template says so.
   - Rows are validated with the shared Valibot schemas.
   - The fix grid is virtualized (`@tanstack/svelte-virtual` 3.13.46) and supports inline edit, merge and split of patrols.
   - A server **dry-run** (`POST …/imports/dry-run`) reports duplicates against existing patrols.
4. **Done:** `POST …/imports/{batchId}/commit` applies the reviewed dry-run (mapped fields only). The UI then shows the counts and links to the patrol list.

Honest caveat: the worker must decode the whole file in memory to read it. "Never read" means sensitive columns are never extracted, rendered, stored or sent. The worker is terminated afterwards, so its memory is released.

---

## 9. Authentication on the client

### Organisers, HQ and patrol leaders: ScoutID (Keycloak OIDC) via a BFF
- **Decision:** Authorization Code + PKCE as a **confidential client on the server side** (BFF). The browser only holds a `__Host-` session cookie (`HttpOnly; Secure; SameSite=Lax`). No access or refresh tokens are ever in JavaScript.
- **Where the BFF lives: the SvelteKit server** (01 C5, 04 §2). `openid-client` runs in `/auth/*` server routes, and `hooks.server.ts` resolves the `__Host-sid` session for both SSR loads and `/api/*`. SSR `load` functions call server modules directly, with no internal HTTP hop. The browser side needs:
  - `GET /auth/login?returnTo=` and `POST /auth/logout`
  - `GET /api/v1/me` (user, roles per competition)
  - a 401 response that the client turns into a redirect to login, preserving the route
- **CSRF:** SameSite=Lax, SvelteKit's Origin check, and the double-submit `X-XSRF-TOKEN` header on every unsafe `/api` request, which the fetch wrapper adds (04 §2.2).
- **Rejected:** PKCE in a public SPA client with tokens in memory or storage. It exposes tokens to XSS, forces silent-renew iframes that third-party-cookie blocking breaks, and gives no benefit offline. `oidc-client-ts` 3.5.0 would be the library if this were ever reversed.
- **ScoutID prefill** in patrol registration is optional. "Logga in med ScoutID för att fylla i" uses the same login, and `/me` returns name, troop and e-mail. Registration also works without logging in.

### Volunteers: device grants (01 C3, 04 §3)
1. The QR on the invite sheet points to `/j/{secret}`.
2. The client creates `deviceId` and a non-extractable P-256 key (`crypto.subtle.generateKey`, stored in Dexie). It asks for an optional volunteer name ("Vem bemannar?") for the audit trail.
3. It calls `POST /api/v1/join` with the public JWK and a signed nonce, receives the ES256 **device grant**, stores it in IndexedDB, removes the secret from the URL (`history.replaceState`) and downloads the station pack.
4. Every outbox command is signed with the device key (`packages/domain/command`). There is no device cookie, so offline operation and installed PWAs work the same way.
5. If the grant is revoked, superseded or expired, the outbox is **kept** (unsent scores are quarantined for HQ rather than lost), the banner says "Skanna inbjudan igen", and a new join re-attaches the same `deviceId`.

### Shared tablets (start/finish, HQ laptop)
- Start/finish tablets use a **device invite** (role `startfinish`), not a personal login, so there is no personal session to leak.
- When an organiser logs in with ScoutID on a shared device, the session idles out after 30 min (enforced server-side), with a visible "Lås / byt användare" button. The client clears the Query cache and any admin drafts on logout. Field Dexie data belongs to the device session and is kept.

---

## 10. Accessibility and i18n

### Accessibility
The target is **WCAG 2.2 AA** across all areas and AAA contrast in sunlight mode. Specific commitments:
- **2.5.8 Target Size:** 56 px minimum in the field, 44 px on desktop.
- **2.4.11 Focus Not Obscured:** sticky bottom bars reserve `scroll-padding`.
- **2.4.7 / 2.4.13:** focus rings are 3 px ink plus an orange offset.
- **3.3.7 Redundant Entry:** the registration wizard carries data forward and ScoutID prefill is available.
- **3.3.8 Accessible Authentication:** QR join, no passwords.
- **4.1.3 Status Messages:** sync state, scan results and saves are announced via `aria-live="polite"`. Conflicts use `assertive`.
- **Colour:** never the only carrier of status (icons + text). Charts in HQ (start distribution) have table equivalents.
- **Ceremony and HQ feed** honour `prefers-reduced-motion`.
- **CI:** automated checks with `@axe-core/playwright` 4.14.0 on every route. Manual screen reader passes (TalkBack, VoiceOver) are part of the release checklist.

### i18n
- **Paraglide JS 2.29.0** (`@inlang/paraglide-js`). Messages are compiled, typed and tree-shaken, so only the strings a route uses are shipped. That suits the field budget.
- Base locale `sv`, `en` prepared. All strings live in `messages/sv.json` from day one, with no hard-coded Swedish in components.
- Dates, times, numbers and plurals use `Intl.*` with `sv-SE`. Times are always 24 h.
- Domain terms (kontroll, patrull, kår, nödbrev) are kept in one glossary file so translators keep them consistent.

---

## 11. Performance budgets

| Metric | Field (`/station`, `/startmal`) | Public pages | Admin/HQ |
|---|---|---|---|
| Initial JS (gzip, route) | ≤ 100 KB | ≤ 70 KB | ≤ 300 KB |
| CSS | ≤ 20 KB | ≤ 20 KB | ≤ 50 KB |
| Lazy assets | zxing WASM, precached after join; not on the critical path | — | SheetJS ~ 300 KB gz, worker only, import route only |
| LCP / TTI, first load, Moto G-class device on slow 4G | ≤ 3.5 s | LCP ≤ 2.5 s | ≤ 4 s |
| Repeat load (SW) | ≤ 1 s to interactive | — | — |
| Scan → patrol identified | ≤ 300 ms native, ≤ 700 ms WASM | — | — |
| Save score (local) → success screen | ≤ 100 ms; INP ≤ 200 ms | INP ≤ 200 ms | INP ≤ 200 ms |

- **Browser support baseline:** Chrome/Android 120+, Samsung Internet 25+, iOS Safari 17+, Firefox 128 ESR+. This baseline lets old phones work. The build target follows it via Vite's `build.target`.
- **Enforcement:** budgets are checked in CI with `size-limit`-style checks on build output and Lighthouse CI on public and field routes.
- **Real device:** one real low-end Android phone (≤ 3 GB RAM) is kept in the team's kit for release testing.

---

## 12. Testing

| Layer | Tool (version) | What |
|---|---|---|
| Unit | Vitest **5.0.5** + `fake-indexeddb` **6.2.5** | Sync engine (ordering, idempotency, backoff, conflict states), clock offset, import normalization, Valibot schemas |
| Component | Vitest browser mode (`@vitest/browser` **5.0.5**, Playwright provider) + `@testing-library/svelte` **5.4.2** | ScoreChips, PatrolPad, SyncBadge, import mapping grid, all in a real browser |
| API mocking | MSW **3.0.3** | Component tests; failure injection (500, slow, 409 conflict). Full-stack dev runs the real server against local Postgres. |
| E2E | Playwright **1.64.1** | See below |
| Contract | Shared `packages/schema` types (compile-time) + previous-release command fixtures | Client/server drift; `schemaVersion` N-1 |

E2E scenarios:
- **Offline:** `context.setOffline(true)`, enter 20 scores, reload, kill the page, go back online, and assert all 20 are on the server exactly once.
- **Two-device conflict:** two browser contexts, HQ edit vs. offline volunteer.
- **Clock skew:** `page.clock`.
- **SW update** while the outbox is non-empty.
- **Camera:** Chromium `--use-fake-device-for-media-stream --use-file-for-fake-video-capture=qr.y4m`.
- **Device projects:** Pixel-class phone, iPad landscape, desktop.
- **Print:** PDF snapshots via `page.pdf()` with visual comparison.
- **Accessibility:** axe checks.

---

## 13. Observability

- **Error reporting:** `@sentry/sveltekit` **11.8.0** for both the browser and the server hooks. The backend (GlitchTip self-hosted or hosted, or Sentry SaaS EU) is chosen with hosting (01 C9, 04 §7). The SDK is the same either way.
  - The offline transport buffers events in IndexedDB and sends them when back online.
  - `beforeSend` scrubs PII (patrol names, volunteer names, URL tokens).
  - No session replay in field routes (bandwidth and privacy).
  - Release tagging matches the SW build version.
- **Operational telemetry (product feature, not analytics):** the field app sends a **device heartbeat** on every sync: app version, outbox depth, oldest pending age, last sync, clock offset, battery level if available, storage persisted yes/no. HQ station tiles are built from these heartbeats.
- **Web vitals:** sampled reports (LCP, INP, CLS) to the same backend, tagged by route group and device class.
- **No third-party analytics.**
- **Dependency hygiene:** Renovate with exact pins and grouped weekly PRs. Updates are frozen during a competition weekend (a calendar-driven Renovate schedule).

---

## 14. Folder and module structure

```
scouttavling.se/
├─ apps/web/                     SvelteKit 3.1 app: client *and* server (one container)
│  ├─ src/
│  │  ├─ routes/
│  │  │  ├─ (public)/            SSR competition, results, follow
│  │  │  ├─ (leader)/            registration, patrol pass
│  │  │  ├─ (field)/             +layout.ts: ssr=false · join, station, startmal
│  │  │  ├─ (admin)/             setup wizard, stations, import, print centre
│  │  │  ├─ (hq)/                dashboard, patrol detail, messages
│  │  │  ├─ (print)/             print templates (SSR)
│  │  │  ├─ (stage)/             ceremony
│  │  │  ├─ auth/                login, callback, logout (openid-client BFF)
│  │  │  └─ api/v1/              +server.ts handlers: REST, sync, SSE, internal/jobs/tick
│  │  ├─ lib/
│  │  │  ├─ api/                 typed fetch wrapper over packages/schema, SSE client
│  │  │  ├─ offline/             dexie db + migrations, outbox, sync engine, clock, storage
│  │  │  ├─ scan/                camera, BarcodeDetector/polyfill wrapper
│  │  │  ├─ import/              worker (SheetJS, PapaParse), templates, deny-list
│  │  │  ├─ auth/                /me, login redirects, device key + grant
│  │  │  ├─ realtime/            EventSource manager, cache patchers
│  │  │  ├─ features/            per-area view models (station, startfinish, hq, …)
│  │  │  └─ server/              server-only modules (02 §1): competition, scoring, identity, realtime, jobs, … + Drizzle schema
│  │  ├─ service-worker.ts       Workbox-based, field/leader/public only
│  │  └─ hooks.{client,server}.ts  Sentry; server: session, CSRF, rate limits, security headers
│  ├─ drizzle/                   generated + hand-written SQL migrations
│  ├─ messages/                  Paraglide sv.json, en.json
│  └─ tests/                     playwright e2e, fixtures (qr.y4m, synthetic import files)
├─ packages/domain/              pure TS: ranking, distribution, item rules, sync decide(), command envelope + JWS, QR, import normalisation
├─ packages/schema/              Valibot schemas: API bodies, commands, station pack, import rows
├─ packages/ui/                  tokens.css, Bits UI–based primitives, domain components
└─ docs/architecture/
```

Rules:
- `lib/offline`, `lib/import` and `packages/domain` have no Svelte imports and no I/O (pure TS, unit-testable). dependency-cruiser enforces this (02 §1).
- Route groups may import from `lib/features` and `packages/*`, but never from each other. Only `routes/api`, `routes/auth`, `hooks.server.ts` and `+page.server.ts`/`+layout.server.ts` files may import `lib/server`.
- Test fixtures are synthetic. Real Scoutnet exports (like the `.xls` currently in the repo root) must never be committed. `*.xls` is already in `.gitignore`.

---

## 15. Interfaces with server modules and security

Client and server are one codebase, so most of these are shared code, not network contracts.

**Server modules / domain (02):**
1. **Shared packages** `packages/domain` and `packages/schema` replace OpenAPI codegen. OpenAPI is generated only if an external integration needs it.
2. **Command sync endpoint** `POST /api/v1/competitions/{cid}/sync/commands` (01 C1):
   - batch of ≤100 device-signed JWS commands, idempotent on `commandId`, ordered per `deviceId`/`deviceSeq`
   - per-command result `accepted{version} | duplicate | conflict{server} | quarantined{reason} | rejected{reason}`
   - accepts `schemaVersion` N-1
3. **Snapshot endpoint** `GET /api/v1/competitions/{cid}/sync/snapshot?since=<cursor>` scoped to the device's station/role. It returns versioned deltas, `minClientVersion`, the backup-mode flag and the server time.
4. **Score aggregate versioning** per (patrol, item), a `VoidScore` command, and an audit trail readable by HQ.
5. **SSE stream** per competition with topics, per-competition monotonic event ids, `Last-Event-ID` resume, heartbeat comments every 20 s, a server-side recycle about every 55 min, and throttled `results.updated` for public clients (with cached polling as an alternative).
6. **QR payload format** per 01 C6, and paper codes per day for scorecards.
7. **Device heartbeat** fields carried on each sync, plus HQ read models built from them.
8. **Import endpoints** `…/imports/dry-run` and `…/imports/{batchId}/commit` (mapped fields only). Mapping templates are stored per organisation, with header names only.
9. **Optional** server PDF rendering of `(print)` routes (separate container, 02 §8) and server-side **Wallet pass** (`.pkpass` / Google Wallet) generation. Neither is in v1.
10. **Photo upload** for reserve protocols (`/upload/{stationToken}` → presigned PUT to object storage), and the conflict model for paper vs. digital entries.

**Security / operations (04):**
1. **BFF in the SvelteKit server** (decided, 01 C5): `__Host-sid` cookie, `X-XSRF-TOKEN` CSRF header, `/auth/login`, `/auth/callback`, `/auth/logout`, `/api/v1/me`.
2. **Keycloak (ScoutID) client registration:** confidential client, redirect URIs, scopes/claims for name, troop and e-mail.
3. **Device grant design** (04 §3): join with public JWK + signed nonce, ES256 grant in IndexedDB, signed commands, revocation from HQ, re-attach of an existing `deviceId`.
4. **Session lifetime policy** for shared devices (30 min idle for personal sessions).
5. **CSP** allowing `wasm-unsafe-eval` (zxing-wasm), `worker-src 'self' blob:`, no third-party script origins, and `connect-src` for the error-reporting endpoint and the object-storage upload origin.
6. **Error-reporting backend** choice (decided with hosting) and PII scrubbing rules. Cache headers: hashed assets immutable, `service-worker.js` `no-cache`.
7. **Release policy:** no breaking API or deploy changes during an active competition window. The server exposes the "active competition" calendar so the client, Renovate and the deploy job can respect it.

## Accessibility review 2026-10-27 (before v0.1.0)

WCAG 2.2 AA review of every user group. No blocker; fixed in the same PR:

| Finding | Fix |
|---|---|
| Error texts not tied to their fields (~50 fields) | `aria-describedby` to an `err-<field>` id wherever `aria-invalid` is set (registration, manage page, settings, new competition, next year, member rows). |
| New-competition form only scrolled to the first error | Focuses it (the linked error is read out). |
| After saving a score, "Skanna nästa patrull" was Scoutblå on Scoutblå; focus stayed on "Spara" behind the overlay | White main button; focus moves to it; the screen behind is `inert`; only "Sparat! …" is announced, not the undo countdown. |
| "Ta bort" in the volunteer log deleted with one tap | Asks first ("Ja, ta bort" / "Avbryt"). |
| Input borders and switch tracks 2.1:1 | `--line-input` #7d8794 (3.6:1). |
| No skip link in admin | "Hoppa till innehållet" before the sidebar. |
| Number pad cut off in landscape or with large text | Keys `clamp(48px, 11dvh, 76px)`; the pad scrolls as a last resort. |
| "Sol" high-contrast mode existed but could not be switched on | "Stark kontrast" switch per phone in the log (localStorage). |
| Focus lost after step/confirmation changes; scan result sheet not a dialog | Focus moves to the new step's heading / the safe button; the sheet is `role=dialog aria-modal`, focuses "Ja, sätt poäng", closes on Escape, background inert. |
| Smaller | Sync pill and follow page no longer re-announce the clock; patrol-pass QR and number named; desk `<h1>`; "Koppla från" asks first; scorecard text ≥ 9 pt; green step label replaced (3.1:1). |

**Known, for later:** tabs/radios on the scan screen and desk use ARIA roles without arrow keys; image alt text is always the competition name (no alt field for covers); "Ring HQ" and a few other field texts still say "HQ"; patrol-detail cell states rely on colour plus a legend.

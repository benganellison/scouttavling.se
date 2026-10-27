# 04 – Identity, Security, Privacy and Operations

Status: proposal · Scope: identity & access (ScoutID), authorisation, threat model, GDPR, hosting, deployment, operations, migration from gokapp.
Versions verified against official release channels on 2026-10-15.

This section defines **contracts** that the backend/domain (02) and client (03) sections must implement: the session model, token formats, roles and permissions. Everything else here is an operational recommendation.

---

## 1. Summary of decisions

| # | Decision |
|---|----------|
| D1 | ScoutID login through a **Backend-for-Frontend (BFF)** in the SvelteKit server: it is a *confidential* OIDC client (client secret + PKCE S256) using the OpenID-certified `openid-client` 6.8.8. The browser only holds an httpOnly `__Host-` session cookie and never sees ScoutID tokens. |
| D2 | Users are keyed by **`scoutnet_member_no`**. `sub` is stored as a secondary attribute only. We do **not** ask for the "member number as `sub`" mapper. |
| D3 | **Any logged-in ScoutID user may create a competition** (organiser decision 2026-10-15; no role-key check). The owning kår or district is picked from the user's `scoutnet-memberships`. Per-competition rights live in our own database. |
| D4 | Non-account actors (station volunteers, start/finish tablets) get a **device-bound grant**. A QR invite secret is exchanged once, online, for an ES256-signed JWS bound to a non-extractable WebCrypto key on the device. Every offline score command is signed with that device key and verified on sync. |
| D5 | Revocation is done through an **invite generation counter** and **per-device revocation**. Commands that arrive after a revocation are **quarantined for HQ review** rather than dropped, which matches the paper-protocol fallback. |
| D6 | Scoutnet exports are **parsed in the browser** with a column allowlist. Personnummer, addresses and criminal-record status never leave the device. |
| D7 | Hosting is **deferred**. The app is one OCI container plus Postgres 18 (uploaded images are stored in Postgres; an S3 bucket is added only if uploads grow a lot, e.g. protocol photos, 05 §6), and §7 fixes the requirements (EU residency, ≥60-min SSE requests, scale to zero with min-instances on event days). The preferred options are serverless containers (Cloud Run, Scaleway); a VPS with Docker Compose + Traefik is the fallback. Roughly €2–16/month between events plus €2–12 per event weekend serverless, or €13–38/month flat on a VPS. |
| D8 | The kår that owns a competition is the **controller**. The operator of scouttavling.se is the **processor** under a DPA; organisers confirmed (2026-10-15) this will **normally be the district** (Scouterna or an association also acceptable). Personal data is deleted **90 days after a competition closes**, and protocol photos **30 days** after results are final. |

---

## 2. ScoutID integration

### 2.1 Facts from the ScoutID documentation (checked 2026-10-15)

- Keycloak realm `scoutnet`. Dev discovery: `https://dev.id.scouterna.se/realms/scoutnet/.well-known/openid-configuration`. Prod base URL is `https://id.scouterna.se`. The wiki lists prod as not yet live. Organisers confirmed (2026-10-15) that prod will be live **before scouttavling.se goes live**, so development proceeds against dev and nothing waits on the prod date.
- Authorization code flow. Public clients must use PKCE S256. Confidential clients get an id and secret. Access-token lifetime is set per client at registration. ScoutID SSO sessions last 30 days.
- Scopes: `openid` (sub, preferred_username `<member_no>@scoutnet`), `profile` (name, given/family name, picture, birthdate, locale, `scoutnet_member_no`), `email` (`email`, `email_verified` which is always true, plus optional `alt_email`/`scouterna_email`), `phone` (`phone_number`, E.164), `scoutnet-memberships` (must be requested explicitly: `primary_group_name`, `primary_group_no`, `group_emails_json`, `memberships`).
- `memberships` is keyed by `groups`, `troops`, `patrols`, `organisations`, `regions`, `districts`, `corps`, `networks`, `projects`. Each entry has `roles[]` of `{id, key, name?}`. **No complete list of role keys is published.** The examples are `it_manager` at kår level, `leader`/`vice_leader` at troop level and `board_member` at organisation level.
- Membership data reflects Scoutnet *at login time*.
- `sub` is a Keycloak UUID that is opaque and not guaranteed to survive future migrations. The wiki names the member number as "the stable identifier". The `preferred_username` format changed before provider v0.14.0 (current release: v0.14.0, 2026-09-28), so prefer the dedicated `scoutnet_member_no` claim over parsing it.

### 2.2 Flow choice: BFF confidential client (recommended) vs SPA public client

| | BFF / confidential client (**recommended**) | SPA public client |
|---|---|---|
| Token storage | Server-side session. Browser gets an httpOnly, Secure, SameSite=Lax `__Host-sid` cookie. | Tokens in JS memory or storage, so XSS can steal them. |
| Client secret | Yes, plus PKCE. Defence in depth. | None. |
| Membership claims | Read once at login and turned into our own roles. Large `memberships` JSON never reaches the browser. | The SPA must parse claims or call the API with a bearer token. |
| Offline | Not relevant: the organiser UI needs the network for admin anyway. Offline scoring uses device grants (§3), not ScoutID tokens. | Offline refresh-token handling in the browser is fragile. |
| Libraries | **`openid-client` 6.8.8** (panva, OpenID-certified RP) in SvelteKit server routes; **`jose` 6.2.12** for sealed cookies and grants. | `oidc-client-ts` 3.5.0 or similar. |

**Decision:** use the BFF pattern in the SvelteKit server (01 C5). `GET /auth/login?returnTo=` uses `openid-client` (`discovery()` against the issuer URL, client auth `client_secret_basic`). It creates `state`, `nonce` and a PKCE S256 verifier and stores them, with `returnTo`, in a short-lived (10 min) `__Host-oidc` cookie, encrypted with `jose` (`dir`/A256GCM). Then it redirects to ScoutID. `GET /auth/callback` runs `authorizationCodeGrant()`, which checks state, PKCE and the ID token (issuer, audience, nonce, signature via JWKS). After that the server:

1. Reads the claims, upserts `app_user`, and snapshots the memberships used for the owning-organisation picker (§2.4).
2. **Discards ScoutID access and refresh tokens.** We call no ScoutID API after login, so storing them only adds risk. If a later feature needs userinfo refresh, keep the refresh token encrypted server-side.
3. Issues our own session. The id is 256 random bits, and only its SHA-256 is stored in a Postgres `session` table, so it works across instances and survives scale-to-zero. Sessions have a 12 h idle and 7 day absolute timeout, and the id is rotated at login. The cookie is `__Host-sid; Path=/; Secure; HttpOnly; SameSite=Lax`.
4. **CSRF:** SvelteKit's built-in Origin check covers form actions. For JSON, `hooks.server.ts` requires a double-submit `XSRF-TOKEN` cookie echoed in `X-XSRF-TOKEN` on every unsafe `/api` method that is authenticated by the session cookie. Device endpoints (`/join`, `/sync/*`) use no cookies and are authenticated by signatures (§3).

The SPA gets the current user from `GET /api/v1/me` and starts login with a top-level navigation to `/auth/login?returnTo=<relative path>`. `returnTo` must be a same-origin relative path, validated against open redirects.

### 2.3 Scopes and claim mapping

Request: `openid profile email phone scoutnet-memberships`.

| Claim | App field | Notes |
|---|---|---|
| `scoutnet_member_no` | `app_user.member_no` (unique, **primary natural key**) | Reject a login that has no member number. Microsoft-only accounts are not supported in v1. |
| `sub` | `app_user.scoutid_sub` (informational) | Update it if it changes. Never use it as a join key. |
| `name`, `given_name`, `family_name` | display name | Refreshed at each login. |
| `email` | `app_user.email` | May be a group address. Use it only for notifications the user turned on. |
| `phone_number` | `app_user.phone` | Only stored if the user consents in the UI ("use my phone number for SMS during the event"). |
| `birthdate`, `picture`, `locale` | **not stored** | Data minimisation. `locale` may set UI language for the session only. |
| `memberships.groups` | `user_group_role(member_no, group_no, role_key, seen_at)` snapshot | Used for authorisation (§2.4) and for the "which kår" picker. |
| `troops`, `patrols`, other types | not stored in v1 | |

**Linking imported people.** When a patrol leader or contact person is imported with a member number (§6.4), the backend stores it on `person.member_no`. If a ScoutID user with that number logs in later, the backend links them automatically and they see "your patrols". It never gives them more than the patrol-leader role for those patrols.

### 2.4 Authorising competition creation

**Decision (organisers, 2026-10-15): any logged-in ScoutID user may create a competition.** There is no role-key allowlist.

- When creating, the user picks the **owning organisation** (kår or district) from their `memberships` (pre-selected: `primary_group_no`). That organisation is the GDPR controller (§6); the creator becomes `owner`.
- Abuse guards instead of role checks: at most 5 new competitions per user per day, new competitions are unlisted until the owner publishes the competition page, and a site admin (platform operator) can suspend a competition or user (audited, §10).
- Memberships are re-evaluated at every login, only to keep the list of selectable owning organisations current. Existing competition roles are explicit grants in our database and stay until an owner removes them. That keeps a running event from breaking because Scoutnet changed mid-weekend.
- Inviting co-organisers by member number creates a pending `competition_role` row keyed on `member_no`. It becomes active the first time that member logs in. An email is sent only if the inviter supplies an address. **We never look people up in Scoutnet.**

### 2.5 Logout

`POST /auth/logout` invalidates our session and then redirects to the ScoutID `end_session_endpoint` with `id_token_hint` (the ID token is kept in the session for this purpose only) and `post_logout_redirect_uri=https://scouttavling.se/`. Shared start/finish tablets never hold a ScoutID session (§3.6), so a logout there cannot sign a parent out of ScoutID. Back-channel logout is not required for v1.

### 2.6 Environments

| Env | ScoutID | Redirect URI |
|---|---|---|
| local | `dev.id.scouterna.se`, or local Keycloak **26.8.1** + `scoutid-keycloak-provider` **v0.14.0** via the provider repo's Docker Compose | `http://localhost:5173/auth/callback` |
| staging | `dev.id.scouterna.se` | `https://staging.scouttavling.se/auth/callback` |
| prod | `id.scouterna.se` | `https://scouttavling.se/auth/callback` |

Each environment has its own client id and secret, stored only in that environment's secret store (§7.7). The issuer URL is configuration, not code.

### 2.7 Client registration email (draft, Swedish)

> **Till:** scoutid@scouterna.se
> **Ämne:** Klientregistrering ScoutID (OIDC) – scouttavling.se
>
> Hej!
>
> Vi bygger **scouttavling.se**, en ideellt driven webbtjänst för att arrangera patrulltävlingar (t.ex. hajker och DM). Den ersätter dagens gokapp. Tävlingsledning och funktionärer i kåren loggar in med ScoutID för att skapa tävlingar, bjuda in medarrangörer och hantera kontroller och resultat. Patrulledare kan även logga in för att se sina patruller.
>
> - **Tjänstens namn:** scouttavling.se
> - **Kontaktperson:** <namn>, <e-post>, <telefon>
> - **Protokoll:** OpenID Connect, authorization code flow med PKCE (S256), **konfidentiell klient** (backend-for-frontend; tokens lämnar aldrig servern)
> - **Redirect URI:er:**
>   - dev: `http://localhost:5173/auth/callback`, `https://staging.scouttavling.se/auth/callback`
>   - prod: `https://scouttavling.se/auth/callback`
> - **Post-logout redirect URI:er:** `http://localhost:5173/`, `https://staging.scouttavling.se/`, `https://scouttavling.se/`
> - **Scopes:** `openid profile email phone scoutnet-memberships`
> - **Access token-livslängd:** standard räcker (vi använder bara ID-token vid inloggning och skapar en egen session)
> - **Sub-mapper:** behövs inte, vi använder `scoutnet_member_no` som nyckel.
>
> Vi skulle gärna få en klient i **dev-miljön nu** och en i **prod** så snart den öppnar — vi planerar att gå live först efter det.
>
> Vi lagrar endast medlemsnummer, namn, e-post, och telefon om användaren godkänner det, samt kårroller. Födelsedatum och profilbild sparas inte. Personuppgiftsbiträdesavtal tecknas med arrangerande kår.
>
> Tack!
> <namn>, för scouttavling.se

---

## 3. Device grants: volunteers, stations and start/finish tablets

### 3.1 Requirements

Volunteers often have no account, and many are parents. A single scan of a QR code should let several of them join one station or a station group. They must be able to work offline for a multi-day event. HQ must be able to revoke access ("make a new code, the old one stops working"), and every score must remain attributable and verifiable when it syncs hours later.

### 3.2 Objects and formats (contract)

**(a) Invite (QR)**: an opaque bearer secret stored server-side as a hash.

```
https://scouttavling.se/j/<inviteSecret>
inviteSecret = base64url(16 random bytes)  // 128 bits, rendered as a QR code
```

| DB `invite` row | |
|---|---|
| `secret_hash` | SHA-256(secret). The plaintext is shown only when the QR is generated. |
| `competition_id`, `role` (`station_volunteer` \| `startfinish` \| `hq_viewer`), `station_ids[]` | Scope. |
| `generation` | Increments on "Create new code". Older invites are marked `revoked`. |
| `valid_from`, `valid_until` | Default: from 7 days before the event to event end + 12 h. |
| `max_devices` (default 10), `require_approval` (default off) | Limit the damage if a QR leaks. |

**(b) Device grant**: a JWS (compact, **ES256**) issued by the backend in exchange for an invite. The device must be online for the exchange.

```json
// header
{ "alg": "ES256", "typ": "st-grant+jwt", "kid": "grant-2026-10" }
// payload
{
  "iss": "https://scouttavling.se",
  "jti": "0192…",                   // grant id (UUIDv7, 01 C2)
  "sub": "0192…",                   // device id
  "cid": "0192…",                   // competition id
  "role": "station_volunteer",
  "stations": ["0192…", "0192…"],
  "gen": 3,                          // invite generation at issuance
  "name": "Anna (förälder)",         // self-chosen display name, optional
  "mno": null,                       // member_no if the volunteer attached ScoutID
  "iat": 1760000000,
  "nbf": 1760000000,
  "exp": 1760300000,                 // event end + 24 h (multi-day aware)
  "cnf": { "jkt": "<RFC 7638 thumbprint of the device public key>" }
}
```

- Device key: during the join, the client calls `crypto.subtle.generateKey({name:"ECDSA", namedCurve:"P-256"}, /*extractable*/ false, ["sign"])` and stores the `CryptoKey` in IndexedDB. The join request carries the public JWK and a proof of possession, which is a signature over the server-provided `nonce`.
- The server signing key is ES256 and lives in the secret store. Rotate it yearly (new `kid`). Old public keys are kept until every grant signed with them has expired. The server uses **`jose` 6.2.12** (`SignJWT`, `jwtVerify`, `compactVerify`, `calculateJwkThumbprint`). The client signs with native WebCrypto, and the shared envelope code lives in `packages/domain/command`.
- The grant goes to the client as JSON (`{grant, publicKeys}`) and is stored in IndexedDB, **not** in a cookie, because it must work offline and in installed PWAs. It is useless without the non-exportable private key.

**(c) Signed command**: each score or check-in recorded offline is wrapped in a JWS signed by the **device key**.

```json
// header
{ "alg": "ES256", "typ": "st-cmd+jwt", "jwk": null, "kid": "<grant jti>" }
// payload
{
  "cmd": "RecordScore",              // command type from 02 §4
  "id": "0192…",                     // client-generated UUIDv7: idempotency key
  "seq": 42,                          // per-device monotonic counter
  "prev": "<base64url SHA-256 of the previous command JWS>", // hash chain
  "at": "2026-10-17T10:41:07.120+02:00", // device clock
  "cid": "0192…", "station": "0192…",
  "body": { "patrolId": "...", "points": 12, "...": "..." }
}
```

The sync endpoint `POST /api/v1/competitions/{cid}/sync/commands` (01 C1) takes `{commands:[jws...]}` (batch, ordered by `seq`). The device sends the grant as `Authorization: Grant <jws>`, but the grant alone is not enough because every command must also be signed by the bound key.

### 3.3 Server verification on sync

For each command, in order:

1. The grant signature is valid with a known `kid`, `iss` and `cid` match, and `exp` has not passed **at the command's `at` time** (see skew below).
2. The command signature verifies against the device public key registered under `grant.sub`, and its thumbprint equals `cnf.jkt`.
3. `body.station ∈ grant.stations`, and `cmd` is allowed for `grant.role` (§4).
4. **Replay:** `id` must be unique, so a duplicate returns the original result idempotently. `seq` must be greater than the last accepted `seq` for that device, and `prev` must match. A gap is accepted but flagged, since a lost command is a signal worth seeing.
5. **Clock skew:** accept if `at` lies within [event start − 1 h, min(server_now, event end + 24 h)] and is no more than 10 min ahead of server receive time. Outside that window, the command is quarantined, not rejected. The server records `received_at` alongside `at`, and ordering uses `seq` per device, never wall-clock time across devices.
6. **Revocation:** the command is quarantined if the device is revoked, or if `grant.gen < invite.current_generation` and the grant was not explicitly re-issued.

**Quarantine** means the command is stored with a reason and shown to HQ as "N scores waiting for review from device *Anna (förälder)*". HQ can approve, reject, or compare against the paper protocol. Data is never silently lost.

### 3.4 Revocation

- **"Create new code"**: increments `invite.generation`. New joins with the old QR fail with a friendly message. Existing devices must refresh: on their next online contact they get a 401 `grant_superseded`, and the volunteer is asked to rescan. The HQ UI can choose to **keep currently joined devices** when it rotates a code that was posted in a shared WhatsApp group.
- **Per-device revoke**: lists every device per station (name, joined time, last sync, command count) and revokes a single one.
- **Online push**: devices poll or keep an SSE connection. A revocation reaches online devices within seconds, and offline ones on their next sync. This is the inherent limit of offline operation. Quarantine closes the gap.

### 3.5 Join flow and abuse limits

1. Scan QR, open `/j/<secret>`, enter a display name ("Anna, förälder") and optionally "Log in with ScoutID" to attach `mno`.
2. If `require_approval` is on, HQ approves the device first. Use this for competitions that print QR codes on public signs.
3. The grant is issued. The client pre-caches the competition, its stations and the patrol list (03 §3).

Rate limits, enforced in the app with `rate-limiter-flexible` 11.2.2 on a Postgres store (so they hold across instances), plus Traefik on option C:
- `/j/*`: 10 req/min per IP, plus a global failed-lookup counter that alerts on more than 100 misses per hour.
- `/sync/*`: 60 req/min per device.

Invite secrets have 128 bits of entropy, so enumeration is not feasible. The rate limits are for DoS protection.

### 3.6 Start & finish tablets and HQ screens

These use the same mechanism with `role = startfinish` (or `hq_viewer` for a read-only HQ screen). They are paired by an organiser who is logged in with ScoutID and clicks "Pair this device" or shows a QR to the tablet. No ScoutID session is placed on a shared device. Grant `exp` is event end + 24 h. The client offers an optional **local screen-lock PIN** (4–6 digits, held only on the device) to cover a tablet left unattended. When the event is closed, all of its grants are revoked automatically.

### 3.7 Patrol leaders and followers

| Link | Format | Grants |
|---|---|---|
| **Follow link** `/f/<token>` | 128-bit random. Stored hashed. One per patrol. Can be rotated. | Read-only view of one patrol's own progress. Shows no personal data beyond the patrol name and the member first names the organiser allows. |
| **Manage link** `/m/<token>` | 128-bit random. Stored hashed. Emailed or sent by SMS to the registered contact. Valid until the competition closes. | Edit the patrol registration, members and contacts. Equivalent to `patrol_leader`. |
| ScoutID | session | `patrol_leader` for patrols whose contact `member_no` matches. |

All link pages send `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex`, and pages use `<meta name="robots" content="noindex">`.

---

## 4. Authorisation model

Roles are granted **per competition** (`competition_role(competition_id, principal, role, station_ids?)`), where the principal is a `member_no` or a `device_id`. The only global role is `platform_admin`, held by operators and used under audit. Creating a competition needs no role: any logged-in ScoutID user may do it (§2.4). The backend enforces permissions in a single policy service (`can(principal, action, resource)`). The client hides controls it cannot use but never enforces anything itself.

**Permission matrix** (✔ allowed, ◐ restricted, as footnoted, – denied)

| Action | Owner | Organiser | HQ | Start/Finish | Station vol. | Patrol leader | Follow link | Public |
|---|---|---|---|---|---|---|---|---|
| Create competition (any logged-in ScoutID user) | – (global) | – | – | – | – | – | – | – |
| Delete / transfer ownership | ✔ | – | – | – | – | – | – | – |
| Edit settings, stations, scoring rules | ✔ | ✔ | – | – | – | – | – | – |
| Invite / remove organisers & HQ | ✔ | ◐¹ | – | – | – | – | – | – |
| Create/rotate station & tablet invites, revoke devices | ✔ | ✔ | ✔ | – | – | – | – | – |
| Import patrols / view all contact data | ✔ | ✔ | ◐² | – | – | – | – | – |
| Register / edit own patrol | ✔ | ✔ | – | – | – | ◐³ | – | ◐⁴ |
| Record start / finish times | ✔ | ✔ | ✔ | ✔ | – | – | – | – |
| Record / correct station scores | ✔ | ✔ | ✔ | – | ◐⁵ | – | – | – |
| Review quarantine, override scores | ✔ | ✔ | ✔ | – | – | – | – | – |
| Upload protocol photo | ✔ | ✔ | ✔ | ✔ | ◐⁵ | – | – | – |
| View all scores (unpublished) | ✔ | ✔ | ✔ | ◐⁶ | ◐⁵ | – | – | – |
| View own patrol progress | ✔ | ✔ | ✔ | ✔ | – | ✔ | ✔ | – |
| View live results (if toggle on) / ceremony | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Send SMS/email to participants | ✔ | ✔ | ◐⁷ | – | – | – | – | – |
| Export / erase personal data, close competition | ✔ | ◐⁸ | – | – | – | – | – | – |

¹ Organisers can invite HQ and organisers, but cannot remove the owner. ² HQ sees an emergency contact phone number only during the event window. ³ Own patrol only, until registration closes. ⁴ Self-registration only when the competition opens public registration. ⁵ Only for the stations in the grant. ⁶ Start/finish sees timing data and patrol status only. ⁷ Event-day templated messages only, with a quota. ⁸ Export only. Erasure is reserved for the owner.

Every write records `actor` (member_no or device_id plus display name), `via` (session or grant jti) and `received_at` in an append-only audit log. That log is the basis for score tamper investigation.

---

## 5. Threat model highlights

| Threat | Mitigations |
|---|---|
| **Score tampering**: a volunteer edits another station's score, or a patrol member forges scores | Station scope in the grant. Device-signed commands. Per-device hash chain and `seq`. Append-only audit log, so every correction keeps the original. HQ can diff against protocol photos. Abnormal-pattern flags such as scores outside the allowed range or a burst of edits. |
| **Token leakage through photos of QR signs** or a forwarded group chat | QR codes are not meant for public posting: the UI prints them on the volunteer sheet, not on the station sign. `max_devices`, `require_approval`, a validity window, the device list showing who joined, one-click rotation, quarantine. A leaked QR gives only *station-scoped* write access, and every device is named and revocable. |
| **Enumeration of follow, manage and invite links** | 128-bit random tokens stored as hashes. Rate limiting with alerting on miss bursts. Constant-time lookup by hash. `noindex`, no-referrer. |
| **CSV/xls import attacks**: macro or formula injection, zip bombs, XXE, parser CVEs | Parsing happens **client-side** (SheetJS, pinned version) in a Web Worker. Only allowlisted columns are sent to the API, as JSON. The server never parses the xls in v1. If server-side parsing is ever added, it gets size limits (5 MB), no XXE, no formula evaluation, and its own process. CSV **exports** prefix cells that start with `= + - @ \t \r` with `'` to block formula injection. |
| **XSS from user content** (patrol names, station descriptions, chat-like notes) | The SPA framework escapes output by default, and raw HTML rendering is banned by lint. Strict CSP: `default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'` (no inline scripts, nonces only if needed). Markdown in descriptions passes through an allowlist sanitiser. Session cookies are httpOnly, and grants are useless without the non-extractable key. |
| **Abuse of SMS/email sending** (spam, cost blow-up, phishing through our sender name) | Only organisers can send, to a competition's own registered contacts only, never free-text recipients. Per-competition quota (default 300 SMS/event) and global daily cap with alerting. Templates with a fixed sender and footer. The provider's spend cap is set at the account level. Self-service registration confirmations are rate-limited per IP and per recipient. |
| **Account takeover / session theft** | BFF with httpOnly `__Host-` cookie, SameSite=Lax, CSRF tokens, session rotation, HSTS preload. No ScoutID tokens in the browser. |
| **Privilege escalation through stale memberships** | Kår roles only gate *creation*. Competition rights are explicit grants, and changes are audited. |
| **Supply chain** | Renovate with exact pins, `npm ci` from the lockfile, `npm audit` in CI, Trivy image scan, pinned action SHAs, signed provenance and SBOM (§7.6). |
| **DoS on event day** | App rate limits (plus Traefik or the platform's edge). Max-instance cap so that cost cannot run away. Public results are cached (1–5 s TTL) and served by cached polling or a single SSE fan-out. Offline-first clients keep working without the server. |

---

## 6. Privacy & GDPR

### 6.1 Roles and legal basis

- **Controller:** the kår (or district) that owns a competition. It already processes the same members' data in Scoutnet.
- **Processor:** the legal entity operating scouttavling.se. **Decision (2026-10-15):** normally the **scout district** (distrikt) is the formal operator; Scouterna or an ideell förening are acceptable alternatives. A private individual acting as processor for many kårer is a real liability risk. A standard **personuppgiftsbiträdesavtal (PUB-avtal)** is accepted in the UI by the owner when creating the first competition for a kår, and is versioned and recorded.
- **Sub-processors** (EU regions; final list follows the hosting decision, §7): the compute host, the database provider if separate (e.g. Neon), object storage, the email provider, the SMS provider, error tracking, ScoutID/Scouterna (identity). They are listed on a public page.
- **Legal basis:** *legitimate interest* / the kår's membership agreement for running scout activities (Art. 6(1)(f), backed by a short balancing test document) for participants and contacts. *Consent* is not used for children's core participation data. Consent is used only for optional things, such as the volunteer phone number or showing first names on public results. Photos of people are not part of the product; protocol photos are of paper.
- **Children:** names, patrol and kår only. **No birth data is stored at all** (organiser decision 2026-10-15). Public result pages show **patrol name + kår** by default. Individual names are never public.

### 6.2 What we store and what we never store

| Category | Stored | Never stored |
|---|---|---|
| Participants (8–18) | first and last name, patrol, kår, optional allergy/medical **free text only if the organiser enables it** (marked sensitive, HQ-only, deleted early) | personnummer, address, birth date **and birth year**, photos of people |
| Contact persons / patrol leaders | name, phone (E.164), email, optional member_no | address, personnummer |
| Organisers (ScoutID) | member_no, name, email, phone (opt-in), kår role snapshot | birthdate, picture, troop/patrol memberships |
| Volunteers | self-chosen display name, optional member_no, device id | — |
| Criminal-record check status (*utdrag ur belastningsregistret*) | **never** | **never**, and never uploaded |

### 6.3 Data minimisation in import (contract for client and backend)

- **Client-side parsing with an allowlist:** the import wizard maps columns to `{firstName, lastName, memberNo, patrolName, groupName, contactName, contactPhone, contactEmail}`. Every other column is **dropped in the browser before any request**. Columns that look like personnummer (`\d{6,8}[-+]?\d{4}`), addresses or "belastningsregister" are highlighted in red, labelled "sent to the server: never", and cannot be mapped.
- The server import schema (Valibot `v.strictObject` in `packages/schema`) **rejects unknown fields** and validates that no value matches a personnummer pattern, as defence in depth.
- Birth dates and birth years (including a trailing year in free-text member lists) are stripped in the browser and never uploaded.

### 6.4 Retention schedule

| Data | Retention | Mechanism |
|---|---|---|
| Participant and contact personal data | **90 days after the competition is closed** (or 13 months after the event date if never closed) | Nightly job pseudonymises: names become "Patrull 12 – medlem 3", and contacts are deleted. Results stay, keyed by patrol name and kår. |
| Protocol photos (may contain names) | **30 days after results are published final**, at most 90 days | Object storage lifecycle rule plus DB job. EXIF/GPS stripped at upload. |
| Optional medical/allergy notes | Deleted at **event end + 7 days** | Job. |
| Device grants, invites | Expire at event end + 24 h. Rows deleted after 90 days. | Job. |
| Audit log (`audit_log`, §10.3) | Kept (append-only). It stores only ids, actions and a reason that must not name participants; names are resolved at read time, so nothing personal remains once an account or a competition's personal data is removed. | DB trigger refuses UPDATE/DELETE. |
| Organiser accounts | Deleted **24 months after last login** (with an email warning at 23 months) | Job. |
| Application logs | 14 days, **no PII** | Platform log retention set to 14 days (or Docker `local` driver rotation on a VPS). |
| Backups | Provider PITR (≤ 7 days) plus daily dumps for 14 days and weekly for 8 weeks. Pseudonymisation catches up through the backup expiry (max ~2 months). This is documented in the privacy policy. | restic `forget --keep-daily 14 --keep-weekly 8` (§7.10). |
| Public results (patrol name, kår, points) | Kept as an archive unless the owner deletes them | — |

### 6.5 Data subject rights, logging, hosting location

- **Export / erasure:** the owner gets "Export all personal data (JSON/CSV)" and "Erase person" per competition. Requests to the operator are forwarded to the controlling kår. Site admins can run "Ta bort personuppgifter" on the owners' behalf from `/site-admin` (closed editions only, typed confirmation, reason required, audited; §10). The target turnaround is under 30 days.
- **Logging without PII:** logs carry internal UUIDv7 ids (user, device, competition) and request ids. They contain no names, phone numbers, emails, member numbers, tokens or invite secrets. pino `redact` paths plus a test that scans captured logs for names, emails and personnummer shapes enforce this. Secrets in `/j/`, `/f/`, `/m/` paths are masked in the app's request log. Platform access logs are configured not to keep them (Traefik `accesslog.fields.names.RequestPath=drop` on a VPS; on serverless platforms, request-path logging is excluded or the log bucket is kept to the 14-day, maintainer-only retention).
- **Location:** all data and backups are in EU regions of the chosen providers (§7.2 H1). No CDN is used for authenticated content.
- **Repository hygiene:** the new repo already contains a **real Scoutnet export (`*.xls`) with personal data**. Delete it from the working tree (it is untracked, so it must never be committed), and add to `.gitignore`: `*.xls`, `*.xlsx`, `*.csv`, `/data/`, `/imports/`, `.env*`. Test fixtures must be synthetic and live in `apps/web/tests/fixtures/` with an explicit `!` exception. Add `gitleaks` plus a simple pre-commit/CI check that fails on personnummer-shaped strings.

---

## 7. Hosting, deployment and operations

**Hosting is deferred** (product owner, 2026-10-15). This section fixes the *requirements* and compares *options*. The application is one OCI image (02 §1) plus Postgres (images included; a bucket only if uploads grow a lot, 05 §6), so the choice can be made late and changed later without code changes.

### 7.1 Load expectations

Peak for a single competition: about 60 patrols, about 30 volunteer devices, 2–3 start/finish tablets, and maybe 200–500 public viewers during the ceremony. Several competitions may run on the same weekend, which means fewer than 200 devices and fewer than 2,000 viewers in total. Write load is tiny (well under 10 commands/s). The real challenges are **availability on event day** and **public fan-out during the ceremony**, not throughput. Between events (most of the year) the load is close to zero, so **scale-to-zero** is the main cost lever.

### 7.2 Requirements for any host

| # | Requirement |
|---|---|
| H1 | **EU data residency** for app, database, object storage, logs and backups. An EU-owned provider is preferred (see open question in 01 §6). A DPA must be available. |
| H2 | Runs a standard **OCI container** (linux/amd64; arm64 is a bonus) with env-var configuration and a platform secret store. |
| H3 | **Long requests for SSE: ≥ 60 min** per request, HTTP/2 or HTTP/1.1 streaming without buffering. The app recycles streams at about 55 min (02 §3). |
| H4 | **Scale to zero** between events, *and* **pin min-instances = 1** during live events (set by the `event-mode` deploy job from the competition calendar) to avoid cold starts. |
| H5 | Either ≥ 250 concurrent requests per instance, or acceptance that anonymous public results use cached polling instead of SSE (02 §3). |
| H6 | Postgres 18 with a **pooled URL** and a **direct (session) URL** (02 §1). PITR or 15-min backups during events. |
| H7 | An external **scheduled HTTP trigger** (5 min + nightly) for `/internal/jobs/tick` (02 §8), and a way to run a **one-shot job** (migrations, `pg_dump`). |
| H8 | Only if uploads grow a lot (protocol/user photos): an S3-compatible EU bucket with presigned URLs and lifecycle rules. Not needed for v0.1, where images live in Postgres. |

### 7.3 Options compared

| | **A. Google Cloud Run** (europe-north1, Finland) + **Neon** (Frankfurt) | **B. Scaleway** Serverless Containers + Serverless SQL (fr-par / nl-ams) | **C. VPS fallback**: e.g. Hetzner Cloud (hel1/fsn1), Docker Compose + Traefik v3.7.15 + self-hosted Postgres |
|---|---|---|---|
| Scale to zero / min-instances | Yes / yes (`--min-instances`) | Yes (after 15 min idle) / yes (`min_scale`) | No (always on) / n/a |
| SSE (H3) | 60-min request timeout max | 60-min request timeout max | Unlimited |
| Concurrency per instance (H5) | Up to 1,000 | **80 max**, so public viewers use cached polling | Unlimited |
| DB | Neon: pooled (`-pooler`) + direct URLs, scale to zero after 5 min (can be disabled on paid plans), PITR 7 days on Launch | Serverless SQL: scale to zero, 7 days of backups included. **NOTIFY delivery best-effort** (hence the polling backstop in 02 §3). Or Scaleway Managed PostgreSQL (always on). | Postgres 18.6 container on the same VM, `pg_dump` + restic 0.19.1 |
| Scheduler / jobs | Cloud Scheduler, Cloud Run Jobs | Cron triggers, Serverless Jobs | systemd timers / cron |
| Ops burden | Lowest | Low | OS patching, TLS, backups are ours |
| Ownership | US-owned (EU region, SCCs) | **EU-owned** | EU-owned |

**Database options, independent of compute:** serverless or managed EU Postgres (Neon, Scaleway Serverless SQL or Managed PostgreSQL, Google Cloud SQL, Aiven) or self-hosted on a VPS. **Object storage:** any S3-compatible EU bucket (Scaleway Object Storage, Hetzner Object Storage, GCS with HMAC keys).

**Guidance, not a decision:** A and B meet every requirement at the lowest idle cost. B is preferred if EU ownership matters to the district as processor. A has the most generous concurrency. C is the fallback if a volunteer wants full control or a flat bill. It is also the cold standby for A/B (§7.9). The phase-0 spike (01 §7) deploys the same image to A or B **and** C, so the decision is made on measured cold starts and SSE behaviour.

### 7.4 Runtime stack (pinned versions, 2026-10-15)

| Component | Version |
|---|---|
| Base image | `node:24.22.0-trixie-slim`, pinned by digest, non-root user |
| App | SvelteKit 3.1.0 + adapter-node 6.0.0 (02 §1); openid-client 6.8.8, jose 6.2.12, Drizzle ORM 0.45.4, postgres.js 3.4.9, pg-boss 12.38.0 |
| Database | **PostgreSQL 18.6** (managed or `postgres:18.6` image), migrations with **drizzle-kit 0.31.11** |
| Reverse proxy (option C only) | **Traefik v3.7.15**, Let's Encrypt, HSTS, rate-limit middleware. Serverless platforms terminate TLS themselves. |
| Backups (option C, and the offsite dump for A/B) | **restic 0.19.1** |
| Uptime monitoring | **Uptime Kuma 2.5.6** or any EU hosted monitor |
| Error tracking | **GlitchTip 6.1.8** (self-hosted on C, or GlitchTip's hosted service) or Sentry SaaS EU region, via `@sentry/sveltekit` 11.8.0 |
| Metrics (optional, C only, phase 2) | **Prometheus 3.15.0** + **Grafana 13.2.4**. On A/B, platform metrics suffice. |
| Local ScoutID | **Keycloak 26.8.1** + **scoutid-keycloak-provider v0.14.0** |

Changes from gokapp: no `ddl-auto=update` (drizzle-kit migrations); no `:latest` tag (deploy by digest); no defaulted DB password; on option C the Traefik dashboard is off and the Docker socket goes through a read-only socket proxy.

### 7.5 Email and SMS

- **Email:** an EU transactional provider such as **Scaleway Transactional Email** (FR) or **Brevo** (FR), sending from `noreply@scouttavling.se` with SPF, DKIM and DMARC `p=quarantine`. Volume is low (hundreds per month), so this is likely free or under €5. Sent through SMTP (nodemailer) so the provider can be swapped.
- **SMS (optional):** e.g. **46elks** (Swedish, pay-as-you-go REST API, alphanumeric sender "Scouttavl"). Third-party sources put cost around 0.5–1 SEK per SMS; confirm on 46elks pricing. A hard monthly spend cap on the account plus app quotas (§5). SMS is optional per competition, and **email-only is the fallback**.

### 7.6 CI/CD

GitHub Actions in the new repo:

1. `ci.yml` on PR: `actions/checkout@v7.0.1`, `actions/setup-node@v7.1.0` (Node 24.22.0, npm cache), `npm ci`, typecheck, lint, dependency-cruiser, Vitest (unit + property), integration tests (Testcontainers `postgres:18.6`), Playwright e2e against the built container, `gitleaks`, personnummer-pattern check, CodeQL for JS/TS (`github/codeql-action`, current bundle v2.27.2).
2. `release.yml` on push to `main`: `docker/setup-buildx-action@v4.4.1`, `docker/metadata-action@v6.2.0`, `docker/build-push-action@v7.4.0` with a multi-stage Dockerfile (build, then `npm prune --omit=dev` into the slim runtime stage), `provenance: mode=max` and `sbom: true`. It pushes to `ghcr.io/<org>/scouttavling:<git-sha>` and `:<semver>` (immutable; never deploy `:latest`), scans with `aquasecurity/trivy-action@v0.36.0` (fail on HIGH/CRITICAL with a fix available), and attests with `actions/attest-build-provenance@v4.2.2`. All actions are pinned to commit SHAs with the version in a comment, and Renovate updates them. Cloud credentials use OIDC workload identity federation where the platform supports it, otherwise an Environment-scoped API key.
3. **Deploy** (staging automatic, prod via `workflow_dispatch` behind a GitHub Environment with a required reviewer), always **by image digest**:
   1. Run migrations as a one-shot job with the same image (`drizzle-kit migrate` on `DATABASE_URL_DIRECT`). Migrations are expand/contract, so the previous revision and N-1 clients keep working.
   2. Roll out: on A/B, a new revision that gets traffic only after `/readyz` passes; rollback means routing traffic back to the previous revision. On C, `deploy.sh <digest>` over a restricted SSH key: pull, `docker compose up -d`, health check, automatic rollback.
4. **`event-mode on|off`** job: sets min-instances = 1 (and disables DB scale-to-zero where supported) from Friday 12:00 before a scheduled competition until it closes. It runs from the competition calendar, with a manual override.
5. **Change freeze:** no prod deploys from Thursday 18:00 until the end of any weekend that has a competition scheduled. The deploy job checks the competition calendar API and refuses during a freeze, with an override for hotfixes.

### 7.7 Environments and secrets

| Env | Domain | Data | ScoutID |
|---|---|---|---|
| local | localhost | synthetic seed, `postgres:18.6` in Docker | dev / local Keycloak |
| staging | staging.scouttavling.se | synthetic, reset weekly (on A/B it scales to zero and costs about nothing) | dev |
| prod | scouttavling.se | real | prod |

Secrets (DB URLs, ScoutID client secret, grant signing key, session/cookie encryption key, S3 keys, SMTP/SMS keys, job-tick secret, restic password) live in the **platform secret store** (Secret Manager, Scaleway Secret Manager), or on C in `/etc/scouttavling/prod.env` (mode 600). They are mirrored in a shared password manager (Bitwarden organisation) that at least two maintainers can access, and are never in the repo. The grant signing key is a PEM injected as a secret file or variable.

### 7.8 Monitoring and alerting

- **Uptime monitor on a different provider from the app** (Uptime Kuma on a small VM or home server, or an EU hosted monitor). It checks `/healthz`, TLS expiry, DNS, the login redirect and the public results page. It checks every 60 s in event mode and every 10–15 min otherwise, since each check is a short request that ends billing immediately on A/B. Alerts go to the maintainer email and a Signal/Telegram/ntfy channel.
- `/healthz` (liveness, no DB) and `/readyz` (DB reachable, migrations current). `/internal/status` (authenticated JSON) reports sync errors, quarantine count, SMS sent, failed invite lookups, queue depth and listener state. Uptime Kuma keyword checks on it are enough for v1.
- **Logs:** pino JSON to stdout, collected by the platform (or the Docker `local` driver on C), with retention set to 14 days.
- Error tracking through GlitchTip/Sentry, with PII scrubbing on both client and server.
- Event-day alert thresholds: health down for 2 min, sync error rate above 5%, quarantine above 20, SMS above 80% of quota, job queue older than 10 min.

### 7.9 Event-day runbook (summary)

**T−7 days:** organiser runs the "event readiness" checklist in the app: stations configured, invites generated, volunteer sheets printed, **blank paper protocols printed for every station**, and start/finish tablets paired and synced. The operator confirms the freeze window, checks that `event-mode` is scheduled, and checks that the last restore test passed within the last 30 days.

**T−1 day:** devices are paired and pre-cached, which proves the offline path works. `event-mode on` is verified (one warm instance, DB not suspending). Lower the DNS TTL to 300 s.

**During the event:**

| Situation | Action |
|---|---|
| Server unreachable | Clients keep recording offline (signed commands queued), so stations and start/finish continue as normal. HQ switches to tablet-local results if they have been synced to the HQ device, otherwise to paper. Live public results pause, shown as "uppdateras snart". |
| Bad release | Route traffic back to the previous revision (A/B) or `deploy.sh <previous digest>` (C). Migrations are expand-only during the freeze, so no DB rollback is needed. |
| Platform or region down for more than 30 min | Deploy the same image digest to the **cold standby** (another region of the same platform, or a prepared option-C VM from cloud-init), point it at the database (or a restore of it), switch DNS. Target **RTO 45 min**. |
| Database lost or corrupted | Managed: **PITR** to just before the incident (new branch or instance), then repoint the app. Self-hosted: restic restore of the latest `pg_dump`. **RPO**: minutes with PITR, 15 min with dumps. Devices then resync, and because commands are idempotent nothing is double-counted. |
| Device lost or stolen | HQ revokes the device and re-invites a replacement. Unsynced data on the lost device is recovered from that station's paper protocol. |
| Leaked QR | Rotate the code, keep current devices, review the device list and quarantine. |
| Tablet battery dead | Pair a spare tablet (unsynced data is lost, so use paper for that interval). Tablets should sync every few minutes when online. |

**After the event:** close the competition, which revokes grants and starts the retention clocks. `event-mode off`. Run a short retro and log incidents.

The analog fallback is part of the design: **every scoring screen has a printed paper equivalent**, and protocol photos plus quarantine review reconcile the two.

### 7.10 Backups

- **Managed DB (A/B):** provider PITR (Neon Launch 7 days; Scaleway Serverless SQL 7 days of backups included), plus a provider-independent **nightly `pg_dump -Fc`**. The dump runs every 15 min while a competition is LIVE, as a one-shot job using the same image plus `pg_dump`. It goes through restic to an S3 bucket at a **different provider**, so a lost account or provider does not lose the data.
- **Self-hosted (C):** the same `pg_dump` + restic schedule, to a bucket in a different location from the VM (e.g. VM in hel1, bucket in fsn1).
- Retention as in §6.4 (`restic forget --keep-daily 14 --keep-weekly 8`), with a separate restic password.
- Photos: bucket versioning is not needed. A weekly copy is kept only while photos exist, so retention applies.
- **Monthly automated restore test** into staging, monitored as a push check.

### 7.11 Cost estimate (EUR, excl. VAT)

Rates checked on 2026-10-15 where an official page gave them: Cloud Run tier-1 regions (incl. europe-north1) cost $0.000024/vCPU-s and $0.0000025/GiB-s, with 180k vCPU-s and 360k GiB-s free per month. Scaleway Serverless Containers cost €0.00001/vCPU-s and €0.000002/GB-s, with 200k vCPU-s and 400k GB-s free. Neon Launch costs $0.106/CU-hour and $0.35/GB-month. **Not verified:** Scaleway Serverless SQL per-vCPU rates (the docs point to the console estimate) and current Hetzner prices. Hetzner repriced twice in 2026 and its cost-optimised line is reported as unavailable. Those figures are ranges.

An event weekend is assumed to be about 60 h with one warm 1 vCPU / 1 GiB instance and an active DB.

| Item | A. Cloud Run + Neon | B. Scaleway serverless | C. Hetzner VPS |
|---|---|---|---|
| Compute, between events | ~0 (free tier) | ~0 (free tier) | 6–15 (4 vCPU/8 GB) |
| Compute, per event weekend | 0–5 (216k vCPU-s, partly free) | 0–2 | included |
| Database, between events | 1–3 (storage, admin use) | 0.1–2 | included |
| Database, per event weekend | 2–7 (0.25–1 CU × 60 h) | 3–10 (range, unverified) | included |
| Staging | ~0 (scales to zero; Neon free plan) | ~0 | 4–6, or share the VM |
| Object storage (photos + backups) | 0–2 | 0–2 | 5–6 |
| Uptime monitor (other provider) | 0–4 | 0–4 | 0–4 |
| Email · domain | 0–5 · ~1.5 | 0–5 · ~1.5 | 0–5 · ~1.5 |
| SMS (optional, e.g. 500 SMS in event months) | 0–40 (SEK 250–500) | same | same |
| **Month without events** | **≈ €3–16** | **≈ €2–15** | **≈ €13–38** |
| **Extra per event weekend** | **≈ €2–12** | **≈ €3–12** | **€0** |
| **Year** (≈ 8 event weekends, excl. SMS) | **≈ €50–290** | **≈ €50–280** | **≈ €160–460** |

Every option is small enough for a kår, district or Scouterna to sponsor. The serverless options are cheapest when events are few, and the VPS is a predictable flat fee.

---

## 8. Migration and rollout from gokapp

gokapp data is per-event and short-lived, and its users are local accounts with no ScoutID link. **We do not migrate personal data.** Only reusable *templates* move: station definitions, scoring rules and class configurations.

| Phase | When (indicative) | Content | Exit criteria |
|---|---|---|---|
| 0. Foundations | Nov 2026 | Repo hygiene (§6.5), CI, phase-0 spike (01 §7) on a serverless container and a VPS, **hosting decision**, staging, ScoutID dev client requested (email §2.7), DPA draft reviewed with Scouterna | Login with dev ScoutID on staging; hosting chosen |
| 1. MVP | Dec 2026 – Feb 2027 | Organiser flows, import wizard, device grants, offline scoring, start/finish, public results | Simulated event with 30 devices on staging, including a server kill and restore drill |
| 2. Pilot | Spring 2027, **one friendly competition** (a single kår, ~20 patrols) | Run **parallel to gokapp**: gokapp stays the system of record, scouttavling.se is used by the same volunteers, and paper protocols are mandatory | Results match. No lost commands. Volunteer survey. |
| 3. Early adopters | Spring/summer 2027 | 3–5 competitions incl. a multi-day hajk. gokapp is still available on request. | Two weekends with no Sev-1 incident |
| 4. Default | Autumn 2027 | New competitions only on scouttavling.se. gokapp becomes read-only, then archived. | — |
| 5. Decommission | ≤ 6 months after phase 4 | Export gokapp results to static archive pages (patrol names and kår only), wipe the gokapp DB, stop the gokapp host | DB deletion confirmed |

**Responsibilities:**
- **Developers** use `tools/gokapp-migrate --templates-only` (02 §9), a TS CLI that reads a gokapp MySQL dump *offline* and creates stations, items and tracks. They also build the results-archive exporter. The full mode runs only into scratch databases for ranking parity.
- **Ops (this section)** runs both stacks during phases 2–4 on separate hosts and accounts. gokapp stays on its current compose/Traefik host. `gokapp.<domain>` keeps working until decommission.
- **Competition owners** re-import participants from Scoutnet with the new wizard, which is how data minimisation applies from day one.

**Pre-production checks:** a ScoutID prod client, a signed DPA template, a published privacy policy and sub-processor list, a restore test passed, and an external security review of the grant/sync endpoints (a volunteer pentest by someone in the Scouterna IT network is fine).

---

## 9. Contracts for other sections (checklist)

1. **Session (organisers):** `__Host-sid` httpOnly cookie (session in Postgres), CSRF header `X-XSRF-TOKEN`, `/auth/login|callback|logout` in the SvelteKit server, `GET /api/v1/me` → `{memberNo, name, groups:[{groupNo, name}], roles:[{competitionId, role, stationIds?}]}` (`groups` = selectable owning organisations).
2. **Invite:** `/j/<128-bit secret>`. `POST /api/v1/join {secret, displayName, publicJwk, nonceSig}` → `{grant, serverKeys}`.
3. **Device grant:** ES256 JWS, `typ: st-grant+jwt`, claims `jti, sub(device), cid, role, stations[], gen, exp, cnf.jkt`.
4. **Signed command:** ES256 JWS from the device key, `typ: st-cmd+jwt`, claims `cmd, id(UUIDv7), seq, prev, at, cid, station, body`. `POST /api/v1/competitions/{cid}/sync/commands` is idempotent on `id` and returns per-command `accepted | duplicate | conflict | quarantined(reason) | rejected(reason)` (01 C1).
5. **Roles:** `platform_admin` (global), and per competition `owner, organiser, hq, startfinish, station_volunteer, patrol_leader`, plus link capabilities `follow` and `manage`, and `public`. Single policy service enforcing §4.
6. **Links:** follow `/f/<128-bit>`, manage `/m/<128-bit>`, stored hashed, `noindex`, `no-referrer`.
7. **Import:** client-side allowlisted columns only. The server rejects unknown fields and personnummer patterns.

## 10. Owners, site admin and the audit log

Built in v0.1 (2026-10-26), decided with the product owner. Code: `apps/web/src/lib/server/ownership.ts`, `siteAdmin.ts`, `audit.ts`, `memberActions.ts`, `scripts/site-admin.ts`; routes `/site-admin/**`. Tests: `src/lib/server/siteAdmin.db.test.ts`, `e2e/site-admin.e2e.ts`.

### 10.1 Owners manage owners

- A competition (edition) and a series each have **owners** and **organisers** ("Ägare och arrangörer" in Inställningar and on `/admin/series/<slug>`). Owners add a co-owner by member number (the person must have logged in once, same rule as before), change roles (owner ↔ organiser), remove people and **transfer** ownership (the owner becomes organiser). Organisers can add and remove organisers and leave, never touch an owner. Removal and transfer ask for confirmation.
- Series owners live in `series_member` (owner/organiser). A series without rows is initialised lazily from its editions' owners/organisers (`ensureSeriesMembers`). Access to the series page is unchanged (owner/organiser of any edition) plus series members.
- **Invariant: at least one owner at all times.** `changeMembers()` is the only write path. It locks the competition/series row `FOR UPDATE`, applies a list of operations, re-counts owners from the database and rolls back if none is left. Concurrent demotions are serialised by the lock (tested: two owners leaving at the same time leave exactly one). The UI only explains the rule; the server enforces it.

### 10.2 Site admin

- **Granted and revoked only on the server command line**, never from the web. The person must have logged in once.

  ```sh
  cd apps/web
  npm run site-admin:grant  -- 3000001 --reason "Driftansvarig för scouttavling.se"
  npm run site-admin:revoke -- 3000001 --reason "Slutar som driftansvarig"
  npm run site-admin:list
  # production, inside the running app container (DATABASE_URL is already set there):
  docker compose --env-file .env.prod -f compose.yaml -f compose.prod.yaml exec \
    -e SITE_ADMIN_OPERATOR="$USER" app npm run site-admin:grant -- 3000001 --reason "…"
  ```

  Stored in `site_admin` (`user_id`, `granted_at`, `granted_by` = `cli:<os user>`, `reason`). The image contains the script (Dockerfile) and `postgres`; it does not need the SvelteKit build. Revoking also ends the admin's temporary accesses.
- `/site-admin` answers **404** to everyone else (also logged out), and the "Plattformsadmin" link is only rendered for site admins. Every action re-checks.
- What a site admin can do, each with a **required reason (≥ 10 characters)** and an audit row:
  1. Search competitions, series and users (name, address, member number) and see owners, organisers, status, last activity (newest `change_log` row), anonymised yes/no and patrol count.
  2. Add, change or remove owners of any competition or series, e.g. when the owner has left. The ≥ 1 owner rule still holds; **"Ersätt ägare"** adds the new owner and removes the old in one transaction.
  3. **Suspend / reopen a competition** (`competition.suspended_at`): public pages (`/t`, `/r`, registration, `/m`, `/folj`, `/p`, `/j`) answer 423 "Tävlingen är tillfälligt avstängd", field snapshot/sync and joining answer 423 (commands stay in the phones' outbox), and `requireCompetition` refuses every admin write (423). Organisers can still look, with a banner.
     **Suspend / reopen a user** (`app_user.suspended_at`): all sessions are deleted, `readSession` ignores suspended users and login (`createSession`) is refused. Their roles stay.
  4. **Remove personal data on behalf of the owners** (GDPR requests forwarded by the district): the same `anonymiseCompetition()`, closed editions only, typed confirmation.
  5. **Tillfällig åtkomst**: a site admin does **not** see a competition's admin pages by default (403 like anyone else). They take time-limited access (1, 2, 4 or 8 h, organiser level) with a reason (`site_admin_access`). `requireCompetition` reads it as an extra role source while `expires_at > now()` and it has not been ended, so it expires by itself with no job. The admin sees a banner with the end time; the owners see "Plattformsadmin X har/hade åtkomst … Anledning …" on every admin page for 7 days and in Inställningar → Händelselogg for 30 days.

### 10.3 Audit log

- `audit_log` is **append-only**: a trigger (in `0000_initial.sql`) rejects `UPDATE`, `DELETE` and `TRUNCATE`; there is no update/delete path in the app. Columns: `at`, `actor_user_id` (null for the CLI), `actor_kind` (`user`/`site_admin`/`cli`), `action`, `target_type`/`target_id`, `competition_id`, `series_id`, `reason`, `details` (jsonb). No foreign keys, so rows outlive what they mention.
- Logged: every owner/organiser change (A), every site-admin action and CLI grant/revoke, and every "Ta bort personuppgifter" (owner or site admin).
- **Personal data:** rows store **ids only**; names are looked up when the log is read ("Borttagen användare" when the account is gone). Removing a competition's personal data therefore never needs to touch the log. The free-text **reason must not contain patrol member names**; every reason field says so. This replaces the "pseudonymise the audit log" job in §6.4 for these rows.
- Read: `/site-admin/audit` (filter by event type, site-admin only, competition/series address, date range); owners see their competition's (and series') entries read-only in Inställningar → Händelselogg.


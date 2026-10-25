# 05 · Competition series, yearly editions and removal of personal data

Status: built in v0.1 (2026-10-25). Decided with the product owner. Code: `apps/web/src/lib/server/series.ts`, `anonymise.ts`, `assets.ts`, `assetStore.ts`, `#lib/brand/branding.ts`, `#lib/series/dates.ts`.

## 1. Model

| Table / column | Meaning |
|---|---|
| `series` | One competition series, e.g. GökOpen (`slug` = `gokopen`). `name`, `owner_group_no/name`, `created_by`, `created_at`. Owns the shared **branding**: `accent_color`, `cover_fit`, images (`asset.series_id`) and the **class colour template** `class_colors` (class name → `#rrggbb`). |
| `competition.series_id` | The series of this edition. Nullable: a competition made with "Ny tävling" is a one-off until someone creates its next year. |
| `competition.edition_year` | 2027 for "GökOpen 2027". |
| `competition.archive_public` | Listed under "Tidigare år" on the public series page (default true). |
| `competition.anonymised_at` | Set by "Ta bort personuppgifter". The edition is read-only from then on. |
| `asset.series_id` | Exactly one of `competition_id` (an edition's own override) and `series_id` (series branding) is set (`asset_one_owner` check). |
| `retired_link` | `token_hash → competition_id`, written when an edition's patrol links are removed, so an old `/m/…` or `/folj/…` link can say "Tävlingen är avslutad och arkiverad" without any patrol link surviving. |

A series slug is never equal to a competition slug (both live under `/t/<slug>`; checked on create, and `series` is a reserved competition slug).

### Branding resolution (one rule, one helper)

Per part (accent, cover fit, event logo, organiser logo, cover): **the edition's own value if set, else the series' value, else the Scouterna base** (Scoutblå, no images, automatic fit). The pure function is `resolveBranding()` in `#lib/brand/branding.ts` (unit-tested); every page reads branding through `loadBranding(comp)` in `#lib/server/assets.ts`, which feeds it. Class colours: a class's own colour, else the series template for that class name (case-insensitive), else the name default (`trackColors(tracks, template)`).

Organisers edit the series branding on `/admin/series/<slug>`; an edition's Inställningar → Utseende shows what is inherited ("Från serien") and only stores overrides.

### Permissions (kept simple)

A user organises a series when they are **owner or organiser of any of its editions** (`requireSeries`). There is no separate series membership. "Skapa nästa år" carries the owners and organisers over to the new edition; HQ and start/finish roles do not.

## 2. Migrations (expand only)

- `0005_competition_series` (generated): `series`, `retired_link`, the four competition columns, `asset.series_id`, `asset.competition_id` nullable, the check constraint. Purely additive.
- `0006_series_backfill` (custom, re-runnable): each competition without a series joins/creates a series named after its year-stripped name and owner ("GökOpen 2027" → "GökOpen", `gokopen`, `edition_year` 2027; a slug clash with a competition gets `-serie`). Branding is **copied** to the series (newest edition wins; images copied row by row; class colours from the tracks). The edition keeps its own values, so the previous app version (which only reads competition-level branding) is unchanged.
- **Contract step, later release:** optionally clear edition-level branding that equals the series' copy, so future series changes reach those editions. Until then such editions behave exactly as before (their override equals the series value).

## 3. "Skapa <Serie> <år+1>"

Shown on a closed edition's overview and as the main button on the series page (from the newest edition). The confirm form (`/admin/<slug>/next-edition`) proposes the name, address and dates; the organiser can adjust every day's date and the registration window.

- **Dates:** every date moves by the same number of days: one year later on the same weekday, nearest the same calendar date (±3 days; `editionShiftDays`). Sat 15 May 2027 → Sat 13 May 2028. Multi-day editions keep their shape; registration dates shift by the same amount.
- **Copied:** days (name, prefix), classes with colours, stations (role, startable, class limits, paper code) with all items, score settings (style), registration settings (window, max, texts, follow settings, public results) with **registration closed**, and the invite structure: one new invite per station/start-finish desk that had one, **with new secrets**. New `patrol_code_key`.
- **Never copied:** patrols, members, scores, devices, messages, contacts (station contacts, HQ phone). Branding is inherited from the series, not copied.
- A one-off competition gets a series created on the fly (its branding copied to the series).

## 4. "Ta bort personuppgifter" (manual only)

Only on a **closed** edition. Its overview shows a persistent reminder ("Personuppgifter finns kvar för N patruller – ta bort när resultaten är klara") until it is done. The confirm page lists what goes and what stays; the organiser types the edition's name. **The app cannot take its own backup first** (the app container has no `pg_dump`, and dumps are an infrastructure concern), so the page states that it cannot be undone. Note: scheduled infrastructure backups (04 §8) still contain the data until they rotate out; that retention is the backup policy's job.

Implementation: `anonymiseCompetition()` in one transaction. Integration test: `apps/web/src/lib/server/anonymise.db.test.ts` ranks, removes, ranks again (deep-equal) and queries every affected table. After removal `anonymised_at` is set and `requireCompetition` refuses every non-GET request (409).

### Every text/reference column that could identify a person

| Table.column | Decision |
|---|---|
| `member.*` (first/last name, troop_text) | **Deleted** (rows). |
| `patrol.contact_name / contact_phone / contact_email / contact_member_no` | **Nulled.** |
| `patrol.manage_token_hash / follow_token_hash / follow_token_enc` | **Nulled**; hashes moved to `retired_link` (hash → edition only). |
| `patrol.number / name / troop / track_id / status / paid / start_station_id` | Kept (results). Patrol names are team names, not personal names. |
| `device.display_name` (volunteer name), the device grant | **Deleted** (rows; grants are only valid with the device row and its invite). |
| `invite.*` | **Deleted.** |
| `message.title / body / created_by`, `message_read` | **Deleted.** |
| `score.note`, `score.user_id`, `score.device_id` | **Nulled.** `points`, `style_points`, `raw`, `state`, `version`, `origin` kept. |
| `score_revision.reason / user_id / device_id / command_id` | **Nulled.** Points history kept. |
| `score_conflict.existing / incoming` | Keys `deviceName, deviceId, userId, reason, note, by, name` **stripped**; `command_id` nulled. |
| `status_event.device_id / user_id` | **Nulled.** |
| `command.payload` → `{}`, `result_detail` → null, `device_id` → null | Ledger rows (id, type, result) kept. |
| `competition_member` | **Deleted** except role `owner`. |
| `station.contact_name / contact_phone` | **Nulled.** |
| `competition.hq_phone` | **Nulled.** `registration_open` set false. |
| `asset.uploaded_by` | **Nulled.** Images kept (branding, not personal). |
| `competition.info_text / confirmation_text` | Kept: organiser texts. Registration stores no other free text (no comment field exists). |
| `change_log` (kind, entity id) | Kept: counts only, no personal data. |
| `app_user`, `session` | Not per edition (organisers' own accounts); untouched. |
| `competition.created_by`, `series.created_by` | Kept (the owner). |

## 5. Public archive

`/t/<series-slug>`: series branding; the current/upcoming edition (newest that is live) with registration and live-results links; "Tidigare år": every **closed** edition with `archive_public`, newest first, with year, date, place, number of patrols and the winners per class (patrol number, name, kår; only when that edition's results are public), each linking to `/r/<edition-slug>` (closed editions show "Slutresultat"). Organisers hide or show a year on `/admin/series/<slug>`. `/t/<edition-slug>` keeps working (edition slugs win) and links back to the series. Old patrol links of an archived edition redirect to `/arkiverad/<edition-slug>`.

## 6. Image storage

Uploaded images stay in **Postgres** (`asset.data`, owner decision): a few logos and covers per edition or series, ≤2 MB each, so backups and restores stay one database dump. All reads and writes go through `#lib/server/assetStore.ts` (`saveAsset` / `readAsset` / `deleteAsset`, plus `listAssets`, `copyAssets`, `clearUploader`), so a switch to object storage touches that one file. **Threshold:** move to an S3-compatible bucket only if uploads grow a lot, e.g. user or protocol photos (hundreds of MB per event), or if the dump size starts to slow backups/restores.

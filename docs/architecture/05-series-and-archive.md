# 05 · Competition series, yearly editions and removal of personal data

Status: built in v0.1 (2026-10-25). Decided with the product owner. Code: `apps/web/src/lib/server/series.ts`, `anonymise.ts`, `assets.ts`, `assetStore.ts`, `#lib/brand/branding.ts`, `#lib/series/dates.ts`.

## 1. Model

| Table / column | Meaning |
|---|---|
| `series` | One competition series, e.g. GökOpen (`slug` = `gokopen`). `name`, `owner_group_no/name`, `created_by`, `created_at`. Owns the shared **branding**: `accent_color`, `cover_fit`, images (`asset.series_id`) and the **class colour template** `class_colors` (class name → `#rrggbb`). |
| `competition.series_id` | The series of this edition. Nullable: a competition made with "Ny tävling" → "Fristående tävling" is a one-off until someone creates its next year. |
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

A user organises a series when they are **owner or organiser of any of its editions**, or a **series member** (`series_member`, owner/organiser; `requireSeries`). Series members are managed in "Ägare och arrangörer" on the series page; the series always has at least one owner (04 §10.1). A series without member rows starts with its editions' owners/organisers (lazily, `ensureSeriesMembers`). "Skapa nästa år" carries the owners and organisers over to the new edition; HQ and start/finish roles do not (product owner confirmed 2026-10-25; the next-year form says so in one line). Those are day-of roles and are invited again per year.

**Removing personal data is owner-only.** Organisers can do everything else on a closed edition, but `/admin/<slug>/anonymise` (page and action) requires the `owner` role and answers 403 otherwise. The overview shows organisers the reminder card with "Be ägaren (namn) ta bort personuppgifterna" instead of the button. Tested in `e2e/series.e2e.ts` (test 3).

## 2. Migrations

Series are part of the single `0000_initial.sql` (all migrations before the first deploy were collapsed on 2026-10-27; nothing had been deployed, so no data needed a backfill). The earlier series backfill (one-off competitions joining a series named after their year-stripped name, branding copied to the series) is in git history if an old database ever needs it.

## 3. "Ny tävling" and "Skapa <Serie> <år+1>"

**"Ny tävling" (`/admin/new`) starts with "Är tävlingen en del av en serie?"**:

- **Fristående tävling**: as before; `series_id` null.
- **Ny tävlingsserie**: the series' name (suggested from the competition name without the year) and its address `/t/<slug>` (suggested from the name, editable). The edition year comes from the first date. The series and its first edition are created in one transaction; the series starts with the Scouterna base branding. The series slug must be free among series **and** competitions, and must differ from the edition's slug (a generated edition slug that equals it becomes `<serie>-<år>`; a typed one is an error).
- **Nytt år i en befintlig serie**: lists only series where the user is owner/organiser of an edition (`organisedSeries`). The summary shows the year it would create (`<serie> <senaste år + 1>`), what is copied, and the **inherited series branding** (accent, logo, cover, class colours). "Fortsätt" opens the next-year form below with the series' newest edition as the source. *Why hand over instead of pre-filling the wizard:* the copy is a whole edition (days, stations with items and class limits, settings, invites) that the wizard's fields (length, class chips, station count) cannot express, so pre-filling would either show fields that are ignored or fork `createNextEdition`. One confirm form and one copy function keep both entry points identical. If that year already exists, the summary links to it; if the user is not owner/organiser of the newest edition (they organise an older year only), the summary asks them to contact its owner.

**"Skapa <Serie> <år+1>"** is shown on a closed edition's overview and as the main button on the series page (from the newest edition). Access: owner/organiser of the source edition (`requireNextEditionSource`); the source is only read, so an archived edition is a valid source. The confirm form (`/admin/<slug>/next-edition`) proposes the name, address and dates; the organiser can adjust every day's date and the registration window.

- **Dates:** every date moves by the same number of days: one year later on the same weekday, nearest the same calendar date (±3 days; `editionShiftDays`). Sat 15 May 2027 → Sat 13 May 2028. Multi-day editions keep their shape; registration dates shift by the same amount.
- **Copied:** days (name, prefix), classes with colours, stations (role, startable, class limits, paper code) with all items, score settings (style), registration settings (window, max, texts, follow settings, public results) with **registration closed**, and the invite structure: one new invite per station/start-finish desk that had one, **with new secrets**. New `patrol_code_key`.
- **Never copied:** patrols, members, scores, devices, messages, contacts (station contacts, HQ phone). Branding is inherited from the series, not copied.
- A one-off competition gets a series created on the fly (its branding copied to the series).

## 4. "Ta bort personuppgifter" (manual only)

Only on a **closed** edition, and only by its **owners** (organisers see who to ask, §1). Its overview shows a persistent reminder ("Personuppgifter finns kvar för N patruller – ta bort när resultaten är klara") until it is done. The confirm page lists what goes and what stays; the owner types the edition's name. **The app cannot take its own backup first** (the app container has no `pg_dump`, and dumps are an infrastructure concern), so the page states that it cannot be undone.

**Backups are part of the deletion routine.** Removal does not touch the scheduled server backups; the data in them disappears only when those backups rotate out. The confirm page says so. Retention today:

| Backup | Retention | Where it is set |
|---|---|---|
| Local dumps on the server (`backup` service, every 15 min; pre-migrate dumps share the folder and the rotation) | newest **96** dumps ≈ **24 hours** | `compose.prod.yaml`: `BACKUP_INTERVAL` 900 s, `BACKUP_KEEP` 96 |
| Offsite copies (restic) | 14 daily + 8 weekly ≈ **8 weeks** | 04 §6.4 / §7.10: `restic forget --keep-daily 14 --keep-weekly 8` |

So removed personal data is gone from every copy **at most ~8 weeks** after "Ta bort personuppgifter". A restore from an older backup brings it back: after a restore, run the removal again for every edition with `anonymised_at` set in the live database before the restore. Changing `BACKUP_KEEP`, `BACKUP_INTERVAL` or the restic policy changes this promise; update this table, the confirm page text and the privacy policy together.

Implementation: `anonymiseCompetition()` in one transaction, which also writes an `audit_log` row (who, when, patrol count; ids only, 04 §10.3). A site admin can run it on the owners' behalf from `/site-admin` (closed editions only, typed confirmation and a reason). Integration test: `apps/web/src/lib/server/anonymise.db.test.ts` ranks, removes, ranks again (deep-equal) and queries every affected table. After removal `anonymised_at` is set and `requireCompetition` refuses every non-GET request (409).

### Every text/reference column that could identify a person

| Table.column | Decision |
|---|---|
| `member.*` (first/last name, troop_text) | **Deleted** (rows). |
| `patrol.contact_name / contact_phone / contact_email / contact_member_no` | **Nulled.** |
| `patrol.manage_token_hash / follow_token_hash / follow_token_enc` | **Nulled**; hashes moved to `retired_link` (hash → edition only). |
| `patrol.number / name / troop / track_id / status / paid / paid_at / start_station_id` | Kept (results, statistics). Patrol names are team names, not personal names. |
| `device.display_name` (volunteer name), the device grant | **Deleted** (rows; grants are only valid with the device row and its invite). |
| `invite.*` | **Deleted.** |
| `message.title / body / created_by`, `message_read` | **Deleted.** |
| `score.note`, `score.user_id`, `score.device_id` | **Nulled.** `points`, `style_points`, `raw`, `state`, `version`, `origin`, `scored_at` (visit time, 06 §2) kept. |
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

**Points per station.** Removal keeps every score, so an archived year shows the same breakdown as on the day: tap a patrol on `/r/<slug>` for its points (and style) per station against the station's max. Public results show it **always once an edition is closed**; while it runs only when the organiser turns on "Visa poäng per kontroll under tävlingen" (`competition.station_results_live`, default off, so patrols cannot see a station's scores before they get there; copied to the next year). Organisers always see it on their results page, and the CSV export has one column per station. Rule: `showStationResults()` in `#lib/server/live.ts`; `publicTracks()` strips the breakdown otherwise.

## 6. Image storage

Uploaded images stay in **Postgres** (`asset.data`, owner decision): a few logos and covers per edition or series, ≤2 MB each, so backups and restores stay one database dump. All reads and writes go through `#lib/server/assetStore.ts` (`saveAsset` / `readAsset` / `deleteAsset`, plus `listAssets`, `copyAssets`, `clearUploader`), so a switch to object storage touches that one file. **Threshold:** move to an S3-compatible bucket only if uploads grow a lot, e.g. user or protocol photos (hundreds of MB per event), or if the dump size starts to slow backups/restores.

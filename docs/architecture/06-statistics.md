# 06 · Statistics

Status: built in v0.1 (2026-10-26). Decided with the product owner. Code: `packages/domain/src/stats.ts` (pure maths, unit-tested), `apps/web/src/lib/server/stats.ts` (loading and what is public), `src/lib/ui/stats/**`, routes `/admin/<slug>/stats` and `/r/<slug>/statistik`.

## 1. Pages and what each shows

| Part | Organiser ("Statistik" under Efter) | Public `/r/<slug>/statistik` |
|---|---|---|
| Participation: registered, started, finished, withdrawn, per class | yes | yes (when results are public) |
| Points per station: median, mean, min–max, standard deviation, count, mean style, % of max, histogram | always | same rule as points per station in the results: **always once closed** (so every archived year), during the competition only with "Visa poäng per kontroll under tävlingen" (`showStationResults()`) |
| Times: time on course (per day), time between stations per leg | always | same rule as above |
| Registrations per day (and running total), registration window | yes | **never** |
| Payments: fee, paid / unpaid, amount received / outstanding, payments per day | yes | **never** |

Class tabs ("Alla klasser" + each class) filter participation and stations. Points are without style (style has its own mean). Withdrawn patrols are left out of points and times, like in the results; "Bröt" counts them.

**Started** = has an `active`/`camp`/`finished` status event or any score, or has that status now. A patrol that withdrew after starting counts as started.

## 2. Times between stations

`score.scored_at` is the time a patrol was at a station: the phone's clock at the **first device report** (capped at server time, as for status events). It is null for paper and HQ entries, which are typed in afterwards and would give wrong times; a later correction (HQ or a re-sent phone report) never moves it. One write path (`writeScore`, `visitTime()`) sets it.

Per patrol and day the timed visits are put in time order; each consecutive pair is a **leg** (A → B) with the minutes between the two reports (time spent at the station is included). Legs over the night (across days) are not counted. **Time on course** = first to last timed visit of a patrol on a day. Legs walked by one patrol only are folded away ("Visa N sträckor till …").

`scored_at` contains no personal data and is **kept** by "Ta bort personuppgifter" (tested in `stats.db.test.ts`: statistics are identical before and after). Migration 0010 backfills existing device scores from their first revision's server time (the phone time was not stored before).

## 3. Fees and payments

`competition.fee_per_patrol` (whole kronor, null = no fee) is set in Inställningar → Anmälan and copied to the next year. "Betald" is still ticked by hand on Patruller (no payment integration). `patrol.paid_at` follows `paid`: set the first time it is ticked, kept when re-saved, cleared when unticked (`paidAtFor()` / `paidAtNew()` in `#lib/server/payments.ts`; every writer of `paid` uses them: the toggle, the patrol form, import).

Received = every paid patrol × fee (also one that withdrew after paying). Outstanding = unpaid patrols still in the competition × fee.

## 4. Registrations

Per Swedish calendar date from `patrol.created_at`. Imported and hand-added patrols count on the day they were added (there is no separate "registered on" for them).

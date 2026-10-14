# Brand intelligence release (features 1–6)

This release adds six features. Each one runs without paid services. Features 7–10 are specified separately and are **not** implemented here.

| # | Feature | Where |
|---|---|---|
| 1 | Configurable reference brand ("My brand") with managed **{Brand} vs Market** comparisons | Onboarding, import dialog, Brands → My brand |
| 2 | **Protect My Brand** alert pack | Alerts → Protect My Brand, Overview |
| 3 | Email delivery via Resend, with a delivery log | Settings → Notifications |
| 4 | **Monday Briefing** | `/briefing`, `/briefing/[week]`, Overview |
| 5 | Bulk editing: brand, monitoring frequency, tags | Products → select → Edit |
| 6 | Queued bulk importer | Add products (more than 25 links), `/imports` |

## 1 · Reference brand

- **The brand is workspace data.** At most one brand per workspace carries `brands.is_reference`, enforced by the partial unique index `brands_ws_reference_uq`. No brand name appears in code, defaults, queries, alerts, reports or the scheduler. The demo seed picks its brand from the fictional catalog file.
- **There are three ways to set it, all through one function (`setReferenceBrand`):**
  - the onboarding step "Which brand is yours?";
  - "This is my brand" on a product in the import dialog;
  - Brands → My brand → Change….
- **The change dialog previews the impact first** using a dry-run reconcile: comparisons created, updated or archived, and listings not yet matched. Nothing is written until you confirm.
- **Cohorts.** Tracked, visible listings are grouped by marketplace, then category, then unit basis. Within one marketplace the currency is the same, and the basis is the first measurable dimension in the order mass → volume → count → serving.
  - A cohort becomes a managed comparison group (`managed_by = 'reference_market'`) when it contains at least one of your listings and at least one competitor's. It is named `{Brand} vs Market · {Category} · {basis}`.
  - Everything else is listed under **Not yet matched**, with one of three reasons: no pack size; none of your listings in that category and unit; or no competitor in it yet.
- **Reconcile** runs after:
  - imports;
  - brand, archive, tracking or quantity changes;
  - bulk edits;
  - the end of each bulk import.

  It holds a per-workspace advisory lock and is idempotent. Cohorts that stop qualifying are **archived, never deleted**, so their history and alerts are kept.
- **Managed comparisons can't be renamed, re-based or archived by hand.** "Remove" excludes a listing from the calculations (it is marked unconfirmed) rather than deleting it.

## 2 · Protect My Brand

Turning the pack on creates four managed rules for each managed comparison. Each rule is keyed by `alert_rules.managed_key`, so enabling the pack twice never creates duplicates.

| Rule | Fires when |
|---|---|
| `competitor_undercut` | A competitor's unit price falls below your best unit price (each new set of undercutters fires once). |
| `price_leadership_change` | The **brand** holding the lowest unit price changes. The first evaluation only records the current leader. |
| `reference_out_of_stock` | One of your listings goes from a **known** available state to `out_of_stock`. Unknown availability never counts. |
| `rival_drop_5pct` | A competitor's price falls 5% or more between **two consecutive observations** of the same provenance and currency. |

- **Cooldown:** 24 hours for each rule and listing (each rule and comparison for leadership changes).
- **Dedupe:** persistent, via `alert_events (rule_id, dedupe_key)`.
- **Turning the pack off** pauses the rules and keeps their history.
- **When a comparison is archived,** its rules are auto-paused, and they resume if the comparison comes back.
- **Managed rules can't be deleted one by one.**
- **Email:** the rules include email when the workspace's email switch is on.

## 3 · Email (Resend)

- **Every message is logged before sending.** Each one becomes a `notification_deliveries` row first, with a deterministic idempotency key that is also sent to Resend as `Idempotency-Key`.
- **Claiming:** a row is claimed (`pending → sending`) before it is sent, so concurrent workers can't both send it.
- **Retries:**
  - Transient failures (network, 429, 5xx) retry after 1 minute, 5 minutes, 30 minutes and 2 hours, up to 4 attempts.
  - Permanent failures fail at once.
  - A final failure adds an in-app notice.
- **Quiet hours hold an email until they end.** Previously such emails were dropped.
- **Modes** are shown honestly in Settings → Notifications:

  | Mode | When |
  |---|---|
  | **live** | Resend key set, and the sender isn't `@example.com` |
  | **dry run** | `EMAIL_DRY_RUN=true`, or tests |
  | **not configured** | No key or no real sender. Rows are recorded as "not sent", with the reason |

- **A test email goes only to the person who asked for it.**
- **Simulated (demo) data is never emailed,** except an explicit test.
- **Templates** (`src/server/notifications/templates.ts`) produce both text and HTML, escape all dynamic text, and label simulated and test messages.

## 4 · Monday Briefing

- **Period:** the previous Monday 00:00 to the next Monday 00:00 in the workspace's time zone (`Asia/Kolkata` by default). The calculation is DST-safe and lives in `src/lib/week.ts`.
- **Storage:** one stored briefing per workspace and week (`briefings`, unique on `workspace_id, week_start`).
  - Generating it again returns the stored copy.
  - **Rebuild** recomputes it in place and increments the version.
- **Data rules:**
  - Only stored observations are used.
  - A price "at" a moment is the last observation at or before it, and only if it is no more than 72 hours old. Otherwise it is shown as missing. It is never zero and never interpolated.
  - Changes are measured only between observations of the same provenance and currency.
- **Sections:**

  | Section | Content |
  |---|---|
  | A | Summary |
  | B | Your position in each managed comparison, start vs end of week. The change is in percentage points |
  | C | Movers |
  | D | Undercuts and leadership |
  | E | Every drop of 5% or more between consecutive checks |
  | F | Daily index |
  | G | Data confidence |

- **Scheduling:** the BullMQ worker runs it hourly and `worker:once` on every run. Both build each workspace's missing briefing once, then do nothing.
- **Email:** sent once per member and week, only if the workspace opted in and the data is real.

## 5 · Bulk editing

`POST /api/bulk` handles three actions:

- `brand`: products (families);
- `frequency`: variants;
- `tags`: products, with add, remove or replace. Tags are de-duplicated case-insensitively and capped at 12.

The response is `{ requested, updated, skipped[], failed[] }`, with a reason for every skipped or failed item. IDs from another workspace fail; they are never touched. A brand change re-reconciles the managed comparisons.

## 6 · Bulk importer

- **Storage:** `import_jobs` and `import_job_items` store every link. Invalid links and duplicates are settled when the job is queued.
- **Processing:** links are processed **25 at a time** (`processNextChunk`) under a 2-minute job lease. The open progress page, the BullMQ worker (every minute) and `worker:once` can all drive a job safely. Links left in progress by a crash return to the queue after 5 minutes.
- **Variant policy:**
  - **Just that listing** is the default: one provider lookup per link.
  - **Every size & flavour** adds variant discovery.
- **Errors:**
  - Transient provider errors re-queue a link, up to 3 attempts.
  - If the provider's budget is exhausted, the job pauses and shows the reason.
- **Controls:** pause, resume, cancel, and retry failed. Retry only appears when some failures can actually be retried.
- **Export:** CSV with every cell quoted, and formula-looking values neutralised.
- **Limits:** a job accepts up to 20,000 links. Larger lists can be split into several jobs.

## Database migration `0002_brand_intelligence`

The migration is **additive only**. It creates new enums, new values on the `alert_type` enum, new tables (`briefings`, `import_jobs`, `import_job_items`, `notification_deliveries`), new nullable or defaulted columns, and new indexes. It doesn't drop, rename, rewrite or backfill anything.

Code that predates this release keeps working against the migrated schema, so the safe order is **migrate first, then deploy**.

## Production release checklist (each step needs explicit approval)

1. **Back up the production database first.** Create a Neon branch or snapshot of production, or confirm that point-in-time restore covers now.
2. **Run a read-only pre-check**; it must return no rows. The partial unique index would fail if any workspace already had two reference brands:
   ```sql
   select workspace_id, count(*) from brands where is_reference group by 1 having count(*) > 1;
   ```
3. **Apply the migration deliberately.**
   > ⚠️ The **Hourly monitoring** GitHub workflow runs `pnpm db:migrate` against the production `DATABASE_URL` every hour from the default branch. **Merging to `main` therefore applies this migration automatically within an hour.**

   Either:
   - run `pnpm db:migrate` yourself against production at a chosen time before merging; or
   - temporarily set `AISLE_SCHEDULED_MONITORING=false`, merge, migrate, then turn it back on.
4. **Verify after migrating:**
   - `select count(*) from briefings` returns 0;
   - `\d alert_rules` shows `managed_key` and `state`.
5. **Deploy the web app** (a Vercel production deployment).
6. **Email (optional):**
   - Add `RESEND_API_KEY` and a verified-domain `EMAIL_FROM` to Vercel and to GitHub Actions secrets and variables.
   - On a staging or preview environment, set `EMAIL_DRY_RUN=true` first.
   - Then use **Settings → Notifications → Send test email**.
7. **In production, tell Aisle which brand is yours** (Brands → My brand). Existing workspaces that already marked a reference brand keep it. Their managed comparisons are built on the next import or brand change, or straight away from Brands → Change… → confirm.
8. **Turn on Protect My Brand** where you want it. Nothing turns on by itself.
9. **Watch the first hourly run's log** for `Monday Briefing: built …`, `email deliveries: …` and `bulk imports: …`.

## Rollback

- **Application:** redeploy the previous Vercel deployment. The schema is backwards compatible.
- **Schema:** the new tables and columns can stay in place harmlessly. To remove them, do it manually in a maintenance window: drop the new tables, columns and indexes. Enum values can't be removed without recreating the type, and they don't need to be.

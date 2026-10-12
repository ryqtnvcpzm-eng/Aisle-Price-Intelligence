# Database

PostgreSQL 14+ via Drizzle ORM. The schema lives in `src/server/db/schema.ts`, and migrations are in `drizzle/`. Apply them with `pnpm db:migrate`; generate new ones with `pnpm db:generate`.

## Shape

```
user ─┬─ session / account / verification          (Better Auth)
      └─ workspace_members ── workspaces
                                 │
     ┌───────────────────────────┼────────────────────────────────────────┐
  brands  categories   product_families ── variants ── variant_quantities │
                                 │            │                           │
                    comparison_groups ── comparison_items                 │
                    alert_rules ── alert_events      notifications         │
                    saved_views   report_definitions ── report_runs        │
                    activity_logs                                          │
     └────────────────────────────────────────────────────────────────────┘
                                              │ variants.listing_id
   Shared catalog (polled once for every workspace):
   listings ── price_observations
          └── offers ── sellers
   Operations: monitoring_jobs · provider_requests · provider_quotas · fx_rates · cache_entries
```

## Tables

| Table | Purpose | Key constraints and indexes |
|---|---|---|
| `workspaces`, `workspace_members` | Tenancy. Roles: owner, admin, analyst, viewer | PK (workspace, user) |
| `listings` | One Amazon listing (marketplace + ASIN), shared across workspaces. Holds the schedule (`check_interval_minutes`, `next_check_at`) and the latest snapshot | unique (marketplace, asin); partial index on `next_check_at` where monitored |
| `price_observations` | Append-only price history in minor units, with basis, stock, list and deal prices, the provider's timestamp and `is_simulated` | unique (listing, observed_at, provider), so re-delivered jobs are idempotent; (listing, observed_at desc) |
| `offers`, `sellers` | Current offers per listing | unique (marketplace, seller_id) |
| `product_families`, `variants` | A workspace's view of a product and its variations (tracked, hidden, interval, favorite, tags) | unique (workspace, marketplace, family_key); unique (workspace, listing) |
| `variant_quantities` | Normalized quantities in milli-base units, with confidence and matched text | unique (variant, dimension) |
| `brands`, `categories` | Per workspace; at most one reference brand | unique (workspace, slug) |
| `comparison_groups`, `comparison_items` | Comparisons with basis, reference, role (reference or competitor) and status (confirmed or suggested) | unique (group, variant) |
| `alert_rules`, `alert_events`, `notifications` | Rules, deduplicated events, inbox | unique (rule, dedupe_key) |
| `monitoring_jobs` | Every refresh batch: kind, status, listings, observations written, error | unique `idempotency_key` |
| `provider_requests`, `provider_quotas` | Per-call accounting and monthly counters; also the source of "verified live" | (provider, created_at) |
| `report_definitions`, `report_runs`, `saved_views`, `activity_logs` | Reports, saved library views, audit trail | (workspace, created_at desc) |
| `cache_entries` | Key/value cache with expiry, used when Redis isn't configured (e.g. the worker heartbeat) | PK key |

## Conventions

- **Money** is `integer` minor units plus an ISO currency. Never floats.
- **Quantities** are `integer` milli-units (mg, µL, milli-count).
- **Time** is stored as `timestamptz` in UTC. Raw `sql` templates must receive ISO strings, not `Date` objects (a postgres.js limitation), or use Drizzle builders.
- **Simulated data** carries `is_simulated = true` all the way through to exports.
- **Retention:** observations older than `OBSERVATION_RETENTION_DAYS` are deleted by the daily maintenance task. Request logs are kept 90 days and activity 365.

## Seed data

`pnpm db:seed` creates `demo@aisle.app`, a public demo login with simulated data only. It contains:

- 11 fictional product families;
- **28 variants: 27 monitored hourly, plus 1 paused on purpose** (the second Fernleaf serum size) so the paused state is demonstrable;
- about 14,800 simulated observations with deliberate gaps;
- comparison groups and alert rules.

So a monitoring pass refreshes 27 listings: 23 on amazon.in, 3 on amazon.com and 1 on amazon.co.uk. The dashboard shows "27 of 28 · 1 paused", linking to the **Paused** filter.

`pnpm db:seed --force` rebuilds the demo workspace.

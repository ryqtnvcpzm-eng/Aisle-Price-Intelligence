# Architecture

```
Browser ── Next.js 16 App Router (RSC + client islands, proxy.ts auth gate)
              │  server components read via src/server/* (never from the client)
              │  route handlers under /api/* (CSRF origin check + rate limit in handle())
              ▼
         src/server ── catalog · comparison · analytics · insights · ml · alerts · reports
              │                       │
              ▼                       ▼
      PostgreSQL (Drizzle)      DataProvider adapters (demo · Amazon Creators API)
              ▲
              │  due listings → refresh jobs → observations → alerts
   Monitoring: BullMQ worker (REDIS_URL set)  or  `pnpm worker:once` on a schedule (free hosting)
```

## Stack

| Layer | Choice |
|---|---|
| Web framework | Next.js 16.4 App Router, React 19.3 (`<ViewTransition>` for the product image morph), TypeScript strict with `noUncheckedIndexedAccess` |
| UI | Tailwind v4 with CSS-variable tokens, Radix primitives, Motion 12, cmdk, sonner, Recharts 3, TanStack Table / Query |
| Data | PostgreSQL via Drizzle ORM 0.45 and postgres.js; migrations in `drizzle/` |
| Auth | Better Auth 1.7 (email + password); a workspace is provisioned on sign-up; optional `SIGNUP_ALLOWLIST` |
| Jobs | BullMQ 5 + Redis when available; otherwise a Postgres-backed cache and scheduled `worker:once` |
| Local ML | `simple-statistics`, `ml-kmeans`, `tiny-tfidf` (all MIT/ISC, pure JS) |
| Exports | CSV, XLSX (exceljs), PDF (pdfkit with bundled Geist fonts, which include the ₹ glyph) |

## Source layout

```
src/
  app/                 routes: (auth) sign-in/up · welcome (onboarding) · (app) product screens · api/*
    (app)/(overview)   dashboard (its own route group, so it gets its own loading boundary)
    (app)/products/(list)  library list (group keeps /products/[id] free of a loading boundary,
                           which preserves the shared-element morph)
  components/          ui primitives · shell · motion tokens · feature components
  lib/                 client-safe domain logic: money, quantity, analytics, comparison, URL parsing
  server/              server-only services (import "server-only")
    catalog/ comparison/ analytics/ insights/ ml/ alerts/ reports/ monitoring/ providers/
worker/                index.ts (BullMQ) · run-once.ts (scheduled mode)
scripts/               migrate · seed · reset · screenshots
tests/                 unit · components (jsdom) · integration (Postgres) · e2e (Playwright)
```

## Core domain decisions

- **Money is integer minor units** (paise, cents). Half-up rounding uses BigInt `divRound`. Currencies are never converted or mixed; cross-marketplace views compare percentage changes.
- **Quantities are integer milli-base units** (mg, µL, milli-count). Unit prices are normalized per 100 g, per kg, per 100 ml, per unit, per serving and so on, and every quantity records its confidence (provider, parsed, manual).
- **Shared catalog, private workspaces.** `listings` (marketplace + ASIN), `price_observations` and `offers` are polled **once** across all workspaces. Families, variants, groups, alerts and reports are workspace-scoped.
- **Four clocks** for freshness: when Aisle requested, when the provider says it updated, when Aisle observed it, and render time. Freshness states are verified, provider_stale, pending, failed, paused and unavailable.
- **Prices are step functions and are never interpolated.** A reading is trusted for `max(maxGap, 2.5 × local cadence)`, capped at 3 days. Longer gaps break the line. Statistics are time-weighted.
- **Rule-based insights + local ML.** Findings are computed deterministically from stored observations, and every insight carries its window, numbers, evidence and method:
  - robust z-score anomalies;
  - least-squares trends with an R² guard;
  - autocorrelation promotion cycles;
  - seeded k-means brand segments;
  - TF-IDF title similarity for comparison suggestions.

  The "Brief me" summary is assembled from these findings. An AI model is optional and only rewords it.

## Monitoring pipeline

1. `scanDueListings` picks listings whose `next_check_at` has passed, grouped by provider and marketplace.
2. `checkBudget` refuses batches the provider can't currently serve.
3. A `monitoring_jobs` row is written with an idempotency key, so a re-delivered job is a no-op.
4. `runRefreshJob` fetches, writes observations, upserts offers and sellers, records change activity and evaluates alert rules.
5. On a final failure, `next_check_at` backs off exponentially. Quota errors pause the provider.

**With Redis**, the BullMQ worker (`pnpm worker`) runs repeatable schedulers:

- scan every 5 minutes;
- system alerts hourly;
- maintenance and scheduled reports daily.

It writes a heartbeat every 30 s.

**Without Redis** (free hosting), `pnpm worker:once` performs the same steps in one pass, and `--daily` adds the daily tasks. It is triggered by `.github/workflows/monitor.yml`, and the UI accepts a two-hour heartbeat window in this mode. Manual refreshes run inline in the request.

## Security

- Short links (`amzn.to`, `a.co`, …) are resolved server-side with HEAD requests and manual redirects. Only an exact-host Amazon allowlist is followed, with at most 5 hops and a 5 s timeout. This prevents SSRF.
- Every mutating API route goes through `handle()`: a same-origin check (CSRF), an in-memory rate limit, Zod validation and workspace scoping.
- Secrets exist only in `src/server/env.ts`, which is Zod-validated and guarded by `server-only`. They are never sent to the client and are stripped from logged URLs.
- Production refuses to boot with the development auth secret.

## Testing

| Suite | Scope |
|---|---|
| `tests/unit` (Vitest, node) | Money, quantity parsing, analytics, comparison, freshness, URL parsing, short-link resolution, providers (fixtures), ML detectors, briefing, allowlist, DB URL handling |
| `tests/unit/*.test.tsx` (jsdom + RTL) | UI primitives and the product image loading state machine |
| `tests/integration` (Postgres) | The full journey through services: import → comparison → refresh → alerts → reports. Also run without Redis in CI |
| `tests/e2e` (Playwright) | Sign-up → onboarding import → comparison → history → alert → refresh → export; palette; errors; mobile; axe accessibility |

Visual and motion QA is a separate, manual-plus-scripted process described in [QA_REPORT.md](QA_REPORT.md).

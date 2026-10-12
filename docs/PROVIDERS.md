# Data providers

Aisle never scrapes Amazon. Every price comes through a `DataProvider` adapter (`src/server/providers/types.ts`). Only **free** sources are integrated.

| Provider | Cost | What works | Verification status |
|---|---|---|---|
| **Demo** (`demo`) | Free | Everything: details, variations, offers, history, search, quota, scheduled monitoring | Exercised end to end by unit, integration and E2E tests |
| **Amazon Creators API** (`creators`) | Free with an approved Amazon Associates account | Details, variations, current offers, search. Monitoring only with operator acknowledgement (see below). No historical prices. | **Fixture-tested only. Not yet verified against a live account.** |

`DATA_PROVIDER=auto` picks the Creators API when its four credentials are set, and demo mode otherwise.

## What "verified" means here

There is a clear difference between code that is tested and an integration that is proven:

- The **demo provider** is fully tested. The whole product journey runs against it: unit and component tests, integration tests against Postgres, and Playwright E2E tests including accessibility checks.
- The **Creators API adapter** follows Amazon's published contract:
  - `POST https://creatorsapi.amazon/catalog/v1/{getItems,getVariations,searchItems}` with an `x-marketplace` header;
  - an OAuth client-credentials token from a credential-version-specific endpoint (Cognito for 2.x, Login with Amazon for 3.x).

  Its request building, response mapping and error mapping are covered by tests against **synthetic fixtures** shaped like the documented responses (`tests/fixtures/creators-getitems.json`). It has **not** been run against real credentials and real responses. Field names or edge cases may differ in practice.

The app is honest about this at runtime:

- **Settings → Data providers** labels a real provider **"Not yet verified live"** until `provider_requests` contains a successful response from it in this deployment. After that, it shows **"Live responses since <date>"**.
- The toolbar's monitoring popover shows **"Live · unverified"** instead of "Live data" until then.
- **Test connection** authenticates and runs a real lookup, so it's the quickest way to verify.

## Demo provider

`src/server/providers/demo/`

- **Catalog:** a fictional catalog of 11 product families from fictional brands (Lumen Nutrition, Northfield Labs, Pureform, Kinetic Basics, Daily Root, Fernleaf, Arcwave). ASINs follow the pattern `B0AISLE###`. Images are generated SVG illustrations served from `/demo-images`.
- **Prices:** deterministic. They are simulated in 2-hour epochs, with charm pricing (₹999, not ₹1,003), promotions, stock-outs and a few deliberate gaps.
- **Labelling:** every simulated value is marked as simulated in the database (`is_simulated`), in the UI ("Sim" and "Simulated" badges) and in every export. Simulated events are never emailed.
- **Unknown ASINs:** a real ASIN pasted in demo mode imports as `Demo listing · <ASIN>` with simulated prices, never invented product details.
- **Failure testing:** `DemoProvider.simulateFailure("quota_exhausted" | "upstream")` makes the next call fail, so tests can exercise retries, backoff and quota pauses.

## Amazon Creators API

`src/server/providers/creators/`

**Environment variables:**

| Variable | Meaning |
|---|---|
| `CREATORS_API_CREDENTIAL_ID`, `CREATORS_API_CREDENTIAL_SECRET` | OAuth client credentials from Associates Central |
| `CREATORS_API_CREDENTIAL_VERSION` | Selects the token endpoint (`2.1`–`2.3` Cognito, `3.1`–`3.3` Login with Amazon) |
| `CREATORS_API_PARTNER_TAG` | Your Associates store ID |
| `CREATORS_API_LICENSE_ACK` | `true` enables scheduled monitoring and price storage |

**Lookup-only by default.** The Associates program governs how product data may be stored and displayed. Unless the operator sets `CREATORS_API_LICENSE_ACK=true` after confirming that their agreement allows it, `capabilities.monitoring` is false. In that mode Aisle uses the API for import previews and variation discovery, and does not keep scheduled price history.

**No price history.** The Creators API returns current offers only, so history starts from the first observation Aisle stores. Charts never backfill or interpolate missing periods.

**Errors** map onto `ProviderError` kinds, which drive retries and backoff:

| Response | Kind | Retried? |
|---|---|---|
| 429 | `rate_limited` | Yes, with a retry-after hint |
| 401 / 403, or a token-endpoint failure | `auth` | No |
| Timeout | `timeout` | Yes |
| Other HTTP failure | `upstream` | Yes |
| Marketplace without a `creatorsMarketplace` mapping | `unsupported` | No |

## Request accounting and safeguards

Every provider call is recorded in `provider_requests`: operation, item count, status, HTTP status, duration and remaining allowance. Monthly counters live in `provider_quotas`.

`checkBudget()` refuses a monitoring batch when:

- the provider has asked Aisle to back off (`pausedUntil`);
- a stored monthly cap would be exceeded; or
- the last reported allowance can't cover the batch.

On the final failed attempt, a refresh job applies exponential backoff to that listing's `nextCheckAt`. A quota error also pauses the provider.

## Adding a provider

1. Implement `DataProvider`: `getProducts`, `getVariations`, optional `searchProducts`, `getQuotaStatus` and `diagnose`, plus `capabilities` and `supportsMarketplace`.
2. Map provider errors to `ProviderError` kinds; that alone gives you retries and backoff.
3. Register it in `src/server/providers/index.ts`.
4. Add fixture-based tests, and document its verification status here until it has been exercised with real credentials.

# Price capture (bookmarklet)

The owner opens an Amazon.in product page in their own browser and clicks the **Aisle capture** bookmarklet. It reads that one page's DOM, shows a small toast, and posts the reading to Aisle.

This is the only path by which Aisle receives real Amazon prices.

- **Aisle never fetches Amazon.** There is no server-side request to Amazon, no headless browser, no scheduled job and no proxy anywhere in this feature.
- **One page, one click.** The bookmarklet never runs on its own and never opens other pages.

## Pieces

| Piece | Where |
|---|---|
| Bookmarklet source and extractor | `src/lib/capture/bookmarklet.ts` |
| Endpoint | `POST /api/capture` (`src/app/api/capture/route.ts`) |
| Recording service | `src/server/capture/service.ts` |
| Tokens | `src/server/capture/tokens.ts`; `GET`, `POST` and `DELETE /api/capture/token` |
| Settings page | Settings → Price capture (`/settings/capture`) |
| Fallback window | `/capture/receive`, used when a page's security policy blocks the request |
| Badges | `CapturedBadge` and `PriceOriginBadge` (`src/components/ui/status.tsx`) |

## Extraction

| Field | How it is read |
|---|---|
| ASIN | Path `/dp/<ASIN>`, `/gp/product/<ASIN>` or `/gp/aw/d/<ASIN>`. Falls back to the `#ASIN` or `input[name=ASIN]` value. |
| Title | `#productTitle`, trimmed. |
| Price | The first selector that holds a single parseable price, tried in this order: `#corePrice_feature_div .a-offscreen`, `#priceblock_ourprice`, `#priceblock_dealprice`, `.a-price.a-text-price .a-offscreen`. |
| Deal | The `#priceblock_dealprice` selector matched, or a deal badge is present. |
| Variant | The selected `#variation_* .selection` texts, falling back to the inline twister labels. |
| Availability | `#availability span` text. |

- **Price parsing:**
  - The price is converted to paise. Indian digit grouping is supported (`₹1,29,999.00` → `12999900`).
  - Ranges such as `₹199 – ₹499` are rejected rather than guessed.
- **The selector that matched is recorded** with each capture.
- **No price on the page** (out of stock, or an overlay): the bookmarklet still posts, with `priceMinor: null` and the availability text, and says so in the toast.
- **The toast** uses `textContent` only. Page text is never inserted as HTML.
- **Tests:** the bookmarklet is unit-tested against six fictional Amazon.in-shaped fixtures (`tests/fixtures/amazon-in/`). The tests evaluate the exact source string that ships in the bookmark.

## Endpoint

Request body:

```
{ asin, title, priceMinor, currency, url, variantLabel, availability, capturedAt, selector, isDeal }
```

**Validation:**

- `asin` must match `^[A-Z0-9]{10}$`.
- `priceMinor` is a non-negative integer, or null.
- `currency` must be `INR`.
- `url` must be an `https://…amazon.in/` page.
- `selector` must be one of the four selectors above.

**Authentication:** `Authorization: Bearer aisle_cap_…`

- **Tokens:** 256 random bits, shown once. Only the SHA-256 hash is stored.
  - There is one active token per person and workspace. Regenerating revokes the old one.
  - Viewers can't hold one.
- **No cookies are read on the bearer path.**
- **CORS:** only `https://*.amazon.in` origins are allowed.
- **Same-origin requests** from `/capture/receive` use the signed-in session instead, and need an explicit "Record capture" click. A crafted link therefore can't record anything on its own.
- **Limits:** 30 requests a minute per token or user, and a 16 KB body.

**Responses:**

| Case | Response |
|---|---|
| Matched | `200 { capture: { status: "recorded" \| "duplicate", variantId, familyId, variant, observedAt, duplicate } }` |
| Untracked | `404 { error: "untracked_asin", asin, importUrl }` |

- **Matched:**
  - The reading is written to `price_observations` with `source = "user-capture"`, `provider = "capture"`, `is_simulated = false` and `provider_updated_at = capturedAt`.
  - If the browser clock is more than 10 minutes off, the server's time is used instead.
  - The same price and availability seen again within 2 minutes is logged as a duplicate rather than recorded twice.
  - Every request is logged in `price_captures`.
- **Untracked:** `importUrl` opens the existing importer, prefilled through `/products?import=<link>`. Nothing is imported until you confirm.

## Keeping simulated and captured apart

- **The current price keeps its provenance.** Listings carry `current_source` and `current_is_simulated`, and a **simulated reading never replaces a captured current price**.
- **Comparisons are like with like.**
  - 24 h, 7 d, 30 d and 90 d changes, lowest seen, and alerts compare only observations of the same provenance as the current price.
  - Alerts don't fire across a simulated↔captured switch.
- **Captures stay off the monitored line.** History charts draw them as separate accent ◆ markers, with "Captured <time>" in the tooltip.
- **Badges:**
  - `CapturedBadge` (solid accent) replaces `SimulatedBadge` (soft amber) wherever the shown price was captured: library grid and table, the product header, the "From" price, variant rows and the chart table.
  - A product with both kinds of variant shows both badges. Each row shows exactly one.

## Shared catalog: a decision for you

Listings and observations are shared between workspaces that track the same ASIN on the same marketplace. That is the existing catalog design.

- A capture is therefore visible in **every workspace tracking that listing**. That includes the public demo workspace, if someone imports the same real ASIN there.
- The `price_captures` log and the activity entry are per workspace.
- If you want captures private to one workspace, that is a follow-up: a workspace-scoped observation overlay.

## Amazon's terms

Amazon's Conditions of Use restrict automated data extraction.

This feature is a manual, user-initiated helper that reads a page the user already has open. It does not fetch, crawl or schedule anything. Whether that use fits Amazon's terms for your account is your call.

## Database migration `0003_price_capture`

The migration is **additive only**:

- a new enum value `observation_source = 'user-capture'`;
- new tables `api_tokens` and `price_captures`;
- two nullable columns on `listings`;
- foreign keys and indexes.

Nothing is dropped, rewritten or backfilled. `current_*` columns that are null fall back to `listings.is_simulated`.

### Production release (each step needs explicit approval)

1. **Back up first.** Create a Neon branch of production, run `pnpm db:migrate` against the branch, and verify:
   ```sql
   select enum_range(null::observation_source);
   \d api_tokens
   ```
2. > ⚠️ **The Hourly monitoring workflow (`monitor.yml`) runs `pnpm db:migrate` against production from the default branch.** Merging to `main` therefore applies this migration within the hour.

   Migrate deliberately before merging, or pause `AISLE_SCHEDULED_MONITORING` around the merge.
3. **Deploy the app.** Make sure `BETTER_AUTH_URL` is the public `https://` URL. The bookmarklet posts there, and Amazon pages can't reach `http://` addresses (they fall back to the pop-up window).
4. **Install the bookmarklet:** Settings → Price capture → Generate token → drag **Aisle capture** to the bookmarks bar.

### Rollback

- **Application:** redeploy the previous build. The schema is backwards compatible.
- **Schema:** the new tables and columns can stay. The enum value can't be removed without recreating the type, and it doesn't need to be.

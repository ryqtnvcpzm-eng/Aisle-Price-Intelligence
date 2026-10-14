# Visual and motion QA report

A passing build, typecheck and test suite does not prove a design is finished. This report covers two separate refinement passes made by **driving the real production build in Chromium**. They went beyond screenshots: per-frame capture, runtime metrics and CPU profiles.

## Method

The harness was Playwright with the Chrome DevTools Protocol.

- **Frame capture:** `Page.startScreencast` records every compositor frame with its timestamp during each interaction. The frames were assembled into time-labelled contact sheets and reviewed frame by frame.
- **Runtime metrics**, gathered on separate runs without capture, because JPEG encoding distorts frame timing:
  - `requestAnimationFrame` interval percentiles;
  - `layout-shift` entries with their source nodes;
  - `long-animation-frame` entries.
- **CPU profiles** (`Profiler.start`) for any interaction with a long frame.
- **Coverage:**
  - 48 scripted segments across sign-up, onboarding, the import sheet, comparison views, library → detail → back, history ranges, refresh, the compare tray, the palette, the sidebar, popovers and every route;
  - every screen in light and dark at 1440 × 900, tablet (1024 × 1366) and phone (390 × 844);
  - loading, error and not-found states, the error state forced by stopping Postgres mid-session.
- **Console errors** across all runs: none.

## Pass 1: motion and continuity

| # | Finding (evidence) | Root cause | Fix | Result |
|---|---|---|---|---|
| 1 | Page text ghosted through the import sheet for ~300 ms as it opened (frames 150–320 ms) | Opacity rode the panel spring, so the fade crawled | Springs move geometry; opacity uses a 100–180 ms tween, applied at the token level | Solid within 100 ms |
| 2 | Lookup → preview and commit → success showed both phases at once, and the sheet height snapped | `AnimatePresence mode="popLayout"` crossfades; no height animation | Sequential swaps with 100 ms exits, a new `AutoHeight` primitive, and the footer swapping in step | Clean swaps; height morphs. CLS 0.023 → 0.008 |
| 3 | The page was blank for ~400 ms while the product image morphed into the detail page | Three stacked fades: view-transition root, page template (300 ms), and a delayed header spring | One quick crossfade: 140 ms out / 200 ms in, a 160 ms template, no extra delay | Title and price present at 256 ms |
| 4 | Back navigation flashed grey skeletons on cached images | Complete images settled via async `decode()`, a frame after paint | Settle synchronously in the ref callback; a distinct `cached` state with no fade | No flash |
| 5 | Switching the comparison to **Timeline** blocked the main thread for **826 ms** | Profile: Recharts' JS line animation (`animationInterpolateFn`, `getTotalLength`) re-rendering ~1,037 rows per frame; only 22 actual price changes | Paint-only CSS line reveal; render rows compressed to change points plus a 240-point hover grid | **826 → 108 ms** |
| 6 | The **Visual** view sat empty for ~220 ms, then bars took until ~1.2 s | Slow exit before mount; Recharts JS bar animation | 80 ms exit; bars grow via CSS `scaleX` from the zero line with an 18 ms stagger | Bars at ~400 ms, settled by ~760 ms |
| 7 | The command palette list jumped ~300 ms after opening | Async product results were inserted above Actions | With an empty query, suggestions append after Actions and Go to | Stable highlight |
| 8 | Product images bled through the palette | The palette used the standard glass | New `.material-thick` tier | Legible |
| 9 | The monitoring dot pinged forever | `animate-ping` was infinite | One pulse per new refresh | Calm |

**Hypotheses tested and rejected.** App pages first measured at ~30 fps. Toggling the ping animation and the backdrop blurs changed nothing, because idle pacing was already 60 fps. The 30 fps came from the screencast's own encoding cost. All metrics were re-taken without capture: every flow holds a **16.7 ms median frame**.

## Pass 2: states, hierarchy, responsive

| Area | Finding | Fix |
|---|---|---|
| States | No `loading.tsx`, `error.tsx` or `not-found.tsx` existed. Cold-database navigations gave no feedback, errors fell through to the framework default, and 404s were unstyled | Layout-matched `PageSkeleton` (appears after 120 ms); in-shell error boundary with Next 16's `retry` (verified by stopping Postgres and recovering); designed 404s. Overview and the library list moved into route groups so `/products/[id]` keeps its morph |
| Insights | Evidence showed raw ISO timestamps and minor units ("44900"); a "trended down" card used an up arrow; fitted values had false precision (₹1,803.84) | Formatted money, percentages and local dates; direction-aware icon; whole-unit estimates |
| Brands | "No overlap" brands interleaved with bars; "100% discounted" on every segment (Indian listings always sit below MRP); truncated brand-vs-brand headers; brand name repeated in its own product list | Sorted rows with no-data rows muted last; discount shown only when informative; full names with colour dots; prefix stripped |
| Settings | Seven cells in a four-column grid (an empty block); "1 listings"; env-var names as values; AI briefings filed under exports | 3 × 2 grid; plurals; env vars moved into hints; a dedicated Insights section |
| Dark mode | Dark-theme amber "Sim" badge on light image tiles was illegible | Fixed light-tile badge colours; tiles dimmed slightly |
| Phone | Detail tabs wrapped onto two lines; filter pills clipped with no affordance; product titles took four lines | Single-line scrolling tabs and pills with edge fades; 22 px balanced titles |
| Tablet | "All marketplaces" wrapped in the toolbar; brand names truncated on cards | Icon-only control below `xl`; flag-only tags |

E2E (14/14, including axe) passed after these changes.

## Image loading investigation

The question was whether cached images complete before React attaches `onLoad`. **Yes, and the original mitigation still left a worse bug.**

- Reproduced at 8× CPU throttling: on **6 of 6** cached reloads, all 11 decoded product images were still invisible 1.5 s in. They appeared only once hydration finished.
- **Cause:** visibility was gated on JavaScript. Server-rendered images started at `opacity: 0`.
- **Fix:** a per-`src` state machine in `ProductImage`:
  - server-rendered images are visible without JS;
  - client-created images fade in;
  - images that completed before the handler was attached are settled in a ref callback before paint: synchronously when decoded, through `decode()` when `naturalWidth` is 0 (SVG);
  - errors show a placeholder;
  - a new `src` resets state and retries;
  - the element is keyed by `src`, so late callbacks from an older source are ignored.
- **After:** 6 of 6 throttled reloads show every image at 1.5 s.
- **Tests:** 8 component tests (load, cached, broken, error, source change with retry, stale callbacks, no image).

## Tracking consistency: 28 variants vs 27 observations

The seed **pauses one variant on purpose** (the second Fernleaf serum size) to demonstrate the paused state. The database confirms:

- 28 tracked variants; 27 listings with a schedule; 1 paused.
- Every scheduled pass refreshes exactly **23 (IN) + 3 (US) + 1 (GB) = 27** listings, writing 27 observations.

This was intended behaviour, but the UI didn't explain it. The dashboard now reads **"27 of 28 · 1 paused"** and links to a new **Paused** library filter. The seed log states it too.

## Demo vs real-provider status

- **Tested end to end:** the demo provider, through unit, integration, E2E and this QA.
- **Not verified live:** the Amazon Creators API adapter is fixture-tested only, so the app labels it **"Not yet verified live"** / **"Live · unverified"** until a real successful response is recorded. See [PROVIDERS.md](PROVIDERS.md).

## Brand intelligence release (features 1–6): two passes

Driven against the production build: desktop light and dark at 1440 × 900, and a phone at 390 × 844 (the mobile E2E uses a Pixel 7 at 412 px). It covered every new screen and dialog, with console errors captured on each step.

| Pass | Finding | Fix |
|---|---|---|
| 1 | The My brand cards said "0 listings" for every comparison | The count's correlated subquery rendered an unqualified column. It is now a grouped join, and a test asserts the count |
| 1 | Briefing index end labels overprinted when both series ended near 100; the y-axis tick "100.4" was clipped | Labels nudge apart when close; ticks are integers |
| 1 | Premium changes read "▲ 54%" and "up 54%", which is a percent of a percent | Shown in percentage points ("▲ 53.6 pts") |
| 1 | Drop dates read "11 Sun" | "Sun 11 Oct", in the briefing's time zone |
| 1 | With many brands, the change-brand dialog pushed the impact preview below the fold | The brand list scrolls on its own |
| 1 | "Retry failed" was offered when the only failures were invalid links (retrying would error) | Shown only when failures are retryable; the count is in the label |
| 1 | The briefing's position table scrolled sideways on phones | Stacked layout below `sm` |
| 2 | React hydration error #418 on `/briefing` | Node's and Chrome's ICU disagree ("Sun 11 Oct" vs "Sun, 11 Oct", "Sept" vs "Sep"). Week and day labels are now built from numeric parts and fixed names, with unit tests |
| 2 | The mobile E2E caught `/history` at 496 px on a 412 px screen: long managed comparison names widened its select | Selects can't exceed their container |
| 2 | The "Not yet matched" hint wrapped badly on phones | Hidden below `sm` |

After the fixes: no console errors on any step in any mode, 21 of 21 E2E tests pass (including axe on `/brands`, `/briefing`, `/alerts`, `/imports` and `/settings`), and the overflow check passes on every route.

## Known limitations

- Headless Chromium uses software rasterization, so blur costs measured here are pessimistic. Real GPUs are faster.
- Line reveals apply a `clip-path` per path. On very large multi-series charts a single group-level mask would be cheaper.
- Comparison tables scroll horizontally on tablets rather than reflowing.
- "Built 12m ago"-style relative times are rendered on the server and the client. Exactly at a rounding boundary they can differ by a minute and React re-renders that text (a warning, not a failure).

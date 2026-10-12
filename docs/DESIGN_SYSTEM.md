# Aisle design system

Aisle should feel like a first-party Apple tool for pricing analysts: calm, dense where it has to be, never decorative for its own sake. Every value lives in `src/app/globals.css` as a semantic CSS variable, and Tailwind utilities (`bg-surface`, `text-ink-2`, `bg-down-soft` …) map onto those variables. Light, dark, high-contrast and reduced-transparency modes all switch in one place.

## Principles

1. **Content first, chrome recedes.** Cards are plain, opaque surfaces. Translucency is reserved for navigation and control layers.
2. **Numbers are the interface.** Prices use tabular figures (`.num`), align in columns and animate between values. Units always travel with numbers ("₹174.95/100 g").
3. **Honest by construction.** Simulated data is badged everywhere. Missing data shows as "—" with a reason, never as zero. Charts break lines across gaps instead of drawing through them.
4. **Colour never carries meaning alone.** Price direction pairs colour with ▲/▼ arrows and screen-reader text. Chart series pair colour with direct labels and dash patterns.

## Colour

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` / `--surface` / `--elevated` | `#f5f5f7` / `#fff` / `#fff` | `#000` / `#161618` / `#232326` | Page, cards, popovers |
| `--ink`, `--ink-2`, `--ink-3`, `--ink-4` | `#1d1d1f` → `#aeaeb2` | `#f5f5f7` → `#5d5d63` | Text hierarchy |
| `--accent` | `#0a6fd6` | `#3b8ff0` | Primary actions, selection, links |
| `--down` / `--up` | teal `#0b7a8f` / amber `#b4561c` | `#4cc4d6` / `#f0975c` | Price decreased / increased. **Deliberately neutral**: a competitor's cut isn't "good" for a brand manager, so red/green is reserved for status |
| `--good`, `--warn`, `--bad` | green / amber / red | brighter equivalents | System status only (worker health, failures) |
| `--sim` | amber-brown | amber | The Simulated badge and demo-mode notices |

Product image tiles are always light (`#f4f4f6`, or `#e6e6ea` with images dimmed to 94 % in dark mode), because Amazon photos are shot on white. Badges placed on tiles therefore use fixed light-tile colours (`SimulatedBadge onImage`).

### Data visualization

- **Categorical palette:** `--series-1` … `--series-8`, validated for adjacent-hue contrast in both themes.
- **Colour follows the entity:** the reference brand always takes series 1. Competitor brands keep their colour across every chart, and variants of one brand are told apart by dash pattern. When only one brand is visible, variants take distinct hues instead.
- **Diverging premiums** use `--up` and `--down` around a visible zero line.
- **Grid and axes** use `--chart-grid` and `--chart-axis`, kept quiet. Labels are 11 px tabular figures.

## Typography

The system UI stack (SF Pro on Apple platforms) is used, with Geist as the fallback.

| Token | Size / line height | Use |
|---|---|---|
| `text-2xs` | 11 / 16 | Eyebrows (`.eyebrow`: 600 weight, +0.04 em tracking, uppercase), meta |
| `text-xs` | 12 / 16.8 | Secondary table text, captions |
| `text-sm` | 13 / 19.2 | Body in dense UI, table cells |
| `text-md` | 15 / 22.4 | Body copy, descriptions |
| `text-xl` | 21 / 27 | Section titles in sheets |
| `text-2xl` / `3xl` | 28 / 34, 36 / 42 | Page titles (`tracking-tight`, 600) |
| `text-4xl` | 46 / 51 | Hero numbers and the overview headline |

Long titles use `text-balance`. Product titles step down on phones (22 px) so they never take four lines.

## Spacing, shape and depth

- **Spacing:** a 4 px grid. Pages are padded `px-4 md:px-8`, sections are separated by `space-y-6`, and cards are padded `p-5`.
- **Radii:** 6 · 8 · 10 · 14 · 18 · 24 (`--radius-xs` … `--radius-2xl`). Cards use 18, controls 8–10, sheets 20–22.
- **Elevation:** `--shadow-xs` … `--shadow-pop`, plus a 0.5 px inset ring (`--ring-inset`) instead of borders. Hairlines are 0.5 px (`.hairline-b`, `.hairline-t`).

## Materials (Liquid Glass, used selectively)

| Class | Recipe | Where |
|---|---|---|
| `.material` | `--glass` (72 % white / 66 % graphite) + blur 22 px + saturate 180 % + edge highlight | Sidebar, toolbar, popovers, menus, compare tray, mobile tab bar |
| `.material-thick` | `--glass-strong` (86 %) + blur 31 px + saturate 190 % | Command palette, which is text-dense and floats over colourful product images |
| `.card` | Opaque `--surface` | All content |

Glass is **never** used for content cards or tables. Under `prefers-reduced-transparency`, the in-app **Reduce transparency** switch or `prefers-contrast: more`, every material becomes a solid surface.

## Components

The primitives live in `src/components/ui/`: Button (primary, tinted, ghost; press scale 0.97), Segmented (spring indicator), Tabs (single-line, scrolls on phones with an edge fade), Switch, Select, Menu/Popover, Dialog/Sheet (bottom sheet on phones), Badge/Kbd, AnimatedNumber, Price/Delta, Freshness/StockBadge/SimulatedBadge, ProductImage, EmptyState/Skeleton, PageSkeleton, DataTable.

## States

| State | Treatment |
|---|---|
| Loading (route) | `PageSkeleton` mirrors the destination's real layout and appears only after 120 ms. The sidebar highlights the destination immediately. |
| Loading (inline) | Shimmer skeletons sized like the content. Charts keep the previous frame dimmed while a new range loads. |
| Empty | `EmptyState`: icon tile, one-sentence explanation, one primary action |
| Error | In-shell error boundary that keeps the navigation, says background monitoring is unaffected, and offers **Try again** plus a reference code |
| Not found | In-shell (unknown product or comparison) and root 404 pages |
| Success | Spring-drawn check (import), toasts for background actions, a one-time pulse on the monitoring dot when new data lands |

## Responsive

- **≥ 1280 px:** full sidebar, 4-column library.
- **1024 px:** compact toolbar controls, 3 columns, flag-only marketplace tags.
- **< 768 px:** mobile tab bar with a centred Add button, a "More" sheet, bottom-sheet dialogs, single-column cards and horizontally scrolling filter and tab strips with edge fades.

Screenshots are in [`docs/screenshots`](screenshots).

# Motion specification

Motion in Aisle explains **where things came from and where they went**. It is never decoration. Every duration, spring and stagger comes from `src/components/motion/tokens.ts`; components ask for a *role* (`spring.popover`, `spring.panel`), never for raw numbers.

## Rules

1. **Springs move geometry; opacity uses a short tween.** Every spring token carries an opacity override (`180 ms`, `cubic-bezier(0.22, 1, 0.36, 1)`; 140 ms for popovers and 100 ms for sheets).
   - *Why:* a spring-driven fade crawls. In QA, a sheet stayed see-through for about 300 ms and the page ghosted through it.
   - Motion inherits the parent `delay` into per-value transitions, so staggers still apply to the fade.
2. **Never show two states at once.** Content swaps inside a container (import phases, comparison views, sheet footers) are sequential (`AnimatePresence mode="wait"`) with exits of 80–100 ms. The container's height springs to fit through `AutoHeight` instead of snapping.
3. **The destination arrives with the motion, not after it.** Page transitions are a 160 ms fade with a 4 px rise. The view-transition root crossfade is 140 ms out and 200 ms in. Nothing stacks a second delayed entrance on top.
4. **Animate on the compositor or in paint, not in React.** Charts render once and reveal with CSS: a `clip-path` sweep for lines, a `scaleX` from the zero line for bars. Per-frame JavaScript re-renders are not allowed on large views.
5. **Respect Reduce Motion.** Under `prefers-reduced-motion`, spatial motion becomes an instant change (cross-fades remain where they aid comprehension), view transitions and chart reveals are disabled, and skeleton shimmer stops.
6. **No perpetual motion.** Nothing loops while idle. The monitoring dot pulses **once** when a new refresh lands.

## Tokens

| Spring | stiffness / damping / mass | Role |
|---|---|---|
| `snappy` | 520 / 38 / 0.8 | Toggles, segmented and tab indicators, small content swaps. No overshoot |
| `press` | 700 / 34 / 0.6 | Button and tile press feedback (scale 0.97) |
| `popover` | 440 / 32 / 0.9 | Menus, popovers, palette. A whisper of settle |
| `panel` | 300 / 32 / 1 | Sheets, dialogs, drawers, compare tray |
| `layout` | 340 / 34 / 1 | Shared-layout moves, reorders, `AutoHeight` |
| `gentle` | 180 / 26 / 1 | Number settling, list entrances |

| Duration | ms | Use |
|---|---|---|
| `micro` | 120 | Exits, hover |
| `press` | 160 | Press feedback |
| `control` | 220 | Control state changes |
| `popover` | 240 | Popover tween fallback |
| `page` | 300 | Legacy page tween (page transitions now use 160) |
| `panel` / `spatial` | 380 / 460 | Large surfaces |

**Easing:** `out` is `[0.22, 1, 0.36, 1]` for arrivals, `standard` is `[0.25, 0.1, 0.25, 1]` for changes in place, and `in` is `[0.4, 0, 1, 1]` for departures.

**Stagger:** 35 ms for lists, 40 ms for grids and 45 ms for variant rows, capped so the last item never waits more than 320 ms. Chart bars stagger by 18 ms.

## Signature interactions

### Add product (import sheet)

| Phase | Motion |
|---|---|
| Open | The scrim fades over 300 ms. The panel rises 18 px and scales from 0.985 on `panel`, and is solid within 100 ms |
| Typing | Each pasted link parses instantly. Detected listings unfold below with a `layout`-spring height |
| Lookup | Skeleton rows matching the preview layout. Then the input exits in 100 ms, the preview enters (8 px rise), and family cards and variant rows stagger in |
| Commit | The button holds its width with a spinner. The preview exits, a check is drawn (`SuccessCheck`), the sheet height springs down to the compact success state, and the footer actions swap in step |

### Library → product detail

The product image is a shared element (`<ViewTransition name="product-{id}" share="morph">`). It travels from the card to the 148 px hero over 420 ms on the `out` curve, with a 2 px blur at 30 % to hide resampling. The rest of the page crossfades in 200 ms, so the title and price are already present as the image lands. Going back reverses the morph. Cached images settle synchronously and never flash a skeleton.

To preserve this, `/products/[id]` deliberately has **no** loading boundary above it; a skeleton would replace the hero mid-transition.

### Comparison builder

| Interaction | Motion |
|---|---|
| Table, Visual, Timeline | The segmented indicator springs (`snappy`). Views swap with an 80 ms exit and a `snappy` 4 px enter. Bars grow from their zero line, and value labels fade in once the bars land (360 ms) |
| Arrange | Drag reordering with `Reorder`; rows settle on `layout` |
| Compare tray | Rises from the bottom on `panel` (glass). Thumbnails pop in on `popover` and reflow on `layout` |

### Prices and charts

- **AnimatedNumber** springs between values on `gentle`, keeping tabular figures fixed-width so digits don't jitter.
- **Chart lines** draw left to right in 720 ms. End labels arrive at 520 ms.
- **Range changes** keep the previous frame dimmed to 45 % until new data lands. There is no flash and no zero-baseline animation.
- **The crosshair tooltip** follows a step-function lookup on change points plus a 240-point hover grid.

## Measured budgets

Measured by driving the production build in Chromium (see [QA_REPORT.md](QA_REPORT.md)):

- every signature flow holds a **16.7 ms median frame**;
- the comparison timeline switch went from an **826 ms** main-thread block to **108 ms**;
- the import commit's layout shift went from 0.023 to 0.008, and other flows show none.

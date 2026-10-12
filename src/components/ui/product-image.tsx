"use client";

import { motion } from "motion/react";
import { Package } from "lucide-react";
import { useCallback, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";

/** ssr: server-rendered, visible without JS · cached: complete at mount, shown without a fade. */
type Status = "ssr" | "cached" | "loading" | "loaded" | "error";

const noopSubscribe = () => () => {};
/** True while rendering on the server or hydrating server markup; false for client-created elements. */
const useHydrating = () => useSyncExternalStore(noopSubscribe, () => false, () => true);

/**
 * Product thumbnail.
 *
 * Loading model (per `src`):
 *  - Server-rendered images are visible immediately — visibility never waits for
 *    JavaScript, so slow hydration can't leave decoded images invisible.
 *  - Images created on the client (navigation, new imports) fade in once loaded.
 *  - A ref callback checks `complete` at commit (before paint), so images that
 *    finished before React attached `onLoad` — cache hits, or loads that beat
 *    hydration — are settled via `decode()`, which is also correct for SVGs
 *    without intrinsic size (naturalWidth 0).
 *  - Failures show a placeholder; a new `src` resets state and retries.
 *  - The <img> is keyed by `src`, so callbacks from a previous source are ignored.
 */
export function ProductImage({ src, alt, size = 40, className, layoutId, rounded = 10 }: { src: string | null | undefined; alt: string; size?: number | "fill"; className?: string; layoutId?: string; rounded?: number }) {
  const hydrating = useHydrating();
  const [state, setState] = useState<{ src: string | null | undefined; status: Status }>(() => ({ src, status: hydrating ? "ssr" : "loading" }));
  // Reset when the source changes (adjusting state during render — no extra effect pass).
  if (state.src !== src) setState({ src, status: "loading" });
  const status = state.src === src ? state.status : "loading";

  // Functional update: a late callback for an older source finds a different `s.src` and is ignored.
  const settle = useCallback((forSrc: string | null | undefined, next: Status) => {
    setState((s) => (s.src === forSrc && s.status !== next && !((s.status === "ssr" || s.status === "cached") && next === "loaded") ? { src: forSrc, status: next } : s));
  }, []);

  const attach = useCallback(
    (img: HTMLImageElement | null) => {
      if (!img || !img.complete) return;
      // Already decoded (cache hit): settle synchronously — ref callbacks run at commit, before paint,
      // so a cached image never flashes its loading skeleton.
      if (img.naturalWidth > 0) return settle(src, "cached");
      // naturalWidth 0 is ambiguous (broken, or an SVG without intrinsic size): decode() decides.
      if (typeof img.decode === "function") img.decode().then(() => settle(src, "loaded"), () => settle(src, "error"));
      else settle(src, "error");
    },
    [settle, src],
  );

  const dims = size === "fill" ? { width: "100%", height: "100%" } : { width: size, height: size };
  const showImage = Boolean(src) && status !== "error";
  return (
    <motion.div layoutId={layoutId} data-image-status={src ? status : "none"} className={cn("relative shrink-0 overflow-hidden bg-[#f4f4f6] dark:bg-[#e6e6ea]", className)} style={{ ...dims, borderRadius: rounded }}>
      {status === "loading" && <div className="skeleton absolute inset-0" aria-hidden />}
      {showImage ? (
        <img
          key={src!}
          ref={attach}
          src={src!}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => settle(src, "loaded")}
          onError={() => settle(src, "error")}
          className={cn("relative h-full w-full object-contain dark:brightness-[0.94]", status === "ssr" || status === "cached" ? "opacity-100" : "transition-opacity duration-300 ease-out", status === "loaded" && "opacity-100", status === "loading" && "opacity-0")}
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-ink-4" role="img" aria-label={alt}>
          <Package className="size-1/2 max-h-6 max-w-6" strokeWidth={1.5} />
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.06)]" style={{ borderRadius: rounded }} />
    </motion.div>
  );
}

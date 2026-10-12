"use client";

import { motion } from "motion/react";
import { Package } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

/** Product thumbnail: fades in once decoded; graceful placeholder; optional shared-layout id. */
export function ProductImage({ src, alt, size = 40, className, layoutId, rounded = 10 }: { src: string | null | undefined; alt: string; size?: number | "fill"; className?: string; layoutId?: string; rounded?: number }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  // An image can finish loading before hydration attaches onLoad — check on mount.
  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete) {
      if (img.naturalWidth > 0) setLoaded(true);
      else setFailed(true);
    }
  }, [src]);
  const dims = size === "fill" ? { width: "100%", height: "100%" } : { width: size, height: size };
  return (
    <motion.div layoutId={layoutId} className={cn("relative shrink-0 overflow-hidden bg-[#f4f4f6] dark:bg-[#ececef]", className)} style={{ ...dims, borderRadius: rounded }}>
      {src && !failed ? (
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn("h-full w-full object-contain transition-opacity duration-300 ease-out", loaded ? "opacity-100" : "opacity-0")}
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-ink-4" aria-label={alt}>
          <Package className="size-1/2 max-h-6 max-w-6" strokeWidth={1.5} />
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.06)]" style={{ borderRadius: rounded }} />
    </motion.div>
  );
}

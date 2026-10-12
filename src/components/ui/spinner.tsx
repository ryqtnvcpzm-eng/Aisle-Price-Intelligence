import { cn } from "@/lib/cn";

/** Apple-style activity indicator: 8 fading spokes. Respects reduced motion via CSS. */
export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <span role="status" aria-label="Loading" className={cn("relative inline-block", className)} style={{ width: size, height: size }}>
      {Array.from({ length: 8 }).map((_, i) => (
        <span
          key={i}
          className="absolute left-1/2 top-0 h-[30%] w-[11%] rounded-full bg-current motion-safe:animate-[spoke_0.8s_linear_infinite]"
          style={{ transform: `translateX(-50%) rotate(${i * 45}deg)`, transformOrigin: `50% ${size / 2}px`, animationDelay: `${(i - 8) * 0.1}s`, opacity: 0.25 + (i / 8) * 0.75 }}
        />
      ))}
      <style>{`@keyframes spoke{0%{opacity:1}100%{opacity:.2}}`}</style>
    </span>
  );
}

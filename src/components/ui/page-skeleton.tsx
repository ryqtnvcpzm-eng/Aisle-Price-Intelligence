import { cn } from "@/lib/cn";

type Body = "dashboard" | "grid" | "table" | "detail" | "list" | "settings";

/**
 * Route-level loading state. It mirrors the real page frame (same paddings,
 * title and description metrics) so content lands in place without a jump,
 * and it fades in only after 120 ms — fast navigations never flash it.
 */
export function PageSkeleton({ body = "list", wide }: { body?: Body; wide?: boolean }) {
  return (
    <div role="status" aria-label="Loading" className={cn("page-skeleton mx-auto space-y-6 px-4 py-6 md:px-8 md:py-8", wide ? "max-w-[1560px]" : "max-w-[1280px]")}>
      <header>
        <div className="skeleton h-8 w-56 rounded-[10px] md:h-9" />
        <div className="skeleton mt-3 h-4 w-[min(520px,80%)] rounded-[6px]" />
      </header>
      {body === "dashboard" && (
        <>
          <div className="card grid grid-cols-2 gap-px overflow-hidden sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="space-y-2 p-4">
                <div className="skeleton h-3 w-24 rounded-[5px]" />
                <div className="skeleton h-7 w-14 rounded-[7px]" />
              </div>
            ))}
          </div>
          <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
            <div className="skeleton h-[360px] rounded-[18px]" />
            <div className="skeleton h-[360px] rounded-[18px]" />
          </div>
        </>
      )}
      {body === "grid" && (
        <>
          <div className="skeleton h-10 w-full rounded-[12px]" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="card space-y-3 p-2 pb-4">
                <div className="skeleton aspect-[16/10] rounded-[13px] sm:aspect-[5/4]" />
                <div className="space-y-2 px-1">
                  <div className="skeleton h-3 w-28 rounded-[5px]" />
                  <div className="skeleton h-4 w-[85%] rounded-[6px]" />
                  <div className="skeleton h-5 w-20 rounded-[6px]" />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {(body === "table" || body === "list") && (
        <div className="card divide-y divide-[var(--hairline)] overflow-hidden">
          {Array.from({ length: body === "table" ? 8 : 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-4">
              <div className="skeleton size-9 shrink-0 rounded-[10px]" />
              <div className="flex-1 space-y-2">
                <div className="skeleton h-3.5 rounded-[6px]" style={{ width: `${70 - ((i * 13) % 30)}%` }} />
                <div className="skeleton h-3 w-[40%] rounded-[5px]" />
              </div>
              {body === "table" && <div className="skeleton h-4 w-16 rounded-[6px]" />}
            </div>
          ))}
        </div>
      )}
      {body === "detail" && (
        <>
          <div className="skeleton h-[180px] rounded-[18px]" />
          <div className="card grid grid-cols-2 gap-px overflow-hidden sm:grid-cols-5">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="space-y-2 p-4">
                <div className="skeleton h-3 w-24 rounded-[5px]" />
                <div className="skeleton h-6 w-20 rounded-[7px]" />
              </div>
            ))}
          </div>
          <div className="skeleton h-[420px] rounded-[18px]" />
        </>
      )}
      {body === "settings" && (
        <div className="grid gap-8 md:grid-cols-[180px_1fr]">
          <div className="hidden space-y-3 md:block">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton h-4 w-28 rounded-[6px]" />)}</div>
          <div className="space-y-6">{Array.from({ length: 3 }, (_, i) => <div key={i} className="skeleton h-[200px] rounded-[18px]" />)}</div>
        </div>
      )}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

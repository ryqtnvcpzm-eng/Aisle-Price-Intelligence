import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Consistent page frame: editorial title, one-line description, actions on the right. */
export function Page({ title, description, actions, children, className, eyebrow, wide }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; eyebrow?: ReactNode; wide?: boolean }) {
  return (
    <div className={cn("mx-auto space-y-6 px-4 py-6 md:px-8 md:py-8", wide ? "max-w-[1560px]" : "max-w-[1280px]", className)}>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
          {description && <p className="mt-1 max-w-[720px] text-md text-ink-2">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {children}
    </div>
  );
}

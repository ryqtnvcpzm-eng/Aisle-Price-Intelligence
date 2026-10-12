"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { useState, type ReactNode } from "react";
import { Toaster } from "sonner";
import { TooltipProvider } from "../ui/tooltip";

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 20_000, refetchOnWindowFocus: false, retry: 1 } } }));
  return (
    <QueryClientProvider client={qc}>
      {/* "user": honour prefers-reduced-motion everywhere — transforms collapse to fades. */}
      <MotionConfig reducedMotion="user">
        <TooltipProvider>
          {children}
          <Toaster
            position="bottom-center"
            offset={24}
            gap={8}
            toastOptions={{
              classNames: {
                toast: "!material !rounded-[14px] !border-0 !text-ink !text-sm !font-medium !shadow-[var(--shadow-pop)] !px-4 !py-3 !gap-3",
                description: "!text-ink-2 !text-xs !font-normal",
                actionButton: "!bg-accent !text-white !rounded-[8px] !font-medium !px-2.5 !h-7",
                cancelButton: "!bg-[var(--hairline)] !text-ink !rounded-[8px]",
              },
            }}
          />
        </TooltipProvider>
      </MotionConfig>
    </QueryClientProvider>
  );
}

"use client";

import { RotateCw, WifiOff } from "lucide-react";
import { useEffect, useTransition } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Route error boundary inside the app shell: the sidebar and toolbar stay, so
 * the person is never stranded. Background monitoring is unaffected by a page
 * failing to render, and the copy says so.
 */
export default function RouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const [pending, start] = useTransition();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-[1280px] px-4 py-6 md:px-8">
      <EmptyState
        icon={<WifiOff />}
        title="This page didn’t load"
        description="Aisle couldn’t reach its data just now. Your tracking isn’t affected — monitoring keeps running in the background."
        action={
          <div className="flex flex-col items-center gap-3">
            <div className="flex gap-2">
              <Button variant="primary" loading={pending} onClick={() => start(() => retry())}>
                <RotateCw className="size-4" /> Try again
              </Button>
              <ButtonLink variant="ghost" href="/">Go to Overview</ButtonLink>
            </div>
            {error.digest && <p className="num text-2xs text-ink-4">Reference {error.digest}</p>}
          </div>
        }
      />
    </div>
  );
}

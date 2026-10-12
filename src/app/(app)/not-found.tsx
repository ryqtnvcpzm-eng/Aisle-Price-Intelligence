import { SearchX } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/** Unknown product, comparison or page inside the app — shown within the shell. */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-[1280px] px-4 py-6 md:px-8">
      <EmptyState
        icon={<SearchX />}
        title="Nothing here"
        description="This product or comparison doesn’t exist in your workspace — it may have been archived, or the link is from another account."
        action={
          <div className="flex gap-2">
            <ButtonLink variant="primary" href="/products">Browse products</ButtonLink>
            <ButtonLink variant="ghost" href="/comparisons">Comparisons</ButtonLink>
          </div>
        }
      />
    </div>
  );
}

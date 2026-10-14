import { ImportsIndex } from "@/components/import/imports-index";
import { Page } from "@/components/ui/page";
import { listJobs } from "@/server/catalog/bulk-import";
import { requireContext } from "@/server/workspace/context";

export const metadata = { title: "Imports" };

export default async function ImportsPage() {
  const ctx = await requireContext();
  const jobs = await listJobs(ctx.workspace.id);
  return (
    <Page title="Imports" description="Bulk imports, processed 25 links at a time. Each keeps a full record you can export.">
      <ImportsIndex jobs={JSON.parse(JSON.stringify(jobs))} />
    </Page>
  );
}

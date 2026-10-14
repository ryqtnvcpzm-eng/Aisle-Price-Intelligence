import { notFound } from "next/navigation";
import { ImportJobView } from "@/components/import/import-job-view";
import { Page } from "@/components/ui/page";
import { getJob, listItems } from "@/server/catalog/bulk-import";
import { HttpError } from "@/server/errors";
import { requireContext } from "@/server/workspace/context";

export const metadata = { title: "Bulk import" };

async function load(workspaceId: string, id: string) {
  try {
    const [{ job, counts }, items] = await Promise.all([getJob(workspaceId, id), listItems(workspaceId, id, { limit: 100 })]);
    return { job, counts, items };
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return null;
    throw e;
  }
}

export default async function ImportJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const snap = await load(ctx.workspace.id, id);
  if (!snap) notFound();
  return (
    <Page title="Bulk import" description="Every link gets a result: imported, skipped or failed — with the reason.">
      <ImportJobView initial={JSON.parse(JSON.stringify(snap))} />
    </Page>
  );
}

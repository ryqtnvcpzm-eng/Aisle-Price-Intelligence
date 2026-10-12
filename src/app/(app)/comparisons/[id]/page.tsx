import { notFound } from "next/navigation";
import { z } from "zod";
import { ComparisonWorkspace } from "@/components/comparisons/workspace";
import { listBrands } from "@/server/catalog/queries";
import { getGroupDetail } from "@/server/comparison/service";
import { HttpError } from "@/server/errors";
import { requireContext } from "@/server/workspace/context";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  try {
    const d = await getGroupDetail(ctx.workspace.id, z.string().uuid().parse(id));
    return { title: d.group.name };
  } catch {
    return { title: "Comparison" };
  }
}

export default async function ComparisonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const ctx = await requireContext();
  let detail;
  try {
    detail = await getGroupDetail(ctx.workspace.id, id);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  }
  const brands = await listBrands(ctx.workspace.id);
  return <ComparisonWorkspace detail={JSON.parse(JSON.stringify(detail))} brands={brands.map((b) => ({ id: b.id, name: b.name, isReference: b.isReference }))} />;
}

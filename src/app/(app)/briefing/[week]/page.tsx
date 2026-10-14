import { notFound } from "next/navigation";
import { isWeekStart } from "@/lib/week";
import { getBriefing, listBriefings } from "@/server/briefing/service";
import { requireContext } from "@/server/workspace/context";
import { BriefingFrame } from "@/components/briefing/briefing-frame";

export const metadata = { title: "Monday Briefing" };

export default async function BriefingWeekPage({ params }: { params: Promise<{ week: string }> }) {
  const { week } = await params;
  if (!isWeekStart(week)) notFound();
  const ctx = await requireContext();
  const [briefing, archive] = await Promise.all([getBriefing(ctx.workspace.id, week), listBriefings(ctx.workspace.id)]);
  if (!briefing) notFound();
  return <BriefingFrame ctx={ctx} briefing={briefing} archive={archive} />;
}

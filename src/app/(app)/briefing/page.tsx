import { BriefingFrame } from "@/components/briefing/briefing-frame";
import { getBriefing, listBriefings } from "@/server/briefing/service";
import { requireContext } from "@/server/workspace/context";

export const metadata = { title: "Monday Briefing" };

export default async function BriefingPage() {
  const ctx = await requireContext();
  const [briefing, archive] = await Promise.all([getBriefing(ctx.workspace.id), listBriefings(ctx.workspace.id)]);
  return <BriefingFrame ctx={ctx} briefing={briefing} archive={archive} />;
}

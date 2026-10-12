import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "../env";
import { logger } from "../logger";
import type { Insight } from "../insights/engine";

/**
 * Optional natural-language layer over the deterministic insights engine.
 * The model receives ONLY verified, structured findings (headline, metrics,
 * period, evidence) and is instructed to explain significance without adding
 * numbers, products, competitors or causes.
 *
 * Without an API key (the free default) the briefing is assembled
 * deterministically from the same findings, so the feature always works.
 */
const SYSTEM = `You are a pricing analyst writing a short morning briefing for a brand manager.
You will receive a JSON list of findings that were computed deterministically from stored price observations.
Rules:
- Use only the facts, numbers, products and time windows present in the JSON. Never introduce new prices, percentages, competitors, products or dates.
- Do not speculate about why a price changed (no causes, motives or strategies) - describe what was observed and why it may matter.
- If a finding is marked simulated, say the data is simulated.
- Write 3-6 short bullet points, most important first, each under 35 words. Plain text, no markdown headings.`;

export function aiEnabled() {
  return Boolean(env.ANTHROPIC_API_KEY);
}

let client: Anthropic | null = null;

export interface Briefing {
  text: string;
  /** Model id when an AI model wrote it; null for the built-in briefing. */
  model: string | null;
  source: "ai" | "built-in";
}

/** Free, deterministic briefing: the most significant verified findings, in plain sentences. */
export function builtInBriefing(insights: Insight[]): string {
  if (!insights.length) return "Nothing notable yet — insights appear once Aisle has a few days of observations across comparable listings.";
  const top = [...insights].sort((a, b) => b.severity - a.severity).slice(0, 5);
  const moves = insights.filter((i) => i.kind === "competitor_cut" || i.kind === "competitor_raise").length;
  const lines: string[] = [];
  const parts = [`${insights.length} finding${insights.length === 1 ? "" : "s"}`];
  if (moves) parts.push(`${moves} competitor price move${moves === 1 ? "" : "s"}`);
  lines.push(`${parts.join(", including ")}. The most significant:`);
  for (const i of top) {
    const headline = i.headline.replace(/[.\s]+$/, "");
    lines.push(`• ${headline}${i.period ? ` (${i.period})` : ""}.`);
  }
  if (insights.some((i) => i.isSimulated)) lines.push("Note: these findings are based on simulated demo data.");
  return lines.join("\n");
}

/** AI briefing when a key is configured; otherwise (or if the API fails) the built-in briefing. */
export async function briefing(insights: Insight[]): Promise<Briefing> {
  const ai = await explainInsights(insights);
  return ai ? { ...ai, source: "ai" } : { text: builtInBriefing(insights), model: null, source: "built-in" };
}

export async function explainInsights(insights: Insight[]): Promise<{ text: string; model: string } | null> {
  if (!env.ANTHROPIC_API_KEY || !insights.length) return null;
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 60_000, maxRetries: 2 });
  const facts = insights.slice(0, 12).map((i) => ({
    headline: i.headline,
    explanation: i.explanation,
    period: i.period,
    metrics: i.metrics,
    evidence: i.evidence,
    observedAt: i.at,
    simulated: i.isSimulated,
  }));
  try {
    const response = await client.beta.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 2000,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [{ role: "user", content: `Findings (JSON):\n${JSON.stringify(facts)}` }],
    });
    if (response.stop_reason === "refusal") return null;
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return text ? { text, model: response.model } : null;
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) logger.warn("AI explanation rate limited");
    else if (e instanceof Anthropic.AuthenticationError) logger.warn("AI explanation: invalid ANTHROPIC_API_KEY");
    else if (e instanceof Anthropic.APIError) logger.warn({ status: e.status }, "AI explanation API error");
    else logger.warn({ err: e }, "AI explanation failed");
    return null;
  }
}

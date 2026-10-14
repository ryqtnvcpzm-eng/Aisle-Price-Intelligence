/**
 * Email templates: every message has a plain-text and an HTML part built from
 * the same content. All dynamic text is escaped; links only ever point at the
 * app's own URL. Simulated (demo) data is labelled in both parts.
 */

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

interface Block {
  heading?: string;
  lines: string[];
}

interface Layout {
  preheader: string;
  title: string;
  intro?: string;
  blocks: Block[];
  cta?: { label: string; url: string };
  simulated?: boolean;
  test?: boolean;
  footer: string;
}

function render(subject: string, l: Layout): RenderedEmail {
  const notes = [l.test ? "This is a test message. No price event occurred." : null, l.simulated ? "Based on SIMULATED demo data — not real Amazon prices." : null].filter((x): x is string => Boolean(x));
  const text = [
    l.title,
    "",
    ...(notes.length ? [...notes.map((n) => `Note: ${n}`), ""] : []),
    ...(l.intro ? [l.intro, ""] : []),
    ...l.blocks.flatMap((b) => [...(b.heading ? [b.heading.toUpperCase()] : []), ...b.lines.map((x) => `• ${x}`), ""]),
    ...(l.cta ? [`${l.cta.label}: ${l.cta.url}`, ""] : []),
    "—",
    l.footer,
  ].join("\n");

  const e = escapeHtml;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${e(subject)}</title></head>
<body style="margin:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1d1d1f">
<span style="display:none;max-height:0;overflow:hidden">${e(l.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:18px;padding:28px">
<tr><td style="font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#6e6e73">Aisle</td></tr>
<tr><td style="padding-top:8px;font-size:21px;line-height:27px;font-weight:600">${e(l.title)}</td></tr>
${notes.map((n) => `<tr><td style="padding-top:12px"><div style="background:#fbf3e6;color:#7a4b12;border-radius:10px;padding:8px 12px;font-size:13px">${e(n)}</div></td></tr>`).join("")}
${l.intro ? `<tr><td style="padding-top:12px;font-size:15px;line-height:22px;color:#424245">${e(l.intro)}</td></tr>` : ""}
${l.blocks
  .map(
    (b) => `<tr><td style="padding-top:18px">${b.heading ? `<div style="font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#6e6e73;padding-bottom:6px">${e(b.heading)}</div>` : ""}${b.lines.map((x) => `<div style="font-size:14px;line-height:21px;padding:3px 0;border-top:0.5px solid #e5e5ea">${e(x)}</div>`).join("")}</td></tr>`,
  )
  .join("")}
${l.cta ? `<tr><td style="padding-top:22px"><a href="${e(l.cta.url)}" style="display:inline-block;background:#0a6fd6;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 16px;border-radius:10px">${e(l.cta.label)}</a></td></tr>` : ""}
<tr><td style="padding-top:24px;font-size:12px;line-height:18px;color:#86868b">${e(l.footer)}</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}

const FOOTER = "You're receiving this because email alerts are on for your Aisle workspace. Manage them in Settings → Notifications.";

export function alertEmail(o: { headline: string; detail: string | null; ruleName: string; workspaceName: string; url: string; simulated: boolean; test: boolean }): RenderedEmail {
  const subject = `${o.test ? "[Test] " : ""}${o.simulated ? "[Simulated] " : ""}${o.headline}`;
  return render(subject, {
    preheader: o.detail ?? o.headline,
    title: o.headline,
    intro: o.detail ?? undefined,
    blocks: [{ lines: [`Alert: ${o.ruleName}`, `Workspace: ${o.workspaceName}`] }],
    cta: { label: "Open in Aisle", url: o.url },
    simulated: o.simulated,
    test: o.test,
    footer: FOOTER,
  });
}

export function testEmail(o: { workspaceName: string; url: string; recipient: string }): RenderedEmail {
  return render("[Test] Aisle email delivery works", {
    preheader: "Your Aisle workspace can send you email.",
    title: "Email delivery works",
    intro: `This test was sent to ${o.recipient} from the ${o.workspaceName} workspace. Alerts and the Monday Briefing will arrive like this.`,
    blocks: [],
    cta: { label: "Open Aisle", url: o.url },
    test: true,
    footer: FOOTER,
  });
}

export function digestEmail(o: { frequency: "daily" | "weekly"; items: { headline: string; detail: string | null }[]; url: string }): RenderedEmail {
  return render(`Aisle ${o.frequency} digest: ${o.items.length} alert${o.items.length === 1 ? "" : "s"}`, {
    preheader: o.items[0]?.headline ?? "",
    title: `Your ${o.frequency} digest`,
    blocks: [{ lines: o.items.map((i) => (i.detail ? `${i.headline} — ${i.detail}` : i.headline)) }],
    cta: { label: "Review alerts", url: o.url },
    footer: FOOTER,
  });
}

export function reportReadyEmail(o: { name: string; title: string; subtitle: string; url: string }): RenderedEmail {
  return render(`Aisle report ready: ${o.name}`, {
    preheader: o.subtitle,
    title: o.title,
    intro: o.subtitle,
    blocks: [],
    cta: { label: "Download in Aisle", url: o.url },
    footer: FOOTER,
  });
}

export function briefingEmail(o: { weekLabel: string; summary: string[]; sections: Block[]; url: string; simulated: boolean }): RenderedEmail {
  return render(`Monday Briefing · ${o.weekLabel}`, {
    preheader: o.summary[0] ?? "",
    title: `Monday Briefing · ${o.weekLabel}`,
    intro: o.summary.join(" "),
    blocks: o.sections,
    cta: { label: "Read the full briefing", url: o.url },
    simulated: o.simulated,
    footer: "Sent every Monday when the briefing email is on (Settings → Notifications).",
  });
}

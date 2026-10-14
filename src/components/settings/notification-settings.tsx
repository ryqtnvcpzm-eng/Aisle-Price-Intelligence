"use client";

import { AnimatePresence, motion } from "motion/react";
import { MailCheck, RotateCw, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/freshness";
import { spring } from "../motion/tokens";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Segmented } from "../ui/segmented";
import { Switch } from "../ui/switch";

export interface DeliveryRow {
  id: string;
  kind: string;
  recipient: string;
  subject: string;
  status: "pending" | "sending" | "sent" | "failed" | "skipped";
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  sentAt: string | null;
  createdAt: string;
  isTest: boolean;
}

interface Props {
  email: { mode: "live" | "dry_run" | "not_configured"; from: string; reason: string | null };
  settings: { digest: string; emailAlerts: boolean; emailBriefing?: boolean };
  deliveries: DeliveryRow[];
  canEdit: boolean;
  userEmail: string;
  onSetting: (key: string, value: unknown) => Promise<void>;
}

const STATUS: Record<DeliveryRow["status"], { label: string; tone: "good" | "warn" | "bad" | "neutral" | "accent" }> = {
  sent: { label: "Sent", tone: "good" },
  pending: { label: "Queued", tone: "accent" },
  sending: { label: "Sending", tone: "accent" },
  failed: { label: "Failed", tone: "bad" },
  skipped: { label: "Not sent", tone: "neutral" },
};

/**
 * Settings → Notifications. Every control says what will actually happen:
 * switches that can't work are disabled with the reason, a test goes only to
 * you, and the log shows each message's real outcome (sent, queued for retry,
 * failed, or not sent and why).
 */
export function NotificationSettings({ email, settings, deliveries, canEdit, userEmail, onSetting }: Props) {
  const router = useRouter();
  const [testing, setTesting] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const live = email.mode === "live";
  const usable = email.mode !== "not_configured";

  async function sendTest() {
    setTesting(true);
    try {
      const r = await api<{ delivery: { status: DeliveryRow["status"]; reason: string | null; recipient: string } }>("/api/notifications/test-email", { method: "POST" });
      if (r.delivery.status === "sent") toast.success(`Test email sent to ${r.delivery.recipient}`, { description: "It can take a minute to arrive. Check spam if it doesn't." });
      else if (r.delivery.status === "pending") toast(`Test email queued for ${r.delivery.recipient}`, { description: r.delivery.reason ?? "The provider didn't accept it yet; Aisle will retry." });
      else toast(`Test email not sent`, { description: r.delivery.reason ?? undefined });
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't send the test.");
    } finally {
      setTesting(false);
    }
  }

  async function retry(id: string) {
    setRetrying(id);
    try {
      const r = await api<{ delivery: { status: DeliveryRow["status"]; reason: string | null } }>(`/api/notifications/deliveries/${id}/retry`, { method: "POST" });
      toast(r.delivery.status === "sent" ? "Sent" : `Still not sent`, { description: r.delivery.status === "sent" ? undefined : (r.delivery.reason ?? undefined) });
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Retry failed.");
    } finally {
      setRetrying(null);
    }
  }

  return (
    <div>
      <div className={cn("mx-5 mb-2 flex items-start gap-3 rounded-[12px] px-4 py-3 text-sm", live ? "bg-good-soft" : email.mode === "dry_run" ? "bg-sim-soft" : "bg-[var(--hairline)]")}>
        <MailCheck className={cn("mt-0.5 size-4 shrink-0", live ? "text-good" : "text-ink-3")} />
        <div className="min-w-0">
          <div className="font-medium text-ink">{live ? "Email is on (Resend)" : email.mode === "dry_run" ? "Email dry run" : "Email isn't set up"}</div>
          <div className="mt-0.5 text-xs text-ink-2">{live ? `Sending from ${email.from}. In-app notifications always work too.` : `${email.reason} In-app notifications always work.`}</div>
        </div>
      </div>
      <Row label="Email alerts" hint={usable ? "Alerts set to email go to every workspace member. Simulated (demo) data is never emailed." : "Available once email is set up."} control={<Switch checked={settings.emailAlerts && usable} onCheckedChange={(v) => onSetting("emailAlerts", v)} disabled={!usable || !canEdit} label="Email alerts" />} />
      <Row label="Monday Briefing email" hint={usable ? "The weekly briefing, each Monday morning. Not sent for simulated data." : "Available once email is set up."} control={<Switch checked={Boolean(settings.emailBriefing) && usable} onCheckedChange={(v) => onSetting("emailBriefing", v)} disabled={!usable || !canEdit} label="Monday Briefing email" />} />
      <Row label="Digest" hint="A summary of real (non-simulated) alert events." control={<Segmented ariaLabel="Digest" size="sm" value={settings.digest} onChange={(v) => onSetting("digest", v)} options={[{ value: "off", label: "Off" }, { value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }]} />} />
      <Row
        label="Test email"
        hint={usable ? `Sends one message to you (${userEmail}) — nobody else.` : "Set up email first."}
        control={
          <Button size="sm" loading={testing} disabled={!usable} onClick={sendTest}>
            <Send className="size-3.5" /> Send test email
          </Button>
        }
      />
      <div className="px-5 pb-2 pt-3 hairline-t">
        <div className="eyebrow mb-2">Delivery log</div>
        {deliveries.length === 0 ? (
          <p className="pb-2 text-xs text-ink-3">No email has been attempted yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--hairline)]">
            <AnimatePresence initial={false}>
              {deliveries.map((d) => (
                <motion.li key={d.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={spring.layout} className="flex items-start gap-3 py-2.5">
                  <Badge tone={STATUS[d.status].tone} size="xs" className="mt-0.5 w-[62px] justify-center">{STATUS[d.status].label}</Badge>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{d.subject}</div>
                    <div className="text-2xs text-ink-3">
                      {d.recipient} · {relativeTime(d.sentAt ?? d.createdAt)}
                      {d.attempts > 1 && ` · ${d.attempts} attempts`}
                      {d.status === "pending" && d.nextAttemptAt && ` · next try ${relativeTime(d.nextAttemptAt)}`}
                    </div>
                    {d.lastError && d.status !== "sent" && <div className="mt-0.5 text-2xs text-ink-2">{d.lastError}</div>}
                  </div>
                  {(d.status === "failed" || d.status === "skipped") && usable && (
                    <Button variant="ghost" size="sm" loading={retrying === d.id} onClick={() => retry(d.id)} aria-label={`Retry ${d.subject}`}>
                      <RotateCw className="size-3.5" /> Retry
                    </Button>
                  )}
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </div>
  );
}

function Row({ label, hint, control }: { label: string; hint?: string; control: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 px-5 py-3 hairline-t sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="text-sm">{label}</div>
        {hint && <div className="mt-0.5 max-w-[420px] text-xs text-ink-3">{hint}</div>}
      </div>
      {control}
    </div>
  );
}

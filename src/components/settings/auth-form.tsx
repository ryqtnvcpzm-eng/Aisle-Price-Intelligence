"use client";

import { motion } from "motion/react";
import { FlaskConical } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { spring } from "../motion/tokens";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/input";

export const DEMO_CREDENTIALS = { email: "demo@aisle.app", password: "aisle-demo-2026" };

export function AuthForm({ mode, demoEnabled }: { mode: "sign-in" | "sign-up"; demoEnabled: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState<"form" | "demo" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e?: React.FormEvent, demo = false) {
    e?.preventDefault();
    setError(null);
    setLoading(demo ? "demo" : "form");
    const res =
      mode === "sign-up" && !demo
        ? await authClient.signUp.email({ name: name.trim() || email.split("@")[0]!, email, password })
        : await authClient.signIn.email(demo ? DEMO_CREDENTIALS : { email, password });
    if (res.error) {
      setLoading(null);
      setError(
        demo
          ? "The demo account isn't seeded yet. Run `pnpm db:seed` and try again."
          : res.error.status === 401 || res.error.code === "INVALID_EMAIL_OR_PASSWORD"
            ? "That email and password don't match."
            : (res.error.message ?? "Something went wrong."),
      );
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring.panel} className="card p-6 shadow-[var(--shadow-lg),var(--ring-inset)]">
      <form onSubmit={submit} className="space-y-4">
        {mode === "sign-up" && (
          <Field label="Name" htmlFor="name">
            <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Priya Sharma" />
          </Field>
        )}
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
        </Field>
        <Field label="Password" htmlFor="password" hint={mode === "sign-up" ? "At least 8 characters." : undefined}>
          <Input id="password" type="password" autoComplete={mode === "sign-up" ? "new-password" : "current-password"} required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && (
          <p role="alert" className="rounded-[10px] bg-bad-soft px-3 py-2 text-sm text-bad">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading === "form"} disabled={loading !== null}>
          {mode === "sign-up" ? "Create account" : "Sign in"}
        </Button>
      </form>
      {demoEnabled && (
        <>
          <div className="my-5 flex items-center gap-3 text-xs text-ink-3">
            <span className="h-px flex-1 bg-[var(--line)]" /> or <span className="h-px flex-1 bg-[var(--line)]" />
          </div>
          <Button size="lg" className="w-full" loading={loading === "demo"} disabled={loading !== null} onClick={() => submit(undefined, true)}>
            <FlaskConical className="size-4 text-sim" /> Explore the demo workspace
          </Button>
          <p className="mt-2.5 text-center text-xs text-ink-3">Fictional brands, simulated prices — clearly labelled throughout.</p>
        </>
      )}
      <p className="mt-6 text-center text-sm text-ink-2">
        {mode === "sign-in" ? (
          <>
            New to Aisle? <Link href="/sign-up" className="font-medium text-accent">Create an account</Link>
          </>
        ) : (
          <>
            Already have an account? <Link href="/sign-in" className="font-medium text-accent">Sign in</Link>
          </>
        )}
      </p>
    </motion.div>
  );
}

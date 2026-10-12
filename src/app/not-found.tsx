import Link from "next/link";
import { Logo } from "@/components/shell/logo";

export const metadata = { title: "Not found" };

/** Unknown URL outside the app shell. */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-bg px-6 text-center">
      <Logo size={40} />
      <p className="num mt-8 text-sm font-medium text-ink-3">404</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">This page doesn’t exist</h1>
      <p className="mt-2 max-w-[420px] text-md text-ink-2">The link may be mistyped or out of date.</p>
      <Link href="/" className="mt-6 inline-flex h-10 items-center rounded-full bg-accent px-5 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hover">
        Back to Aisle
      </Link>
    </main>
  );
}

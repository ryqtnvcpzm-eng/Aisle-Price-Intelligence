import { Logo } from "@/components/shell/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-12">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,var(--accent-softer),transparent_70%)]" />
      <div className="relative w-full max-w-[400px]">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo size={48} />
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">Aisle</h1>
          <p className="mt-1 text-sm text-ink-2">Price intelligence for every shelf on Amazon.</p>
        </div>
        {children}
      </div>
    </div>
  );
}

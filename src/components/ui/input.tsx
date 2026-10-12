import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const base =
  "w-full rounded-[10px] bg-surface text-ink placeholder:text-ink-4 shadow-[inset_0_0_0_0.5px_var(--line-strong),var(--shadow-xs)] transition-[box-shadow] duration-150 outline-none focus:shadow-[inset_0_0_0_1px_var(--accent),0_0_0_4px_var(--accent-soft)] disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input({ className, invalid, ...props }, ref) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={cn(base, "h-9 px-3 text-base", invalid && "shadow-[inset_0_0_0_1px_var(--bad)]", className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(base, "px-3 py-2.5 text-base", className)} {...props} />;
});

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {error ? <p className="text-xs text-bad">{error}</p> : hint ? <p className="text-xs text-ink-3">{hint}</p> : null}
    </div>
  );
}

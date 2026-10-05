"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useRef, useTransition, type ReactNode } from "react";
import { X } from "lucide-react";

/** GET form that submits on every change (works without JS as a plain form too). */
export function FilterBar({ children, hasFilters }: { children: ReactNode; hasFilters: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const ref = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const submit = () => {
    const fd = new FormData(ref.current!);
    const next = new URLSearchParams();
    for (const [k, v] of fd.entries()) if (typeof v === "string" && v !== "") next.set(k, v);
    // Preserve params that are not part of the filter form (e.g. tab).
    for (const [k, v] of params.entries()) if (!fd.has(k) && !next.has(k)) next.set(k, v);
    startTransition(() => router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false }));
  };
  return (
    <form
      ref={ref}
      method="get"
      onChange={(e) => {
        if ((e.target as HTMLElement).tagName === "SELECT") submit();
      }}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="mb-4 flex flex-wrap items-end gap-2"
      aria-busy={pending}
    >
      {children}
      {hasFilters && (
        <button
          type="button"
          onClick={() => startTransition(() => router.replace(pathname, { scroll: false }))}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-2 text-sm text-muted hover:bg-surface-2 hover:text-text"
        >
          <X className="size-3.5" /> Clear
        </button>
      )}
      {pending && <span className="py-2 text-xs text-muted">Updating…</span>}
    </form>
  );
}

export function FilterSelect({
  name,
  label,
  value,
  options,
  allLabel,
}: {
  name: string;
  label: string;
  value?: string | null;
  options: { value: string; label: string }[];
  allLabel: string;
}) {
  return (
    <label className="min-w-0 flex-1 basis-36 sm:max-w-52 sm:flex-none">
      <span className="sr-only">{label}</span>
      <select name={name} defaultValue={value ?? ""} className="input !py-1.5 text-sm" aria-label={label}>
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function FilterSearch({ value, placeholder }: { value?: string | null; placeholder: string }) {
  return (
    <label className="min-w-0 flex-[2_1_14rem]">
      <span className="sr-only">Search</span>
      <input type="search" name="q" defaultValue={value ?? ""} placeholder={placeholder} className="input !py-1.5 text-sm" />
    </label>
  );
}

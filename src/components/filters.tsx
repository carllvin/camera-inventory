"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useTransition, type ReactNode } from "react";
import { X } from "lucide-react";

/** GET form that submits on every change (works without JS as a plain form too). */
export function FilterBar({ children, hasFilters }: { children: ReactNode; hasFilters: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const ref = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const typing = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(typing.current ?? undefined), []);
  const submit = () => {
    clearTimeout(typing.current ?? undefined);
    const fd = new FormData(ref.current!);
    const next = new URLSearchParams();
    for (const [k, v] of fd.entries()) if (typeof v === "string" && v !== "") next.set(k, v);
    // Preserve params that are not part of the filter form (e.g. tab).
    // A changed filter starts again at the first page.
    for (const [k, v] of params.entries()) if (k !== "page" && !fd.has(k) && !next.has(k)) next.set(k, v);
    startTransition(() => router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false }));
  };
  return (
    <form
      ref={ref}
      method="get"
      onChange={(e) => {
        if ((e.target as HTMLElement).tagName === "SELECT") submit();
      }}
      // The search updates the list while typing (shortly after the last key).
      onInput={(e) => {
        const t = e.target as HTMLInputElement;
        if (t.name !== "q" || (e.nativeEvent as InputEvent).isComposing) return;
        clearTimeout(typing.current ?? undefined);
        typing.current = setTimeout(submit, 250);
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

const isEditable = (el: Element | null) =>
  !!el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el as HTMLElement).isContentEditable);

export function FilterSearch({ value, placeholder }: { value?: string | null; placeholder: string }) {
  const ref = useRef<HTMLInputElement>(null);
  // Just start typing anywhere on the page: the keys go into the search ("/" jumps there too).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const input = ref.current;
      if (!input || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      if (isEditable(document.activeElement) || document.querySelector("dialog[open]")) return;
      if (e.key === "/") {
        e.preventDefault();
        input.focus();
        input.select();
      } else if (e.key.length === 1 && e.key !== " ") {
        input.focus(); // the key itself lands in the field
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <label className="min-w-0 flex-[2_1_14rem]">
      <span className="sr-only">Search</span>
      <input
        ref={ref}
        type="search"
        name="q"
        defaultValue={value ?? ""}
        placeholder={placeholder}
        autoComplete="off"
        onKeyDown={(e) => {
          if (e.key === "Escape" && e.currentTarget.value) {
            e.currentTarget.value = "";
            e.currentTarget.dispatchEvent(new Event("input", { bubbles: true }));
          }
        }}
        className="input !py-1.5 text-sm"
      />
    </label>
  );
}

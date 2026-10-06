"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/format";
import { FieldShell, useField } from "./forms";

export interface TypeChoice {
  id: string;
  name: string;
  category?: string | null;
  tracking?: "serialized" | "bulk";
}

interface Option {
  value: string;
  label: string;
  detail?: string | null;
  type?: TypeChoice;
}

/**
 * Searchable equipment-type picker for catalogs with thousands of types: typing
 * queries /api/equipment-types/search (words in any order, typos tolerated).
 * Submits the chosen id (with `valuePrefix`) under `name`. `extraOptions` are
 * fixed choices filtered locally (e.g. "Any <category>" for case lines).
 */
export function TypePicker({
  name,
  id = name,
  label,
  defaultValue,
  placeholder = "Search manufacturer, model, alias…",
  emptyLabel,
  valuePrefix = "",
  extraOptions = [],
  extraLabel,
  hint,
  className,
  onChange,
  "aria-label": ariaLabel,
}: {
  name: string;
  id?: string;
  label?: string;
  defaultValue?: { id: string; name: string } | null;
  placeholder?: string;
  /** Shown when nothing is chosen and choosing nothing is allowed (e.g. "Detect automatically"). */
  emptyLabel?: string;
  valuePrefix?: string;
  extraOptions?: { value: string; label: string }[];
  extraLabel?: string;
  hint?: ReactNode;
  className?: string;
  onChange?: (type: TypeChoice | null) => void;
  "aria-label"?: string;
}) {
  const echoed = useField(name, defaultValue ? `${valuePrefix}${defaultValue.id}` : null);
  const echoedLabel = useField(`${name}__label`, defaultValue?.name ?? null);
  const [selected, setSelected] = useState<{ value: string; label: string } | null>(echoed.value ? { value: echoed.value, label: echoedLabel.value || echoed.value } : null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<TypeChoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/equipment-types/search?q=${encodeURIComponent(query)}`, { signal: ctrl.signal });
        if (res.ok) {
          setResults(await res.json());
          setActive(0);
        }
      } catch {
        /* aborted or offline: keep the previous suggestions */
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 150);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query, open]);

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const extras = extraOptions.filter((o) => words.every((w) => o.label.toLowerCase().includes(w)));
  const options: Option[] = [
    ...results.map((t) => ({ value: `${valuePrefix}${t.id}`, label: t.name, detail: t.category, type: t })),
    ...extras.map((o) => ({ ...o, detail: extraLabel })),
  ];

  const choose = (o: Option | null) => {
    setSelected(o ? { value: o.value, label: o.label } : null);
    setQuery("");
    setOpen(false);
    onChange?.(o?.type ?? null);
  };

  return (
    <FieldShell label={label} id={id} error={echoed.error} hint={hint} className={className}>
      <div className="relative">
        <input type="hidden" name={name} value={selected?.value ?? ""} />
        <input type="hidden" name={`${name}__label`} value={selected?.label ?? ""} />
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-label={label ? undefined : ariaLabel}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
          aria-invalid={echoed.error ? true : undefined}
          autoComplete="off"
          spellCheck={false}
          className={cn("input pr-8", echoed.error && "border-danger")}
          placeholder={selected ? selected.label : (emptyLabel ?? placeholder)}
          value={open ? query : (selected?.label ?? "")}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(a + 1, options.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && open) {
              e.preventDefault(); // never submit the form from the picker
              if (options[active]) choose(options[active]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        {selected && !open && (
          <button
            type="button"
            onClick={() => {
              choose(null);
              inputRef.current?.focus();
            }}
            className="absolute inset-y-0 right-1 my-auto grid size-7 place-items-center rounded text-muted hover:text-text"
            aria-label={emptyLabel ? `Clear (${emptyLabel})` : "Clear"}
          >
            <X className="size-4" />
          </button>
        )}
        {open && (
          <ul id={listId} role="listbox" className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-border bg-surface py-1 text-sm shadow-lg">
            {emptyLabel && !query && (
              <li role="option" aria-selected={!selected} className="cursor-pointer px-3 py-1.5 text-muted hover:bg-surface-2" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(null)}>
                {emptyLabel}
              </li>
            )}
            {options.map((o, i) => (
              <li
                key={o.value}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={cn("flex cursor-pointer items-baseline justify-between gap-3 px-3 py-1.5", i === active ? "bg-accent-soft" : "hover:bg-surface-2")}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(o)}
              >
                <span className="min-w-0 break-words">{o.label}</span>
                {o.detail && <span className="shrink-0 text-xs text-muted">{o.detail}</span>}
              </li>
            ))}
            {!loading && options.length === 0 && <li className="px-3 py-1.5 text-muted">No matching equipment type</li>}
            {loading && options.length === 0 && (
              <li className="flex items-center gap-2 px-3 py-1.5 text-muted">
                <Loader2 className="size-3.5 animate-spin" /> Searching…
              </li>
            )}
          </ul>
        )}
      </div>
    </FieldShell>
  );
}

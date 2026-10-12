"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { useT } from "./i18n";

/** Read-only value with a copy button (for links people paste elsewhere). */
export function CopyField({ value, label }: { value: string; label: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <input readOnly value={value} aria-label={label} onFocus={(e) => e.currentTarget.select()} className="input min-w-0 flex-1 font-mono text-xs" />
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* no clipboard (http): the field is selected for copying by hand */
          }
        }}
        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-2.5 py-2 text-xs font-medium hover:bg-surface-2"
      >
        {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />} {copied ? t("Copied") : t("Copy")}
      </button>
    </div>
  );
}

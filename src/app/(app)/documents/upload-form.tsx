"use client";

import { useEffect, useState } from "react";
import { FileUp } from "lucide-react";
import { ActionForm, Select, SubmitButton } from "@/components/forms";
import { useT } from "@/components/i18n";
import { buttonVariants } from "@/components/ui";
import type { T } from "@/lib/i18n/core";
import { uploadDocumentAction } from "./actions";

// Same limits as the server (MAX_DOCUMENT_* in server/domain/documents.ts); checked here
// so a too-large upload gets a clear message instead of failing in transit.
const MB = 1024 * 1024;
const MAX_FILES = 20;
const MAX_FILE_BYTES = 25 * MB;
const MAX_TOTAL_BYTES = 100 * MB;

function sizeProblem(files: File[], t: T): string | null {
  if (files.length > MAX_FILES) return t("At most {n} files per document.", { n: MAX_FILES });
  const big = files.find((f) => f.size > MAX_FILE_BYTES);
  if (big) return t("{file} is {size} MB - files can be at most 25 MB.", { file: big.name, size: (big.size / MB).toFixed(1) });
  if (files.reduce((n, f) => n + f.size, 0) > MAX_TOTAL_BYTES) return t("The files are larger than 100 MB together. Upload fewer pages or smaller photos.");
  return null;
}

export function UploadForm({
  kind,
  projects,
  rentalHouses,
  defaultProjectId,
  aiAvailable,
  aiBatch = false,
}: {
  kind: "delivery_note" | "return_note" | "inventory_list";
  projects: { value: string; label: string }[];
  rentalHouses: { value: string; label: string }[];
  defaultProjectId?: string;
  aiAvailable: boolean;
  /** The AI provider offers the discounted queue. */
  aiBatch?: boolean;
}) {
  const t = useT();
  const [names, setNames] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <ActionForm action={uploadDocumentAction} className="space-y-5">
      <input type="hidden" name="kind" value={kind} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label={t("Project")}
          name="projectId"
          placeholder={aiAvailable ? t("Detect from document") : t("Choose project…")}
          defaultValue={defaultProjectId}
          options={projects}
          required={!aiAvailable}
        />
        <Select label={t("Rental house")} name="rentalHouseId" placeholder={aiAvailable ? t("Detect from document") : t("Choose later")} options={rentalHouses} />
      </div>
      <div>
        <input
          id="document-files"
          type="file"
          name="file"
          multiple
          accept="application/pdf,image/*"
          className="sr-only"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            setNames(files.map((f) => f.name));
            setProblem(sizeProblem(files, t));
          }}
        />
        <label
          htmlFor="document-files"
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-surface px-4 py-10 text-center hover:border-ring/60"
        >
          <FileUp className="size-8 text-accent" aria-hidden />
          <span className="font-medium">{names.length ? (names.length === 1 ? t("1 file selected") : t("{n} files selected", { n: names.length })) : t("Choose PDF or take photos")}</span>
          <span className="text-xs text-muted">{t("PDF, or one photo per page (JPEG, PNG, WebP) · up to 20 files, 25 MB each, 100 MB in total")}</span>
          {names.length > 0 && <span className="max-w-full truncate text-xs text-text">{names.join(", ")}</span>}
        </label>
        {problem && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {problem}
          </p>
        )}
      </div>
      <p className="text-sm text-muted">
        {aiAvailable
          ? t("The document is read automatically. You review every line before anything changes on the project.")
          : t("AI reading is not configured on this server, so you will enter the lines yourself after uploading.")}
      </p>
      {aiBatch && <AiQueueCheckbox t={t} />}
      <SubmitButton className={`${buttonVariants.primary} w-full sm:w-auto`} pendingText={t("Uploading…")} disabled={problem !== null}>
        {t("Upload")}
      </SubmitButton>
    </ActionForm>
  );
}

/** Discounted AI queue (Message Batches): half the price, the answer comes later. Remembered per browser. */
export function AiQueueCheckbox({ t }: { t: T }) {
  const [on, setOn] = useState(false);
  // After hydration (the server can't know the browser's choice).
  useEffect(() => {
    try {
      if (window.localStorage.getItem("aiBatch") === "1") setOn(true);
    } catch {
      /* no storage */
    }
  }, []);
  return (
    <label className="flex items-start gap-3 rounded-lg border border-border bg-surface p-3 text-sm">
      <input
        type="checkbox"
        name="aiBatch"
        checked={on}
        onChange={(e) => {
          setOn(e.target.checked);
          try {
            window.localStorage.setItem("aiBatch", e.target.checked ? "1" : "0");
          } catch {
            /* private mode: just not remembered */
          }
        }}
        className="mt-0.5 size-4"
      />
      <span>
        <span className="font-medium">{t("AI queue: 50 % cheaper")}</span>
        <span className="block text-xs text-muted">{t("Read in Anthropic's batch queue at half the price. Usually within an hour, at most 24 hours; you can close the page meanwhile.")}</span>
      </span>
    </label>
  );
}

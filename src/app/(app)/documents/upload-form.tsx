"use client";

import { useState } from "react";
import { FileUp } from "lucide-react";
import { ActionForm, Select, SubmitButton } from "@/components/forms";
import { buttonVariants } from "@/components/ui";
import { uploadDocumentAction } from "./actions";

// Same limits as the server (MAX_DOCUMENT_* in server/domain/documents.ts); checked here
// so a too-large upload gets a clear message instead of failing in transit.
const MB = 1024 * 1024;
const MAX_FILES = 20;
const MAX_FILE_BYTES = 25 * MB;
const MAX_TOTAL_BYTES = 100 * MB;

function sizeProblem(files: File[]): string | null {
  if (files.length > MAX_FILES) return `At most ${MAX_FILES} files per document.`;
  const big = files.find((f) => f.size > MAX_FILE_BYTES);
  if (big) return `${big.name} is ${(big.size / MB).toFixed(1)} MB - files can be at most 25 MB.`;
  if (files.reduce((n, f) => n + f.size, 0) > MAX_TOTAL_BYTES) return "The files are larger than 100 MB together. Upload fewer pages or smaller photos.";
  return null;
}

export function UploadForm({
  kind,
  projects,
  rentalHouses,
  defaultProjectId,
  aiAvailable,
}: {
  kind: "delivery_note" | "return_note" | "inventory_list";
  projects: { value: string; label: string }[];
  rentalHouses: { value: string; label: string }[];
  defaultProjectId?: string;
  aiAvailable: boolean;
}) {
  const [names, setNames] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <ActionForm action={uploadDocumentAction} className="space-y-5">
      <input type="hidden" name="kind" value={kind} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Project"
          name="projectId"
          placeholder={aiAvailable ? "Detect from document" : "Choose project…"}
          defaultValue={defaultProjectId}
          options={projects}
          required={!aiAvailable}
        />
        <Select label="Rental house" name="rentalHouseId" placeholder={aiAvailable ? "Detect from document" : "Choose later"} options={rentalHouses} />
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
            setProblem(sizeProblem(files));
          }}
        />
        <label
          htmlFor="document-files"
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-surface px-4 py-10 text-center hover:border-ring/60"
        >
          <FileUp className="size-8 text-accent" aria-hidden />
          <span className="font-medium">{names.length ? `${names.length} file${names.length === 1 ? "" : "s"} selected` : "Choose PDF or take photos"}</span>
          <span className="text-xs text-muted">PDF, or one photo per page (JPEG, PNG, WebP) · up to 20 files, 25 MB each, 100 MB in total</span>
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
          ? "The document is read automatically. You review every line before anything changes on the project."
          : "AI reading is not configured on this server, so you will enter the lines yourself after uploading."}
      </p>
      <SubmitButton className={`${buttonVariants.primary} w-full sm:w-auto`} pendingText="Uploading…" disabled={problem !== null}>
        Upload
      </SubmitButton>
    </ActionForm>
  );
}

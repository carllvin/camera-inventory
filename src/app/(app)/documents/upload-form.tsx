"use client";

import { useState } from "react";
import { FileUp } from "lucide-react";
import { ActionForm, Select, SubmitButton } from "@/components/forms";
import { buttonVariants } from "@/components/ui";
import { uploadDocumentAction } from "./actions";

export function UploadForm({
  kind,
  projects,
  rentalHouses,
  defaultProjectId,
  aiAvailable,
}: {
  kind: "delivery_note" | "return_note";
  projects: { value: string; label: string }[];
  rentalHouses: { value: string; label: string }[];
  defaultProjectId?: string;
  aiAvailable: boolean;
}) {
  const [names, setNames] = useState<string[]>([]);
  return (
    <ActionForm action={uploadDocumentAction} className="space-y-5">
      <input type="hidden" name="kind" value={kind} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Project" name="projectId" placeholder="Choose project…" defaultValue={defaultProjectId} options={projects} required />
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
          onChange={(e) => setNames(Array.from(e.target.files ?? []).map((f) => f.name))}
        />
        <label
          htmlFor="document-files"
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-surface px-4 py-10 text-center hover:border-ring/60"
        >
          <FileUp className="size-8 text-accent" aria-hidden />
          <span className="font-medium">{names.length ? `${names.length} file${names.length === 1 ? "" : "s"} selected` : "Choose PDF or take photos"}</span>
          <span className="text-xs text-muted">PDF, or one photo per page (JPEG, PNG, WebP) · up to 20 files, 25 MB each</span>
          {names.length > 0 && <span className="max-w-full truncate text-xs text-text">{names.join(", ")}</span>}
        </label>
      </div>
      <p className="text-sm text-muted">
        {aiAvailable
          ? "The document is read automatically. You review every line before anything changes on the project."
          : "AI reading is not configured on this server, so you will enter the lines yourself after uploading."}
      </p>
      <SubmitButton className={`${buttonVariants.primary} w-full sm:w-auto`} pendingText="Uploading…">
        Upload
      </SubmitButton>
    </ActionForm>
  );
}

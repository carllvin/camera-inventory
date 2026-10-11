"use client";

import { useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import { ActionForm, Field, SubmitButton } from "./forms";
import { buttonVariants } from "./ui";
import { useT } from "./i18n";
import { removePhotoAction, uploadPhotosAction, type PhotoTarget } from "@/app/(app)/media/actions";

/** Pick or take photos (phone camera opens directly) and upload them. */
export function PhotoUpload({ target, label }: { target: PhotoTarget; label?: string }) {
  const t = useT();
  const [count, setCount] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  return (
    <ActionForm action={uploadPhotosAction.bind(null, target)} className="space-y-2" resetOnSuccess onSuccess={() => setCount(0)}>
      <input
        ref={input}
        type="file"
        name="file"
        accept="image/*"
        multiple
        className="sr-only"
        id={`photo-${target.id}`}
        onChange={(e) => setCount(e.target.files?.length ?? 0)}
      />
      <label htmlFor={`photo-${target.id}`} className={`${buttonVariants.secondary} w-full cursor-pointer`}>
        <ImagePlus className="size-4" /> {count ? (count === 1 ? t("1 photo selected") : t("{n} photos selected", { n: count })) : (label ?? t("Add photos"))}
      </label>
      {count > 0 && (
        <>
          <Field name="caption" placeholder={t("Caption (optional)")} aria-label={t("Photo caption")} id={`caption-${target.id}`} />
          <SubmitButton className="w-full" pendingText={t("Uploading…")}>
            {t("Upload")}
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function RemovePhotoButton({ target, photoId }: { target: PhotoTarget; photoId: string }) {
  const t = useT();
  return (
    <ActionForm action={removePhotoAction.bind(null, target, photoId)}>
      <SubmitButton variant="ghost" className="!px-2 !py-1 text-xs text-muted" pendingText="…" aria-label={t("Remove photo")}>
        {t("Remove")}
      </SubmitButton>
    </ActionForm>
  );
}

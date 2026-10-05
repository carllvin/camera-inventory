"use client";

import { useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import { ActionForm, Field, SubmitButton } from "./forms";
import { buttonVariants } from "./ui";
import { removePhotoAction, uploadPhotosAction, type PhotoTarget } from "@/app/(app)/media/actions";

/** Pick or take photos (phone camera opens directly) and upload them. */
export function PhotoUpload({ target, label = "Add photos" }: { target: PhotoTarget; label?: string }) {
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
        <ImagePlus className="size-4" /> {count ? `${count} photo${count === 1 ? "" : "s"} selected` : label}
      </label>
      {count > 0 && (
        <>
          <Field name="caption" placeholder="Caption (optional)" aria-label="Photo caption" id={`caption-${target.id}`} />
          <SubmitButton className="w-full" pendingText="Uploading…">
            Upload
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function RemovePhotoButton({ target, photoId }: { target: PhotoTarget; photoId: string }) {
  return (
    <ActionForm action={removePhotoAction.bind(null, target, photoId)}>
      <SubmitButton variant="ghost" className="!px-2 !py-1 text-xs text-muted" pendingText="…" aria-label="Remove photo">
        Remove
      </SubmitButton>
    </ActionForm>
  );
}

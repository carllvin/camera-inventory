"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, X } from "lucide-react";
import { cn } from "@/lib/format";

/**
 * Small product picture (item photo or the type's reference image), a camera icon without one.
 * A click on the picture shows it large; it never opens the row or link it sits in.
 */
export function Thumb({ photoId, name, className }: { photoId: string | null; name: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const box = cn("flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-gradient-to-b from-white to-zinc-100 text-zinc-400", className);
  if (!photoId) {
    return (
      <div className={box}>
        <Camera className="size-5" strokeWidth={1.25} aria-hidden />
      </div>
    );
  }
  return (
    <>
      <button
        type="button"
        aria-label={`Show picture of ${name}`}
        onClick={(e) => {
          // Inside a link, a <summary> or a checkbox label: only open the picture.
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className={cn(box, "cursor-zoom-in hover:ring-2 hover:ring-ring/60 focus-visible:ring-2 focus-visible:ring-ring")}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-checked images */}
        <img src={`/api/photos/${photoId}?size=thumb`} alt={name} loading="lazy" className="h-full w-full object-contain p-0.5 mix-blend-multiply" />
      </button>
      {open && <PicturePreview photoId={photoId} name={name} onClose={() => setOpen(false)} />}
    </>
  );
}

/** The picture large above the page; a click anywhere, Escape or × closes it. */
function PicturePreview({ photoId, name, onClose }: { photoId: string; name: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={name}
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
    >
      <figure className="relative max-h-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-2xl">
        {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-checked images */}
        <img src={`/api/photos/${photoId}`} alt={name} className="max-h-[75vh] w-auto object-contain p-3" />
        <figcaption className="border-t border-zinc-200 px-4 py-2 text-sm text-zinc-700">{name}</figcaption>
        <button type="button" aria-label="Close picture" onClick={onClose} className="absolute top-2 right-2 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80">
          <X className="size-4" />
        </button>
      </figure>
    </div>,
    document.body,
  );
}

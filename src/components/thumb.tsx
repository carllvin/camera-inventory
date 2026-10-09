import { Camera } from "lucide-react";
import { cn } from "@/lib/format";

/** Small product picture (item photo or the type's reference image), a camera icon without one. */
export function Thumb({ photoId, name, className }: { photoId: string | null; name: string; className?: string }) {
  return (
    <div className={cn("flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-gradient-to-b from-white to-zinc-100 text-zinc-400", className)}>
      {photoId ? (
        // eslint-disable-next-line @next/next/no-img-element -- private, auth-checked images
        <img src={`/api/photos/${photoId}?size=thumb`} alt={name} loading="lazy" className="h-full w-full object-contain p-0.5 mix-blend-multiply" />
      ) : (
        <Camera className="size-5" strokeWidth={1.25} aria-hidden />
      )}
    </div>
  );
}

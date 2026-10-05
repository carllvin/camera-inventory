import { Camera } from "lucide-react";
import { cn } from "@/lib/format";

/**
 * Reference image of an equipment type, always on a light neutral background so
 * product shots look consistent in light and dark mode. Falls back to a placeholder.
 */
export function TypeImage({ name, photoId, className, size = "thumb" }: { name: string; photoId?: string | null; className?: string; size?: "thumb" | "full" }) {
  return (
    <div className={cn("flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg bg-gradient-to-b from-white to-zinc-100 text-zinc-400", className)}>
      {photoId ? (
        // eslint-disable-next-line @next/next/no-img-element -- private, auth-checked images
        <img src={`/api/photos/${photoId}${size === "thumb" ? "?size=thumb" : ""}`} alt={name} loading="lazy" className="h-full w-full object-contain p-2 mix-blend-multiply" />
      ) : (
        <div className="flex flex-col items-center gap-2 px-4 text-center">
          <Camera className="size-10" strokeWidth={1.25} aria-hidden />
          <span className="text-xs text-zinc-500">{name}</span>
        </div>
      )}
    </div>
  );
}

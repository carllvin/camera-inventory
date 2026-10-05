import { Camera } from "lucide-react";
import { cn } from "@/lib/format";

/**
 * Reference image of an equipment type on a light, neutral background.
 * Images are served from object storage once the storage service exists (Phase 5);
 * until then a neutral placeholder is shown.
 */
export function TypeImage({ name, className }: { name: string; storageKey?: string | null; className?: string }) {
  return (
    <div className={cn("flex aspect-[4/3] items-center justify-center rounded-lg bg-gradient-to-b from-white to-zinc-100 text-zinc-400", className)}>
      <div className="flex flex-col items-center gap-2 px-4 text-center">
        <Camera className="size-10" strokeWidth={1.25} aria-hidden />
        <span className="text-xs text-zinc-500">{name}</span>
      </div>
    </div>
  );
}

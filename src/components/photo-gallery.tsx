import { formatDateTime } from "@/lib/format";
import type { PhotoTarget } from "@/app/(app)/media/actions";
import { PhotoUpload, RemovePhotoButton } from "./photo-upload";
import { Card, CardHeader } from "./ui";

export interface GalleryPhoto {
  id: string;
  caption: string | null;
  createdAt: Date;
  uploadedBy: string | null;
  isPrimary?: boolean;
}

export function PhotoGallery({ photos, target, canEdit, title = "Photos" }: { photos: GalleryPhoto[]; target: PhotoTarget; canEdit: boolean; title?: string }) {
  return (
    <Card>
      <CardHeader title={`${title}${photos.length ? ` (${photos.length})` : ""}`} />
      <div className="space-y-3 p-3">
        {photos.length === 0 ? (
          <p className="px-1 text-sm text-muted">No photos yet.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {photos.map((p) => (
              <li key={p.id} className="overflow-hidden rounded-lg border border-border bg-surface-2">
                <a href={`/api/photos/${p.id}`} target="_blank" rel="noopener" className="block">
                  {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-checked images */}
                  <img src={`/api/photos/${p.id}?size=thumb`} alt={p.caption ?? "Photo"} loading="lazy" className="aspect-[4/3] w-full object-cover" />
                </a>
                <div className="flex items-start justify-between gap-1 px-2 py-1.5">
                  <div className="min-w-0 text-[11px] leading-tight text-muted">
                    {p.caption && <div className="truncate text-xs text-text">{p.caption}</div>}
                    {formatDateTime(p.createdAt)}
                    {p.uploadedBy && ` · ${p.uploadedBy}`}
                  </div>
                  {canEdit && <RemovePhotoButton target={target} photoId={p.id} />}
                </div>
              </li>
            ))}
          </ul>
        )}
        {canEdit && <PhotoUpload target={target} />}
      </div>
    </Card>
  );
}

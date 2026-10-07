"use client";

import { Undo2 } from "lucide-react";
import type { ActionState } from "@/server/actions";
import { ActionForm, SubmitButton } from "./forms";

/** Small "Undo" next to a history entry. */
export function UndoButton({ action, label }: { action: (prev: ActionState, fd: FormData) => Promise<ActionState>; label: string }) {
  return (
    <ActionForm action={action}>
      <SubmitButton variant="ghost" className="!px-1.5 !py-0.5 text-xs text-muted hover:text-text" pendingText="…" aria-label={`Undo: ${label}`}>
        <Undo2 className="size-3.5" /> Undo
      </SubmitButton>
    </ActionForm>
  );
}

"use client";

import { Undo2 } from "lucide-react";
import type { ActionState } from "@/server/actions";
import { ActionForm, SubmitButton } from "./forms";
import { useT } from "./i18n";

/** Small "Undo" next to a history entry. */
export function UndoButton({ action, label }: { action: (prev: ActionState, fd: FormData) => Promise<ActionState>; label: string }) {
  const t = useT();
  return (
    <ActionForm action={action}>
      <SubmitButton variant="ghost" className="!px-1.5 !py-0.5 text-xs text-muted hover:text-text" pendingText="…" aria-label={t("Undo: {msg}", { msg: label })}>
        <Undo2 className="size-3.5" /> {t("Undo")}
      </SubmitButton>
    </ActionForm>
  );
}

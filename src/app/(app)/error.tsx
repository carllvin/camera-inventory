"use client";

import { useEffect } from "react";
import { EmptyState, buttonVariants } from "@/components/ui";
import { useT } from "@/components/i18n";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <EmptyState
      title={t("Something went wrong")}
      action={
        <button type="button" onClick={reset} className={buttonVariants.secondary}>
          {t("Try again")}
        </button>
      }
    >
      {t("The page could not be loaded. Nothing was changed.")}
      {error.digest && <span className="block text-xs">{t("Reference: {digest}", { digest: error.digest })}</span>}
    </EmptyState>
  );
}

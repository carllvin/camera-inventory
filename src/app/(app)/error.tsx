"use client";

import { useEffect } from "react";
import { EmptyState, buttonVariants } from "@/components/ui";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <EmptyState
      title="Something went wrong"
      action={
        <button type="button" onClick={reset} className={buttonVariants.secondary}>
          Try again
        </button>
      }
    >
      The page could not be loaded. Nothing was changed.{error.digest && <span className="block text-xs">Reference: {error.digest}</span>}
    </EmptyState>
  );
}

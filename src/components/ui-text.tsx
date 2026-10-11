"use client";

import { useT } from "./i18n";

/**
 * Texts of the shared components in ui.tsx, which render on the server and in
 * client components alike (and so cannot await getT()).
 */

/** A value of one of the label maps in lib/format (STATUS_LABEL etc.), in the user's language. */
export function LabelText({ text }: { text: string }) {
  const t = useT();
  return <>{t(text)}</>;
}

export function NoPermissionTitle() {
  const t = useT();
  return <>{t("No permission")}</>;
}

export function NoPermissionText() {
  const t = useT();
  return <>{t("Your role in this workspace does not allow this action. Ask a workspace admin.")}</>;
}

/** The tab bar's frame (`<nav aria-label="Sections">`). */
export function SectionsNav({ className, children }: { className?: string; children: React.ReactNode }) {
  const t = useT();
  return (
    <nav className={className} aria-label={t("Sections")}>
      {children}
    </nav>
  );
}

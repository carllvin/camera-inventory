"use client";

import { useTransition } from "react";
import { Clapperboard } from "lucide-react";
import { setCurrentProjectAction } from "@/app/(app)/current-project-actions";
import { useT } from "./i18n";

/** Header control: which project the app focuses on. */
export function ProjectSwitcher({ projects, currentId }: { projects: { id: string; name: string }[]; currentId: string | null }) {
  const t = useT();
  const [pending, start] = useTransition();
  if (projects.length === 0) return null;
  return (
    <label className="relative flex items-center" title={t("Current project")}>
      <Clapperboard className="pointer-events-none absolute left-2.5 size-4 text-accent" aria-hidden />
      <span className="sr-only">{t("Current project")}</span>
      <select
        className="input h-9 max-w-[13rem] truncate rounded-full !py-1 pr-7 pl-8 text-sm font-medium sm:max-w-[16rem]"
        value={currentId ?? "all"}
        disabled={pending}
        onChange={(e) => start(() => setCurrentProjectAction(e.target.value))}
      >
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
        <option value="all">{t("All projects")}</option>
      </select>
    </label>
  );
}

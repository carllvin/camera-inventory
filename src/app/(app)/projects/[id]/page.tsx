import { getCtx } from "@/server/auth/context";
import { assertUuid } from "@/server/pages";
import { ProjectDashboard } from "../../project-dashboard";

/** A project's page: what needs doing, its calendar, sets and activity (equipment lives on the Equipment tab). */
export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ month?: string; add?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  assertUuid(id);
  return <ProjectDashboard ctx={await getCtx()} projectId={id} month={sp.month} add={sp.add} />;
}

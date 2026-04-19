import { json } from "@sveltejs/kit";
import { regenerateProjectFiles } from "$lib/server/sync/projector";
import { getProject } from "$lib/server/db/repositories/project-repository";

export async function POST() {
  regenerateProjectFiles();
  const project = getProject();

  return json({
    ok: true,
    syncStatus: project?.syncStatus ?? "healthy",
  });
}

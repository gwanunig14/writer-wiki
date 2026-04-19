import { json } from "@sveltejs/kit";
import { z } from "zod";
import { createProject } from "$lib/server/db/repositories/project-repository";
import { saveProviderKey } from "$lib/server/settings/secrets";
import { getAppPaths } from "$lib/server/settings/config";
import { seedProjectData } from "$lib/server/filesystem/seed-project-data";

const requestSchema = z.object({
  name: z.string().min(1),
  provider: z.enum(["openai", "anthropic"]),
  model: z.string().optional().nullable(),
  apiKey: z.string().min(1).optional(),
  rootPath: z.string().optional(),
});

export async function POST({ request }) {
  const payload = requestSchema.parse(await request.json());
  const { projectDataDir } = getAppPaths();

  if (payload.apiKey) {
    saveProviderKey(payload.provider, payload.apiKey);
  }

  const project = createProject({
    name: payload.name,
    provider: payload.provider,
    defaultModel: payload.model ?? null,
    rootPath: payload.rootPath ?? projectDataDir,
  });

  seedProjectData(project.name);

  return json(
    {
      id: project.id,
      name: project.name,
      provider: project.provider,
      rootPath: project.rootPath,
      syncStatus: project.syncStatus,
    },
    { status: 201 },
  );
}

import { json } from "@sveltejs/kit";
import { z } from "zod";
import { exportProject } from "$lib/server/export/export-project";

const requestSchema = z.object({
  includeSecrets: z.boolean().optional().default(false),
});

export async function POST({ request }) {
  const payload = requestSchema.parse(await request.json());
  const exported = await exportProject(payload);

  return json({
    fileName: exported.fileName,
    downloadPath: exported.downloadPath,
  });
}

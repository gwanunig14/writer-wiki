import type { Handle } from "@sveltejs/kit";
import { migrate } from "$lib/server/db/migrate";
import { getProjectState } from "$lib/server/db/repositories/project-repository";
import { ensureWorkspaceSeed } from "$lib/server/filesystem/workspace";

export const handle: Handle = async ({ event, resolve }) => {
  migrate();
  ensureWorkspaceSeed();
  event.locals.projectState = getProjectState();
  return resolve(event);
};

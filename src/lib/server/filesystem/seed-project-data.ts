import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAppPaths } from "$lib/server/settings/config";
import { ensureWorkspaceSeed } from "./workspace";

export function seedProjectData(projectName: string) {
  const { projectDataDir } = getAppPaths();
  ensureWorkspaceSeed();

  const readmePath = join(projectDataDir, "README.md");
  if (!existsSync(readmePath)) {
    writeFileSync(
      readmePath,
      `# ${projectName}\n\nThis folder contains deterministic chapter, wiki, chronology, and continuity projections for Author Canon Keeper.\n`,
    );
  }
}

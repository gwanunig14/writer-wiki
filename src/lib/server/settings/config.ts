import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

export interface AppPaths {
  dataDir: string;
  dbPath: string;
  secretsPath: string;
  projectDataDir: string;
  promptsDir: string;
  userCanonDecisionsPath: string;
}

let cachedPaths: AppPaths | null = null;

export function getAppPaths(): AppPaths {
  if (cachedPaths) {
    return cachedPaths;
  }

  const dataDir = resolve(
    process.env.ACK_DATA_DIR ?? join(process.cwd(), ".local-data"),
  );
  const dbPath = resolve(
    process.env.ACK_DB_PATH ?? join(dataDir, "author-canon-keeper.sqlite"),
  );
  const secretsPath = resolve(join(dataDir, "provider-secrets.json"));
  const projectDataDir = resolve(
    process.env.ACK_PROJECT_DATA_DIR ?? join(process.cwd(), "project-data"),
  );
  const promptsDir = join(projectDataDir, "system", "prompts");
  const userCanonDecisionsPath = join(
    projectDataDir,
    "system",
    "user-canon-decisions.json",
  );

  mkdirSync(dataDir, { recursive: true });
  mkdirSync(projectDataDir, { recursive: true });
  mkdirSync(promptsDir, { recursive: true });

  cachedPaths = {
    dataDir,
    dbPath,
    secretsPath,
    projectDataDir,
    promptsDir,
    userCanonDecisionsPath,
  };
  return cachedPaths;
}

export function resetPathsForTests() {
  cachedPaths = null;
}

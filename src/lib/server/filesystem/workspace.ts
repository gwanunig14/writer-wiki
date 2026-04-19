import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAppPaths } from "$lib/server/settings/config";

const baseDirectories = [
  ["chapters"],
  ["wiki", "Characters"],
  ["wiki", "Locations"],
  ["wiki", "Items"],
  ["wiki", "Organizations"],
  ["wiki", "Chronology"],
  ["wiki", "Continuity"],
  ["system", "prompts"],
];

export function ensureWorkspaceSeed() {
  const { projectDataDir } = getAppPaths();
  for (const segments of baseDirectories) {
    mkdirSync(join(projectDataDir, ...segments), { recursive: true });
  }

  const seedFiles = [
    [
      join(projectDataDir, "wiki", "Chronology", "Chronology.md"),
      "# Chronology\n\nNo chronology entries yet.\n",
    ],
    [
      join(projectDataDir, "wiki", "Continuity", "Watchlist.md"),
      "# Continuity Watchlist\n\nNo watchlist items yet.\n",
    ],
    [
      join(projectDataDir, "system", "constitution.txt"),
      "Author Canon Keeper Constitution\n",
    ],
    [
      join(projectDataDir, "system", "prompts", "scan.txt"),
      "Scan prompt placeholder\n",
    ],
    [join(projectDataDir, "system", "user-canon-decisions.json"), "[]\n"],
  ] as const;

  for (const [filePath, contents] of seedFiles) {
    if (!existsSync(filePath)) {
      writeFileSync(filePath, contents);
    }
  }
}

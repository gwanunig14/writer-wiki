import { createWriteStream } from "node:fs";
import { mkdir, readdir, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import archiver from "archiver";
import { getAppPaths } from "$lib/server/settings/config";

async function collectFiles(rootPath: string): Promise<string[]> {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(rootPath, entry.name);
      if (entry.isDirectory()) {
        return collectFiles(fullPath);
      }

      return [fullPath];
    }),
  );

  return files.flat();
}

export async function exportProject(options?: { includeSecrets?: boolean }) {
  const { dataDir, dbPath, projectDataDir, secretsPath } = getAppPaths();
  const exportDir = join(dataDir, "exports");
  await mkdir(exportDir, { recursive: true });

  const fileName = `author-canon-keeper-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
  const downloadPath = join(exportDir, fileName);
  const output = createWriteStream(downloadPath);
  const archive = archiver("zip", { zlib: { level: 9 } });

  const includedEntries: string[] = [];

  archive.pipe(output);
  archive.file(dbPath, { name: basename(dbPath) });
  includedEntries.push(basename(dbPath));

  for (const filePath of await collectFiles(projectDataDir)) {
    const archivePath = join(
      "project-data",
      relative(projectDataDir, filePath),
    );
    archive.file(filePath, { name: archivePath });
    includedEntries.push(archivePath);
  }

  if (options?.includeSecrets) {
    const secretStats = await stat(secretsPath).catch(() => null);
    if (secretStats?.isFile()) {
      archive.file(secretsPath, { name: "provider-secrets.json" });
      includedEntries.push("provider-secrets.json");
    }
  }

  await archive.finalize();

  await new Promise<void>((resolve, reject) => {
    output.on("close", () => resolve());
    output.on("error", reject);
    archive.on("error", reject);
  });

  return {
    fileName,
    downloadPath,
    includedEntries,
  };
}

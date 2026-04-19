import { beforeEach, describe, expect, it } from "vitest";
import { rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { migrate } from "$lib/server/db/migrate";
import { resetDatabaseForTests } from "$lib/server/db/client";
import { resetPathsForTests } from "$lib/server/settings/config";
import { waitForScanJob } from "$lib/server/scan/scan-orchestrator";
import { updateProjectSyncStatus } from "$lib/server/db/repositories/project-repository";
import { POST as createChapter } from "../../src/routes/api/chapters/+server";
import { POST as scanChapter } from "../../src/routes/api/chapters/[id]/scan/+server";
import { POST as exportZip } from "../../src/routes/api/export/zip/+server";
import { POST as repairSync } from "../../src/routes/api/settings/repair/+server";
import { POST as createProject } from "../../src/routes/api/setup/project/+server";

const testRoot = join(process.cwd(), ".tmp-test-data-export");

function makeJsonRequest(body: unknown) {
  return new Request("http://localhost", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("export and sync repair", () => {
  beforeEach(() => {
    resetDatabaseForTests();
    resetPathsForTests();
    rmSync(testRoot, { force: true, recursive: true });
    process.env.ACK_DATA_DIR = testRoot;
    process.env.ACK_DB_PATH = join(testRoot, "author-canon-keeper.sqlite");
    process.env.ACK_PROJECT_DATA_DIR = join(testRoot, "project-data");
    migrate();
  });

  it("exports the project without secrets by default and repairs degraded sync", async () => {
    await createProject({
      request: makeJsonRequest({
        name: "Atlas Draft",
        provider: "openai",
        apiKey: "ack-demo-local",
      }),
    } as never);

    const chapterResponse = await createChapter({
      request: makeJsonRequest({
        number: 1,
        title: "Arrival",
        text: "Alice arrives in Harbor City and meets Bob.",
      }),
    } as never);
    const chapter = await chapterResponse.json();

    const scanResponse = await scanChapter({
      params: { id: chapter.id },
      request: makeJsonRequest({ forceRescan: true }),
    } as never);
    const scanJob = await scanResponse.json();
    await waitForScanJob(scanJob.id);

    const exportResponse = await exportZip({
      request: makeJsonRequest({ includeSecrets: false }),
    } as never);
    const exportPayload = await exportResponse.json();
    expect(existsSync(exportPayload.downloadPath)).toBe(true);

    const archiveListing = execFileSync(
      "unzip",
      ["-l", exportPayload.downloadPath],
      { encoding: "utf-8" },
    );
    expect(archiveListing).toContain("author-canon-keeper.sqlite");
    expect(archiveListing).not.toContain("provider-secrets.json");

    updateProjectSyncStatus("degraded");
    const repairResponse = await repairSync();
    const repairPayload = await repairResponse.json();
    expect(repairPayload.ok).toBe(true);
    expect(repairPayload.syncStatus).toBe("healthy");
  });
});

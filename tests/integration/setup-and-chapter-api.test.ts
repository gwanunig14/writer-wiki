import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { migrate } from "$lib/server/db/migrate";
import { resetDatabaseForTests } from "$lib/server/db/client";
import { resetPathsForTests } from "$lib/server/settings/config";
import { waitForScanJob } from "$lib/server/scan/scan-orchestrator";
import {
  GET as getChapters,
  POST as createChapter,
} from "../../src/routes/api/chapters/+server";
import { GET as getChapter } from "../../src/routes/api/chapters/[id]/+server";
import { POST as scanChapter } from "../../src/routes/api/chapters/[id]/scan/+server";
import { GET as getScanJob } from "../../src/routes/api/scan-jobs/[scanJobId]/+server";
import { POST as createProject } from "../../src/routes/api/setup/project/+server";
import { POST as testProvider } from "../../src/routes/api/setup/provider/test/+server";

const testRoot = join(process.cwd(), ".tmp-test-data-integration");

function makeJsonRequest(body: unknown) {
  return new Request("http://localhost", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("setup and chapter api", () => {
  beforeEach(() => {
    resetDatabaseForTests();
    resetPathsForTests();
    rmSync(testRoot, { force: true, recursive: true });
    process.env.ACK_DATA_DIR = testRoot;
    process.env.ACK_DB_PATH = join(testRoot, "author-canon-keeper.sqlite");
    process.env.ACK_PROJECT_DATA_DIR = join(testRoot, "project-data");
    migrate();
  });

  it("creates a local project, saves a chapter, and completes a scan", async () => {
    const providerResponse = await testProvider({
      request: makeJsonRequest({
        provider: "openai",
        apiKey: "ack-demo-local",
      }),
    } as never);
    expect(providerResponse.status).toBe(200);
    expect((await providerResponse.json()).ok).toBe(true);

    const projectResponse = await createProject({
      request: makeJsonRequest({
        name: "Atlas Draft",
        provider: "openai",
        apiKey: "ack-demo-local",
      }),
    } as never);
    expect(projectResponse.status).toBe(201);

    const createdChapterResponse = await createChapter({
      request: makeJsonRequest({
        number: 1,
        title: "Arrival",
        text: "Alice arrives in Harbor City and meets Bob.",
      }),
    } as never);
    expect(createdChapterResponse.status).toBe(201);
    const chapter = await createdChapterResponse.json();

    const chaptersResponse = await getChapters();
    const chaptersPayload = await chaptersResponse.json();
    expect(chaptersPayload.chapters).toHaveLength(1);

    const chapterDetailResponse = await getChapter({
      params: { id: chapter.id },
    } as never);
    expect(chapterDetailResponse.status).toBe(200);

    const scanResponse = await scanChapter({
      params: { id: chapter.id },
      request: makeJsonRequest({ forceRescan: true }),
    } as never);
    expect(scanResponse.status).toBe(202);
    const scanJob = await scanResponse.json();

    await waitForScanJob(scanJob.id);

    const scanStatusResponse = await getScanJob({
      params: { scanJobId: scanJob.id },
    } as never);
    const scanStatus = await scanStatusResponse.json();
    expect(scanStatus.status).toBe("success");

    expect(
      existsSync(join(testRoot, "project-data", "chapters", "001-arrival.md")),
    ).toBe(true);
    expect(
      existsSync(
        join(testRoot, "project-data", "wiki", "Characters", "alice.md"),
      ),
    ).toBe(true);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { migrate } from "$lib/server/db/migrate";
import { resetDatabaseForTests } from "$lib/server/db/client";
import { resetPathsForTests } from "$lib/server/settings/config";
import { waitForScanJob } from "$lib/server/scan/scan-orchestrator";
import { POST as createChapter } from "../../src/routes/api/chapters/+server";
import { POST as scanChapter } from "../../src/routes/api/chapters/[id]/scan/+server";
import { POST as chatQuery } from "../../src/routes/api/chat/query/+server";
import { POST as createProject } from "../../src/routes/api/setup/project/+server";

const testRoot = join(process.cwd(), ".tmp-test-data-chat");

function makeJsonRequest(body: unknown) {
  return new Request("http://localhost", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("chat api", () => {
  beforeEach(() => {
    resetDatabaseForTests();
    resetPathsForTests();
    rmSync(testRoot, { force: true, recursive: true });
    process.env.ACK_DATA_DIR = testRoot;
    process.env.ACK_DB_PATH = join(testRoot, "author-canon-keeper.sqlite");
    process.env.ACK_PROJECT_DATA_DIR = join(testRoot, "project-data");
    migrate();
  });

  it("answers canon questions and refuses brainstorming requests", async () => {
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

    const answerResponse = await chatQuery({
      request: makeJsonRequest({ question: "Who arrives in Harbor City?" }),
    } as never);
    const answerPayload = await answerResponse.json();
    expect(answerPayload.answer.direct.length).toBeGreaterThan(0);
    expect(answerPayload.evidence.length).toBeGreaterThan(0);

    const refusalResponse = await chatQuery({
      request: makeJsonRequest({
        question: "Brainstorm a new ending for this novel.",
      }),
    } as never);
    const refusalPayload = await refusalResponse.json();
    expect(refusalPayload.answer.direct).toContain(
      "cannot help with brainstorming",
    );

    const actionResponse = await chatQuery({
      request: makeJsonRequest({ question: "Jurt is an exclamation." }),
    } as never);
    const actionPayload = await actionResponse.json();
    expect(actionPayload.answer.direct).toContain("Reply with confirm");

    const confirmResponse = await chatQuery({
      request: makeJsonRequest({
        conversationId: actionPayload.conversationId,
        question: "confirm",
      }),
    } as never);
    const confirmPayload = await confirmResponse.json();
    expect(confirmPayload.answer.direct).toContain("ignore Jurt");

    const decisions = JSON.parse(
      readFileSync(
        join(testRoot, "project-data", "system", "user-canon-decisions.json"),
        "utf-8",
      ),
    ) as Array<Record<string, unknown>>;
    expect(decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "suppress",
          matchNames: expect.arrayContaining(["Jurt"]),
        }),
      ]),
    );

    const mergeActionResponse = await chatQuery({
      request: makeJsonRequest({ question: "merge Alice into Bob" }),
    } as never);
    const mergeActionPayload = await mergeActionResponse.json();
    expect(mergeActionPayload.answer.direct).toContain("Reply with confirm");

    const mergeConfirmResponse = await chatQuery({
      request: makeJsonRequest({
        conversationId: mergeActionPayload.conversationId,
        question: "confirm",
      }),
    } as never);
    const mergeConfirmPayload = await mergeConfirmResponse.json();
    expect(mergeConfirmPayload.answer.direct).toContain(
      "Merged Alice into Bob",
    );

    const decisionsAfterMerge = JSON.parse(
      readFileSync(
        join(testRoot, "project-data", "system", "user-canon-decisions.json"),
        "utf-8",
      ),
    ) as Array<Record<string, unknown>>;
    expect(decisionsAfterMerge).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "merge",
          mergeIntoName: "Bob",
          matchNames: expect.arrayContaining(["Alice"]),
        }),
      ]),
    );
  });
});

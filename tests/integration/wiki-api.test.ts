import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { getDatabase, makeId, nowIso } from "$lib/server/db/client";
import { migrate } from "$lib/server/db/migrate";
import { resetDatabaseForTests } from "$lib/server/db/client";
import { resetPathsForTests } from "$lib/server/settings/config";
import { waitForScanJob } from "$lib/server/scan/scan-orchestrator";
import { GET as getWikiTree } from "../../src/routes/api/wiki/tree/+server";
import { GET as getWikiPage } from "../../src/routes/api/wiki/[category]/[slug]/+server";
import { PUT as updateWikiPage } from "../../src/routes/api/wiki/[category]/[slug]/+server";
import { POST as dismissContinuityItem } from "../../src/routes/api/continuity/watchlist/[id]/dismiss/+server";
import { POST as createChapter } from "../../src/routes/api/chapters/+server";
import { POST as scanChapter } from "../../src/routes/api/chapters/[id]/scan/+server";
import { POST as createProject } from "../../src/routes/api/setup/project/+server";
import { reconcileCanon } from "$lib/server/scan/reconcile-canon";

const testRoot = join(process.cwd(), ".tmp-test-data-wiki");

function makeJsonRequest(body: unknown) {
  return new Request("http://localhost", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makePutRequest(body: unknown) {
  return new Request("http://localhost", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("wiki api", () => {
  beforeEach(() => {
    resetDatabaseForTests();
    resetPathsForTests();
    rmSync(testRoot, { force: true, recursive: true });
    process.env.ACK_DATA_DIR = testRoot;
    process.env.ACK_DB_PATH = join(testRoot, "author-canon-keeper.sqlite");
    process.env.ACK_PROJECT_DATA_DIR = join(testRoot, "project-data");
    migrate();
  });

  it("returns wiki tree nodes and wiki pages after a scan", async () => {
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

    const treeResponse = await getWikiTree();
    const treePayload = await treeResponse.json();
    const characterNode = treePayload.nodes.find(
      (node: { label: string }) => node.label === "Characters",
    );
    expect(characterNode).toBeTruthy();
    expect(
      characterNode.children.some(
        (child: { label: string }) => child.label === "Minor",
      ),
    ).toBe(true);

    const pageResponse = await getWikiPage({
      params: { category: "character", slug: "alice" },
    } as never);
    const pagePayload = await pageResponse.json();
    expect(pagePayload.title).toBe("Alice");
    expect(pagePayload.kind).toBe("article");

    const allPageResponse = await getWikiPage({
      params: { category: "character", slug: "character-all" },
    } as never);
    const allPagePayload = await allPageResponse.json();
    expect(allPagePayload.body).toContain("Alice");

    const updateResponse = await updateWikiPage({
      params: { category: "character", slug: "alice" },
      request: makePutRequest({
        name: "Alice",
        category: "organization",
        articleBody: "Alice now leads the Harbor Circle.",
      }),
    } as never);
    const updatePayload = await updateResponse.json();
    expect(updatePayload.redirectHref).toBe("/wiki/organization/alice");

    const updatedPageResponse = await getWikiPage({
      params: { category: "organization", slug: "alice" },
    } as never);
    const updatedPagePayload = await updatedPageResponse.json();
    expect(updatedPagePayload.category).toBe("organization");
    expect(updatedPagePayload.editableEntity.articleBody).toBe(
      "Alice now leads the Harbor Circle.",
    );
    expect(updatedPagePayload.aliases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Alice",
          sourceType: "user-managed",
        }),
      ]),
    );

    const decisions = JSON.parse(
      readFileSync(
        join(testRoot, "project-data", "system", "user-canon-decisions.json"),
        "utf-8",
      ),
    ) as Array<Record<string, unknown>>;
    expect(decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "override",
          canonicalName: "Alice",
          category: "organization",
        }),
      ]),
    );
  });

  it("merges one dossier into another from the wiki api", async () => {
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

    const mergeResponse = await updateWikiPage({
      params: { category: "character", slug: "alice" },
      request: makePutRequest({
        name: "Alice",
        category: "character",
        articleBody: "Alice arrives in Harbor City and meets Bob.",
        mergeIntoName: "Bob",
      }),
    } as never);
    const mergePayload = await mergeResponse.json();
    expect(mergePayload.redirectHref).toBe("/wiki/character/bob");

    const mergedAllPageResponse = await getWikiPage({
      params: { category: "character", slug: "character-all" },
    } as never);
    const mergedAllPagePayload = await mergedAllPageResponse.json();
    expect(mergedAllPagePayload.body).toContain("Bob");
    expect(mergedAllPagePayload.body).not.toContain("/wiki/character/alice");

    const mergedPageResponse = await getWikiPage({
      params: { category: "character", slug: "bob" },
    } as never);
    const mergedPagePayload = await mergedPageResponse.json();
    expect(mergedPagePayload.aliases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Alice",
          sourceType: "user-managed",
          sourceLabel: "Manual alias or merge",
        }),
      ]),
    );

    const decisions = JSON.parse(
      readFileSync(
        join(testRoot, "project-data", "system", "user-canon-decisions.json"),
        "utf-8",
      ),
    ) as Array<Record<string, unknown>>;
    expect(decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "merge",
          mergeIntoName: "Bob",
          matchNames: expect.arrayContaining(["Alice"]),
        }),
      ]),
    );
  });

  it("stores explicit folder paths and parent locations from dossier edits", async () => {
    await createProject({
      request: makeJsonRequest({
        name: "Atlas Draft",
        provider: "openai",
        apiKey: "ack-demo-local",
      }),
    } as never);

    const timestamp = nowIso();
    const vistanaId = makeId();
    const kinburghId = makeId();
    getDatabase()
      .prepare(
        `INSERT INTO entities (
          id, name, slug, category, subtype, parent_entity_id, is_stub, descriptor, article_body, evidence_status,
          created_from_chapter_id, last_updated_from_chapter_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 'established', NULL, NULL, ?, ?)`,
      )
      .run(
        vistanaId,
        "Vistana",
        "vistana",
        "location",
        null,
        null,
        "0",
        "Region root.",
        timestamp,
        timestamp,
      );
    getDatabase()
      .prepare(
        `INSERT INTO entities (
          id, name, slug, category, subtype, parent_entity_id, is_stub, descriptor, article_body, evidence_status,
          created_from_chapter_id, last_updated_from_chapter_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 'established', NULL, NULL, ?, ?)`,
      )
      .run(
        kinburghId,
        "Kinburgh",
        "kinburgh",
        "location",
        null,
        null,
        "0",
        "City.",
        timestamp,
        timestamp,
      );

    const updateResponse = await updateWikiPage({
      params: { category: "location", slug: "kinburgh" },
      request: makePutRequest({
        name: "Kinburgh",
        category: "location",
        articleBody: "City.",
        folderPath: "Vistana/Core Cities",
        parentLocationName: "Vistana",
      }),
    } as never);
    const updatePayload = await updateResponse.json();
    expect(updatePayload.redirectHref).toBe("/wiki/location/kinburgh");

    const updatedPageResponse = await getWikiPage({
      params: { category: "location", slug: "kinburgh" },
    } as never);
    const updatedPagePayload = await updatedPageResponse.json();
    expect(updatedPagePayload.editableEntity.folderPath).toBe(
      "Vistana/Core Cities",
    );
    expect(updatedPagePayload.editableEntity.parentLocationName).toBe(
      "Vistana",
    );

    const treeResponse = await getWikiTree();
    const treePayload = await treeResponse.json();
    const locationNode = treePayload.nodes.find(
      (node: { label: string }) => node.label === "Locations",
    );
    expect(locationNode.children).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "Vistana" })]),
    );
  });

  it("dismisses continuity watchlist items and removes them from the continuity page", async () => {
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

    reconcileCanon(chapter.id, {
      entities: [],
      chronology: [],
      watchlist: [
        {
          type: "timeline-risk",
          subject: "Arrival sequence",
          body: "Order between Alice's arrival and Bob's greeting remains unclear.",
        },
      ],
      summary: {
        articlesCreated: [],
        articlesUpdated: [],
        stubsCreated: [],
        chronologyUpdated: [],
        continuityUpdated: ["Arrival sequence"],
        contradictionsFlagged: [],
      },
    });

    const continuityPageResponse = await getWikiPage({
      params: { category: "continuity", slug: "continuity-watchlist" },
    } as never);
    const continuityPagePayload = await continuityPageResponse.json();
    expect(continuityPagePayload.continuityItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ subject: "Arrival sequence" }),
      ]),
    );

    const continuityItemId = continuityPagePayload.continuityItems[0].id;
    const dismissResponse = await dismissContinuityItem({
      params: { id: continuityItemId },
    } as never);
    const dismissPayload = await dismissResponse.json();
    expect(dismissPayload).toEqual({ ok: true, dismissed: true });

    const refreshedContinuityPageResponse = await getWikiPage({
      params: { category: "continuity", slug: "continuity-watchlist" },
    } as never);
    const refreshedContinuityPagePayload =
      await refreshedContinuityPageResponse.json();
    expect(refreshedContinuityPagePayload.continuityItems).toEqual([]);
    expect(refreshedContinuityPagePayload.resolvedContinuityItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subject: "Arrival sequence",
          status: "resolved",
        }),
      ]),
    );
    expect(refreshedContinuityPagePayload.body).not.toContain(
      "### Arrival sequence",
    );
  });
});

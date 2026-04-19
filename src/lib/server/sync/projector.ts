import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDatabase } from "$lib/server/db/client";
import {
  getProject,
  updateProjectSyncStatus,
} from "$lib/server/db/repositories/project-repository";
import type { EntitySummaryRecord } from "$lib/server/db/repositories/entity-repository";
import { getAppPaths } from "$lib/server/settings/config";
import { getEntityFolderSegments } from "$lib/server/wiki/entity-organization";

const categoryLabels = {
  character: "Characters",
  location: "Locations",
  item: "Items",
  organization: "Organizations",
} as const;

function safeFileName(value: string) {
  return (
    value
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "untitled"
  );
}

export function regenerateProjectFiles() {
  const project = getProject();
  if (!project) {
    return;
  }

  const db = getDatabase();
  const { projectDataDir } = getAppPaths();

  try {
    const chapters = db
      .prepare(
        "SELECT number, title, current_text FROM chapters ORDER BY COALESCE(number, 999999), created_at",
      )
      .all() as Array<Record<string, unknown>>;
    const entities = db
      .prepare(
        "SELECT id, name, slug, category, subtype, parent_entity_id, article_body, is_stub FROM entities ORDER BY category, name",
      )
      .all() as Array<Record<string, unknown>>;
    const generatedPages = db
      .prepare("SELECT category, slug, body FROM generated_pages ORDER BY slug")
      .all() as Array<Record<string, unknown>>;

    mkdirSync(join(projectDataDir, "chapters"), { recursive: true });
    mkdirSync(join(projectDataDir, "wiki", "Chronology"), { recursive: true });
    mkdirSync(join(projectDataDir, "wiki", "Continuity"), { recursive: true });
    for (const label of Object.values(categoryLabels)) {
      rmSync(join(projectDataDir, "wiki", label), {
        recursive: true,
        force: true,
      });
      mkdirSync(join(projectDataDir, "wiki", label), { recursive: true });
    }

    for (const chapter of chapters) {
      const prefix =
        chapter.number === null
          ? "draft"
          : String(chapter.number).padStart(3, "0");
      const filePath = join(
        projectDataDir,
        "chapters",
        `${prefix}-${safeFileName(String(chapter.title))}.md`,
      );
      writeFileSync(
        filePath,
        `# ${String(chapter.title)}\n\n${String(chapter.current_text)}`,
      );
    }

    const entityRecords = entities.map(
      (entity) =>
        ({
          id: String(entity.id),
          name: String(entity.name),
          slug: String(entity.slug),
          category: String(entity.category) as EntitySummaryRecord["category"],
          subtype: (entity.subtype as string | null) ?? null,
          parentEntityId: (entity.parent_entity_id as string | null) ?? null,
          isStub: String(entity.is_stub) === "1",
          articleBody: String(entity.article_body),
          createdFromChapterId: null,
          updatedAt: "",
        }) satisfies EntitySummaryRecord,
    );

    const entitiesByCategory = new Map(
      Object.keys(categoryLabels).map((category) => [
        category,
        entityRecords.filter((entity) => entity.category === category),
      ]),
    );

    for (const entity of entityRecords) {
      const directory = join(
        projectDataDir,
        "wiki",
        categoryLabels[entity.category],
        ...getEntityFolderSegments(
          entity,
          entitiesByCategory.get(entity.category) ?? [],
        ),
      );
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        join(directory, `${String(entity.slug)}.md`),
        `# ${String(entity.name)}\n\n${String(entity.articleBody)}\n\n${entity.isStub ? "_Stub entry._" : ""}`.trim(),
      );
    }

    for (const page of generatedPages) {
      const category = String(page.category ?? "wiki");
      const directory =
        category === "chronology"
          ? join(projectDataDir, "wiki", "Chronology")
          : category === "continuity"
            ? join(projectDataDir, "wiki", "Continuity")
            : join(projectDataDir, "wiki");
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        join(directory, `${String(page.slug)}.md`),
        String(page.body),
      );
    }

    updateProjectSyncStatus("healthy");
  } catch (error) {
    updateProjectSyncStatus("degraded");
    throw error;
  }
}

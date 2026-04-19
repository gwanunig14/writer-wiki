import { getDatabase } from "$lib/server/db/client";

export interface EntitySummaryRecord {
  id: string;
  name: string;
  slug: string;
  category: "character" | "location" | "item" | "organization";
  subtype: string | null;
  parentEntityId: string | null;
  isStub: boolean;
  articleBody: string;
  createdFromChapterId: string | null;
  updatedAt: string;
}

export interface EntityAliasRecord {
  name: string;
  sourceType: "chapter-scan" | "user-managed";
  sourceLabel?: string;
  createdAt: string;
}

function mapEntity(row: Record<string, unknown>): EntitySummaryRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    category: row.category as EntitySummaryRecord["category"],
    subtype: (row.subtype as string | null) ?? null,
    parentEntityId: (row.parent_entity_id as string | null) ?? null,
    isStub: String(row.is_stub) === "1",
    articleBody: String(row.article_body),
    createdFromChapterId:
      (row.created_from_chapter_id as string | null) ?? null,
    updatedAt: String(row.updated_at),
  };
}

export function listEntities() {
  return getDatabase()
    .prepare("SELECT * FROM entities ORDER BY category, name")
    .all()
    .map((row) => mapEntity(row as Record<string, unknown>));
}

export function listEntitiesByCategory(
  category: EntitySummaryRecord["category"],
) {
  return getDatabase()
    .prepare("SELECT * FROM entities WHERE category = ? ORDER BY name")
    .all(category)
    .map((row) => mapEntity(row as Record<string, unknown>));
}

export function getEntityByCategoryAndSlug(category: string, slug: string) {
  const row = getDatabase()
    .prepare("SELECT * FROM entities WHERE category = ? AND slug = ? LIMIT 1")
    .get(category, slug) as Record<string, unknown> | undefined;

  return row ? mapEntity(row) : null;
}

export function getEntityById(entityId: string) {
  const row = getDatabase()
    .prepare("SELECT * FROM entities WHERE id = ? LIMIT 1")
    .get(entityId) as Record<string, unknown> | undefined;

  return row ? mapEntity(row) : null;
}

export function listRelatedEntities(entity: EntitySummaryRecord) {
  if (!entity.createdFromChapterId) {
    return [];
  }

  return getDatabase()
    .prepare(
      "SELECT * FROM entities WHERE created_from_chapter_id = ? AND id != ? ORDER BY name LIMIT 8",
    )
    .all(entity.createdFromChapterId, entity.id)
    .map((row) => mapEntity(row as Record<string, unknown>));
}

export function listAliasesForEntity(entityId: string) {
  return getDatabase()
    .prepare(
      `SELECT
          a.alias,
          a.source_chapter_id,
          a.created_at,
          c.number AS chapter_number,
          c.title AS chapter_title
        FROM entity_aliases a
        LEFT JOIN chapters c ON c.id = a.source_chapter_id
       WHERE a.entity_id = ?
       ORDER BY lower(a.alias), a.created_at`,
    )
    .all(entityId)
    .map((row) => {
      const record = row as Record<string, unknown>;
      const chapterNumber = record.chapter_number;
      const chapterTitle = record.chapter_title;

      return {
        name: String(record.alias),
        sourceType: record.source_chapter_id ? "chapter-scan" : "user-managed",
        sourceLabel: record.source_chapter_id
          ? chapterNumber === null
            ? `Draft: ${String(chapterTitle)}`
            : `Chapter ${String(chapterNumber)}: ${String(chapterTitle)}`
          : "Manual alias or merge",
        createdAt: String(record.created_at),
      } satisfies EntityAliasRecord;
    });
}

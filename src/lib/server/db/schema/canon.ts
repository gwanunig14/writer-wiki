import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const entities = sqliteTable("entities", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  category: text("category").notNull(),
  subtype: text("subtype"),
  parentEntityId: text("parent_entity_id"),
  isStub: text("is_stub").notNull().default("1"),
  descriptor: text("descriptor"),
  articleBody: text("article_body").notNull(),
  evidenceStatus: text("evidence_status").notNull().default("mentioned-only"),
  createdFromChapterId: text("created_from_chapter_id"),
  lastUpdatedFromChapterId: text("last_updated_from_chapter_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const entityAliases = sqliteTable("entity_aliases", {
  id: text("id").primaryKey(),
  entityId: text("entity_id").notNull(),
  alias: text("alias").notNull(),
  sourceChapterId: text("source_chapter_id"),
  createdAt: text("created_at").notNull(),
});

export const entityLinks = sqliteTable("entity_links", {
  id: text("id").primaryKey(),
  fromEntityId: text("from_entity_id").notNull(),
  toEntityId: text("to_entity_id").notNull(),
  relationType: text("relation_type").notNull(),
  sourceChapterId: text("source_chapter_id"),
  createdAt: text("created_at").notNull(),
});

export const chronologyEntries = sqliteTable("chronology_entries", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  body: text("body").notNull(),
  relativeOrder: text("relative_order").notNull(),
  confidence: text("confidence").notNull(),
  sourceChapterIds: text("source_chapter_ids").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const watchlistEntries = sqliteTable("watchlist_entries", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  sourceChapterIds: text("source_chapter_ids").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const generatedPages = sqliteTable("generated_pages", {
  id: text("id").primaryKey(),
  pageType: text("page_type").notNull(),
  category: text("category"),
  slug: text("slug").notNull().unique(),
  body: text("body").notNull(),
  updatedAt: text("updated_at").notNull(),
});

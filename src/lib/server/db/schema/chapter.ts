import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const chapters = sqliteTable("chapters", {
  id: text("id").primaryKey(),
  number: integer("number"),
  title: text("title").notNull(),
  currentText: text("current_text").notNull(),
  status: text("status", { enum: ["draft", "saved", "scanned", "stale"] })
    .notNull()
    .default("draft"),
  latestVersionId: text("latest_version_id"),
  lastScannedVersionId: text("last_scanned_version_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const chapterVersions = sqliteTable("chapter_versions", {
  id: text("id").primaryKey(),
  chapterId: text("chapter_id").notNull(),
  versionNumber: integer("version_number").notNull(),
  text: text("text").notNull(),
  textHash: text("text_hash").notNull(),
  scanStatus: text("scan_status", {
    enum: ["never-scanned", "queued", "in-progress", "success", "failed"],
  })
    .notNull()
    .default("never-scanned"),
  createdAt: text("created_at").notNull(),
});

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const scanJobs = sqliteTable("scan_jobs", {
  id: text("id").primaryKey(),
  chapterId: text("chapter_id").notNull(),
  chapterVersionId: text("chapter_version_id").notNull(),
  provider: text("provider").notNull(),
  status: text("status", {
    enum: [
      "queued",
      "gathering-context",
      "running",
      "reconciling",
      "regenerating",
      "success",
      "failed",
    ],
  })
    .notNull()
    .default("queued"),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  summaryJson: text("summary_json"),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull(),
});

export const scanResultArtifacts = sqliteTable("scan_result_artifacts", {
  id: text("id").primaryKey(),
  scanJobId: text("scan_job_id").notNull(),
  artifactType: text("artifact_type").notNull(),
  payload: text("payload").notNull(),
  createdAt: text("created_at").notNull(),
});

export const derivedDependencies = sqliteTable("derived_dependencies", {
  id: text("id").primaryKey(),
  sourceChapterId: text("source_chapter_id").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  reason: text("reason").notNull(),
  createdAt: text("created_at").notNull(),
});

export const fileProjections = sqliteTable("file_projections", {
  id: text("id").primaryKey(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  relativePath: text("relative_path").notNull(),
  contentHash: text("content_hash").notNull(),
  syncStatus: text("sync_status", { enum: ["pending", "written", "failed"] })
    .notNull()
    .default("pending"),
  retryCount: integer("retry_count").notNull().default(0),
  lastError: text("last_error"),
  updatedAt: text("updated_at").notNull(),
});

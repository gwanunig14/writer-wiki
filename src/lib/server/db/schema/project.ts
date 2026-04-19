import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  rootPath: text("root_path").notNull(),
  provider: text("provider", { enum: ["openai", "anthropic"] }).notNull(),
  defaultModel: text("default_model"),
  defaultFontSize: integer("default_font_size").notNull().default(16),
  syncStatus: text("sync_status", {
    enum: ["healthy", "degraded", "repairing"],
  })
    .notNull()
    .default("healthy"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const providerCredentialMetadata = sqliteTable(
  "provider_credential_metadata",
  {
    provider: text("provider").primaryKey(),
    keyAlias: text("key_alias").notNull(),
    lastTestedAt: text("last_tested_at"),
    lastTestStatus: text("last_test_status", {
      enum: ["unknown", "success", "failed"],
    })
      .notNull()
      .default("unknown"),
    lastError: text("last_error"),
  },
);

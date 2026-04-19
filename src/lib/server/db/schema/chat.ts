import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const chatConversations = sqliteTable("chat_conversations", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  role: text("role").notNull(),
  message: text("message").notNull(),
  evidenceJson: text("evidence_json"),
  createdAt: text("created_at").notNull(),
});

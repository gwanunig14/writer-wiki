import { getDatabase, makeId, nowIso } from "$lib/server/db/client";

const pendingActionPrefix = "__pending_canon_action__:";
const clearPendingActionMessage = "__clear_pending_canon_action__";

export interface ChatMessageRecord {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  message: string;
  evidenceJson: string | null;
  createdAt: string;
}

function mapMessage(row: Record<string, unknown>): ChatMessageRecord {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    role: row.role as ChatMessageRecord["role"],
    message: String(row.message),
    evidenceJson: (row.evidence_json as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

export function ensureConversation(conversationId?: string | null) {
  if (conversationId) {
    const existing = getDatabase()
      .prepare("SELECT id FROM chat_conversations WHERE id = ? LIMIT 1")
      .get(conversationId) as { id: string } | undefined;
    if (existing) {
      return existing.id;
    }
  }

  const id = makeId();
  const timestamp = nowIso();
  getDatabase()
    .prepare(
      "INSERT INTO chat_conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
    )
    .run(id, "Canon Chat", timestamp, timestamp);
  return id;
}

export function appendChatMessage(input: {
  conversationId: string;
  role: ChatMessageRecord["role"];
  message: string;
  evidenceJson?: string | null;
}) {
  const id = makeId();
  const timestamp = nowIso();
  getDatabase()
    .prepare(
      "INSERT INTO chat_messages (id, conversation_id, role, message, evidence_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(
      id,
      input.conversationId,
      input.role,
      input.message,
      input.evidenceJson ?? null,
      timestamp,
    );
  getDatabase()
    .prepare("UPDATE chat_conversations SET updated_at = ? WHERE id = ?")
    .run(timestamp, input.conversationId);
  return id;
}

export function listConversationMessages(conversationId: string) {
  return getDatabase()
    .prepare(
      "SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at",
    )
    .all(conversationId)
    .map((row) => mapMessage(row as Record<string, unknown>));
}

export function setPendingCanonAction(
  conversationId: string,
  action: Record<string, unknown> | null,
) {
  appendChatMessage({
    conversationId,
    role: "system",
    message: action
      ? `${pendingActionPrefix}${JSON.stringify(action)}`
      : clearPendingActionMessage,
  });
}

export function getPendingCanonAction(conversationId: string) {
  const messages = listConversationMessages(conversationId).slice().reverse();

  for (const message of messages) {
    if (message.role !== "system") {
      continue;
    }

    if (message.message === clearPendingActionMessage) {
      return null;
    }

    if (!message.message.startsWith(pendingActionPrefix)) {
      continue;
    }

    try {
      return JSON.parse(
        message.message.slice(pendingActionPrefix.length),
      ) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  return null;
}

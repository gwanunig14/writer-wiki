import { getDatabase, nowIso } from "$lib/server/db/client";
import { regenerateGeneratedPages } from "$lib/server/scan/reconcile-canon";
import { regenerateProjectFiles } from "$lib/server/sync/projector";

export interface ActiveWatchlistEntryRecord {
  id: string;
  type: string;
  subject: string;
  body: string;
  status: "active" | "resolved";
  sourceLabels: string[];
  updatedAt: string;
}

function parseSourceChapterIds(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return [] as string[];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [] as string[];
  }
}

function getChapterSourceLabels() {
  const rows = getDatabase()
    .prepare("SELECT id, number, title FROM chapters ORDER BY created_at")
    .all() as Array<Record<string, unknown>>;

  return new Map(
    rows.map((row) => [
      String(row.id),
      row.number === null
        ? `Draft: ${String(row.title)}`
        : `Chapter ${String(row.number)}: ${String(row.title)}`,
    ]),
  );
}

function listWatchlistEntriesByStatus(
  status: "active" | "resolved",
): ActiveWatchlistEntryRecord[] {
  const chapterSourceLabels = getChapterSourceLabels();
  const rows = getDatabase()
    .prepare(
      `SELECT id, type, subject, body, status, source_chapter_ids, updated_at
         FROM watchlist_entries
        WHERE status = ?
        ORDER BY updated_at DESC, subject ASC`,
    )
    .all(status) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: String(row.id),
    type: String(row.type),
    subject: String(row.subject),
    body: String(row.body),
    status: String(row.status) as "active" | "resolved",
    sourceLabels: parseSourceChapterIds(row.source_chapter_ids)
      .map((chapterId) => chapterSourceLabels.get(chapterId))
      .filter((label): label is string => Boolean(label)),
    updatedAt: String(row.updated_at),
  }));
}

export function listActiveWatchlistEntries(): ActiveWatchlistEntryRecord[] {
  return listWatchlistEntriesByStatus("active");
}

export function listResolvedWatchlistEntries(): ActiveWatchlistEntryRecord[] {
  return listWatchlistEntriesByStatus("resolved");
}

export function dismissWatchlistEntry(watchlistEntryId: string) {
  const existing = getDatabase()
    .prepare("SELECT id, status FROM watchlist_entries WHERE id = ? LIMIT 1")
    .get(watchlistEntryId) as Record<string, unknown> | undefined;

  if (!existing) {
    throw new Error("Continuity watchlist item not found.");
  }

  if (String(existing.status) !== "active") {
    return { ok: true, dismissed: false };
  }

  getDatabase()
    .prepare(
      "UPDATE watchlist_entries SET status = 'resolved', updated_at = ? WHERE id = ?",
    )
    .run(nowIso(), watchlistEntryId);

  regenerateGeneratedPages();
  regenerateProjectFiles();

  return { ok: true, dismissed: true };
}

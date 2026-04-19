import { getDatabase } from "$lib/server/db/client";
import type { ChapterRecord } from "$lib/types/domain";

export interface ScanContext {
  relatedCanon: string[];
}

export function getScanContext(chapter: ChapterRecord): ScanContext {
  const db = getDatabase();

  const entityRows = db
    .prepare(
      "SELECT name, category, article_body, is_stub FROM entities ORDER BY updated_at DESC LIMIT 24",
    )
    .all() as Array<Record<string, unknown>>;
  const chronologyRows = db
    .prepare(
      "SELECT label, body FROM chronology_entries ORDER BY updated_at DESC LIMIT 10",
    )
    .all() as Array<Record<string, unknown>>;
  const watchlistRows = db
    .prepare(
      "SELECT subject, body FROM watchlist_entries WHERE status = ? ORDER BY updated_at DESC LIMIT 10",
    )
    .all("active") as Array<Record<string, unknown>>;

  return {
    relatedCanon: [
      `Current chapter: ${chapter.title}`,
      ...entityRows.map(
        (row) =>
          `Entity ${String(row.name)} [${String(row.category)}${String(row.is_stub) === "1" ? ", stub" : ""}]: ${String(row.article_body)}`,
      ),
      ...chronologyRows.map(
        (row) => `Chronology ${String(row.label)}: ${String(row.body)}`,
      ),
      ...watchlistRows.map(
        (row) => `Watchlist ${String(row.subject)}: ${String(row.body)}`,
      ),
    ],
  };
}

import { getDatabase } from "$lib/server/db/client";
import type { RetrievedCanonContext, RetrievalEvidence } from "./query-context";

export function tokenize(question: string) {
  return question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
}

export function scoreMatch(text: string, tokens: string[]) {
  const normalized = text.toLowerCase();
  return tokens.reduce(
    (score, token) => score + (normalized.includes(token) ? 1 : 0),
    0,
  );
}

export function retrieveCanonContext(question: string): RetrievedCanonContext {
  const tokens = tokenize(question);
  const db = getDatabase();

  const evidence: RetrievalEvidence[] = [];
  const chapters = db
    .prepare(
      "SELECT id, title, current_text FROM chapters ORDER BY updated_at DESC LIMIT 12",
    )
    .all() as Array<Record<string, unknown>>;
  const entities = db
    .prepare(
      "SELECT id, name, slug, category, article_body FROM entities ORDER BY updated_at DESC LIMIT 24",
    )
    .all() as Array<Record<string, unknown>>;
  const chronology = db
    .prepare(
      "SELECT id, label, body FROM chronology_entries ORDER BY updated_at DESC LIMIT 10",
    )
    .all() as Array<Record<string, unknown>>;
  const watchlist = db
    .prepare(
      "SELECT id, subject, body FROM watchlist_entries WHERE status = ? ORDER BY updated_at DESC LIMIT 10",
    )
    .all("active") as Array<Record<string, unknown>>;

  const scored = [
    ...chapters.map((row) => ({
      score: scoreMatch(
        `${String(row.title)} ${String(row.current_text)}`,
        tokens,
      ),
      evidence: {
        type: "chapter" as const,
        refId: String(row.id),
        label: String(row.title),
        snippet: String(row.current_text).slice(0, 280),
      },
    })),
    ...entities.map((row) => ({
      score: scoreMatch(
        `${String(row.name)} ${String(row.article_body)}`,
        tokens,
      ),
      evidence: {
        type: "article" as const,
        refId: String(row.id),
        label: `${String(row.name)} (${String(row.category)})`,
        snippet: String(row.article_body).slice(0, 280),
      },
    })),
    ...chronology.map((row) => ({
      score: scoreMatch(`${String(row.label)} ${String(row.body)}`, tokens),
      evidence: {
        type: "chronology" as const,
        refId: String(row.id),
        label: String(row.label),
        snippet: String(row.body).slice(0, 280),
      },
    })),
    ...watchlist.map((row) => ({
      score: scoreMatch(`${String(row.subject)} ${String(row.body)}`, tokens),
      evidence: {
        type: "watchlist" as const,
        refId: String(row.id),
        label: String(row.subject),
        snippet: String(row.body).slice(0, 280),
      },
    })),
  ]
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 8)
    .map((item) => item.evidence);

  return { evidence: scored };
}

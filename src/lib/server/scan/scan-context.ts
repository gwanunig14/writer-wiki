import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getDatabase } from "$lib/server/db/client";
import type { ChapterRecord } from "$lib/types/domain";

const MAX_ENTITY_CONTEXT = 10;
const MAX_CHRONOLOGY_CONTEXT = 6;
const MAX_WATCHLIST_CONTEXT = 6;
const MAX_SERIES_BIBLE_CONTEXT = 6;

export interface ScanContext {
  relatedCanon: string[];
  stats: {
    touchedEntityCount: number;
    chronologyCount: number;
    watchlistCount: number;
    contradictionCount: number;
    ambiguityCount: number;
    seriesBibleSectionCount: number;
  };
  escalationHints: {
    highContradictionDensity: boolean;
    highEntityAmbiguity: boolean;
    majorSeriesBibleImpact: boolean;
    highReconciliationRisk: boolean;
    validationRetryCount: number;
  };
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4);
}

function scoreMatch(text: string, tokens: string[]) {
  const normalized = text.toLowerCase();
  return tokens.reduce(
    (score, token) => score + (normalized.includes(token) ? 1 : 0),
    0,
  );
}

function loadSeriesBibleSections(chapterText: string) {
  const systemDir = join(process.cwd(), "project-data", "system");
  const candidates = [
    join(systemDir, "constitution.txt"),
    join(systemDir, "series-bible.md"),
  ];
  const tokens = tokenize(chapterText);

  for (const path of candidates) {
    if (!existsSync(path)) {
      continue;
    }

    const text = readFileSync(path, "utf8");
    const sections = text
      .split(/\n\s*\n+/)
      .map((section) => section.replace(/\s+/g, " ").trim())
      .filter(Boolean);

    return sections
      .map((section) => ({
        section,
        score: scoreMatch(section, tokens),
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, MAX_SERIES_BIBLE_CONTEXT)
      .map((entry) => entry.section);
  }

  return [] as string[];
}

export function getScanContext(chapter: ChapterRecord): ScanContext {
  const db = getDatabase();
  const chapterTokens = tokenize(`${chapter.title} ${chapter.currentText}`);

  const entityRows = db
    .prepare(
      "SELECT name, category, article_body, is_stub FROM entities ORDER BY updated_at DESC LIMIT 80",
    )
    .all() as Array<Record<string, unknown>>;
  const chronologyRows = db
    .prepare(
      "SELECT label, body FROM chronology_entries ORDER BY updated_at DESC LIMIT 30",
    )
    .all() as Array<Record<string, unknown>>;
  const watchlistRows = db
    .prepare(
      "SELECT type, subject, body FROM watchlist_entries WHERE status = ? ORDER BY updated_at DESC LIMIT 30",
    )
    .all("active") as Array<Record<string, unknown>>;

  const touchedEntities = entityRows
    .map((row) => {
      const name = String(row.name ?? "");
      const category = String(row.category ?? "");
      const body = String(row.article_body ?? "");
      const score = scoreMatch(`${name} ${body}`, chapterTokens);
      return {
        row,
        score,
        category,
        name,
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_ENTITY_CONTEXT)
    .map((entry) => entry.row);

  const nearbyChronology = chronologyRows
    .map((row) => {
      const label = String(row.label ?? "");
      const body = String(row.body ?? "");
      return {
        row,
        score: scoreMatch(`${label} ${body}`, chapterTokens),
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_CHRONOLOGY_CONTEXT)
    .map((entry) => entry.row);

  const relevantWatchlist = watchlistRows
    .map((row) => {
      const subject = String(row.subject ?? "");
      const body = String(row.body ?? "");
      return {
        row,
        score: scoreMatch(`${subject} ${body}`, chapterTokens),
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_WATCHLIST_CONTEXT)
    .map((entry) => entry.row);

  const seriesBibleSections = loadSeriesBibleSections(chapter.currentText);
  const contradictionCount = relevantWatchlist.filter(
    (row) => String(row.type ?? "") === "contradiction",
  ).length;
  const ambiguityCount = relevantWatchlist.filter((row) =>
    [
      "name-collision",
      "relationship-ambiguity",
      "location-risk",
      "item-clarification",
      "timeline-risk",
    ].includes(String(row.type ?? "")),
  ).length;
  const watchlistCount = relevantWatchlist.length;

  return {
    relatedCanon: [
      `Current chapter: ${chapter.title}`,
      ...touchedEntities.map(
        (row) =>
          `Entity ${String(row.name)} [${String(row.category)}${String(row.is_stub) === "1" ? ", stub" : ""}]: ${String(row.article_body)}`,
      ),
      ...nearbyChronology.map(
        (row) => `Chronology ${String(row.label)}: ${String(row.body)}`,
      ),
      ...relevantWatchlist.map(
        (row) =>
          `Watchlist ${String(row.subject)} [${String(row.type)}]: ${String(row.body)}`,
      ),
      ...seriesBibleSections.map(
        (section, index) => `SeriesBible section ${index + 1}: ${section}`,
      ),
    ],
    stats: {
      touchedEntityCount: touchedEntities.length,
      chronologyCount: nearbyChronology.length,
      watchlistCount,
      contradictionCount,
      ambiguityCount,
      seriesBibleSectionCount: seriesBibleSections.length,
    },
    escalationHints: {
      highContradictionDensity:
        watchlistCount > 0 && contradictionCount / watchlistCount >= 0.4,
      highEntityAmbiguity: ambiguityCount >= 3,
      majorSeriesBibleImpact: seriesBibleSections.length >= 3,
      highReconciliationRisk:
        touchedEntities.length >= 9 ||
        ambiguityCount >= 3 ||
        contradictionCount >= 3,
      validationRetryCount: 0,
    },
  };
}

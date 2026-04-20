import { getDatabase, makeId, nowIso } from "$lib/server/db/client";
import { makeSlug } from "$lib/server/providers/provider";
import type { ScanResult } from "$lib/types/scan-result";
import { replaceChapterDependencies } from "./rescan-propagation";

const categoryLabels = {
  character: "Characters",
  location: "Locations",
  item: "Items",
  organization: "Organizations",
} as const;

const continuitySectionOrder = [
  "Active Contradictions",
  "Missing Descriptions",
  "Name Collisions / Identity Risks",
  "Timeline Risks",
  "Location / Layout Risks",
  "Relationship Ambiguities",
  "Items / Artifacts Requiring Clarification",
  "Questions for Author Decision",
] as const;

const watchlistSectionByType = {
  contradiction: "Active Contradictions",
  "missing-description": "Missing Descriptions",
  "name-collision": "Name Collisions / Identity Risks",
  "timeline-risk": "Timeline Risks",
  "location-risk": "Location / Layout Risks",
  "relationship-ambiguity": "Relationship Ambiguities",
  "item-clarification": "Items / Artifacts Requiring Clarification",
} as const;

function countWords(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return 0;
  }

  return trimmed.split(/\s+/).length;
}

function countSentences(value: string) {
  return value
    .split(/[.!?]+/)
    .map((segment) => segment.trim())
    .filter(Boolean).length;
}

function hasDetailSignals(value: string) {
  return /,|;|'s\b|\b(and|who|with|from|at|in|on|of|for|because|after|before|during|works|serves|rides|owns|uses|carries|leads|oversees)\b/i.test(
    value,
  );
}

function normalizeEntityEvidence(
  summary: string,
  suggestedStub: boolean,
  existingIsStub?: boolean,
) {
  const wordCount = countWords(summary);
  const sentenceCount = countSentences(summary);
  const substantiveSummary =
    wordCount >= 8 && (sentenceCount >= 2 || hasDetailSignals(summary));

  if (existingIsStub === false) {
    return { isStub: false, evidenceStatus: "established" as const };
  }

  if (!suggestedStub || substantiveSummary) {
    return { isStub: false, evidenceStatus: "established" as const };
  }

  if (wordCount >= 6) {
    return { isStub: true, evidenceStatus: "partial" as const };
  }

  return { isStub: true, evidenceStatus: "mentioned-only" as const };
}

function chooseCanonicalArticleBody(input: {
  existingName: string;
  incomingName: string;
  canonicalName: string;
  existingArticleBody: string;
  incomingArticleBody: string;
  category: ScanResult["entities"][number]["category"];
  existingIsStub: boolean;
  incomingIsStub: boolean;
}) {
  const existingBody = input.existingArticleBody.trim();
  const incomingBody = input.incomingArticleBody.trim();

  if (!existingBody) {
    return incomingBody;
  }

  if (!incomingBody) {
    return existingBody;
  }

  if (input.existingIsStub && !input.incomingIsStub) {
    return incomingBody;
  }

  if (
    input.category === "character" &&
    normalizeAliasValue(input.canonicalName).toLowerCase() ===
      normalizeAliasValue(input.existingName).toLowerCase() &&
    normalizeAliasValue(input.incomingName).toLowerCase() !==
      normalizeAliasValue(input.canonicalName).toLowerCase()
  ) {
    return existingBody;
  }

  const incomingWordCount = countWords(incomingBody);
  const existingWordCount = countWords(existingBody);
  const incomingSentenceCount = countSentences(incomingBody);
  const existingSentenceCount = countSentences(existingBody);

  if (
    incomingSentenceCount > existingSentenceCount ||
    (incomingSentenceCount === existingSentenceCount &&
      incomingWordCount > existingWordCount)
  ) {
    return incomingBody;
  }

  return existingBody;
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
    return [];
  }
}

function deleteEntriesForChapter(
  tableName: "chronology_entries" | "watchlist_entries",
  chapterId: string,
) {
  const db = getDatabase();
  const rows = db
    .prepare(`SELECT id, source_chapter_ids FROM ${tableName}`)
    .all() as Array<Record<string, unknown>>;

  for (const row of rows) {
    const sourceChapterIds = parseSourceChapterIds(row.source_chapter_ids);
    if (!sourceChapterIds.includes(chapterId)) {
      continue;
    }

    db.prepare(`DELETE FROM ${tableName} WHERE id = ?`).run(String(row.id));
  }
}

function getChapterSourceLabels() {
  const db = getDatabase();
  const rows = db
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

function formatSources(
  sourceChapterIdsText: unknown,
  chapterSourceLabels: Map<string, string>,
) {
  const labels = parseSourceChapterIds(sourceChapterIdsText)
    .map((id) => chapterSourceLabels.get(id) ?? `Unknown chapter (${id})`)
    .filter(Boolean);

  return labels.length ? labels.join("; ") : "Missing";
}

function ensureBulletBody(body: string, fallbackLabel: string) {
  const trimmed = body.trim();
  if (!trimmed) {
    return `- ${fallbackLabel}: Missing`;
  }

  if (/^[-*]\s+[A-Za-z][^\n]*:/m.test(trimmed)) {
    return trimmed;
  }

  return `- ${fallbackLabel}: ${trimmed}`;
}

function buildChronologyPageBody() {
  const db = getDatabase();
  const chapterSourceLabels = getChapterSourceLabels();
  const chronologyEntries = db
    .prepare(
      "SELECT label, body, confidence, source_chapter_ids, relative_order FROM chronology_entries ORDER BY CAST(relative_order AS INTEGER), created_at",
    )
    .all() as Array<Record<string, unknown>>;
  const timelineRisks = db
    .prepare(
      "SELECT subject, body, source_chapter_ids FROM watchlist_entries WHERE status = ? AND type = ? ORDER BY updated_at DESC",
    )
    .all("active", "timeline-risk") as Array<Record<string, unknown>>;
  const contradictionEntries = db
    .prepare(
      "SELECT subject, body, source_chapter_ids FROM watchlist_entries WHERE status = ? AND type = ? ORDER BY updated_at DESC",
    )
    .all("active", "contradiction") as Array<Record<string, unknown>>;

  const timelineSection = chronologyEntries.length
    ? chronologyEntries
        .map((entry) => {
          const body = ensureBulletBody(String(entry.body ?? ""), "Event");
          const confidence = String(entry.confidence ?? "possible");
          const needsSources = !/(^|\n)-\s*Sources:/i.test(body);

          return [
            `### ${String(entry.label)}`,
            body,
            `- Confidence: ${confidence[0].toUpperCase()}${confidence.slice(1)}`,
            needsSources
              ? `- Sources: ${formatSources(entry.source_chapter_ids, chapterSourceLabels)}`
              : null,
          ]
            .filter(Boolean)
            .join("\n");
        })
        .join("\n\n")
    : "- No timeline entries yet.";

  const ambiguitySection = timelineRisks.length
    ? timelineRisks
        .map(
          (entry) =>
            `- ${String(entry.subject)}: ${String(entry.body ?? "")
              .replace(/\s+/g, " ")
              .trim()} (Sources: ${formatSources(entry.source_chapter_ids, chapterSourceLabels)})`,
        )
        .join("\n")
    : "- None currently flagged.";

  const conflictSection = contradictionEntries.length
    ? contradictionEntries
        .map(
          (entry) =>
            `- ${String(entry.subject)}: ${String(entry.body ?? "")
              .replace(/\s+/g, " ")
              .trim()} (Sources: ${formatSources(entry.source_chapter_ids, chapterSourceLabels)})`,
        )
        .join("\n")
    : "- None currently flagged.";

  return [
    "# Chronology Master",
    "",
    "## Timeline Entries",
    "",
    timelineSection,
    "",
    "## Date / Sequence Ambiguities",
    ambiguitySection,
    "",
    "## Conflicting Timeline Claims",
    conflictSection,
  ].join("\n");
}

function formatContinuityEntry(
  entry: Record<string, unknown>,
  chapterSourceLabels: Map<string, string>,
) {
  const body = ensureBulletBody(String(entry.body ?? ""), "Issue");
  const needsSources = !/(^|\n)-\s*Sources:/i.test(body);
  const needsStatus = !/(^|\n)-\s*Status:/i.test(body);

  return [
    `### ${String(entry.subject)}`,
    body,
    needsStatus ? "- Status: active" : null,
    needsSources
      ? `- Sources: ${formatSources(entry.source_chapter_ids, chapterSourceLabels)}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function stripLeadingArticle(name: string) {
  return name.replace(/^The\s+/i, "").trim();
}

function normalizeAliasValue(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function inferEntitySubtype(entity: ScanResult["entities"][number]) {
  if (entity.category !== "character") {
    return null;
  }

  const text = `${entity.name} ${entity.summary}`.toLowerCase();

  if (
    /\b(?:protagonist|main character|lead character|primary character|primary pov|on-page primary character|point-of-view|point of view|pov)\b/.test(
      text,
    )
  ) {
    return "Main";
  }

  return null;
}

function buildWatchOrganizationAliases(name: string) {
  const normalizedName = normalizeAliasValue(name);
  const articleStripped = stripLeadingArticle(normalizedName);

  if (
    !/^(?:City Watch|Watch)$/i.test(articleStripped) ||
    /Watchmen$/i.test(articleStripped)
  ) {
    return [] as string[];
  }

  return ["The City Watch", "City Watch", "The Watch", "Watch"].filter(
    (alias) => alias.toLowerCase() !== normalizedName.toLowerCase(),
  );
}

function scoreCanonicalName(
  value: string,
  category: ScanResult["entities"][number]["category"],
) {
  const normalized = normalizeAliasValue(value);
  const articleStripped = stripLeadingArticle(normalized);
  const tokenCount = normalized.split(/\s+/).filter(Boolean).length;
  let score = tokenCount * 100 + normalized.length;

  if (normalized !== articleStripped) {
    score += 10;
  }

  if (category === "location" && articleStripped.split(/\s+/).length > 1) {
    score += 25;
  }

  if (
    category === "organization" &&
    /\b(Watch|Guard|Guild|Order|Council|Company|Companies|Legion|Militia)\b/i.test(
      articleStripped,
    )
  ) {
    score += 25;
  }

  if (
    category === "character" &&
    /\b(King|Queen|Prince|Princess|Duke|Duchess|Emperor|Empress)\b/i.test(
      articleStripped,
    )
  ) {
    score += 25;
  }

  return score;
}

function startsWithHonorific(name: string) {
  return /^(?:mr|mrs|ms|miss|captain|sir|lady|lord)\s+/i.test(
    normalizeAliasValue(name),
  );
}

function endsWithUncertainCharacterSuffix(name: string) {
  return /\b(?:something|someone|somebody)$/i.test(normalizeAliasValue(name));
}

function getCharacterSurname(name: string) {
  const stripped = normalizeAliasValue(name)
    .replace(/^(?:mr|mrs|ms|miss|captain|sir|lady|lord)\s+/i, "")
    .trim();
  const tokens = stripped.split(/\s+/).filter(Boolean);
  return tokens.length ? tokens[tokens.length - 1].toLowerCase() : "";
}

function isHonorificSurnameVariant(name: string) {
  const normalized = normalizeAliasValue(name);
  const stripped = normalized.replace(
    /^(?:mr|mrs|ms|miss|captain|sir|lady|lord)\s+/i,
    "",
  );
  const originalTokens = normalized.split(/\s+/).filter(Boolean);
  const strippedTokens = stripped.split(/\s+/).filter(Boolean);

  return (
    stripped !== normalized &&
    originalTokens.length === 2 &&
    strippedTokens.length === 1
  );
}

function chooseCanonicalEntityName(
  existingName: string,
  incomingName: string,
  category: ScanResult["entities"][number]["category"],
) {
  const normalizedExisting = normalizeAliasValue(existingName);
  const normalizedIncoming = normalizeAliasValue(incomingName);

  if (normalizedExisting.toLowerCase() === normalizedIncoming.toLowerCase()) {
    return normalizedExisting;
  }

  if (category === "character") {
    if (
      endsWithUncertainCharacterSuffix(normalizedExisting) &&
      !endsWithUncertainCharacterSuffix(normalizedIncoming)
    ) {
      return normalizedIncoming;
    }

    if (
      endsWithUncertainCharacterSuffix(normalizedIncoming) &&
      !endsWithUncertainCharacterSuffix(normalizedExisting)
    ) {
      return normalizedExisting;
    }

    const existingSurname = getCharacterSurname(normalizedExisting);
    const incomingSurname = getCharacterSurname(normalizedIncoming);
    if (
      existingSurname &&
      incomingSurname &&
      existingSurname === incomingSurname
    ) {
      if (
        startsWithHonorific(normalizedExisting) &&
        !startsWithHonorific(normalizedIncoming)
      ) {
        return normalizedIncoming;
      }

      if (
        startsWithHonorific(normalizedIncoming) &&
        !startsWithHonorific(normalizedExisting)
      ) {
        return normalizedExisting;
      }
    }

    return normalizedExisting;
  }

  return [normalizedExisting, normalizedIncoming].sort((left, right) => {
    const scoreDifference =
      scoreCanonicalName(right, category) - scoreCanonicalName(left, category);
    if (scoreDifference !== 0) {
      return scoreDifference;
    }

    return right.localeCompare(left);
  })[0];
}

function buildImplicitAliases(entity: ScanResult["entities"][number]) {
  const aliases = new Set<string>();
  const normalizedName = normalizeAliasValue(entity.name);
  const withoutArticle = stripLeadingArticle(normalizedName);

  if (withoutArticle && withoutArticle !== normalizedName) {
    aliases.add(withoutArticle);
  }

  if (
    entity.category === "location" &&
    withoutArticle !== normalizedName &&
    withoutArticle.split(/\s+/).length > 1
  ) {
    const lastToken = withoutArticle.split(/\s+/).at(-1);
    if (
      lastToken &&
      ["Hearth", "Inn", "Tavern", "Headquarters"].includes(lastToken)
    ) {
      aliases.add(lastToken);
    }
  }

  if (
    entity.category === "location" &&
    normalizedName === withoutArticle &&
    withoutArticle.split(/\s+/).length > 1
  ) {
    aliases.add(`The ${withoutArticle}`);
  }

  if (
    entity.category === "organization" &&
    normalizedName === withoutArticle &&
    withoutArticle.split(/\s+/).length > 1
  ) {
    aliases.add(`The ${withoutArticle}`);
  }

  if (entity.category === "organization") {
    for (const alias of buildWatchOrganizationAliases(normalizedName)) {
      aliases.add(alias);
    }
  }

  if (
    entity.category === "character" &&
    normalizedName === withoutArticle &&
    /\b(King|Queen|Prince|Princess|Duke|Duchess|Emperor|Empress)$/i.test(
      withoutArticle,
    )
  ) {
    aliases.add(`The ${withoutArticle}`);
  }

  for (const alias of entity.aliases) {
    const normalizedAlias = normalizeAliasValue(alias);
    if (normalizedAlias) {
      aliases.add(normalizedAlias);
    }
  }

  aliases.delete(normalizedName);
  return [...aliases];
}

function findEntityByAliasOrSlug(
  entity: ScanResult["entities"][number],
  slug: string,
) {
  const db = getDatabase();
  const aliasCandidates = [entity.name, ...buildImplicitAliases(entity)]
    .map((value) => normalizeAliasValue(value))
    .filter(Boolean);

  const existingBySlug = db
    .prepare("SELECT * FROM entities WHERE slug = ? LIMIT 1")
    .get(slug) as Record<string, unknown> | undefined;
  if (existingBySlug) {
    return existingBySlug;
  }

  for (const candidate of aliasCandidates) {
    const existingByName = db
      .prepare(
        "SELECT * FROM entities WHERE lower(name) = lower(?) AND category = ? LIMIT 1",
      )
      .get(candidate, entity.category) as Record<string, unknown> | undefined;
    if (existingByName) {
      return existingByName;
    }

    const existingByAlias = db
      .prepare(
        `SELECT e.*
           FROM entity_aliases a
           JOIN entities e ON e.id = a.entity_id
          WHERE lower(a.alias) = lower(?) AND e.category = ?
          LIMIT 1`,
      )
      .get(candidate, entity.category) as Record<string, unknown> | undefined;
    if (existingByAlias) {
      return existingByAlias;
    }
  }

  if (
    entity.category === "character" &&
    isHonorificSurnameVariant(entity.name)
  ) {
    const surname = getCharacterSurname(entity.name);
    if (surname) {
      const surnameMatches = db
        .prepare(
          `SELECT *
             FROM entities
            WHERE category = 'character'
              AND lower(name) != lower(?)
              AND lower(name) LIKE ?`,
        )
        .all(entity.name, `%${surname}`) as Array<Record<string, unknown>>;

      const exactSurnameMatches = surnameMatches.filter((candidate) => {
        const candidateSurname = getCharacterSurname(String(candidate.name));
        const candidateTokens = normalizeAliasValue(String(candidate.name))
          .split(/\s+/)
          .filter(Boolean);

        return candidateSurname === surname && candidateTokens.length >= 2;
      });

      if (exactSurnameMatches.length === 1) {
        return exactSurnameMatches[0];
      }
    }
  }

  return undefined;
}

function persistEntityAliases(
  entityId: string,
  chapterId: string,
  aliases: string[],
) {
  const db = getDatabase();
  const uniqueAliases = new Set(
    aliases.map((alias) => normalizeAliasValue(alias)).filter(Boolean),
  );

  for (const alias of uniqueAliases) {
    const exists = db
      .prepare(
        "SELECT id FROM entity_aliases WHERE entity_id = ? AND lower(alias) = lower(?) LIMIT 1",
      )
      .get(entityId, alias) as Record<string, unknown> | undefined;

    if (exists) {
      continue;
    }

    db.prepare(
      "INSERT INTO entity_aliases (id, entity_id, alias, source_chapter_id, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(makeId(), entityId, alias, chapterId, nowIso());
  }
}

function buildContinuityPageBody() {
  const db = getDatabase();
  const chapterSourceLabels = getChapterSourceLabels();
  const watchlistEntries = db
    .prepare(
      "SELECT type, subject, body, source_chapter_ids FROM watchlist_entries WHERE status = ? ORDER BY updated_at DESC",
    )
    .all("active") as Array<Record<string, unknown>>;
  const grouped = new Map<string, string[]>();

  for (const section of continuitySectionOrder) {
    grouped.set(section, []);
  }

  for (const entry of watchlistEntries) {
    const section =
      watchlistSectionByType[
        String(entry.type) as keyof typeof watchlistSectionByType
      ] ?? "Questions for Author Decision";
    grouped
      .get(section)
      ?.push(formatContinuityEntry(entry, chapterSourceLabels));
  }

  return [
    "# Continuity Watchlist",
    "",
    ...continuitySectionOrder.flatMap((section) => [
      `## ${section}`,
      grouped.get(section)?.length
        ? grouped.get(section)!.join("\n\n")
        : "- None currently flagged.",
      "",
    ]),
  ]
    .join("\n")
    .trim();
}

function upsertEntity(
  chapterId: string,
  entity: ScanResult["entities"][number],
) {
  const db = getDatabase();
  const slug = makeSlug(entity.name);
  const existing = findEntityByAliasOrSlug(entity, slug);
  const timestamp = nowIso();
  const articleBody = entity.summary.trim();
  const aliasesToPersist = buildImplicitAliases(entity);
  const inferredSubtype = inferEntitySubtype(entity);

  if (existing) {
    const wasStub = String(existing.is_stub) === "1";
    const canonicalName = chooseCanonicalEntityName(
      String(existing.name),
      entity.name,
      entity.category,
    );
    const normalizedEvidence = normalizeEntityEvidence(
      articleBody,
      entity.isStub,
      wasStub,
    );
    const canonicalArticleBody = chooseCanonicalArticleBody({
      existingName: String(existing.name),
      incomingName: entity.name,
      canonicalName,
      existingArticleBody: String(existing.article_body ?? ""),
      incomingArticleBody: articleBody,
      category: entity.category,
      existingIsStub: wasStub,
      incomingIsStub: normalizedEvidence.isStub,
    });

    db.prepare(
      `UPDATE entities
         SET name = ?,
             category = ?,
           subtype = ?,
             is_stub = ?,
             article_body = ?,
             evidence_status = ?,
             last_updated_from_chapter_id = ?,
             updated_at = ?
       WHERE id = ?`,
    ).run(
      canonicalName,
      entity.category,
      (existing.subtype as string | null) ?? inferredSubtype,
      normalizedEvidence.isStub ? "1" : "0",
      canonicalArticleBody,
      normalizedEvidence.evidenceStatus,
      chapterId,
      timestamp,
      String(existing.id),
    );

    persistEntityAliases(
      String(existing.id),
      chapterId,
      [...aliasesToPersist, entity.name, String(existing.name)].filter(
        (alias) =>
          normalizeAliasValue(alias).toLowerCase() !==
          canonicalName.toLowerCase(),
      ),
    );

    return {
      id: String(existing.id),
      slug: String(existing.slug),
      created: false,
      promotedFromStub: wasStub && !normalizedEvidence.isStub,
    };
  }

  const id = makeId();
  const normalizedEvidence = normalizeEntityEvidence(
    articleBody,
    entity.isStub,
  );
  db.prepare(
    `INSERT INTO entities (
      id, name, slug, category, subtype, is_stub, descriptor, article_body, evidence_status,
      created_from_chapter_id, last_updated_from_chapter_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    entity.name,
    slug,
    entity.category,
    inferredSubtype,
    normalizedEvidence.isStub ? "1" : "0",
    articleBody,
    normalizedEvidence.evidenceStatus,
    chapterId,
    chapterId,
    timestamp,
    timestamp,
  );

  persistEntityAliases(id, chapterId, aliasesToPersist);

  return { id, slug, created: true, promotedFromStub: false };
}

function replaceChronology(
  chapterId: string,
  chronology: ScanResult["chronology"],
) {
  const db = getDatabase();
  deleteEntriesForChapter("chronology_entries", chapterId);

  for (const [index, item] of chronology.entries()) {
    db.prepare(
      `INSERT INTO chronology_entries (id, label, body, relative_order, confidence, source_chapter_ids, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      makeId(),
      item.label,
      item.body,
      String(index + 1),
      item.confidence,
      JSON.stringify([chapterId]),
      nowIso(),
      nowIso(),
    );
  }
}

function replaceWatchlist(
  chapterId: string,
  watchlist: ScanResult["watchlist"],
) {
  const db = getDatabase();
  deleteEntriesForChapter("watchlist_entries", chapterId);

  for (const item of watchlist) {
    db.prepare(
      `INSERT INTO watchlist_entries (id, type, subject, body, source_chapter_ids, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
    ).run(
      makeId(),
      item.type,
      item.subject,
      item.body,
      JSON.stringify([chapterId]),
      nowIso(),
      nowIso(),
    );
  }
}

export function regenerateGeneratedPages() {
  const db = getDatabase();
  db.prepare("DELETE FROM generated_pages").run();

  for (const [category, label] of Object.entries(categoryLabels)) {
    const entities = db
      .prepare(
        "SELECT name, slug, is_stub FROM entities WHERE category = ? ORDER BY name",
      )
      .all(category) as Array<Record<string, unknown>>;
    const lines = entities.length
      ? entities.map(
          (entity) =>
            `- [${String(entity.name)}](/wiki/${category}/${String(entity.slug)})${String(entity.is_stub) === "1" ? " (stub)" : ""}`,
        )
      : ["No canon entries yet."];

    db.prepare(
      "INSERT INTO generated_pages (id, page_type, category, slug, body, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      makeId(),
      "category-all",
      category,
      `${category}-all`,
      `# ${label}\n\n${lines.join("\n")}`,
      nowIso(),
    );
  }

  db.prepare(
    "INSERT INTO generated_pages (id, page_type, category, slug, body, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    makeId(),
    "chronology",
    "chronology",
    "chronology",
    buildChronologyPageBody(),
    nowIso(),
  );

  db.prepare(
    "INSERT INTO generated_pages (id, page_type, category, slug, body, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    makeId(),
    "continuity-watchlist",
    "continuity",
    "continuity-watchlist",
    buildContinuityPageBody(),
    nowIso(),
  );
}

export function reconcileCanon(chapterId: string, result: ScanResult) {
  const entityOutcomes = result.entities.map((entity) =>
    upsertEntity(chapterId, entity),
  );
  replaceChronology(chapterId, result.chronology);
  replaceWatchlist(chapterId, result.watchlist);
  regenerateGeneratedPages();

  replaceChapterDependencies(chapterId, [
    ...entityOutcomes.map((entity) => ({
      targetType: "entity",
      targetId: entity.id,
      reason: `Updated from chapter scan for ${chapterId}`,
    })),
    {
      targetType: "generated-page",
      targetId: "chronology",
      reason: "Chronology regenerated from scan.",
    },
    {
      targetType: "generated-page",
      targetId: "continuity-watchlist",
      reason: "Continuity watchlist regenerated from scan.",
    },
  ]);

  return {
    entityOutcomes,
    summary: result.summary,
  };
}

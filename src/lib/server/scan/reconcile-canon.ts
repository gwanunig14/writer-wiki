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

  // Never let a stub body overwrite a real article body.
  if (!input.existingIsStub && input.incomingIsStub) {
    return existingBody;
  }

  // Cross-category template guard: if the existing article body was generated
  // from a template that doesn't match the entity's current category, prefer
  // the incoming body. This happens when an earlier scan misclassified the
  // entity (e.g. stored a character-format dossier for a location) and a
  // later scan returns the correct template.
  const characterTemplateMarkers = [
    "## Identity",
    "## Voice / Manner",
    "## Personality",
  ];
  const existingUsesCharacterTemplate = characterTemplateMarkers.some(
    (marker) => existingBody.includes(marker),
  );
  if (existingUsesCharacterTemplate && input.category !== "character") {
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

const characterHonorificPattern =
  "mr|mrs|ms|miss|captain|sir|lady|lord|baron|baroness|prince|princess|duke|duchess|king|queen|emperor|empress|doctor|dr|professor|master|aunt|uncle";

function stripCharacterHonorific(name: string) {
  return normalizeAliasValue(name)
    .replace(new RegExp(`^(?:${characterHonorificPattern})\\.?\\s+`, "i"), "")
    .trim();
}

function getLeadingCharacterHonorific(name: string) {
  const match = normalizeAliasValue(name).match(
    new RegExp(`^(${characterHonorificPattern})\\.?\\s+`, "i"),
  );
  return match?.[1]?.toLowerCase() ?? null;
}

function hasNonMissingCharacterDetailSection(summary: string) {
  return summary
    .split(/\n(?=##\s+)/)
    .some(
      (section) =>
        /^##\s+(?:Identity|Physical Description|Description|Function in Story)\b/i.test(
          section,
        ) &&
        section
          .split("\n")
          .some(
            (line) =>
              /^\s*-\s+/.test(line) &&
              !/:\s*Missing\s*$/i.test(line) &&
              !/\bMissing\b/i.test(line),
          ),
    );
}

function hasUnsupportedPovOnlySummary(summary: string) {
  const text = summary.toLowerCase();

  return (
    /\b(?:primary pov|point-of-view|point of view|pov)\b/.test(text) &&
    !/\b(?:protagonist|main character|lead character|primary character|on-page primary character)\b/.test(
      text,
    ) &&
    ((summary.match(/\bmissing\b/gi)?.length ?? 0) >= 2 ||
      /\b(?:canon status:\s*unconfirmed|mentioned or on-page|rumor|rumors|claimed|alleged|supposed)\b/.test(
        text,
      )) &&
    !hasNonMissingCharacterDetailSection(summary)
  );
}

function stripUnsupportedPointOfViewLines(summary: string) {
  return summary
    .split("\n")
    .filter(
      (line) =>
        !/\b(?:protagonist|main character|lead character|primary character|on-page primary character|primary pov|point-of-view|point of view|pov)\b/i.test(
          line,
        ),
    )
    .join("\n")
    .trim();
}

function inferEntitySubtype(entity: ScanResult["entities"][number]) {
  if (entity.category === "item") {
    return entity.itemSubtype ?? null;
  }

  if (entity.category !== "character") {
    return null;
  }

  const text = `${entity.name} ${entity.summary}`.toLowerCase();
  const hasExplicitPrimaryCue =
    /\b(?:protagonist|main character|lead character|primary character|on-page primary character)\b/.test(
      text,
    );
  const hasPovCue = /\b(?:primary pov|point-of-view|point of view|pov)\b/.test(
    text,
  );
  const appearsNonHuman =
    /\b(?:animal|horse|mare|stallion|mount|steed|hound|dog|cat|wolf|bird)\b/.test(
      text,
    );
  const hasSubstantiveEvidence =
    !entity.isStub ||
    normalizeEntityEvidence(entity.summary, entity.isStub).isStub === false;
  const hasUnsupportedThinPovSummary = hasUnsupportedPovOnlySummary(
    entity.summary,
  );

  if (
    hasSubstantiveEvidence &&
    !appearsNonHuman &&
    (hasExplicitPrimaryCue || (hasPovCue && !hasUnsupportedThinPovSummary))
  ) {
    return "Main";
  }

  return null;
}

function buildWatchOrganizationAliases(name: string) {
  const normalizedName = normalizeAliasValue(name);
  const articleStripped = stripLeadingArticle(normalizedName);

  if (/^City Watchmen$/i.test(articleStripped)) {
    return ["The City Watch", "City Watch", "The Watch", "Watch"];
  }

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

  if (category === "organization" && /Watchmen$/i.test(articleStripped)) {
    score -= 25;
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
  return stripCharacterHonorific(name) !== normalizeAliasValue(name);
}

function endsWithUncertainCharacterSuffix(name: string) {
  return /\b(?:something|someone|somebody)$/i.test(normalizeAliasValue(name));
}

function getCharacterSurname(name: string) {
  const stripped = stripCharacterHonorific(name);
  const tokens = stripped.split(/\s+/).filter(Boolean);
  return tokens.length ? tokens[tokens.length - 1].toLowerCase() : "";
}

function isHonorificSurnameVariant(name: string) {
  const normalized = normalizeAliasValue(name);
  const stripped = stripCharacterHonorific(name);
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
    const existingTokens = stripCharacterHonorific(normalizedExisting)
      .split(/\s+/)
      .filter(Boolean);
    const incomingTokens = stripCharacterHonorific(normalizedIncoming)
      .split(/\s+/)
      .filter(Boolean);

    if (
      existingTokens.length === 1 &&
      incomingTokens.length > 1 &&
      incomingTokens[0]?.toLowerCase() === existingTokens[0]?.toLowerCase()
    ) {
      return normalizedIncoming;
    }

    if (
      incomingTokens.length === 1 &&
      existingTokens.length > 1 &&
      existingTokens[0]?.toLowerCase() === incomingTokens[0]?.toLowerCase()
    ) {
      return normalizedExisting;
    }

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

  if (category === "organization") {
    const existingBase = stripLeadingArticle(normalizedExisting).replace(
      /\bWatchmen$/i,
      "Watch",
    );
    const incomingBase = stripLeadingArticle(normalizedIncoming).replace(
      /\bWatchmen$/i,
      "Watch",
    );

    if (existingBase.toLowerCase() === incomingBase.toLowerCase()) {
      if (
        /Watchmen$/i.test(normalizedExisting) &&
        !/Watchmen$/i.test(normalizedIncoming)
      ) {
        return normalizedIncoming;
      }

      if (
        /Watchmen$/i.test(normalizedIncoming) &&
        !/Watchmen$/i.test(normalizedExisting)
      ) {
        return normalizedExisting;
      }
    }
  }

  if (category === "location") {
    const existingTokens = stripLeadingArticle(normalizedExisting)
      .split(/\s+/)
      .filter(Boolean);
    const incomingTokens = stripLeadingArticle(normalizedIncoming)
      .split(/\s+/)
      .filter(Boolean);
    const descriptiveBuildingSuffixPattern =
      /^(?:Manor|House|Hall|Keep|Castle|Tower|Inn|Tavern)$/i;

    if (
      existingTokens.length === 1 &&
      incomingTokens.length > 1 &&
      descriptiveBuildingSuffixPattern.test(
        incomingTokens[incomingTokens.length - 1] ?? "",
      )
    ) {
      return normalizedExisting;
    }

    if (
      incomingTokens.length === 1 &&
      existingTokens.length > 1 &&
      descriptiveBuildingSuffixPattern.test(
        existingTokens[existingTokens.length - 1] ?? "",
      )
    ) {
      return normalizedIncoming;
    }
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
  const itemPossessiveOwnerMatch =
    entity.category === "item"
      ? normalizedName.match(/^(.+?)['’]s\s+\S/)
      : null;

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
      if (
        itemPossessiveOwnerMatch &&
        normalizedAlias.toLowerCase() ===
          itemPossessiveOwnerMatch[1].toLowerCase()
      ) {
        continue;
      }
      aliases.add(normalizedAlias);
    }
  }

  aliases.delete(normalizedName);
  return [...aliases];
}

function findPreferredCharacterMergeMatch(
  entity: ScanResult["entities"][number],
) {
  if (entity.category !== "character") {
    return undefined;
  }

  const db = getDatabase();

  if (isHonorificSurnameVariant(entity.name)) {
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

      const honorific = getLeadingCharacterHonorific(entity.name);
      const honorificMatches = honorific
        ? exactSurnameMatches.filter((candidate) => {
            const candidateText =
              `${String(candidate.name)} ${String(candidate.article_body ?? "")}`.toLowerCase();
            return new RegExp(`\\b${honorific}\\b`, "i").test(candidateText);
          })
        : exactSurnameMatches;

      if (honorificMatches.length === 1) {
        return honorificMatches[0];
      }

      if (exactSurnameMatches.length === 1) {
        return exactSurnameMatches[0];
      }
    }
  }

  const strippedName = stripCharacterHonorific(entity.name);
  const nameTokens = strippedName.split(/\s+/).filter(Boolean);

  if (nameTokens.length === 1) {
    const firstName = nameTokens[0].toLowerCase();
    const fullNameMatches = db
      .prepare(
        `SELECT *
           FROM entities
          WHERE category = 'character'
            AND lower(name) != lower(?)`,
      )
      .all(entity.name) as Array<Record<string, unknown>>;

    const uniqueMatches = fullNameMatches.filter((candidate) => {
      const candidateTokens = stripCharacterHonorific(String(candidate.name))
        .split(/\s+/)
        .filter(Boolean);

      return (
        candidateTokens.length > 1 &&
        candidateTokens[0]?.toLowerCase() === firstName
      );
    });

    if (uniqueMatches.length === 1) {
      return uniqueMatches[0];
    }
  }

  return undefined;
}

function findPreferredOrganizationMergeMatch(
  entity: ScanResult["entities"][number],
) {
  if (entity.category !== "organization") {
    return undefined;
  }

  const normalizedName = normalizeAliasValue(entity.name);
  const entityBase = stripLeadingArticle(normalizedName).replace(
    /\bWatchmen$/i,
    "Watch",
  );
  if (!/^(?:City Watch|Watch)$/i.test(entityBase)) {
    return undefined;
  }

  const db = getDatabase();
  const matches = db
    .prepare("SELECT * FROM entities WHERE category = 'organization'")
    .all() as Array<Record<string, unknown>>;

  const compatibleMatches = matches.filter((candidate) => {
    const candidateName = normalizeAliasValue(String(candidate.name));
    if (candidateName.toLowerCase() === normalizedName.toLowerCase()) {
      return false;
    }

    const candidateBase = stripLeadingArticle(candidateName).replace(
      /\bWatchmen$/i,
      "Watch",
    );
    return candidateBase.toLowerCase() === entityBase.toLowerCase();
  });

  if (compatibleMatches.length > 0) {
    return compatibleMatches.sort((left, right) => {
      const rightName = String(right.name);
      const leftName = String(left.name);
      const rightScore =
        scoreCanonicalName(rightName, "organization") +
        (String(right.slug) === makeSlug(rightName) ? 1000 : 0);
      const leftScore =
        scoreCanonicalName(leftName, "organization") +
        (String(left.slug) === makeSlug(leftName) ? 1000 : 0);

      return rightScore - leftScore;
    })[0];
  }

  return undefined;
}

function shouldPreserveExistingMainSubtype(
  entity: ScanResult["entities"][number],
) {
  if (entity.category !== "character") {
    return false;
  }

  const text = `${entity.name} ${entity.summary}`.toLowerCase();

  // Stub entries (alias-only references like "John Burton" for Marcus Day) must
  // not downgrade an existing Main character's subtype, unless the stub reveals
  // the character is actually an animal (e.g. "Marcus's horse").
  if (entity.isStub) {
    return !/\b(?:animal|horse|mare|stallion|mount|steed|hound|dog|cat|wolf|bird)\b/.test(
      text,
    );
  }

  const hasUnsupportedThinPovSummary = hasUnsupportedPovOnlySummary(
    entity.summary,
  );

  return (
    !/\b(?:animal|horse|mare|stallion|mount|steed|hound|dog|cat|wolf|bird)\b/.test(
      text,
    ) && !hasUnsupportedThinPovSummary
  );
}

function findEntityByAliasOrSlug(
  entity: ScanResult["entities"][number],
  slug: string,
) {
  const db = getDatabase();
  const aliasCandidates = [entity.name, ...buildImplicitAliases(entity)]
    .map((value) => normalizeAliasValue(value))
    .filter(Boolean);

  const preferredCharacterMatch = findPreferredCharacterMergeMatch(entity);
  if (preferredCharacterMatch) {
    return preferredCharacterMatch;
  }

  const preferredOrganizationMatch =
    findPreferredOrganizationMergeMatch(entity);
  if (preferredOrganizationMatch) {
    return preferredOrganizationMatch;
  }

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

  return undefined;
}

function pruneRedundantAliases(entityId: string, canonicalName: string) {
  getDatabase()
    .prepare(
      "DELETE FROM entity_aliases WHERE entity_id = ? AND lower(alias) = lower(?)",
    )
    .run(entityId, canonicalName);
}

function removeOrphanedScanEntities() {
  const db = getDatabase();
  const orphanRows = db
    .prepare(
      `SELECT id
         FROM entities
        WHERE created_from_chapter_id IS NOT NULL
          AND id NOT IN (
            SELECT target_id
              FROM derived_dependencies
             WHERE target_type = 'entity'
          )`,
    )
    .all() as Array<Record<string, unknown>>;

  for (const row of orphanRows) {
    const entityId = String(row.id);
    db.prepare("DELETE FROM entity_aliases WHERE entity_id = ?").run(entityId);
    db.prepare(
      "DELETE FROM entity_links WHERE from_entity_id = ? OR to_entity_id = ?",
    ).run(entityId, entityId);
    db.prepare("DELETE FROM entities WHERE id = ?").run(entityId);
  }
}

function mergeExactNameDuplicateEntities() {
  const db = getDatabase();
  const rows = db
    .prepare(
      "SELECT id, name, slug, category, created_at FROM entities ORDER BY created_at, id",
    )
    .all() as Array<Record<string, unknown>>;
  const groups = new Map<string, Array<Record<string, unknown>>>();

  for (const row of rows) {
    const key = `${String(row.category).toLowerCase()}:${normalizeAliasValue(String(row.name)).toLowerCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  for (const group of groups.values()) {
    if (group.length < 2) {
      continue;
    }

    const canonicalName = String(group[0].name);
    const preferred =
      group.find((row) => String(row.slug) === makeSlug(canonicalName)) ??
      group[0];

    for (const duplicate of group) {
      if (String(duplicate.id) === String(preferred.id)) {
        continue;
      }

      db.prepare(
        "UPDATE entity_aliases SET entity_id = ? WHERE entity_id = ?",
      ).run(String(preferred.id), String(duplicate.id));
      db.prepare(
        "UPDATE entity_links SET from_entity_id = ? WHERE from_entity_id = ?",
      ).run(String(preferred.id), String(duplicate.id));
      db.prepare(
        "UPDATE entity_links SET to_entity_id = ? WHERE to_entity_id = ?",
      ).run(String(preferred.id), String(duplicate.id));
      db.prepare(
        "UPDATE derived_dependencies SET target_id = ? WHERE target_type = 'entity' AND target_id = ?",
      ).run(String(preferred.id), String(duplicate.id));
      db.prepare("DELETE FROM entities WHERE id = ?").run(String(duplicate.id));
    }

    db.prepare(
      `DELETE FROM entity_aliases
        WHERE id NOT IN (
          SELECT MIN(id)
            FROM entity_aliases
           GROUP BY entity_id, lower(alias)
        )`,
    ).run();
    pruneRedundantAliases(String(preferred.id), canonicalName);
  }
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
  const articleBody =
    entity.category === "character" &&
    hasUnsupportedPovOnlySummary(entity.summary)
      ? stripUnsupportedPointOfViewLines(entity.summary)
      : entity.summary.trim();
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
      // Use the raw entity.isStub rather than the normalized value so that a
      // supplemental stub generated by the normalizer never overwrites a real
      // article body that was written by the LLM or stored from a prior scan.
      incomingIsStub: entity.isStub,
    });
    const sanitizedCanonicalArticleBody =
      entity.category === "character" &&
      hasUnsupportedPovOnlySummary(canonicalArticleBody)
        ? stripUnsupportedPointOfViewLines(canonicalArticleBody)
        : canonicalArticleBody;

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
      inferredSubtype ??
        (entity.category === "character" &&
        existing.subtype === "Main" &&
        shouldPreserveExistingMainSubtype(entity)
          ? "Main"
          : null),
      normalizedEvidence.isStub ? "1" : "0",
      sanitizedCanonicalArticleBody,
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
    pruneRedundantAliases(String(existing.id), canonicalName);

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
  pruneRedundantAliases(id, entity.name);

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

function resolveScannedParentLocations(entities: ScanResult["entities"]) {
  const db = getDatabase();
  const scannedParentByChildSlug = new Map<string, string>();

  for (const entity of entities) {
    if (entity.category !== "location") continue;
    const parentName = entity.parentLocationName?.trim();
    if (!parentName) continue;
    scannedParentByChildSlug.set(makeSlug(entity.name), makeSlug(parentName));
  }

  // Helper: detect if assigning parentId as parent of childId would create a cycle
  function wouldCreateCycle(childId: string, parentId: string): boolean {
    if (childId === parentId) return true;
    let current = parentId;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      const parent = db
        .prepare("SELECT parent_entity_id FROM entities WHERE id = ? LIMIT 1")
        .get(current) as { parent_entity_id: string | null } | undefined;
      if (!parent) break;
      if (parent.parent_entity_id === childId) return true;
      visited.add(current);
      current = parent.parent_entity_id || undefined;
    }
    return false;
  }

  for (const entity of entities) {
    if (entity.category !== "location") {
      continue;
    }

    const entitySlug = makeSlug(entity.name);
    const child = db
      .prepare(
        "SELECT id, parent_entity_id FROM entities WHERE slug = ? LIMIT 1",
      )
      .get(entitySlug) as
      | { id: string; parent_entity_id: string | null }
      | undefined;

    if (!child) {
      continue;
    }

    // If current DB parent directly contradicts scanned location edges (A->B while scan says B->A),
    // clear the contradictory parent so the hierarchy can be rebuilt safely.
    if (child.parent_entity_id) {
      const currentParent = db
        .prepare("SELECT id, slug FROM entities WHERE id = ? LIMIT 1")
        .get(child.parent_entity_id) as
        | { id: string; slug: string }
        | undefined;
      if (
        currentParent &&
        scannedParentByChildSlug.get(currentParent.slug) === entitySlug
      ) {
        db.prepare(
          "UPDATE entities SET parent_entity_id = NULL, updated_at = ? WHERE id = ?",
        ).run(nowIso(), child.id);
      }
    }

    // If the scan explicitly sets a parent, apply it (but preserve existing manual parent and reject cycles).
    if (entity.parentLocationName?.trim()) {
      if (child.parent_entity_id) {
        // Already has a manually set parent — don't overwrite
        continue;
      }

      const parentName = entity.parentLocationName.trim();
      const parentSlug = makeSlug(parentName);

      const parent =
        (db
          .prepare(
            `SELECT id FROM entities WHERE category = 'location' AND (slug = ? OR lower(name) = lower(?)) LIMIT 1`,
          )
          .get(parentSlug, parentName) as { id: string } | undefined) ??
        (db
          .prepare(
            `SELECT e.id FROM entity_aliases a
               JOIN entities e ON e.id = a.entity_id
              WHERE e.category = 'location' AND lower(a.alias) = lower(?)
              LIMIT 1`,
          )
          .get(parentName) as { id: string } | undefined);

      if (
        !parent ||
        parent.id === child.id ||
        wouldCreateCycle(child.id, parent.id)
      ) {
        // Reject: self-loop, not found, or would create cycle
        continue;
      }

      db.prepare(
        "UPDATE entities SET parent_entity_id = ?, updated_at = ? WHERE id = ? AND parent_entity_id IS NULL",
      ).run(parent.id, nowIso(), child.id);
    }
  }
}

function resolveScannedEntityLinks(
  chapterId: string,
  entities: ScanResult["entities"],
) {
  const db = getDatabase();

  for (const entity of entities) {
    if (!entity.links.length) continue;

    const fromSlug = makeSlug(entity.name);
    const from = db
      .prepare("SELECT id FROM entities WHERE slug = ? LIMIT 1")
      .get(fromSlug) as { id: string } | undefined;
    if (!from) continue;

    for (const link of entity.links) {
      const toSlug = makeSlug(link.targetName);
      const to =
        (db
          .prepare(
            "SELECT id FROM entities WHERE slug = ? OR lower(name) = lower(?) LIMIT 1",
          )
          .get(toSlug, link.targetName) as { id: string } | undefined) ??
        (db
          .prepare(
            `SELECT e.id FROM entity_aliases a
               JOIN entities e ON e.id = a.entity_id
              WHERE lower(a.alias) = lower(?) LIMIT 1`,
          )
          .get(link.targetName) as { id: string } | undefined);
      if (!to || to.id === from.id) continue;

      // Skip if this directional link already exists
      const existing = db
        .prepare(
          "SELECT id FROM entity_links WHERE from_entity_id = ? AND to_entity_id = ? AND relation_type = ? LIMIT 1",
        )
        .get(from.id, to.id, link.relationType);
      if (existing) continue;

      db.prepare(
        "INSERT INTO entity_links (id, from_entity_id, to_entity_id, relation_type, source_chapter_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(makeId(), from.id, to.id, link.relationType, chapterId, nowIso());
    }
  }
}

function resolveContainsLinksAsParents() {
  const db = getDatabase();

  // Walk all 'contains' links where both endpoints are locations.
  // If the contained entity has no parent yet, set it to the containing entity.
  const containsLinks = db
    .prepare(
      `SELECT l.from_entity_id, l.to_entity_id
         FROM entity_links l
         JOIN entities f ON f.id = l.from_entity_id AND f.category = 'location'
         JOIN entities t ON t.id = l.to_entity_id  AND t.category = 'location'
        WHERE l.relation_type = 'contains'`,
    )
    .all() as { from_entity_id: string; to_entity_id: string }[];

  for (const { from_entity_id, to_entity_id } of containsLinks) {
    db.prepare(
      "UPDATE entities SET parent_entity_id = ?, updated_at = ? WHERE id = ? AND parent_entity_id IS NULL",
    ).run(from_entity_id, nowIso(), to_entity_id);
  }
}

export function reconcileCanon(chapterId: string, result: ScanResult) {
  const entityOutcomes = result.entities.map((entity) =>
    upsertEntity(chapterId, entity),
  );
  resolveScannedParentLocations(result.entities);
  resolveScannedEntityLinks(chapterId, result.entities);
  resolveContainsLinksAsParents();
  replaceChronology(chapterId, result.chronology);
  replaceWatchlist(chapterId, result.watchlist);

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
  mergeExactNameDuplicateEntities();
  removeOrphanedScanEntities();
  regenerateGeneratedPages();

  return {
    entityOutcomes,
    summary: result.summary,
  };
}

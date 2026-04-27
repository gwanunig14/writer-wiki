import { getDatabase } from "$lib/server/db/client";
import {
  tokenize,
  scoreMatch,
} from "$lib/server/retrieval/retrieve-canon-context";
import type { ChapterRecord } from "$lib/types/domain";
import type { ChapterScanComparisonPacket } from "$lib/server/prompts/scan-prompt";
import {
  buildChapterScanPayload,
  buildChapterScanInput,
} from "$lib/server/prompts/scan-prompt";

type PriorCanonCoverage = "none" | "low" | "medium" | "high";

type ExtractionDetails = {
  multiToken: string[];
  titledEntity: string[];
  titleOfPlace: string[];
  titledSpan: string[];
  quoted: string[];
  canonOverlap: string[];
  repeated: string[];
  normalized: string[];
  fallbackCentral: Array<{
    name: string;
    score: number;
    reasons: string[];
    mentions: number;
  }>;
  rejected: Array<{
    name: string;
    reason: string;
  }>;
};

type ExtractedEntitiesResult = {
  candidates: Set<string>;
  fallbackMode: boolean;
  extractionDetails: ExtractionDetails;
};

export type ReconciliationSignals = {
  contradictionCount: number;
  unresolvedAmbiguityCount: number;
  entitiesTouched: number;
  fileMoveCount: number;
  stubEntityCount: number;
  missingDescriptionCount: number;
  validationRetryCount: number;
  seriesBibleOutcome:
    | "no-series-bible-update-needed"
    | "series-bible-update-required"
    | "series-bible-review-required";
};

export type ScanContext = {
  comparisonPacket: ChapterScanComparisonPacket;
  priorCanonCoverage: PriorCanonCoverage;
  fallbackMode: boolean;
  extractionDetails: ExtractionDetails;
  stats: {
    touchedEntityCount: number;
    chronologyCount: number;
    watchlistCount: number;
    contradictionCount: number;
    ambiguityCount: number;
    seriesBibleSectionCount: number;
    reconciliationConfidence: number;
  };
  escalationHints: {
    contradictionCountExceededThreshold: boolean;
    unresolvedAmbiguityExceededThreshold: boolean;
    majorSeriesBibleImpact: boolean;
    lowReconciliationConfidence: boolean;
    validationRetryCount: number;
  };
  scanPayload: ReturnType<typeof buildChapterScanPayload>;
  scanInput: ReturnType<typeof buildChapterScanInput>;
};

type ScanContextOptions = {
  /**
   * Optional project-specific terms that are broad world/background entities.
   * Example: if a fantasy project has a world called "Eldoria", pass ["Eldoria"].
   * These terms are treated as weak comparison coverage by themselves.
   */
  broadEntityTerms?: string[];
};

type CandidateScore = {
  name: string;
  mentions: number;
  score: number;
  reasons: string[];
};

const GENERIC_TITLES = [
  "Baroness",
  "Baron",
  "Emperor",
  "Empress",
  "Duke",
  "Duchess",
  "King",
  "Queen",
  "Prince",
  "Princess",
  "Lord",
  "Lady",
  "Captain",
  "Sir",
  "Madam",
  "Master",
  "Mistress",
  "Doctor",
  "Father",
  "Mother",
] as const;

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "of",
  "in",
  "on",
  "at",
  "to",
  "for",
  "by",
  "with",
  "from",
  "as",
  "but",
  "or",
  "nor",
  "so",
  "yet",
  "is",
  "was",
  "are",
  "were",
  "be",
  "been",
  "has",
  "had",
  "have",
  "do",
  "does",
  "did",
  "that",
  "this",
  "these",
  "those",
]);

const BLOCKED_SINGLE_TOKEN_CANDIDATES = new Set([
  "Chapter",
  "The",
  "A",
  "An",
  "He",
  "She",
  "His",
  "Her",
  "They",
  "Them",
  "There",
  "This",
  "That",
  "Those",
  "These",
  "It",
  "Its",
  "Salt",
  "Water",
  "Workers",
  "Dockworkers",
  "Merchants",
  "Sailors",
  "Children",
  "Animals",
  "People",
  "Someone",
  "Something",
  "Everyone",
  "Everything",
]);

const RELATIONSHIP_TERMS = [
  "son",
  "daughter",
  "sister",
  "brother",
  "husband",
  "wife",
  "father",
  "mother",
  "right hand",
  "friend",
  "enemy",
  "rival",
  "mentor",
  "apprentice",
  "servant",
  "guard",
  "advisor",
  "counselor",
  "heir",
  "successor",
  "predecessor",
  "partner",
  "spouse",
  "child",
  "parent",
  "uncle",
  "aunt",
  "cousin",
  "nephew",
  "niece",
];

const DESCRIPTION_TERMS = [
  "hair",
  "eyes",
  "dress",
  "suit",
  "coat",
  "gloves",
  "face",
  "beard",
  "mustache",
  "scar",
  "thin",
  "short",
  "tall",
  "old",
  "young",
  "smiled",
  "frowned",
  "bowed",
  "walked",
  "stood",
  "sat",
  "limped",
  "wore",
  "wearing",
  "looked",
  "seemed",
  "appeared",
];

const GENERIC_BROAD_ENTITY_PATTERNS = [
  /\bworld\b/i,
  /\bempire\b/i,
  /\bkingdom\b/i,
  /\brealm\b/i,
  /\bcontinent\b/i,
  /\bplanet\b/i,
  /\buniverse\b/i,
  /\bcountry\b/i,
  /\bnation\b/i,
  /\bsetting\b/i,
  /\bcivilization\b/i,
];

const CONTRADICTION_ESCALATION_THRESHOLD = 1;
const UNRESOLVED_AMBIGUITY_ESCALATION_THRESHOLD = 2;
const MAJOR_SERIES_BIBLE_THRESHOLD = 1;
const RECONCILIATION_CONFIDENCE_THRESHOLD = 0.7;

const MAX_ENTITY_CONTEXT = 8;
const MAX_CHRONOLOGY_CONTEXT = 8;
const MAX_WATCHLIST_CONTEXT = 8;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compactLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function uniquePush(
  list: string[],
  value: string,
  max = Number.POSITIVE_INFINITY,
) {
  const clean = compactLine(value);
  if (!clean || list.includes(clean) || list.length >= max) return;
  list.push(clean);
}

function isGenericTitle(value: string): boolean {
  return GENERIC_TITLES.includes(value as (typeof GENERIC_TITLES)[number]);
}

function isBlockedSingleTokenCandidate(
  value: string,
  canonNames: Set<string>,
  canonAliases: Set<string>,
): boolean {
  const clean = compactLine(value);
  if (clean.split(/\s+/).length !== 1) return false;
  if (canonNames.has(clean) || canonAliases.has(clean)) return false;
  if (BLOCKED_SINGLE_TOKEN_CANDIDATES.has(clean)) return true;
  if (STOPWORDS.has(clean.toLowerCase())) return true;
  if (isGenericTitle(clean)) return true;
  return false;
}

function isBroadEntity(
  name: string,
  projectBroadEntityTerms: string[] = [],
): boolean {
  const clean = compactLine(name);
  if (!clean) return false;

  const projectPatterns = projectBroadEntityTerms
    .filter(Boolean)
    .map((term) => new RegExp(`\\b${escapeRegExp(term)}\\b`, "i"));

  return [...GENERIC_BROAD_ENTITY_PATTERNS, ...projectPatterns].some(
    (pattern) => pattern.test(clean),
  );
}

function getNearbyText(text: string, name: string, before = 180, after = 240) {
  const escapedName = escapeRegExp(name);
  const matches = [...text.matchAll(new RegExp(`\\b${escapedName}\\b`, "gi"))];

  return matches
    .map((match) => {
      const index = match.index ?? 0;
      return text.slice(
        Math.max(0, index - before),
        index + name.length + after,
      );
    })
    .join(" ");
}

function countNameMentions(text: string, name: string): number {
  const escapedName = escapeRegExp(name);
  return [...text.matchAll(new RegExp(`\\b${escapedName}\\b`, "gi"))].length;
}

function appearsEarly(text: string, name: string): boolean {
  const index = text.toLowerCase().indexOf(name.toLowerCase());
  return index >= 0 && index < text.length * 0.15;
}

function appearsAsDialogueSpeaker(text: string, name: string): boolean {
  const escapedName = escapeRegExp(name);

  const patterns = [
    new RegExp(`\\b${escapedName}\\b\\s*:`, "i"),
    new RegExp(
      `["“][^"”]{0,240}["”]\\s*,?\\s*${escapedName}\\s+(said|asked|answered|replied|whispered|called|mused|laughed|sighed)\\b`,
      "i",
    ),
    new RegExp(
      `\\b${escapedName}\\s+(said|asked|answered|replied|whispered|called|mused|laughed|sighed)\\b`,
      "i",
    ),
  ];

  return patterns.some((pattern) => pattern.test(text));
}

function hasRelationshipContext(text: string, name: string): boolean {
  const nearbyText = getNearbyText(text, name).toLowerCase();
  return RELATIONSHIP_TERMS.some((term) => nearbyText.includes(term));
}

function hasDescriptionContext(text: string, name: string): boolean {
  const nearbyText = getNearbyText(text, name).toLowerCase();
  return DESCRIPTION_TERMS.some((term) => nearbyText.includes(term));
}

function scoreChapterCandidate(name: string, text: string): CandidateScore {
  const mentions = countNameMentions(text, name);
  const reasons: string[] = [];
  let score = 0;

  if (mentions > 1) {
    score += Math.min(mentions, 12) * 1.8;
    reasons.push("repeated mention");
  }

  if (name.split(/\s+/).length > 1) {
    score += 3;
    reasons.push("multi-token proper name");
  }

  if (GENERIC_TITLES.some((title) => name.startsWith(`${title} `))) {
    score += 3;
    reasons.push("title + name");
  }

  if (appearsEarly(text, name)) {
    score += 2;
    reasons.push("appears early");
  }

  if (appearsAsDialogueSpeaker(text, name)) {
    score += 2;
    reasons.push("dialogue speaker");
  }

  if (hasRelationshipContext(text, name)) {
    score += 1.5;
    reasons.push("relationship context");
  }

  if (hasDescriptionContext(text, name)) {
    score += 1.5;
    reasons.push("description context");
  }

  return {
    name,
    mentions,
    score: Number(score.toFixed(3)),
    reasons,
  };
}

function addCandidate(
  candidates: Set<string>,
  detailsList: string[],
  candidate: string,
  canonNames: Set<string>,
  canonAliases: Set<string>,
  rejected: ExtractionDetails["rejected"],
) {
  const clean = compactLine(candidate);
  if (!clean) return;

  if (isBlockedSingleTokenCandidate(clean, canonNames, canonAliases)) {
    rejected.push({ name: clean, reason: "blocked single-token candidate" });
    return;
  }

  candidates.add(clean);
  detailsList.push(clean);
}

function normalizeCandidate(
  candidate: string,
  text: string,
  canonNames: Set<string>,
  canonAliases: Set<string>,
): string | null {
  let normalized = compactLine(candidate).replace(/'s\b/g, "");

  if (!normalized || STOPWORDS.has(normalized.toLowerCase())) return null;
  if (isGenericTitle(normalized)) return null;

  if (
    normalized.split(/\s+/).length === 1 &&
    !canonNames.has(normalized) &&
    !canonAliases.has(normalized)
  ) {
    return null;
  }

  for (const canon of canonNames) {
    if (normalized.toLowerCase() === canon.toLowerCase()) {
      return canon;
    }
  }

  for (const alias of canonAliases) {
    if (normalized.toLowerCase() !== alias.toLowerCase()) continue;

    for (const canon of canonNames) {
      if (
        canon.toLowerCase() !== alias.toLowerCase() &&
        text.toLowerCase().includes(canon.toLowerCase())
      ) {
        return canon;
      }
    }

    return alias;
  }

  return normalized;
}

/**
 * Extract candidate entities from chapter text, canon-assisted if possible.
 * If prior canon is sparse, fallback to strong chapter-local extraction.
 */
function extractChapterEntities(
  text: string,
  canonNames: Set<string>,
  canonAliases: Set<string>,
  priorCanonCoverage: PriorCanonCoverage,
): ExtractedEntitiesResult {
  const extractionDetails: ExtractionDetails = {
    multiToken: [],
    titledEntity: [],
    titleOfPlace: [],
    titledSpan: [],
    quoted: [],
    canonOverlap: [],
    repeated: [],
    normalized: [],
    fallbackCentral: [],
    rejected: [],
  };

  const candidates = new Set<string>();
  let match: RegExpExecArray | null;

  const multiTokenPattern =
    /\b([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+){1,4})\b/g;
  while ((match = multiTokenPattern.exec(text))) {
    addCandidate(
      candidates,
      extractionDetails.multiToken,
      match[1],
      canonNames,
      canonAliases,
      extractionDetails.rejected,
    );
  }

  const titleNamePattern = new RegExp(
    `\\b(${GENERIC_TITLES.join("|")})\\s+([A-Z][a-zA-Z'-]+(?:\\s+[A-Z][a-zA-Z'-]+){0,3})`,
    "g",
  );
  while ((match = titleNamePattern.exec(text))) {
    addCandidate(
      candidates,
      extractionDetails.titledEntity,
      `${match[1]} ${match[2]}`,
      canonNames,
      canonAliases,
      extractionDetails.rejected,
    );
  }

  const titleOfPlacePattern = new RegExp(
    `\\b(${GENERIC_TITLES.join("|")})\\s+of\\s+([A-Z][a-zA-Z'-]+(?:\\s+[A-Z][a-zA-Z'-]+){0,3})`,
    "g",
  );
  while ((match = titleOfPlacePattern.exec(text))) {
    const fullTitle = `${match[1]} of ${match[2]}`;
    const placeOrRole = match[2];

    addCandidate(
      candidates,
      extractionDetails.titleOfPlace,
      fullTitle,
      canonNames,
      canonAliases,
      extractionDetails.rejected,
    );

    addCandidate(
      candidates,
      extractionDetails.titleOfPlace,
      placeOrRole,
      canonNames,
      canonAliases,
      extractionDetails.rejected,
    );
  }

  const titledSpanPattern =
    /\bThe\s+[A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+){1,4}\b/g;
  while ((match = titledSpanPattern.exec(text))) {
    addCandidate(
      candidates,
      extractionDetails.titledSpan,
      match[0],
      canonNames,
      canonAliases,
      extractionDetails.rejected,
    );
  }

  const quotedNamePattern =
    /["“']([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+){0,4})["”']/g;
  while ((match = quotedNamePattern.exec(text))) {
    addCandidate(
      candidates,
      extractionDetails.quoted,
      match[1],
      canonNames,
      canonAliases,
      extractionDetails.rejected,
    );
  }

  for (const canon of [...canonNames, ...canonAliases]) {
    if (!canon || canon.length < 3) continue;

    const canonPattern = new RegExp(`\\b${escapeRegExp(canon)}(?:'s)?\\b`, "i");
    if (canonPattern.test(text)) {
      addCandidate(
        candidates,
        extractionDetails.canonOverlap,
        canon,
        canonNames,
        canonAliases,
        extractionDetails.rejected,
      );
    }
  }

  const capSpanCounts = new Map<string, number>();
  const capSpanPattern = /\b([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+){0,3})\b/g;
  while ((match = capSpanPattern.exec(text))) {
    const candidate = compactLine(match[1]);
    if (!candidate || candidate.length < 3) continue;
    if (STOPWORDS.has(candidate.toLowerCase())) continue;
    if (isBlockedSingleTokenCandidate(candidate, canonNames, canonAliases))
      continue;

    capSpanCounts.set(candidate, (capSpanCounts.get(candidate) ?? 0) + 1);
  }

  for (const [span, count] of capSpanCounts.entries()) {
    if (count <= 1) continue;

    addCandidate(
      candidates,
      extractionDetails.repeated,
      span,
      canonNames,
      canonAliases,
      extractionDetails.rejected,
    );
  }

  const normalized = new Set<string>();
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeCandidate(
      candidate,
      text,
      canonNames,
      canonAliases,
    );

    if (!normalizedCandidate) {
      extractionDetails.rejected.push({
        name: candidate,
        reason: "normalization rejected candidate",
      });
      continue;
    }

    if (
      isBlockedSingleTokenCandidate(
        normalizedCandidate,
        canonNames,
        canonAliases,
      )
    ) {
      extractionDetails.rejected.push({
        name: normalizedCandidate,
        reason: "blocked normalized single-token candidate",
      });
      continue;
    }

    normalized.add(normalizedCandidate);
    extractionDetails.normalized.push(normalizedCandidate);
  }

  let fallbackMode = false;

  if (priorCanonCoverage === "none" || priorCanonCoverage === "low") {
    fallbackMode = true;

    const scoredCandidates = Array.from(normalized)
      .map((name) => scoreChapterCandidate(name, text))
      .filter((candidate) => candidate.score >= 5)
      .sort((left, right) => right.score - left.score);

    for (const candidate of scoredCandidates) {
      normalized.add(candidate.name);
      extractionDetails.fallbackCentral.push(candidate);
    }
  }

  return {
    candidates: normalized,
    fallbackMode,
    extractionDetails,
  };
}

/**
 * Extract a few stable anchors from existing article prose for compact comparison packets.
 * This deliberately stays generic: no project-specific fields, no invented facts.
 */
function collectStableFacts(
  articleBody: string,
  parentLocationName: string | null,
): string[] {
  const cleanBody = articleBody.replace(/\s+/g, " ").trim();
  const facts: string[] = [];

  if (parentLocationName) {
    uniquePush(facts, `Parent location: ${parentLocationName}`, 1);
  }

  if (!cleanBody) return facts;

  const sentences = cleanBody
    .split(/(?<=[.!?])\s+/)
    .map(compactLine)
    .filter(Boolean);

  const stableAnchorTerms = [
    " is ",
    " was ",
    " serves ",
    " served ",
    " owns ",
    " owned ",
    " leads ",
    " led ",
    " member ",
    " family ",
    " sibling ",
    " parent ",
    " child ",
    " spouse ",
    " located ",
    " founded ",
    " rules ",
    " ruled ",
    " associated ",
    " described ",
  ];

  for (const sentence of sentences) {
    if (facts.length >= 5) break;
    const lower = sentence.toLowerCase();

    if (stableAnchorTerms.some((term) => lower.includes(term.trim()))) {
      uniquePush(facts, sentence, 5);
    }
  }

  if (facts.length === 0 && sentences[0]) {
    uniquePush(facts, sentences[0], 1);
  }

  return facts;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Returns a heuristic confidence score from 0 to 1.
 *
 * Interpretation:
 * - 0.85 to 1.00 => low reconciliation risk
 * - 0.70 to 0.84 => moderate reconciliation risk
 * - below 0.70   => high reconciliation risk; consider escalation
 */
export function estimateReconciliationConfidence(
  signals: ReconciliationSignals,
): number {
  let score = 1;

  score -= Math.min(signals.contradictionCount, 5) * 0.08;
  score -= Math.min(signals.unresolvedAmbiguityCount, 6) * 0.05;
  score -= Math.min(signals.fileMoveCount, 4) * 0.04;
  score -= Math.min(signals.stubEntityCount, 6) * 0.025;
  score -= Math.min(signals.missingDescriptionCount, 6) * 0.02;
  score -= Math.min(signals.validationRetryCount, 3) * 0.08;

  if (signals.seriesBibleOutcome === "series-bible-review-required") {
    score -= 0.12;
  } else if (signals.seriesBibleOutcome === "series-bible-update-required") {
    score -= 0.04;
  }

  if (signals.entitiesTouched >= 15) {
    score -= 0.06;
  } else if (signals.entitiesTouched >= 10) {
    score -= 0.03;
  }

  return clamp01(Number(score.toFixed(3)));
}

function calculatePriorCanonCoverage(
  comparisonPacket: ChapterScanComparisonPacket,
  projectBroadEntityTerms: string[],
): PriorCanonCoverage {
  const relevantEntities = comparisonPacket.entities.filter(
    (entity) => !isBroadEntity(entity.canonicalName, projectBroadEntityTerms),
  );

  const hasChronology =
    (comparisonPacket.chronologyComparisonFacts?.length ?? 0) > 0;
  const hasWatchlist = (comparisonPacket.watchlistNotes?.length ?? 0) > 0;

  if (relevantEntities.length === 0 && !hasChronology && !hasWatchlist) {
    return "none";
  }

  if (
    relevantEntities.length <= 3 ||
    (relevantEntities.length === 0 && comparisonPacket.entities.length > 0) ||
    (comparisonPacket.entities.length > 0 &&
      comparisonPacket.entities.every((entity) =>
        isBroadEntity(entity.canonicalName, projectBroadEntityTerms),
      ))
  ) {
    return "low";
  }

  if (relevantEntities.length > 3 && relevantEntities.length < 7) {
    return "medium";
  }

  return "high";
}

function logComparisonPacketSelection(details: Record<string, unknown>) {
  // eslint-disable-next-line no-console
  console.info("[scan:comparison-packet] entity selection", details);
}

export function getScanContext(
  chapter: ChapterRecord,
  options: ScanContextOptions = {},
): ScanContext {
  const projectBroadEntityTerms = options.broadEntityTerms ?? [];
  const seriesBibleSections: unknown[] = [];
  const db = getDatabase();

  const chapterText = `${chapter.title} ${chapter.currentText}`;
  const chapterTokens = tokenize(chapterText);

  const entityRows = db
    .prepare(
      `SELECT e.id, e.name, e.category, e.article_body, e.is_stub, p.name AS parent_location_name
       FROM entities e
       LEFT JOIN entities p ON p.id = e.parent_entity_id
       ORDER BY e.updated_at DESC
       LIMIT 120`,
    )
    .all() as Array<Record<string, unknown>>;

  const aliasRows = db
    .prepare(
      `SELECT entity_id, alias
       FROM entity_aliases
       ORDER BY created_at DESC`,
    )
    .all() as Array<Record<string, unknown>>;

  const aliasesByEntityId = new Map<string, string[]>();
  for (const row of aliasRows) {
    const entityId = String(row.entity_id ?? "");
    const alias = compactLine(String(row.alias ?? ""));
    if (!entityId || !alias) continue;

    const current = aliasesByEntityId.get(entityId) ?? [];
    uniquePush(current, alias, 8);
    aliasesByEntityId.set(entityId, current);
  }

  const canonNames = new Set<string>();
  const canonAliases = new Set<string>();
  for (const row of entityRows) {
    const name = compactLine(String(row.name ?? ""));
    if (name) canonNames.add(name);

    const aliases = aliasesByEntityId.get(String(row.id ?? "")) ?? [];
    for (const alias of aliases) {
      if (alias) canonAliases.add(alias);
    }
  }

  const initialPriorCanonCoverage: PriorCanonCoverage =
    entityRows.length === 0 ? "none" : "low";

  const extractionResult = extractChapterEntities(
    chapterText,
    canonNames,
    canonAliases,
    initialPriorCanonCoverage,
  );

  const extractedEntities = extractionResult.candidates;
  const fallbackMode = extractionResult.fallbackMode;
  const extractionDetails = extractionResult.extractionDetails;

  logComparisonPacketSelection({
    stage: "extracted chapter entity candidates",
    fallbackMode,
    extractedEntities: Array.from(extractedEntities),
    fallbackCentral: extractionDetails.fallbackCentral,
    rejected: extractionDetails.rejected.slice(0, 25),
  });

  const chronologyRows = db
    .prepare(
      `SELECT label, body
       FROM chronology_entries
       ORDER BY updated_at DESC
       LIMIT 30`,
    )
    .all() as Array<Record<string, unknown>>;

  const watchlistRows = db
    .prepare(
      `SELECT type, subject, body
       FROM watchlist_entries
       WHERE status = ?
       ORDER BY updated_at DESC
       LIMIT 30`,
    )
    .all("active") as Array<Record<string, unknown>>;

  const nearbyChronology = chronologyRows
    .map((row) => {
      const label = String(row.label ?? "");
      const body = String(row.body ?? "");
      const rowText = `${label} ${body}`;
      let overlap = 0;

      for (const entity of extractedEntities) {
        if (rowText.toLowerCase().includes(entity.toLowerCase())) overlap++;
      }

      return {
        row,
        overlap,
        score: scoreMatch(rowText, chapterTokens) + overlap * 10,
      };
    })
    .filter((entry) => entry.overlap > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_CHRONOLOGY_CONTEXT)
    .map((entry) => entry.row);

  const relevantWatchlist = watchlistRows
    .map((row) => {
      const subject = String(row.subject ?? "");
      const body = String(row.body ?? "");
      const rowText = `${subject} ${body}`;
      let overlap = 0;

      for (const entity of extractedEntities) {
        if (rowText.toLowerCase().includes(entity.toLowerCase())) overlap++;
      }

      return {
        row,
        overlap,
        score: scoreMatch(rowText, chapterTokens) + overlap * 10,
      };
    })
    .filter((entry) => {
      const body = compactLine(String(entry.row.body ?? ""));
      return entry.overlap > 0 && body.length > 0;
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_WATCHLIST_CONTEXT);

  const entityNameMap = new Map<
    string,
    { entity: Record<string, unknown>; names: string[] }
  >();

  for (const row of entityRows) {
    const entityId = String(row.id ?? "");
    if (!entityId) continue;

    const name = compactLine(String(row.name ?? ""));
    const aliases = aliasesByEntityId.get(entityId) ?? [];
    const names = [name, ...aliases].map(compactLine).filter(Boolean);

    entityNameMap.set(entityId, { entity: row, names });
  }

  const canonCandidates: Array<{
    entity: Record<string, unknown>;
    matchNames: string[];
    matchScore: number;
    overlap: number;
    reason: string;
  }> = [];

  for (const { entity, names } of entityNameMap.values()) {
    const matchNames: string[] = [];
    let overlap = 0;
    let score = 0;

    for (const name of names) {
      if (!name) continue;

      const exactExtractedMatch = Array.from(extractedEntities).some(
        (entityName) =>
          entityName.localeCompare(name, undefined, { sensitivity: "base" }) ===
          0,
      );

      if (exactExtractedMatch) {
        matchNames.push(name);
        overlap++;
        score += 15;
        continue;
      }

      if (chapterText.toLowerCase().includes(name.toLowerCase())) {
        matchNames.push(name);
        score += 5;
      }
    }

    if (overlap === 0) score -= 20;

    if (matchNames.length > 0 && score > 0) {
      canonCandidates.push({
        entity,
        matchNames,
        matchScore: score,
        overlap,
        reason:
          overlap > 0
            ? "direct extracted-entity overlap"
            : "weak chapter-text match",
      });
    }
  }

  logComparisonPacketSelection({
    stage: "canon candidates before ranking",
    candidates: canonCandidates.map((candidate) => ({
      name: candidate.entity.name,
      overlap: candidate.overlap,
      score: candidate.matchScore,
      matchNames: candidate.matchNames,
    })),
  });

  canonCandidates.sort(
    (left, right) =>
      right.overlap - left.overlap || right.matchScore - left.matchScore,
  );

  const selectedEntities: Array<{
    entity: Record<string, unknown>;
    reason: string;
    matchNames: string[];
  }> = [];
  const seenIds = new Set<string>();

  for (const candidate of canonCandidates) {
    if (candidate.overlap === 0) continue;

    const entityId = String(candidate.entity.id ?? "");
    if (!entityId || seenIds.has(entityId)) continue;

    selectedEntities.push({
      entity: candidate.entity,
      reason: candidate.reason,
      matchNames: candidate.matchNames,
    });
    seenIds.add(entityId);

    if (selectedEntities.length >= MAX_ENTITY_CONTEXT) break;
  }

  logComparisonPacketSelection({
    stage: "final included comparison packet entities",
    selectedEntities: selectedEntities.map((entry) => ({
      name: entry.entity.name,
      reason: entry.reason,
      matchNames: entry.matchNames,
    })),
  });

  const comparisonPacket: ChapterScanComparisonPacket = {
    entities: selectedEntities.map(({ entity }) => {
      const canonicalName = compactLine(String(entity.name ?? ""));
      const category = String(entity.category ?? "character") as
        | "character"
        | "location"
        | "item"
        | "organization";
      const entityId = String(entity.id ?? "");
      const parentLocationName = compactLine(
        String(entity.parent_location_name ?? ""),
      );

      const stableFacts = collectStableFacts(
        String(entity.article_body ?? ""),
        parentLocationName || null,
      );

      const openRisks = relevantWatchlist
        .filter((entry) => {
          const subject = compactLine(String(entry.row.subject ?? ""));
          return (
            subject.localeCompare(canonicalName, undefined, {
              sensitivity: "base",
            }) === 0 ||
            subject.toLowerCase().includes(canonicalName.toLowerCase()) ||
            Array.from(extractedEntities).some((entityName) =>
              subject.toLowerCase().includes(entityName.toLowerCase()),
            )
          );
        })
        .map((entry) => compactLine(String(entry.row.body ?? "")))
        .filter(Boolean)
        .slice(0, 3);

      return {
        canonicalName,
        category,
        aliases: aliasesByEntityId.get(entityId) ?? [],
        stableFacts,
        openRisks,
      };
    }),
    chronologyComparisonFacts: nearbyChronology
      .map((row) => {
        const label = compactLine(String(row.label ?? ""));
        const body = compactLine(String(row.body ?? ""));
        return `${label}: ${body}`;
      })
      .slice(0, MAX_CHRONOLOGY_CONTEXT),
    watchlistNotes: relevantWatchlist
      .map((entry) => {
        const subject = compactLine(String(entry.row.subject ?? ""));
        const type = compactLine(String(entry.row.type ?? ""));
        const body = compactLine(String(entry.row.body ?? ""));
        return `${subject} [${type}]: ${body}`;
      })
      .slice(0, MAX_WATCHLIST_CONTEXT),
  };

  const priorCanonCoverage = calculatePriorCanonCoverage(
    comparisonPacket,
    projectBroadEntityTerms,
  );

  const contradictionCount = relevantWatchlist.filter(
    (entry) => String(entry.row.type ?? "") === "contradiction",
  ).length;

  const ambiguityCount = relevantWatchlist.filter((entry) =>
    [
      "name-collision",
      "relationship-ambiguity",
      "location-risk",
      "item-clarification",
      "timeline-risk",
    ].includes(String(entry.row.type ?? "")),
  ).length;

  const watchlistCount = relevantWatchlist.length;
  const seriesBibleOutcome =
    seriesBibleSections.length > 0
      ? "series-bible-update-required"
      : "no-series-bible-update-needed";

  const reconciliationConfidence = estimateReconciliationConfidence({
    contradictionCount,
    unresolvedAmbiguityCount: ambiguityCount,
    entitiesTouched: selectedEntities.length,
    fileMoveCount: 0,
    stubEntityCount: selectedEntities.filter((entry) =>
      Boolean(entry.entity.is_stub),
    ).length,
    missingDescriptionCount: 0,
    validationRetryCount: 0,
    seriesBibleOutcome,
  });

  const scanPayload = buildChapterScanPayload({
    chapterNumber: chapter.number,
    chapterTitle: chapter.title,
    chapterText,
    comparisonPacket,
    priorCanonCoverage,
  });

  const scanInput = buildChapterScanInput(scanPayload, priorCanonCoverage);

  return {
    comparisonPacket,
    priorCanonCoverage,
    fallbackMode,
    extractionDetails,
    stats: {
      touchedEntityCount: selectedEntities.length,
      chronologyCount: nearbyChronology.length,
      watchlistCount,
      contradictionCount,
      ambiguityCount,
      seriesBibleSectionCount: seriesBibleSections.length,
      reconciliationConfidence,
    },
    escalationHints: {
      contradictionCountExceededThreshold:
        contradictionCount > CONTRADICTION_ESCALATION_THRESHOLD,
      unresolvedAmbiguityExceededThreshold:
        ambiguityCount > UNRESOLVED_AMBIGUITY_ESCALATION_THRESHOLD,
      majorSeriesBibleImpact:
        seriesBibleSections.length >= MAJOR_SERIES_BIBLE_THRESHOLD,
      lowReconciliationConfidence:
        reconciliationConfidence < RECONCILIATION_CONFIDENCE_THRESHOLD,
      validationRetryCount: 0,
    },
    scanPayload,
    scanInput,
  };
}

import { getDatabase } from "$lib/server/db/client";
import { applyUserCanonDecisionToEntity } from "$lib/server/canon/user-canon-decisions";
import { makeSlug } from "$lib/server/providers/provider";
import { scanResultSchema, type ScanResult } from "$lib/types/scan-result";

type SupportedCategory = ScanResult["entities"][number]["category"];

const locationSuffixes = [
  "Bay",
  "Field",
  "City",
  "Forest",
  "Hall",
  "Hearth",
  "Headquarters",
  "Mansion",
  "Gate",
  "Gates",
  "Road",
  "Street",
  "Tower",
  "Tavern",
  "Inn",
];

const mountContextNouns = ["horse", "destrier", "mare", "stallion", "gelding"];

const organizationSuffixes = [
  "Empire",
  "Watch",
  "Watchmen",
  "Army",
  "Rail",
  "Council",
  "Court",
  "Rangers",
  "Sharpshooters",
  "Guard",
  "Guards",
  "Militia",
  "Guild",
  "Order",
  "Legion",
  "Company",
  "Companies",
];

const characterTitleSuffixes = [
  "King",
  "Queen",
  "Prince",
  "Princess",
  "Duke",
  "Duchess",
  "Emperor",
  "Empress",
];

const possessiveLocationNouns = [
  "bar",
  "barn",
  "camp",
  "desk",
  "farm",
  "hall",
  "home",
  "house",
  "inn",
  "office",
  "place",
  "saloon",
  "shop",
  "stable",
  "tavern",
];

const titlePrefixes = [
  "Captain",
  "Baroness",
  "Baron",
  "Lady",
  "Lord",
  "Ms",
  "Mrs",
  "Mr",
  "Sir",
];

const bareTitleTokens = new Set([...titlePrefixes, "Miss", "Doctor", "Dr"]);

const connectorTokens = new Set(["of", "the"]);

const singleWordStoplist = new Set([
  "All",
  "And",
  "Any",
  "At",
  "But",
  "Captain",
  "Cards",
  "Chapter",
  "Current",
  "Every",
  "Five",
  "For",
  "Four",
  "From",
  "Give",
  "Good",
  "He",
  "Her",
  "His",
  "How",
  "If",
  "In",
  "Inside",
  "Instead",
  "It",
  "Just",
  "Judging",
  "Later",
  "Less",
  "Like",
  "Maybe",
  "Monday",
  "Most",
  "Ms",
  "Mr",
  "Mrs",
  "Miss",
  "My",
  "No",
  "Not",
  "Now",
  "Oh",
  "One",
  "Only",
  "Probably",
  "Regrettably",
  "Saturday",
  "See",
  "She",
  "Should",
  "Source",
  "Splashes",
  "Sunday",
  "Watchman",
  "That",
  "Thank",
  "The",
  "There",
  "They",
  "This",
  "Thin",
  "Three",
  "Thursday",
  "Through",
  "Turned",
  "Tuesday",
  "Twelve",
  "Two",
  "Watching",
  "Wednesday",
  "What",
  "When",
  "Where",
  "While",
  "Will",
  "Motherhood",
  "Yet",
  "You",
  "Days",
  "War",
  "Join",
]);

const multiWordLeadingStoplist = new Set([
  "All",
  "And",
  "At",
  "Before",
  "Did",
  "Doesn",
  "Don",
  "Every",
  "Fat",
  "For",
  "From",
  "Freed",
  "Give",
  "Hello",
  "If",
  "In",
  "Inside",
  "Instead",
  "Judging",
  "Less",
  "Like",
  "Maybe",
  "Most",
  "Not",
  "Now",
  "One",
  "Only",
  "Poor",
  "Probably",
  "Regrettably",
  "Tell",
  "Then",
  "Thin",
  "Tracking",
  "Through",
  "Turned",
  "Joining",
  "Join",
]);

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isCapitalizedToken(token: string) {
  return /^[A-Z][A-Za-z'-]*$/.test(token);
}

function getExistingEntitySlugs() {
  return new Set(
    getDatabase()
      .prepare("SELECT slug FROM entities")
      .all()
      .map((row) => String((row as Record<string, unknown>).slug)),
  );
}

function getSnippet(text: string, index: number, length: number) {
  const start = Math.max(
    0,
    Math.max(text.lastIndexOf(".", index), text.lastIndexOf("\n", index)) + 1,
  );
  const endCandidates = [
    text.indexOf(".", index + length),
    text.indexOf("\n", index + length),
  ].filter((value) => value !== -1);
  const end = endCandidates.length
    ? Math.min(...endCandidates) + 1
    : text.length;
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function stripTitlePrefix(name: string) {
  return name.replace(
    new RegExp(`^(?:${titlePrefixes.join("|")})\\.?\\s+`),
    "",
  );
}

function normalizeCharacterName(name: string) {
  const stripped = stripTitlePrefix(name).replace(/\s+/g, " ").trim();

  if (!stripped) {
    return name.trim();
  }

  return stripped.split(/\s+/).length >= 2 ? stripped : name.trim();
}

function stripLeadingArticle(name: string) {
  return name.replace(/^The\s+/i, "").trim();
}

function sanitizeMatchedName(name: string) {
  return name
    .replace(/(?:\s+(?:of|the|and))+$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function appearsInChapterText(name: string, chapterText: string) {
  const candidates = [name, stripTitlePrefix(name)].filter(Boolean);

  return candidates.some((candidate) => {
    const pattern = new RegExp(
      `(^|[^A-Za-z])${escapeRegExp(candidate)}([^A-Za-z]|$)`,
      "i",
    );
    return pattern.test(chapterText);
  });
}

function hasPlausibleTokenShape(name: string) {
  const tokens = name.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return false;
  }

  if (tokens.length === 1) {
    return (
      isCapitalizedToken(tokens[0]) &&
      !singleWordStoplist.has(tokens[0]) &&
      !bareTitleTokens.has(tokens[0])
    );
  }

  if (
    multiWordLeadingStoplist.has(tokens[0]) ||
    singleWordStoplist.has(tokens[tokens.length - 1]) ||
    name.includes(" and ")
  ) {
    return false;
  }

  return tokens.every(
    (token, index) =>
      isCapitalizedToken(token) ||
      (index > 0 && connectorTokens.has(token.toLowerCase())),
  );
}

function findFirstNameMatch(name: string, chapterText: string) {
  if (!chapterText) {
    return null;
  }

  const match = new RegExp(
    `(^|[^A-Za-z])${escapeRegExp(name)}([^A-Za-z]|$)`,
    "i",
  ).exec(chapterText);

  if (!match || match.index === undefined) {
    return null;
  }

  const prefixLength = match[1]?.length ?? 0;
  return {
    index: match.index + prefixLength,
    snippet: getSnippet(chapterText, match.index + prefixLength, name.length),
  };
}

function hasStandaloneSingleWordOccurrence(name: string, chapterText: string) {
  if (!chapterText) {
    return false;
  }

  const pattern = new RegExp(`\\b${escapeRegExp(name)}\\b`, "g");

  for (const match of chapterText.matchAll(pattern)) {
    const index = match.index ?? -1;
    if (index >= 0 && isStandaloneSingleToken(index, name, chapterText)) {
      return true;
    }
  }

  return false;
}

function hasMultiWordCharacterOverlap(
  name: string,
  entities: ScanResult["entities"],
) {
  const normalized = name.trim().toLowerCase();

  return entities.some(
    (entity) =>
      entity.category === "character" &&
      entity.name.split(/\s+/).length > 1 &&
      entity.name.toLowerCase().split(/\s+/).includes(normalized),
  );
}

function shouldDropSingleWordLocationCharacterCollision(
  entity: ScanResult["entities"][number],
  entities: ScanResult["entities"],
  existingEntitySlugs: Set<string>,
) {
  return (
    entity.category === "location" &&
    entity.name.split(/\s+/).length === 1 &&
    hasMultiWordCharacterOverlap(entity.name, entities) &&
    !existingEntitySlugs.has(makeSlug(entity.name))
  );
}

function shouldDropSingleWordCharacterAliasCollision(
  entity: ScanResult["entities"][number],
  entities: ScanResult["entities"],
  existingEntitySlugs: Set<string>,
) {
  return (
    entity.category === "character" &&
    entity.name.split(/\s+/).length === 1 &&
    hasMultiWordCharacterOverlap(entity.name, entities) &&
    !existingEntitySlugs.has(makeSlug(entity.name))
  );
}

function shouldDropCoreNameDuplicate(
  entity: ScanResult["entities"][number],
  entities: ScanResult["entities"],
) {
  const normalizeCore = (value: string) =>
    value
      .replace(/^(?:the|mr|mrs|ms|miss|captain|sir|lady|lord)\s+/i, "")
      .trim()
      .toLowerCase();

  const entityCore = normalizeCore(entity.name);

  return entities.some((candidate) => {
    if (candidate === entity || candidate.category !== entity.category) {
      return false;
    }

    const candidateCore = normalizeCore(candidate.name);

    return (
      candidateCore === entityCore &&
      candidate.name.length > entity.name.length &&
      candidate.name.toLowerCase() !== entity.name.toLowerCase()
    );
  });
}

function hasStrongSingleWordEvidence(
  name: string,
  category: SupportedCategory,
  context: string,
) {
  if (category === "item") {
    const mountPattern = mountContextNouns.join("|");

    return (
      new RegExp(
        `\\b(?:${mountPattern})\\b[^.\\n]{0,24}\\b${escapeRegExp(name)}\\b`,
        "i",
      ).test(context) ||
      new RegExp(
        `\\b${escapeRegExp(name)}\\b[^.\\n]{0,24}\\b(?:${mountPattern})\\b`,
        "i",
      ).test(context)
    );
  }

  if (category === "location") {
    return new RegExp(
      `\\b(?:in|into|from|to|toward|towards|at|outside|inside|near|overlooking)\\s+${escapeRegExp(name)}\\b`,
      "i",
    ).test(context);
  }

  if (category === "character") {
    return /\b(with|met|meets|asked|told|said|watched|watching|called|named|wife|husband|son|daughter|captain|miss|ms|mr|mrs|lady|lord|baron|baroness|owner)\b/i.test(
      context,
    );
  }

  return false;
}

function hasCharacterContextCue(context: string) {
  return /\b(owner|captain|baroness|baron|wife|husband|son|daughter|team|partner|man|woman|he|she|his|her|said|asked|mumbled|replied|arrived|rode|took|looked|missed|wanted|knew)\b/i.test(
    context,
  );
}

function isPossessiveOwnerReference(name: string, context: string) {
  return new RegExp(
    `${escapeRegExp(name)}['’]s\\s+(?:${possessiveLocationNouns.join("|")})\\b`,
    "i",
  ).test(context);
}

function buildDuplicateTokenIndex(entities: ScanResult["entities"]) {
  const index = new Map<string, number>();

  for (const entity of entities) {
    if (entity.category !== "character") {
      continue;
    }

    for (const token of entity.name.split(/\s+/).filter(Boolean)) {
      const normalized = token.toLowerCase();
      index.set(normalized, (index.get(normalized) ?? 0) + 1);
    }
  }

  return index;
}

function shouldDropAsPartialDuplicate(
  entity: ScanResult["entities"][number],
  allEntities: ScanResult["entities"],
) {
  if (entity.category !== "character") {
    return false;
  }

  const tokens = entity.name.split(/\s+/).filter(Boolean);
  if (tokens.length !== 1) {
    return false;
  }

  const duplicateTokenIndex = buildDuplicateTokenIndex(allEntities);
  return (duplicateTokenIndex.get(tokens[0].toLowerCase()) ?? 0) > 1;
}

function isStandaloneSingleToken(
  index: number,
  name: string,
  chapterText: string,
) {
  const before = chapterText.slice(Math.max(0, index - 20), index);
  const after = chapterText.slice(
    index + name.length,
    index + name.length + 20,
  );

  return !/[A-Z][a-z]+\s+$/.test(before) && !/^\s+[A-Z][a-z]+/.test(after);
}

function inferCategory(
  name: string,
  context: string,
): SupportedCategory | null {
  const tokens = name.split(/\s+/).filter(Boolean);
  const hasCharacterCue = hasCharacterContextCue(context);
  const mountPattern = mountContextNouns.join("|");
  const articleStrippedName = stripLeadingArticle(name);
  const articleStrippedTokens = articleStrippedName
    .split(/\s+/)
    .filter(Boolean);
  const looksLikePersonName =
    tokens.length > 1 &&
    !name.startsWith("The ") &&
    !tokens.some((token) => connectorTokens.has(token.toLowerCase())) &&
    !locationSuffixes.some(
      (suffix) => name.endsWith(` ${suffix}`) || name === suffix,
    ) &&
    !organizationSuffixes.some(
      (suffix) => name.endsWith(` ${suffix}`) || name === suffix,
    );

  if (
    isPossessiveOwnerReference(name, context) &&
    (looksLikePersonName || tokens.length === 1)
  ) {
    return "character";
  }

  if (
    articleStrippedName !== name &&
    organizationSuffixes.some(
      (suffix) =>
        articleStrippedName.endsWith(` ${suffix}`) ||
        articleStrippedName === suffix,
    )
  ) {
    return "organization";
  }

  if (
    articleStrippedName !== name &&
    characterTitleSuffixes.some(
      (suffix) =>
        articleStrippedName.endsWith(` ${suffix}`) ||
        articleStrippedName === suffix,
    )
  ) {
    return "character";
  }

  if (
    new RegExp(
      `\\b(?:${mountPattern})\\b[^.\\n]{0,24}\\b${escapeRegExp(name)}\\b`,
      "i",
    ).test(context) ||
    new RegExp(
      `\\b${escapeRegExp(name)}\\b[^.\\n]{0,24}\\b(?:${mountPattern})\\b`,
      "i",
    ).test(context)
  ) {
    return "item";
  }

  if (
    name.startsWith("The ") ||
    locationSuffixes.some(
      (suffix) => name.endsWith(` ${suffix}`) || name === suffix,
    )
  ) {
    return "location";
  }

  if (
    organizationSuffixes.some(
      (suffix) => name.endsWith(` ${suffix}`) || name === suffix,
    )
  ) {
    return "organization";
  }

  if (
    /\b(sharpshooters|guard|guards|watchmen|militia|guild|order|legion|company|companies|rangers|council)\b/i.test(
      name,
    )
  ) {
    return "organization";
  }

  if (
    !looksLikePersonName &&
    !hasCharacterCue &&
    new RegExp(
      `\\b(?:in|into|from|to|toward|towards|at|outside|inside|near|overlooking)\\s+${escapeRegExp(name)}\\b`,
      "i",
    ).test(context)
  ) {
    return "location";
  }

  if (hasCharacterCue) {
    return "character";
  }

  if (
    articleStrippedName !== name &&
    articleStrippedTokens.length > 1 &&
    !locationSuffixes.some(
      (suffix) =>
        articleStrippedName.endsWith(` ${suffix}`) ||
        articleStrippedName === suffix,
    )
  ) {
    return "character";
  }

  if (tokens.length > 1) {
    return "character";
  }

  return null;
}

function normalizeProviderEntity(
  entity: ScanResult["entities"][number],
  chapterText: string,
) {
  const normalizedName =
    entity.category === "character"
      ? normalizeCharacterName(entity.name)
      : entity.name.trim();
  const normalizedEntity =
    normalizedName === entity.name
      ? entity
      : { ...entity, name: normalizedName };

  const match = findFirstNameMatch(normalizedEntity.name, chapterText);
  const hasCharacterEvidence =
    normalizedEntity.aliases.length > 0 || normalizedEntity.links.length > 0;
  const inferredCategory = match
    ? inferCategory(normalizedEntity.name, match.snippet)
    : null;

  if (
    normalizedEntity.category === "character" &&
    inferredCategory === "location" &&
    (hasCharacterEvidence || hasCharacterContextCue(match?.snippet ?? ""))
  ) {
    return applyUserCanonDecisionToEntity(normalizedEntity);
  }

  if (inferredCategory && inferredCategory !== normalizedEntity.category) {
    return applyUserCanonDecisionToEntity({
      ...normalizedEntity,
      category: inferredCategory,
    });
  }

  return applyUserCanonDecisionToEntity(normalizedEntity);
}

function buildSupplementalSummary(
  name: string,
  category: SupportedCategory,
  snippet: string,
) {
  if (category === "character") {
    return [
      "## Core Status",
      `- Full name: ${name}`,
      "- Canon status: Unconfirmed",
      "- On-page status: Mentioned or on-page in the current chapter snapshot",
      "",
      "## Identity",
      "- Occupation / function: Missing",
      "- Affiliation(s): Missing",
      "",
      "## Physical Description",
      "- Missing / unestablished: No reliable physical description established by automatic fallback extraction.",
      "",
      "## Voice / Manner",
      "- Missing / unestablished: No stable speech or manner details extracted yet.",
      "",
      "## Personality",
      "- Missing / unestablished: No stable personality details extracted yet.",
      "",
      "## Relationships",
      "- Missing / unestablished: Relationship details require later confirmation.",
      "",
      "## Timeline of Appearances",
      `- Current chapter snapshot: ${snippet || `${name} is named in the current chapter snapshot.`}`,
      "",
      "## Outfit / Appearance by Scene",
      "- Current chapter snapshot: Missing / unestablished",
      "",
      "## Knowledge / Secrets",
      "- Missing / unestablished",
      "",
      "## Open Questions / Continuity Risks",
      "- Missing: fuller identity, role, and relationship details need confirmation.",
      "",
      "## Sources",
      "- Source: Current chapter snapshot",
    ].join("\n");
  }

  return [
    "## Core Status",
    `- Name: ${name}`,
    "- Canon status: Unconfirmed",
    "",
    "## Description",
    `- Evidence from current chapter snapshot: ${snippet || `${name} is named in the current chapter snapshot.`}`,
    "- Missing / unestablished: fuller details require later confirmation.",
    "",
    "## Function in Story",
    `- ${name} is referenced in the current chapter snapshot.`,
    "",
    "## Contradictions / Ambiguities",
    "- None yet, but details remain thin.",
    "",
    "## Sources",
    "- Source: Current chapter snapshot",
  ].join("\n");
}

function collectSupplementalEntities(
  chapterText: string,
  existingEntities: ScanResult["entities"],
  existingEntitySlugs: Set<string>,
) {
  const found = new Map<string, ScanResult["entities"][number]>();
  const existingKeys = new Set(
    existingEntities.map(
      (entity) => `${entity.category}:${entity.name.trim().toLowerCase()}`,
    ),
  );

  function matchesExistingEntityReference(name: string) {
    const normalized = name.trim().toLowerCase();
    const slug = makeSlug(name);

    if (!normalized || existingEntitySlugs.has(slug)) {
      return false;
    }

    return [...existingEntities, ...Array.from(found.values())].some(
      (entity) => {
        if (
          entity.name.trim().toLowerCase() === normalized ||
          makeSlug(entity.name) === slug
        ) {
          return true;
        }

        if (
          entity.aliases.some(
            (alias) => alias.trim().toLowerCase() === normalized,
          )
        ) {
          return true;
        }

        if (entity.category !== "character") {
          return false;
        }

        const tokens = entity.name
          .trim()
          .toLowerCase()
          .split(/\s+/)
          .filter(Boolean);

        return tokens.length > 1 && tokens.includes(normalized);
      },
    );
  }

  function addCandidate(
    name: string,
    category: SupportedCategory,
    index: number,
  ) {
    const cleaned =
      category === "character"
        ? normalizeCharacterName(name)
        : name.trim().replace(/\s+/g, " ");
    const snippet = getSnippet(chapterText, index, cleaned.length);

    if (
      !cleaned ||
      singleWordStoplist.has(cleaned) ||
      !hasPlausibleTokenShape(cleaned) ||
      matchesExistingEntityReference(cleaned) ||
      shouldDropSingleWordLocationCharacterCollision(
        {
          name: cleaned,
          category,
          summary: "",
          isStub: true,
          aliases: [],
          links: [],
        },
        [...existingEntities, ...Array.from(found.values())],
        existingEntitySlugs,
      ) ||
      (cleaned.split(/\s+/).length === 1 &&
        !hasStrongSingleWordEvidence(cleaned, category, snippet))
    ) {
      return;
    }

    const key = `${category}:${cleaned.toLowerCase()}`;
    if (existingKeys.has(key) || found.has(key)) {
      return;
    }

    const entity = applyUserCanonDecisionToEntity({
      name: cleaned,
      category,
      summary: buildSupplementalSummary(cleaned, category, snippet),
      isStub: true,
      aliases: [],
      links: [],
    });

    if (!entity) {
      return;
    }

    found.set(key, entity);
  }

  const multiWordPattern =
    /\b(?:The\s+)?[A-Z][a-z]+(?:\s+(?:[A-Z][a-z]+|of|the))*\b/g;
  for (const match of chapterText.matchAll(multiWordPattern)) {
    const name = sanitizeMatchedName(match[0]);
    if (name.split(/\s+/).length < 2 || /^Chapter\s+\d+$/i.test(name)) {
      continue;
    }

    const context = getSnippet(chapterText, match.index ?? 0, name.length);
    const category = inferCategory(name, context);
    if (category) {
      addCandidate(name, category, match.index ?? 0);

      if (category === "location" && /\bBay$/.test(name)) {
        const [firstToken] = name.split(/\s+/);
        if (firstToken && name.includes(" ")) {
          addCandidate(firstToken, "location", match.index ?? 0);
        }
      }
    }
  }

  const singleWordPattern = /\b[A-Z][a-z]+\b/g;
  for (const match of chapterText.matchAll(singleWordPattern)) {
    const name = match[0];
    const index = match.index ?? 0;
    if (
      singleWordStoplist.has(name) ||
      !isStandaloneSingleToken(index, name, chapterText)
    ) {
      continue;
    }

    const context = getSnippet(chapterText, index, name.length);
    const category = inferCategory(name, context);
    if (category) {
      addCandidate(name, category, index);
    }
  }

  return Array.from(found.values());
}

export function normalizeScanResult(
  input: unknown,
  chapterText = "",
): ScanResult {
  const parsed = scanResultSchema.parse(input);
  const existingEntitySlugs = getExistingEntitySlugs();
  const seen = new Set<string>();

  const normalizedProviderEntities = parsed.entities
    .map((entity) => normalizeProviderEntity(entity, chapterText))
    .filter(
      (entity): entity is ScanResult["entities"][number] => entity !== null,
    );

  const dedupedEntities = normalizedProviderEntities.filter((entity) => {
    const key = `${entity.category}:${entity.name.trim().toLowerCase()}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  const groundedEntities = dedupedEntities.filter((entity) => {
    const nameMatch = findFirstNameMatch(entity.name, chapterText);
    const hasStandaloneSingleWord =
      entity.name.split(/\s+/).length === 1
        ? hasStandaloneSingleWordOccurrence(entity.name, chapterText)
        : true;

    if (
      !hasPlausibleTokenShape(entity.name) ||
      shouldDropAsPartialDuplicate(entity, dedupedEntities) ||
      shouldDropCoreNameDuplicate(entity, dedupedEntities) ||
      shouldDropSingleWordCharacterAliasCollision(
        entity,
        dedupedEntities,
        existingEntitySlugs,
      ) ||
      shouldDropSingleWordLocationCharacterCollision(
        entity,
        dedupedEntities,
        existingEntitySlugs,
      ) ||
      (entity.category === "character" &&
        entity.name.split(/\s+/).length === 1 &&
        !hasStandaloneSingleWord &&
        hasMultiWordCharacterOverlap(entity.name, dedupedEntities)) ||
      (entity.name.split(/\s+/).length === 1 &&
        !hasStandaloneSingleWord &&
        !nameMatch?.snippet)
    ) {
      return false;
    }

    if (
      entity.name.split(/\s+/).length === 1 &&
      !hasStandaloneSingleWord &&
      !existingEntitySlugs.has(makeSlug(entity.name))
    ) {
      const snippet = nameMatch?.snippet ?? "";
      if (!hasStrongSingleWordEvidence(entity.name, entity.category, snippet)) {
        return false;
      }
    }

    return (
      !chapterText ||
      appearsInChapterText(entity.name, chapterText) ||
      existingEntitySlugs.has(makeSlug(entity.name))
    );
  });

  const supplementedEntities = chapterText
    ? collectSupplementalEntities(
        chapterText,
        groundedEntities,
        existingEntitySlugs,
      )
    : [];

  return {
    ...parsed,
    entities: [...groundedEntities, ...supplementedEntities],
  };
}

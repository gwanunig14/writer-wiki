import type { WikiPage } from "$lib/types/domain";
import { getDatabase } from "$lib/server/db/client";
import {
  listActiveWatchlistEntries,
  listResolvedWatchlistEntries,
} from "$lib/server/canon/continuity-manager";
import {
  getEntityById,
  listEntitiesByCategory,
  listAliasesForEntity,
  listEntities,
  type EntitySummaryRecord,
} from "$lib/server/db/repositories/entity-repository";
import { getBacklinksForEntity } from "./backlink-index";
import { getEntityFolderSegments } from "$lib/server/wiki/entity-organization";

const linkifyTitleTokens = new Set([
  "baron",
  "baroness",
  "captain",
  "doctor",
  "dr",
  "lady",
  "lord",
  "miss",
  "mr",
  "mrs",
  "ms",
  "sir",
]);

const ageLinePattern =
  /^\s*[-*]\s+(?:Age:\s*(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b|(?:at\s+least\s+)?(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s*years\s*old\b|(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)-year-old\b|At\s+(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b)/i;

function parseAgeToken(value: string) {
  const normalized = value.trim().toLowerCase();
  if (/^\d{1,2}$/.test(normalized)) {
    return Number(normalized);
  }

  const wordAges: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
    twenty: 20,
  };

  return wordAges[normalized] ?? null;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceOutsideMarkdownLinks(
  text: string,
  pattern: RegExp,
  replacement: string,
) {
  return text
    .split(/(\[[^\]]+\]\([^\)]+\))/g)
    .map((segment) =>
      segment.startsWith("[") && segment.includes("](")
        ? segment
        : segment.replace(pattern, replacement),
    )
    .join("");
}

function collectEntityLinkNames(entities: EntitySummaryRecord[]) {
  const tokenFrequency = new Map<string, number>();

  for (const entity of entities) {
    if (entity.category !== "character") {
      continue;
    }

    const [firstToken] = entity.name.split(/\s+/);
    if (!firstToken || firstToken.length < 3) {
      continue;
    }

    const normalized = firstToken.toLowerCase();
    tokenFrequency.set(normalized, (tokenFrequency.get(normalized) ?? 0) + 1);
  }

  return entities.flatMap((entity) => {
    const linkNames = [entity.name];

    if (entity.category === "character") {
      const [firstToken] = entity.name.split(/\s+/);
      if (firstToken && firstToken.length >= 3) {
        const normalized = firstToken.toLowerCase();
        if (
          tokenFrequency.get(normalized) === 1 &&
          !linkifyTitleTokens.has(normalized)
        ) {
          linkNames.push(firstToken);
        }
      }
    }

    return linkNames
      .sort((left, right) => right.length - left.length)
      .map((linkName) => ({
        ...entity,
        linkName,
      }));
  });
}

function linkifyCanonText(text: string, currentSlug?: string) {
  return collectEntityLinkNames(listEntities())
    .sort((left, right) => right.linkName.length - left.linkName.length)
    .reduce((output, entity) => {
      if (entity.slug === currentSlug) {
        return output;
      }

      return replaceOutsideMarkdownLinks(
        output,
        new RegExp(`\\b${escapeRegExp(entity.linkName)}\\b`, "g"),
        `[${entity.linkName}](/wiki/${entity.category}/${entity.slug})`,
      );
    }, text);
}

function getChapterLabel(chapterId: string | null) {
  if (!chapterId) return null;
  const row = getDatabase()
    .prepare("SELECT number, title FROM chapters WHERE id = ? LIMIT 1")
    .get(chapterId) as { number: number | null; title: string } | undefined;
  if (!row) return null;
  return formatChapterLabel(row.number, row.title);
}

function formatChapterLabel(number: number | null, title: string) {
  if (number !== null) {
    const titleNormalized = title.trim().toLowerCase();
    if (titleNormalized === `chapter ${number}`) {
      return `Chapter ${number}`;
    }
  }
  return number === null ? `Draft: ${title}` : `Chapter ${number}: ${title}`;
}

function inferCharacterAgeFromChapter(
  entityName: string,
  chapterText: string,
): number | null {
  if (!chapterText.trim()) return null;
  const firstName = entityName.split(/\s+/)[0] ?? entityName;
  const nearbyParagraph = chapterText
    .split(/\n\s*\n/)
    .find((paragraph) =>
      new RegExp(`\\b${escapeRegExp(firstName)}\\b`, "i").test(paragraph),
    );

  if (!nearbyParagraph) {
    return null;
  }

  const ageSourceText = nearbyParagraph;
  const directAgePattern = new RegExp(
    `\\b${escapeRegExp(firstName)}\\b[^.?!]{0,120}?((?:\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty))\\s*years\\s*old\\b`,
    "i",
  );
  const directAgeMatch = directAgePattern.exec(ageSourceText);
  if (directAgeMatch) {
    return parseAgeToken(directAgeMatch[1]);
  }

  const hyphenAgePattern = new RegExp(
    `\\b${escapeRegExp(firstName)}\\b[^.?!]{0,180}?((?:\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty))-year-old\\b`,
    "i",
  );
  const hyphenAgeMatch = hyphenAgePattern.exec(ageSourceText);
  if (hyphenAgeMatch) {
    const trailing = ageSourceText
      .slice(hyphenAgeMatch.index, hyphenAgeMatch.index + 90)
      .toLowerCase();
    if (!/\b(son|daughter|child|boy|girl|lord)\b/.test(trailing)) {
      return parseAgeToken(hyphenAgeMatch[1]);
    }
  }

  if (nearbyParagraph) {
    const paragraphAgePattern =
      /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)-year-olds?\b/gi;
    for (const match of nearbyParagraph.matchAll(paragraphAgePattern)) {
      const token = match[1];
      if (!token) {
        continue;
      }

      const trailing = nearbyParagraph
        .slice(match.index ?? 0, (match.index ?? 0) + 70)
        .toLowerCase();
      const leading = nearbyParagraph
        .slice(Math.max(0, (match.index ?? 0) - 24), match.index ?? 0)
        .toLowerCase();
      if (/\b(son|daughter|child|boy|girl)\b/.test(trailing)) {
        continue;
      }
      if (!/\bother\s*$/.test(leading)) {
        continue;
      }

      const parsed = parseAgeToken(token);
      if (parsed !== null) {
        return parsed;
      }
    }
  }

  return null;
}

function syncCharacterAgeLines(
  body: string,
  chapterText: string,
  entityName: string,
) {
  const inferredAge = inferCharacterAgeFromChapter(entityName, chapterText);
  const lines = body.split("\n");
  const hasAgeLine = lines.some((line) => ageLinePattern.test(line));

  const nextLines = lines.filter((line) => !ageLinePattern.test(line));

  if (inferredAge === null) {
    return nextLines.join("\n");
  }

  if (!hasAgeLine) {
    return nextLines.join("\n");
  }

  const physicalHeaderIndex = nextLines.findIndex((line) =>
    /^##\s+Physical Description\s*$/i.test(line),
  );
  if (physicalHeaderIndex === -1) {
    return nextLines.join("\n");
  }

  nextLines.splice(physicalHeaderIndex + 1, 0, `- Age: ${inferredAge}`);
  return nextLines.join("\n");
}

function upsertCoreStatusLine(body: string, label: string, value: string) {
  const lines = body.split("\n");
  const coreStatusIndex = lines.findIndex((line) =>
    /^##\s+Core Status\s*$/i.test(line),
  );
  if (coreStatusIndex === -1) {
    return body;
  }

  let sectionEnd = lines.length;
  for (let i = coreStatusIndex + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) {
      sectionEnd = i;
      break;
    }
  }

  const targetPrefix = `- ${label}:`;
  const existingIndex = lines.findIndex(
    (line, index) =>
      index > coreStatusIndex &&
      index < sectionEnd &&
      line.trim().toLowerCase().startsWith(targetPrefix.toLowerCase()),
  );

  const nextLine = `${targetPrefix} ${value}`;
  if (existingIndex !== -1) {
    lines[existingIndex] = nextLine;
  } else {
    lines.splice(coreStatusIndex + 1, 0, nextLine);
  }

  return lines.join("\n");
}

function augmentLocationPhysicalDetails(
  body: string,
  chapterText: string,
  entityName: string,
  aliasNames: string[],
) {
  const db = getDatabase();
  const chapterRows = db
    .prepare(
      "SELECT id, number, title, current_text FROM chapters ORDER BY number ASC, title ASC",
    )
    .all() as Array<{
    id: string;
    number: number | null;
    title: string;
    current_text: string;
  }>;

  const hasAnyChapterText = chapterRows.some((row) => row.current_text.trim());
  if (!chapterText.trim() && !hasAnyChapterText) {
    return body;
  }

  const locationDetailCuePattern =
    /\b(red amber|amber|ruby|ebony|sandstone|marble|granite|limestone|brick|stone|wood(?:en)?|timber|iron|steel|fountain|statues?|flowers?|garden|groves?|meadow|creek|dock|doors?|windows?|staircase|hall(?:way)?s?|foyer|ballroom|drawing room|parlor|bath(?:room|tub)?|conservatory|greenhouse|telegraph|bedrooms?|dining room|office|tunnels?|walls?|columns?|chimneys?|trim|facade|interior|exterior)\b/i;
  const structuralCuePattern =
    /\b(fountain|statues?|garden|groves?|meadow|creek|dock|doors?|windows?|staircase|hall(?:way)?s?|foyer|ballroom|drawing room|parlor|bath(?:room|tub)?|conservatory|greenhouse|telegraph|bedrooms?|dining room|office|tunnels?|walls?|columns?|chimneys?|trim|facade|interior|exterior|mansion|manor|estate|townhouse|house|home|inn|tavern)\b/i;
  const locationNouns = new Set([
    "mansion",
    "manor",
    "home",
    "house",
    "townhouse",
    "estate",
    "inn",
    "tavern",
    "hall",
    "watch",
    "restaurant",
    "brothel",
  ]);
  const stopOwnerTokens = new Set([
    "the",
    "of",
    "and",
    "at",
    "in",
    "on",
    "for",
    "to",
  ]);
  const stopReferenceNames = new Set([
    "the",
    "this",
    "that",
    "these",
    "those",
    "home",
    "house",
    "mansion",
    "manor",
    "estate",
    "inn",
    "tavern",
    "hall",
    "watch",
    "city",
    "town",
    "district",
    "region",
    "location",
  ]);

  const referenceNames = new Set<string>([entityName]);
  const possessiveOwnerTokens = new Set<string>();

  const addReferenceName = (candidate: string | undefined) => {
    const cleaned = candidate?.replace(/\s+/g, " ").trim();
    if (!cleaned || cleaned.length < 3 || cleaned.length > 80) {
      return;
    }
    const lowered = cleaned.toLowerCase();
    if (stopReferenceNames.has(lowered)) {
      return;
    }
    if (!cleaned.includes(" ") && stopOwnerTokens.has(lowered)) {
      return;
    }
    referenceNames.add(cleaned);
  };

  const addOwnerToken = (candidate: string | undefined) => {
    const cleaned = candidate?.replace(/[^A-Za-z'’\-]/g, "").trim();
    if (!cleaned) {
      return;
    }
    const lowered = cleaned.toLowerCase();
    if (
      lowered.length < 3 ||
      stopOwnerTokens.has(lowered) ||
      locationNouns.has(lowered)
    ) {
      return;
    }
    possessiveOwnerTokens.add(lowered);
  };

  for (const alias of aliasNames) {
    addReferenceName(alias);
  }

  for (const token of entityName.split(/\s+/)) {
    addOwnerToken(token);
  }

  const aliasMatch = new RegExp(
    `${escapeRegExp(entityName)}\\s+itself,\\s+the\\s+([A-Z][A-Za-z'’]+(?:\\s+[A-Z][A-Za-z'’]+)+)`,
    "i",
  ).exec(body);
  if (aliasMatch?.[1]) {
    addReferenceName(aliasMatch[1]);
  }

  const chapterSentences = (chapterText || "")
    .split(/(?<=[.?!])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  for (const sentence of chapterSentences) {
    if (!new RegExp(`\\b${escapeRegExp(entityName)}\\b`, "i").test(sentence)) {
      continue;
    }

    const aliasFromEntity = new RegExp(
      `\\b${escapeRegExp(entityName)}\\b[^.?!]{0,80}\\bthe\\s+([A-Za-z][A-Za-z'’\\-]*(?:\\s+[A-Za-z][A-Za-z'’\\-]*){0,4})`,
      "i",
    ).exec(sentence);
    if (aliasFromEntity?.[1]) {
      addReferenceName(`the ${aliasFromEntity[1]}`);
      addReferenceName(aliasFromEntity[1]);
    }

    const aliasBeforeEntity = new RegExp(
      `\\bthe\\s+([A-Za-z][A-Za-z'’\\-]*(?:\\s+[A-Za-z][A-Za-z'’\\-]*){0,4})[^.?!]{0,80}\\b${escapeRegExp(entityName)}\\b`,
      "i",
    ).exec(sentence);
    if (aliasBeforeEntity?.[1]) {
      addReferenceName(`the ${aliasBeforeEntity[1]}`);
      addReferenceName(aliasBeforeEntity[1]);
    }
  }

  const sentenceReferencesEntityStrict = (sentence: string) =>
    Array.from(referenceNames).some((name) =>
      new RegExp(`\\b${escapeRegExp(name)}\\b`, "i").test(sentence),
    );
  const sentenceReferencesEntity = (sentence: string) =>
    sentenceReferencesEntityStrict(sentence) ||
    Array.from(possessiveOwnerTokens).some((ownerToken) =>
      new RegExp(
        `\\b${escapeRegExp(ownerToken)}['’]s\\s+(?:home|house|townhouse|mansion|estate|manor)\\b`,
        "i",
      ).test(sentence),
    );

  const detailCandidates: Array<{
    detail: string;
    score: number;
    chapterLabel: string;
  }> = [];

  for (const chapter of chapterRows) {
    const chapterTextValue = chapter.current_text?.trim() ?? "";
    if (!chapterTextValue) {
      continue;
    }
    const chapterLabel = formatChapterLabel(chapter.number, chapter.title);
    const paragraphs = chapterTextValue
      .split(/\n\s*\n+/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);

    for (const paragraph of paragraphs) {
      const paragraphSentences = paragraph
        .split(/(?<=[.?!])\s+/)
        .map((sentence) => sentence.trim())
        .filter(Boolean);
      let previousSentenceReferencedStrict = false;

      for (const sentence of paragraphSentences) {
        if (!locationDetailCuePattern.test(sentence)) {
          previousSentenceReferencedStrict =
            sentenceReferencesEntityStrict(sentence);
          continue;
        }
        const mentionsEntityOrAlias = sentenceReferencesEntity(sentence);
        const hasDescriptiveSurfaceNoun =
          /^the\s+(mansion|manor|walls?|columns?|trim|chimneys?|facade|exterior|interior|structure|building|wood|grain|fountain|fountains|gate|hallway|foyer|ballroom|drawing\s+room|parlor|conservatory|greenhouse|bedroom|office)\b/i.test(
            sentence,
          );
        const usesParagraphAnaphora =
          previousSentenceReferencedStrict &&
          (/^(its|it|each|every|this|these)\b/i.test(sentence) ||
            hasDescriptiveSurfaceNoun);
        previousSentenceReferencedStrict =
          sentenceReferencesEntityStrict(sentence);
        if (!mentionsEntityOrAlias && !usesParagraphAnaphora) {
          continue;
        }

        const sentenceLower = sentence.toLowerCase();
        const isComparativeOnly = Array.from(referenceNames).some((name) => {
          const loweredName = name.toLowerCase();
          return (
            sentenceLower.includes(`similar to ${loweredName}`) ||
            sentenceLower.includes(`like ${loweredName}`)
          );
        });
        if (isComparativeOnly) {
          continue;
        }

        if (/mentioned or on-page|event detail remains thin/i.test(sentence)) {
          continue;
        }

        const quoteCount = sentence.match(/["”“]/g)?.length ?? 0;
        if (quoteCount >= 2 || /^["“]/.test(sentence)) {
          continue;
        }

        const hasBodyCentricTerms =
          /\b(shoulders?|chest|eyes?|hair|gown|dress|man|woman|boy|girl|kiss|hands?)\b/i.test(
            sentence,
          );
        if (hasBodyCentricTerms && !structuralCuePattern.test(sentence)) {
          continue;
        }

        let compact = sentence.replace(/\s+/g, " ").trim();
        if (compact.length > 260) {
          compact = compact.split(/["”“]/)[0]?.trim() ?? compact;
        }
        if (compact.length > 200) {
          compact = `${compact.slice(0, 197).trimEnd()}...`;
        }
        if (compact.length < 20) {
          continue;
        }
        let score = 0;
        if (/\bred amber\b/i.test(compact)) {
          score += 6;
        }
        if (/\bamber\b/i.test(compact)) {
          score += 3;
        }
        if (
          /\b(fountain|statue|interior|hallway|foyer|ballroom|drawing room|parlor|conservatory|greenhouse|bedroom|office|tunnel)\b/i.test(
            compact,
          )
        ) {
          score += 3;
        }
        if (mentionsEntityOrAlias) {
          score += 2;
        }
        score += 2;
        detailCandidates.push({ detail: compact, score, chapterLabel });
      }
    }
  }

  const details = detailCandidates
    .sort((left, right) => right.score - left.score)
    .filter(
      (candidate, index, all) =>
        all.findIndex(
          (other) =>
            other.detail.toLowerCase() === candidate.detail.toLowerCase(),
        ) === index,
    )
    .slice(0, 8);

  if (details.length === 0) {
    return body;
  }

  const lines = body.split("\n");
  const confirmedHeadingIndex = lines.findIndex((line) =>
    /^###\s+Confirmed physical details\s*$/i.test(line),
  );
  if (confirmedHeadingIndex === -1) {
    return body;
  }

  let insertAt = confirmedHeadingIndex + 1;
  while (insertAt < lines.length && /^\s*[-*]\s+/.test(lines[insertAt])) {
    insertAt += 1;
  }

  const newLines = details
    .filter(
      (candidate) =>
        !body.toLowerCase().includes(candidate.detail.toLowerCase()),
    )
    .map((candidate) => `- ${candidate.chapterLabel}: ${candidate.detail}`);

  if (newLines.length === 0) {
    return body;
  }

  lines.splice(insertAt, 0, ...newLines);
  return lines.join("\n");
}

function sanitizeLocationConfirmedDetails(
  body: string,
  entityName: string,
  aliasNames: string[],
) {
  const lines = body.split("\n");
  const headingIndex = lines.findIndex((line) =>
    /^###\s+Confirmed physical details\s*$/i.test(line),
  );
  if (headingIndex === -1) {
    return body;
  }

  let sectionEnd = lines.length;
  for (let i = headingIndex + 1; i < lines.length; i += 1) {
    if (/^###\s+/.test(lines[i])) {
      sectionEnd = i;
      break;
    }
  }

  const referenceNames = [entityName, ...aliasNames]
    .map((value) => value.trim())
    .filter(Boolean);
  const ownerTokens = new Set(
    referenceNames
      .flatMap((value) => value.split(/\s+/))
      .map((token) => token.toLowerCase())
      .filter((token) => token.length >= 3),
  );

  const cuePattern =
    /\b(red amber|amber|ruby|ebony|sandstone|marble|granite|limestone|brick|stone|wood(?:en)?|timber|iron|steel|fountain|statues?|flowers?|garden|groves?|meadow|creek|dock|doors?|windows?|staircase|hall(?:way)?s?|foyer|ballroom|drawing room|parlor|bath(?:room|tub)?|conservatory|greenhouse|telegraph|bedrooms?|dining room|office|tunnels?|walls?|columns?|chimneys?|trim|facade|interior|exterior|mansion|manor|estate|townhouse|house|home|inn|tavern)\b/i;

  const keepLine = (line: string) => {
    if (!/^\s*[-*]\s+/.test(line)) {
      return true;
    }
    const content = line
      .replace(/^\s*[-*]\s+/, "")
      .replace(/^Chapter\s+\d+(?::\s+[^:]+)?:\s+/i, "")
      .trim();
    if (!content) {
      return false;
    }
    if (
      /mentioned or on-page|event detail remains thin|red-blooded man|straight line from her shoulders/i.test(
        content,
      )
    ) {
      return false;
    }

    const hasCue = cuePattern.test(content);
    const hasEntityReference = referenceNames.some((name) =>
      new RegExp(`\\b${escapeRegExp(name)}\\b`, "i").test(content),
    );
    const hasPossessiveLocationReference = Array.from(ownerTokens).some(
      (token) =>
        new RegExp(
          `\\b${escapeRegExp(token)}['’]s\\s+(?:home|house|townhouse|mansion|estate|manor)\\b`,
          "i",
        ).test(content),
    );
    const hasBodyOnlySignal =
      /\b(shoulders?|chest|eyes?|hair|gown|dress|man|woman|boy|girl|kiss|hands?)\b/i.test(
        content,
      ) && !hasCue;
    if (hasBodyOnlySignal) {
      return false;
    }

    return hasCue || hasEntityReference || hasPossessiveLocationReference;
  };

  const originalSectionLines = lines.slice(headingIndex + 1, sectionEnd);
  const filteredSectionLines = originalSectionLines.filter(keepLine);
  if (filteredSectionLines.length === 0) {
    return body;
  }

  const next = [
    ...lines.slice(0, headingIndex + 1),
    ...filteredSectionLines,
    ...lines.slice(sectionEnd),
  ];
  return next.join("\n");
}

function enrichEntityBodyForDisplay(
  entity: EntitySummaryRecord,
  body: string,
  aliasNames: string[],
) {
  const chapterLabel = getChapterLabel(entity.createdFromChapterId);
  const chapterText = entity.createdFromChapterId
    ? ((
        getDatabase()
          .prepare("SELECT current_text FROM chapters WHERE id = ? LIMIT 1")
          .get(entity.createdFromChapterId) as
          | { current_text: string }
          | undefined
      )?.current_text ?? "")
    : "";

  let enriched = body;

  const chapterEvidenceLabel = chapterLabel ?? "available chapter evidence";
  enriched = enriched.replace(
    /\bin\s+the\s+current\s+chapter\s+snapshot\b/gi,
    `in ${chapterEvidenceLabel}`,
  );
  enriched = enriched.replace(
    /\bfrom\s+the\s+current\s+chapter\s+snapshot\b/gi,
    `from ${chapterEvidenceLabel}`,
  );
  enriched = enriched.replace(
    /\bin\s+the\s+current\s+chapter\s+text\b/gi,
    `in ${chapterEvidenceLabel}`,
  );
  enriched = enriched.replace(
    /\bfrom\s+the\s+current\s+chapter\s+text\b/gi,
    `from ${chapterEvidenceLabel}`,
  );
  enriched = enriched.replace(
    /\bcurrent chapter snapshot\b/gi,
    chapterEvidenceLabel,
  );
  enriched = enriched.replace(
    /\bcurrent chapter text\b/gi,
    chapterEvidenceLabel,
  );
  enriched = enriched.replace(/\bin\s+the\s+(Chapter\s+\d+)\b/g, "in $1");
  enriched = enriched.replace(/\bfrom\s+the\s+(Chapter\s+\d+)\b/g, "from $1");
  enriched = enriched.replace(/\bthe\s+(Chapter\s+\d+)\b/g, "$1");

  if (chapterLabel) {
    enriched = enriched.replace(
      /^-\s+First appearance:\s+Current chapter snapshot\s*$/im,
      `- First appearance: ${chapterLabel}`,
    );
    enriched = enriched.replace(
      /^-\s+Current chapter snapshot:\s+/gim,
      `- ${chapterLabel}: `,
    );
    enriched = enriched.replace(
      /^-\s+Source:\s+Current chapter snapshot\s*$/gim,
      `- Source: ${chapterLabel}`,
    );
    enriched = enriched.replace(
      /^-\s+Source:\s+Current chapter text\.?\s*$/gim,
      `- Source: ${chapterLabel}`,
    );
    enriched = enriched.replace(
      /^-\s+Current chapter text\.?\s*$/gim,
      `- Source: ${chapterLabel}`,
    );
    enriched = enriched.replace(
      /^Current chapter text\.?\s*$/gim,
      `- Source: ${chapterLabel}`,
    );
  }

  if (entity.category === "character") {
    enriched = syncCharacterAgeLines(enriched, chapterText, entity.name);
  }

  if (entity.category === "location") {
    enriched = augmentLocationPhysicalDetails(
      enriched,
      chapterText,
      entity.name,
      aliasNames,
    );
    enriched = sanitizeLocationConfirmedDetails(
      enriched,
      entity.name,
      aliasNames,
    );

    const parentLocation = entity.parentEntityId
      ? getEntityById(entity.parentEntityId)
      : null;
    const childLocations = listEntitiesByCategory("location")
      .filter((location) => location.parentEntityId === entity.id)
      .map((location) => location.name)
      .sort((left, right) => left.localeCompare(right));

    enriched = upsertCoreStatusLine(
      enriched,
      "Region / jurisdiction",
      parentLocation?.name ?? "Missing / unestablished",
    );
    enriched = upsertCoreStatusLine(
      enriched,
      "Direct sublocations / districts",
      childLocations.length > 0 ? childLocations.join(", ") : "None currently",
    );
  }

  return enriched;
}

export function buildEntityWikiPage(entity: EntitySummaryRecord): WikiPage {
  const aliases = listAliasesForEntity(entity.id);
  const aliasNames = aliases.map((alias) => alias.name);
  const characterEntities =
    entity.category === "character" ? listEntitiesByCategory("character") : [];
  const locationNames = listEntitiesByCategory("location")
    .filter((location) => location.id !== entity.id)
    .map((location) => location.name);
  const parentLocation = entity.parentEntityId
    ? getEntityById(entity.parentEntityId)
    : null;
  const enrichedBody = enrichEntityBodyForDisplay(
    entity,
    entity.articleBody,
    aliasNames,
  );

  return {
    title: entity.name,
    kind: "article",
    category: entity.category,
    isStub: entity.isStub,
    body: linkifyCanonText(enrichedBody, entity.slug).trim(),
    updatedAt: entity.updatedAt,
    backlinks: getBacklinksForEntity(entity),
    aliases,
    editableEntity: {
      id: entity.id,
      name: entity.name,
      slug: entity.slug,
      category: entity.category,
      articleBody: entity.articleBody,
      folderPath:
        entity.category === "character"
          ? (getEntityFolderSegments(entity, characterEntities)[0] ?? "")
          : (entity.subtype ?? ""),
      parentLocationName: parentLocation?.name,
      availableLocationNames: locationNames,
    },
  };
}

export function buildGeneratedWikiPage(input: {
  title: string;
  kind: WikiPage["kind"];
  category?: string;
  body: string;
  updatedAt?: string;
}) {
  const continuityItems =
    input.kind === "continuity" ? listActiveWatchlistEntries() : undefined;
  const resolvedContinuityItems =
    input.kind === "continuity" ? listResolvedWatchlistEntries() : undefined;

  return {
    title: input.title,
    kind: input.kind,
    category: input.category,
    body:
      input.kind === "category-all" ? input.body : linkifyCanonText(input.body),
    updatedAt: input.updatedAt,
    backlinks: [],
    continuityItems,
    resolvedContinuityItems,
  } satisfies WikiPage;
}

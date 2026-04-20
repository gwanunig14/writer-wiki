import { getDatabase } from "$lib/server/db/client";
import { applyUserCanonDecisionToEntity } from "$lib/server/canon/user-canon-decisions";
import { makeSlug } from "$lib/server/providers/provider";
import { scanResultSchema, type ScanResult } from "$lib/types/scan-result";
import nlp from "compromise";

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

const possessivePlaceNouns = [
  "building",
  "buildings",
  "district",
  "gate",
  "gates",
  "house",
  "houses",
  "home",
  "homes",
  "market",
  "roof",
  "roofs",
  "street",
  "streets",
  "tier",
  "tiers",
  "townhouse",
  "townhouses",
  "wall",
  "walls",
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

const uncertainCharacterSuffixes = new Set([
  "something",
  "someone",
  "somebody",
]);

const connectorTokens = new Set(["of", "the"]);

const singleWordStoplist = new Set([
  "All",
  "And",
  "Any",
  "At",
  "But",
  "Brushes",
  "Captain",
  "Caroused",
  "Cards",
  "Chapter",
  "Commotion",
  "Current",
  "Eaten",
  "Every",
  "Five",
  "Foam",
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
  "To",
  "Tracking",
  "Through",
  "Turned",
  "Joining",
  "Join",
]);

const locationPrepositions = new Set([
  "at",
  "from",
  "in",
  "inside",
  "into",
  "near",
  "outside",
  "overlooking",
  "to",
  "toward",
  "towards",
  "within",
]);

const strongLocationPrepositions = new Set([
  "at",
  "from",
  "in",
  "inside",
  "into",
  "near",
  "outside",
  "overlooking",
  "toward",
  "towards",
  "within",
]);

const characterPrepositions = new Set(["about", "beside", "with"]);

const characterRelationNouns = new Set([
  "brother",
  "daughter",
  "doctor",
  "father",
  "husband",
  "mother",
  "sister",
  "son",
  "wife",
]);

const humanActionVerbs = new Set([
  "asked",
  "called",
  "couched",
  "coughed",
  "crept",
  "drank",
  "filled",
  "finished",
  "followed",
  "grabbed",
  "heard",
  "held",
  "holding",
  "helped",
  "hugged",
  "insisted",
  "jumped",
  "kissed",
  "knelt",
  "laughed",
  "listened",
  "looked",
  "loosened",
  "marched",
  "mumbled",
  "named",
  "nodded",
  "noted",
  "poured",
  "read",
  "replied",
  "returned",
  "rode",
  "said",
  "sighed",
  "slumped",
  "smiled",
  "snickered",
  "stood",
  "strode",
  "thought",
  "took",
  "walked",
  "watched",
  "waved",
  "yawned",
  "yelled",
]);

const genericHumanReferenceTerms = new Set([
  "boys",
  "girls",
  "ladies",
  "man",
  "men",
  "people",
  "person",
  "some",
  "someone",
  "somebody",
  "woman",
  "women",
]);

const appearancePhrasePattern =
  /\b(?:[a-z]+-eyed|[a-z]+-haired|(?:green|blue|brown|black|grey|gray|hazel|golden|blonde|red|pink|tan|coffee-brown|dark-brown|light-brown|white|silver)\s+(?:eye|eyes|hair|mustache|beard|lips|skin|complexion|frame|build|jaw|brow|brows|cheek|cheeks))\b/gi;

type ParsedSentenceTerm = {
  text: string;
  normal: string;
  machine: string | null;
  tags: Set<string>;
};

type ParsedSentence = {
  text: string;
  terms: ParsedSentenceTerm[];
  subject: string;
  verb: string;
  predicate: string;
};

const parsedSentenceCache = new Map<string, ParsedSentence[]>();

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSentenceValue(value: string) {
  return value
    .toLowerCase()
    .replace(/^['"“”`]+|['"“”`]+$/g, "")
    .replace(/[.,!?;:]+$/g, "")
    .replace(/['’]s$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseSentencesWithGrammar(text: string) {
  const cached = parsedSentenceCache.get(text);
  if (cached) {
    return cached;
  }

  const parsed = (
    nlp(text).sentences().json() as Array<Record<string, unknown>>
  )
    .map((sentence) => {
      const sentenceMeta =
        (sentence.sentence as Record<string, unknown> | undefined) ?? {};

      return {
        text: String(sentence.text ?? "")
          .replace(/\s+/g, " ")
          .trim(),
        terms: Array.isArray(sentence.terms)
          ? sentence.terms.map((term) => {
              const record = term as Record<string, unknown>;
              return {
                text: String(record.text ?? ""),
                normal: String(record.normal ?? record.text ?? ""),
                machine:
                  typeof record.machine === "string" ? record.machine : null,
                tags: new Set(
                  Array.isArray(record.tags)
                    ? record.tags.filter(
                        (tag): tag is string => typeof tag === "string",
                      )
                    : [],
                ),
              } satisfies ParsedSentenceTerm;
            })
          : [],
        subject: String(sentenceMeta.subject ?? "")
          .replace(/\s+/g, " ")
          .trim(),
        verb: String(sentenceMeta.verb ?? "")
          .replace(/\s+/g, " ")
          .trim(),
        predicate: String(sentenceMeta.predicate ?? "")
          .replace(/\s+/g, " ")
          .trim(),
      } satisfies ParsedSentence;
    })
    .filter((sentence) => sentence.text.length > 0);

  parsedSentenceCache.set(text, parsed);
  return parsed;
}

function getNormalizedSentenceTerm(term: ParsedSentenceTerm) {
  return normalizeSentenceValue(term.machine ?? term.normal ?? term.text);
}

function buildReferenceCandidatePhrases(name: string) {
  const stripped = stripTitlePrefix(name).replace(/\s+/g, " ").trim();
  const tokens = stripped.split(/\s+/).filter(Boolean);
  const candidates = new Set<string>([name.trim(), stripped]);

  if (tokens.length > 0) {
    candidates.add(tokens[0]);
  }

  return [...candidates]
    .map((candidate) =>
      candidate
        .split(/\s+/)
        .map((token) => normalizeSentenceValue(token))
        .filter(Boolean),
    )
    .filter((tokens) => tokens.length > 0);
}

function findReferenceMatch(sentence: ParsedSentence, name: string) {
  const candidates = buildReferenceCandidatePhrases(name);

  for (const candidate of candidates) {
    for (
      let index = 0;
      index <= sentence.terms.length - candidate.length;
      index += 1
    ) {
      const window = sentence.terms.slice(index, index + candidate.length);
      const matches = window.every(
        (term, offset) => getNormalizedSentenceTerm(term) === candidate[offset],
      );

      if (matches) {
        return {
          start: index,
          end: index + candidate.length - 1,
          terms: window,
        };
      }
    }
  }

  return null;
}

function subjectEndsWithReference(sentence: ParsedSentence, name: string) {
  const normalizedSubject = normalizeSentenceValue(sentence.subject);
  if (!normalizedSubject) {
    return false;
  }

  return buildReferenceCandidatePhrases(name).some((candidate) => {
    const phrase = candidate.join(" ");
    return (
      normalizedSubject === phrase || normalizedSubject.endsWith(` ${phrase}`)
    );
  });
}

function hasNearbySentenceTag(
  match: ReturnType<typeof findReferenceMatch>,
  tag: string,
) {
  return match?.terms.some((term) => term.tags.has(tag)) ?? false;
}

function getPreviousSentenceTerm(sentence: ParsedSentence, index: number) {
  return index > 0 ? sentence.terms[index - 1] : null;
}

function getNextSentenceTerm(sentence: ParsedSentence, index: number) {
  return index + 1 < sentence.terms.length ? sentence.terms[index + 1] : null;
}

function getNormalizedVerbTokens(sentence: ParsedSentence) {
  const verbTokens = sentence.verb
    .split(/\s+/)
    .map((token) => normalizeSentenceValue(token))
    .filter(Boolean);

  if (verbTokens.length > 0) {
    return verbTokens;
  }

  return sentence.terms
    .filter((term) => term.tags.has("Verb"))
    .map((term) => getNormalizedSentenceTerm(term));
}

function sentenceHasThingPronoun(sentence: string) {
  return /\b(it|its)\b/i.test(sentence);
}

function hasHumanSentenceRole(name: string, sentence: ParsedSentence) {
  const match = findReferenceMatch(sentence, name);
  if (!match) {
    return false;
  }

  const previous = getPreviousSentenceTerm(sentence, match.start);
  const next = getNextSentenceTerm(sentence, match.end);
  const normalizedPrevious = previous
    ? getNormalizedSentenceTerm(previous)
    : "";
  const normalizedNext = next ? getNormalizedSentenceTerm(next) : "";
  const verbs = getNormalizedVerbTokens(sentence);
  const possessiveHead = sentence.terms[match.start];
  const isPossessivePlaceContext =
    (Boolean(possessiveHead?.text) &&
      (possessiveHead.text.endsWith("'s") ||
        possessiveHead.text.endsWith("’s") ||
        possessiveHead.tags.has("Possessive")) &&
      normalizedNext !== "" &&
      (possessivePlaceNouns.includes(normalizedNext) ||
        possessiveLocationNouns.includes(normalizedNext))) ||
    isPossessivePlaceReference(name, sentence.text);
  const isStrongLocationObjectContext =
    normalizedPrevious !== "" &&
    strongLocationPrepositions.has(normalizedPrevious) &&
    !subjectEndsWithReference(sentence, name);
  const isCollectivePlacePossessiveContext =
    normalizedPrevious === "of" && isPossessivePlaceContext;
  const hasExplicitPersonLikeTag = match.terms.some(
    (term) =>
      term.tags.has("Person") ||
      term.tags.has("Honorific") ||
      term.tags.has("FirstName") ||
      term.tags.has("LastName") ||
      term.tags.has("MaleName") ||
      term.tags.has("FemaleName"),
  );
  const hasDeterminerTag = match.terms.some((term) =>
    term.tags.has("Determiner"),
  );
  const hasPluralOnlyTag =
    match.terms.some((term) => term.tags.has("Plural")) &&
    !hasExplicitPersonLikeTag;
  const normalizedMatchedName = match.terms
    .map((term) => getNormalizedSentenceTerm(term))
    .join(" ")
    .trim();
  const isSingleWordName = name.trim().split(/\s+/).length === 1;
  const isGenericHumanReference =
    normalizedMatchedName !== "" &&
    genericHumanReferenceTerms.has(normalizedMatchedName);
  const hasSubjectActionEvidence =
    subjectEndsWithReference(sentence, name) &&
    verbs.some((verb) => humanActionVerbs.has(verb)) &&
    !hasDeterminerTag &&
    !hasPluralOnlyTag &&
    !isGenericHumanReference;
  const hasContextualHumanCue =
    (normalizedPrevious !== "" &&
      characterPrepositions.has(normalizedPrevious)) ||
    (normalizedPrevious !== "" &&
      characterRelationNouns.has(normalizedPrevious)) ||
    (normalizedNext !== "" && characterRelationNouns.has(normalizedNext)) ||
    hasSubjectActionEvidence;
  const hasSentenceWideLocationDescriptor =
    isSingleWordName &&
    (new RegExp(
      `\\b(?:in|into|from|at|near|within|inside|outside|toward|towards)\\s+${escapeRegExp(name)}\\b`,
      "i",
    ).test(sentence.text) ||
      new RegExp(
        `\\b${escapeRegExp(name)}['’]s\\s+(?:${[...possessivePlaceNouns, ...possessiveLocationNouns].join("|")})\\b`,
        "i",
      ).test(sentence.text) ||
      (sentenceHasThingPronoun(sentence.text) &&
        /\b(?:city|town|village|harbor|port|district|settlement|place)\b/i.test(
          sentence.text,
        )) ||
      /\bit\s+was\s+(?:a|an|the)?\s*[^.?!]{0,24}\b(?:city|town|village|harbor|port|district|settlement)\b/i.test(
        sentence.text,
      ));

  const hasHumanEvidence = hasExplicitPersonLikeTag || hasContextualHumanCue;

  if (
    (isStrongLocationObjectContext ||
      isCollectivePlacePossessiveContext ||
      hasSentenceWideLocationDescriptor) &&
    !hasSubjectActionEvidence
  ) {
    return false;
  }

  return hasHumanEvidence;
}

function hasLocationSentenceRole(name: string, sentence: ParsedSentence) {
  const match = findReferenceMatch(sentence, name);
  if (!match) {
    return false;
  }

  const previous = getPreviousSentenceTerm(sentence, match.start);
  const next = getNextSentenceTerm(sentence, match.end);
  const normalizedPrevious = previous
    ? getNormalizedSentenceTerm(previous)
    : "";
  const normalizedNext = next ? getNormalizedSentenceTerm(next) : "";
  const possessiveHead = sentence.terms[match.start];

  return (
    (normalizedPrevious !== "" &&
      locationPrepositions.has(normalizedPrevious)) ||
    ((possessiveHead.text.endsWith("'s") ||
      possessiveHead.text.endsWith("’s")) &&
      normalizedNext !== "" &&
      (possessivePlaceNouns.includes(normalizedNext) ||
        possessiveLocationNouns.includes(normalizedNext))) ||
    isPossessivePlaceReference(name, sentence.text)
  );
}

function hasPlaceNameMorphology(name: string) {
  return /(?:burgh|shire|ton|field|ford|bay)$/i.test(name.trim());
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
  const strippedTokens = stripped.split(/\s+/).filter(Boolean);

  if (strippedTokens.length >= 2) {
    const trailingToken =
      strippedTokens[strippedTokens.length - 1].toLowerCase();
    if (uncertainCharacterSuffixes.has(trailingToken)) {
      return strippedTokens.slice(0, -1).join(" ");
    }
  }

  if (!stripped) {
    return name.trim();
  }

  return stripped.split(/\s+/).length >= 2 ? stripped : name.trim();
}

function cleanupSummaryFragmentText(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/,+/g, ",")
    .replace(/^\s*[,:;]+\s*|\s*[,:;]+\s*$/g, "")
    .trim();
}

function normalizeAppearancePhrase(value: string) {
  const normalized = cleanupSummaryFragmentText(value).toLowerCase();
  if (!normalized) {
    return "";
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function extractAppearancePhrasesFromIdentityFragment(fragment: string) {
  const phrases = [
    ...new Set(
      Array.from(fragment.matchAll(appearancePhrasePattern), (match) =>
        normalizeAppearancePhrase(match[0] ?? ""),
      ).filter(Boolean),
    ),
  ];

  const remainder = cleanupSummaryFragmentText(
    fragment.replace(appearancePhrasePattern, " "),
  );

  return { phrases, remainder };
}

function splitSummarySections(summary: string) {
  const lines = summary.split(/\r?\n/);
  const sections: Array<{ heading: string | null; lines: string[] }> = [];
  let current: { heading: string | null; lines: string[] } | null = null;

  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      current = { heading: line, lines: [] };
      sections.push(current);
      continue;
    }

    if (!current) {
      current = { heading: null, lines: [] };
      sections.push(current);
    }

    current.lines.push(line);
  }

  return sections;
}

function normalizeCharacterSummarySections(summary: string) {
  if (
    !summary.includes("## Identity") ||
    !summary.includes("## Physical Description")
  ) {
    return summary;
  }

  const sections = splitSummarySections(summary);
  const identitySection = sections.find(
    (section) => section.heading === "## Identity",
  );
  const physicalSection = sections.find(
    (section) => section.heading === "## Physical Description",
  );

  if (!identitySection || !physicalSection) {
    return summary;
  }

  const movedPhysicalLines: string[] = [];
  const normalizedIdentityLines = identitySection.lines.flatMap((line) => {
    if (!line.startsWith("- ")) {
      return [line];
    }

    const bulletText = line.slice(2).trim();
    const fragments = bulletText
      .split(/\s*[,;]\s*/)
      .map((fragment) => fragment.trim())
      .filter(Boolean);

    if (fragments.length === 0) {
      return [line];
    }

    const keptFragments: string[] = [];

    for (const fragment of fragments) {
      const { phrases, remainder } =
        extractAppearancePhrasesFromIdentityFragment(fragment);

      movedPhysicalLines.push(...phrases.map((phrase) => `- ${phrase}`));

      if (remainder) {
        keptFragments.push(remainder);
      }
    }

    return keptFragments.length > 0 ? [`- ${keptFragments.join(", ")}`] : [];
  });

  if (movedPhysicalLines.length === 0) {
    return summary;
  }

  identitySection.lines = normalizedIdentityLines;
  const existingPhysicalLines = physicalSection.lines.filter(
    (line) =>
      !/^-\s+Missing \/ unestablished:/i.test(line) &&
      !movedPhysicalLines.includes(line),
  );
  physicalSection.lines = [...movedPhysicalLines, ...existingPhysicalLines];

  return sections
    .flatMap((section) =>
      section.heading ? [section.heading, ...section.lines] : section.lines,
    )
    .join("\n");
}

function summaryHasExplicitMainCharacterCue(summary: string) {
  return /\b(?:protagonist|main character|lead character|primary character|primary pov|on-page primary character|point-of-view|point of view|pov)\b/i.test(
    summary,
  );
}

function addPointOfViewCueToCharacterSummary(summary: string) {
  const sections = splitSummarySections(summary);
  const coreStatusIndex = sections.findIndex(
    (section) => section.heading === "## Core Status",
  );

  if (coreStatusIndex === -1) {
    return summary;
  }

  const coreStatus = sections[coreStatusIndex];
  const pointOfViewLine =
    "- Chapter role: Point-of-view character in current chapter snapshot";

  if (coreStatus.lines.includes(pointOfViewLine)) {
    return summary;
  }

  coreStatus.lines = [...coreStatus.lines, pointOfViewLine];

  return sections
    .flatMap((section) =>
      section.heading ? [section.heading, ...section.lines] : section.lines,
    )
    .join("\n");
}

function normalizeAliasCandidate(value: string) {
  return value
    .replace(/^["“”'`]+|["“”'`]+$/g, "")
    .replace(/[.,!?;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isDistinctCharacterAlias(alias: string, canonicalName: string) {
  const normalizedAlias = normalizeAliasCandidate(alias);
  if (!normalizedAlias) {
    return false;
  }

  const aliasTokens = normalizedAlias.split(/\s+/).filter(Boolean);
  if (
    aliasTokens.length < 2 ||
    aliasTokens.length > 4 ||
    !aliasTokens.every((token) => isCapitalizedToken(token))
  ) {
    return false;
  }

  const canonicalCore = normalizeCharacterName(canonicalName).toLowerCase();
  const aliasCore = normalizeCharacterName(normalizedAlias).toLowerCase();
  if (!aliasCore || aliasCore === canonicalCore) {
    return false;
  }

  const canonicalTokens = canonicalCore.split(/\s+/).filter(Boolean);
  const aliasCoreTokens = aliasCore.split(/\s+/).filter(Boolean);

  return !(
    aliasCoreTokens.every((token) => canonicalTokens.includes(token)) ||
    canonicalTokens.every((token) => aliasCoreTokens.includes(token))
  );
}

function extractAliasesFromCharacterSummary(
  summary: string,
  canonicalName: string,
) {
  const aliases = new Set<string>();
  const patterns = [
    /\b(?:alias|fake name)\s*[:,-]?\s*([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){1,2})/gi,
    /\b(?:calls?|called)\s+(?:himself|herself)\s+([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){1,2})/gi,
    /\bintroduc(?:es|ed)\s+(?:himself|herself)\s+as\s+([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){1,2})/gi,
    /\b(?:uses?|used|using|went)\s+(?:by\s+|under\s+|the\s+name\s+)?([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){1,2})/gi,
    /\b(?:said|says)\s+(?:his|her)\s+name\s+(?:is|was)\s+([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){1,2})/gi,
  ];

  for (const pattern of patterns) {
    for (const match of summary.matchAll(pattern)) {
      const alias = normalizeAliasCandidate(match[1] ?? "");
      if (isDistinctCharacterAlias(alias, canonicalName)) {
        aliases.add(alias);
      }
    }
  }

  return [...aliases];
}

function resolveUniqueCharacterReference(
  reference: string,
  entities: ScanResult["entities"],
) {
  const normalizedReference = normalizeAliasCandidate(reference).toLowerCase();
  if (!normalizedReference) {
    return null;
  }

  const candidates = entities.filter((entity) => {
    if (entity.category !== "character") {
      return false;
    }

    const candidateNames = [
      entity.name,
      stripTitlePrefix(entity.name),
      ...entity.aliases,
    ]
      .map((value) => normalizeAliasCandidate(value).toLowerCase())
      .filter(Boolean);

    if (candidateNames.includes(normalizedReference)) {
      return true;
    }

    return candidateNames.some((value) =>
      value.split(/\s+/).filter(Boolean).includes(normalizedReference),
    );
  });

  return candidates.length === 1 ? candidates[0] : null;
}

function extractDialogueExchangeAliases(
  chapterText: string,
  entities: ScanResult["entities"],
) {
  const aliasesByCharacter = new Map<string, Set<string>>();
  const exchangePattern =
    /["“]What['’]s your name\?["”]\s*["“]([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){1,2})\.\s*Yours\?["”]\s*["“][A-Z][A-Za-z'-]+\s+also\.\s*([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){1,2})\.["”]/g;

  for (const match of chapterText.matchAll(exchangePattern)) {
    const index = match.index ?? 0;
    const precedingContext = chapterText.slice(Math.max(0, index - 240), index);
    const interactionMatches = [
      ...precedingContext.matchAll(
        /\b([A-Z][a-z]+)\b[^.?!\n]{0,120}\b(?:with|to)\s+([A-Z][a-z]+)\b/g,
      ),
    ];
    const latestInteraction = interactionMatches.at(-1);
    if (!latestInteraction) {
      continue;
    }

    const speaker = resolveUniqueCharacterReference(
      latestInteraction[1],
      entities,
    );
    const addressee = resolveUniqueCharacterReference(
      latestInteraction[2],
      entities,
    );
    const addAlias = (
      character: ScanResult["entities"][number] | null,
      alias: string,
    ) => {
      if (!character || !isDistinctCharacterAlias(alias, character.name)) {
        return;
      }

      if (!aliasesByCharacter.has(character.name)) {
        aliasesByCharacter.set(character.name, new Set<string>());
      }
      aliasesByCharacter
        .get(character.name)
        ?.add(normalizeAliasCandidate(alias));
    };

    addAlias(addressee, match[1] ?? "");
    addAlias(speaker, match[2] ?? "");
  }

  return aliasesByCharacter;
}

function enrichCharacterAliasesFromContext(
  entities: ScanResult["entities"],
  chapterText: string,
) {
  const dialogueAliases = extractDialogueExchangeAliases(chapterText, entities);

  return entities.map((entity) => {
    if (entity.category !== "character") {
      return entity;
    }

    const aliases = new Set(
      entity.aliases
        .map((alias) => normalizeAliasCandidate(alias))
        .filter(Boolean),
    );

    for (const alias of extractAliasesFromCharacterSummary(
      entity.summary,
      entity.name,
    )) {
      aliases.add(alias);
    }

    for (const alias of dialogueAliases.get(entity.name) ?? []) {
      aliases.add(alias);
    }

    aliases.delete(normalizeAliasCandidate(entity.name));

    return {
      ...entity,
      aliases: [...aliases],
    };
  });
}

function getCharacterSurname(name: string) {
  const stripped = stripTitlePrefix(name).trim();
  const tokens = stripped.split(/\s+/).filter(Boolean);
  return tokens.length >= 1 ? tokens[tokens.length - 1].toLowerCase() : "";
}

function isHonorificSurnameVariant(name: string) {
  const trimmed = name.trim();
  const stripped = stripTitlePrefix(trimmed);
  const originalTokens = trimmed.split(/\s+/).filter(Boolean);
  const strippedTokens = stripped.split(/\s+/).filter(Boolean);

  return (
    stripped !== trimmed &&
    originalTokens.length === 2 &&
    strippedTokens.length === 1
  );
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

function hasChapterWideSingleWordEvidence(
  name: string,
  category: SupportedCategory,
  chapterText: string,
) {
  if (!chapterText) {
    return false;
  }

  const pattern = new RegExp(`\\b${escapeRegExp(name)}\\b`, "g");

  for (const match of chapterText.matchAll(pattern)) {
    const index = match.index ?? -1;
    if (index < 0) {
      continue;
    }

    const snippet = getSnippet(chapterText, index, name.length);
    if (
      hasStrongSingleWordEvidence(name, category, snippet) ||
      (category === "location" && isPossessivePlaceReference(name, snippet))
    ) {
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

function shouldDropHonorificSurnameDuplicate(
  entity: ScanResult["entities"][number],
  entities: ScanResult["entities"],
) {
  if (
    entity.category !== "character" ||
    !isHonorificSurnameVariant(entity.name)
  ) {
    return false;
  }

  const entitySurname = getCharacterSurname(entity.name);
  if (!entitySurname) {
    return false;
  }

  return entities.some((candidate) => {
    if (candidate === entity || candidate.category !== "character") {
      return false;
    }

    if (isHonorificSurnameVariant(candidate.name)) {
      return false;
    }

    const candidateTokens = stripTitlePrefix(candidate.name)
      .split(/\s+/)
      .filter(Boolean);

    return (
      candidateTokens.length >= 2 &&
      getCharacterSurname(candidate.name) === entitySurname
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
    return parseSentencesWithGrammar(context).some((sentence) =>
      hasLocationSentenceRole(name, sentence),
    );
  }

  if (category === "character") {
    return parseSentencesWithGrammar(context).some((sentence) =>
      hasHumanSentenceRole(name, sentence),
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

function isPossessivePlaceReference(name: string, context: string) {
  return new RegExp(
    `${escapeRegExp(name)}['’]s\s+(?:${possessivePlaceNouns.join("|")})\b`,
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
  const hasStrongItemEvidence = hasStrongSingleWordEvidence(
    name,
    "item",
    context,
  );
  const hasStrongLocationEvidence = hasStrongSingleWordEvidence(
    name,
    "location",
    context,
  );
  const hasStrongCharacterEvidence = hasStrongSingleWordEvidence(
    name,
    "character",
    context,
  );

  if (tokens.length === 1) {
    if (hasStrongItemEvidence) {
      return "item";
    }

    if (hasStrongLocationEvidence && !hasStrongCharacterEvidence) {
      return "location";
    }

    if (!hasStrongCharacterEvidence && hasPlaceNameMorphology(name)) {
      return "location";
    }

    if (hasStrongCharacterEvidence) {
      return "character";
    }
  }

  if (
    isPossessiveOwnerReference(name, context) &&
    (looksLikePersonName || (tokens.length === 1 && hasStrongCharacterEvidence))
  ) {
    return "character";
  }

  if (tokens.length === 1 && isPossessivePlaceReference(name, context)) {
    return "location";
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

  if (hasStrongItemEvidence) {
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

  if (!looksLikePersonName && !hasCharacterCue && hasStrongLocationEvidence) {
    return "location";
  }

  if (hasCharacterCue) {
    if (tokens.length === 1 && !hasStrongCharacterEvidence) {
      return null;
    }

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
  let normalizedSummary =
    entity.category === "character"
      ? normalizeCharacterSummarySections(entity.summary)
      : entity.summary;

  if (
    entity.category === "character" &&
    !summaryHasExplicitMainCharacterCue(normalizedSummary) &&
    isLikelyPointOfViewCharacter(entity.name, chapterText)
  ) {
    normalizedSummary = addPointOfViewCueToCharacterSummary(normalizedSummary);
  }

  const normalizedName =
    entity.category === "character"
      ? normalizeCharacterName(entity.name)
      : entity.name.trim();
  const normalizedEntity =
    normalizedName === entity.name && normalizedSummary === entity.summary
      ? entity
      : { ...entity, name: normalizedName, summary: normalizedSummary };

  const match = findFirstNameMatch(normalizedEntity.name, chapterText);
  const hasCharacterEvidence =
    normalizedEntity.aliases.length > 0 || normalizedEntity.links.length > 0;
  const inferredCategory = match
    ? inferCategory(normalizedEntity.name, match.snippet)
    : null;

  if (
    normalizedEntity.category === "character" &&
    normalizedEntity.name.split(/\s+/).length === 1 &&
    !hasChapterWideSingleWordEvidence(
      normalizedEntity.name,
      "character",
      chapterText,
    ) &&
    hasChapterWideSingleWordEvidence(
      normalizedEntity.name,
      "location",
      chapterText,
    )
  ) {
    return applyUserCanonDecisionToEntity({
      ...normalizedEntity,
      category: "location",
    });
  }

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

function getParagraphSnippet(text: string, index: number) {
  const start = Math.max(0, text.lastIndexOf("\n", Math.max(0, index - 1)) + 1);
  const nextNewline = text.indexOf("\n", index);
  const end = nextNewline === -1 ? text.length : nextNewline;
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function getFirstNonEmptyParagraph(text: string) {
  return (
    text
      .split(/\n+/)
      .map((segment) => segment.replace(/\s+/g, " ").trim())
      .find(Boolean) ?? ""
  );
}

function splitIntoSentences(value: string) {
  return parseSentencesWithGrammar(value).map((sentence) => sentence.text);
}

function buildCharacterReferenceCandidates(name: string) {
  const stripped = stripTitlePrefix(name).replace(/\s+/g, " ").trim();
  const tokens = stripped.split(/\s+/).filter(Boolean);
  const candidates = new Set<string>([name.trim(), stripped]);

  if (tokens.length > 0) {
    candidates.add(tokens[0]);
  }

  return [...candidates].filter(Boolean);
}

function sentenceMentionsCharacterReference(sentence: string, name: string) {
  return buildCharacterReferenceCandidates(name).some((candidate) =>
    new RegExp(`\\b${escapeRegExp(candidate)}\\b`, "i").test(sentence),
  );
}

function sentenceHasCharacterPronoun(sentence: string) {
  return /\b(he|him|his|she|her|hers)\b/i.test(sentence);
}

function countCharacterReferenceHits(name: string, chapterText: string) {
  return buildCharacterReferenceCandidates(name).reduce((count, candidate) => {
    const matches = chapterText.match(
      new RegExp(`\\b${escapeRegExp(candidate)}\\b`, "gi"),
    );
    return count + (matches?.length ?? 0);
  }, 0);
}

function isLikelyPointOfViewCharacter(name: string, chapterText: string) {
  if (!chapterText) {
    return false;
  }

  const firstParagraph = getFirstNonEmptyParagraph(chapterText);
  const firstParagraphSentences = parseSentencesWithGrammar(firstParagraph);
  const firstReferenceMatch = findFirstNameMatch(name, firstParagraph);

  if (!firstReferenceMatch || firstReferenceMatch.index > 120) {
    return false;
  }

  const firstSentence = firstParagraphSentences[0];
  if (!firstSentence || !subjectEndsWithReference(firstSentence, name)) {
    return false;
  }

  const firstSentenceVerbs = getNormalizedVerbTokens(firstSentence);
  if (!firstSentenceVerbs.some((verb) => humanActionVerbs.has(verb))) {
    return false;
  }

  let activeReferenceThread = false;
  const relevantSentences: Array<{
    sentence: string;
    mentionsCharacter: boolean;
  }> = [];

  for (const parsedSentence of firstParagraphSentences) {
    const mentionsCharacter = sentenceMentionsCharacterReference(
      parsedSentence.text,
      name,
    );
    const hasPronoun = sentenceHasCharacterPronoun(parsedSentence.text);

    if (mentionsCharacter) {
      activeReferenceThread = true;
      relevantSentences.push({
        sentence: parsedSentence.text,
        mentionsCharacter: true,
      });
      continue;
    }

    if (activeReferenceThread && hasPronoun) {
      relevantSentences.push({
        sentence: parsedSentence.text,
        mentionsCharacter: false,
      });
    }
  }

  if (relevantSentences.length < 2) {
    return false;
  }

  const mentionCount = relevantSentences.filter(
    ({ mentionsCharacter }) => mentionsCharacter,
  ).length;
  const pronounFollowUpCount = relevantSentences.filter(
    ({ mentionsCharacter, sentence }) =>
      !mentionsCharacter && sentenceHasCharacterPronoun(sentence),
  ).length;

  if (mentionCount < 1 || pronounFollowUpCount < 2) {
    return false;
  }

  const hasFirstParagraphCharacterSignal = relevantSentences.some(
    ({ sentence, mentionsCharacter }) =>
      sentenceHasCharacterPronoun(sentence) ||
      hasAppearanceDetailCue(sentence) ||
      hasOwnedOutfitDetail(sentence, mentionsCharacter),
  );

  if (!hasFirstParagraphCharacterSignal) {
    return false;
  }

  return countCharacterReferenceHits(name, chapterText) >= 6;
}

function hasAppearanceDetailCue(sentence: string) {
  return /\b(hair|eye|eyes|lip|lips|face|frame|build|beard|mustache|skin|complexion|brow|brows|cheek|cheeks|jaw|golden|blonde|brown|black|grey|gray|green|blue|red|pink|tan|hazel|shapely|taut|round|average|short|tall|heavy|bags)\b/i.test(
    sentence,
  );
}

function hasOutfitDetailCue(sentence: string) {
  return /\b(dress|apron|shawl|coat|hat|vest|shirt|pants|trousers|uniform|glove|gloves|boot|boots|shoe|shoes|barefoot|tie)\b/i.test(
    sentence,
  );
}

function countDetailCueMatches(sentence: string, pattern: RegExp) {
  return (
    sentence.match(
      new RegExp(
        pattern.source,
        pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
      ),
    )?.length ?? 0
  );
}

function hasOwnedOutfitDetail(sentence: string, mentionsCharacter: boolean) {
  if (!hasOutfitDetailCue(sentence)) {
    return false;
  }

  return (
    mentionsCharacter ||
    /^\s*(?:his|her)\b/i.test(sentence) ||
    (/^\s*(?:he|she)\b/i.test(sentence) &&
      /\b(his|her)\b[^.]{0,40}\b(dress|apron|shawl|coat|hat|vest|shirt|pants|trousers|uniform|glove|gloves|boot|boots|shoe|shoes|barefoot|tie)\b/i.test(
        sentence,
      ))
  );
}

function buildSupplementalCharacterEvidence(
  name: string,
  chapterText: string,
  index: number,
) {
  const timelineSnippet = getSnippet(chapterText, index, name.length);
  const paragraphSnippet = getParagraphSnippet(chapterText, index);
  const sentences = splitIntoSentences(paragraphSnippet);
  const relevantSentences: Array<{
    sentence: string;
    mentionsCharacter: boolean;
  }> = [];
  let activeReferenceThread = false;

  for (const sentence of sentences) {
    const mentionsCharacter = sentenceMentionsCharacterReference(
      sentence,
      name,
    );
    const hasPronoun = sentenceHasCharacterPronoun(sentence);

    if (mentionsCharacter) {
      activeReferenceThread = true;
      relevantSentences.push({ sentence, mentionsCharacter });
      continue;
    }

    if (activeReferenceThread && hasPronoun) {
      relevantSentences.push({ sentence, mentionsCharacter });
    }
  }

  const physicalDetails = [
    ...new Set(
      relevantSentences
        .map(({ sentence }) => sentence)
        .filter(hasAppearanceDetailCue),
    ),
  ];
  const outfitDetails = [
    ...new Set(
      relevantSentences
        .filter(({ sentence, mentionsCharacter }) =>
          hasOwnedOutfitDetail(sentence, mentionsCharacter),
        )
        .map(({ sentence }) => sentence),
    ),
  ];
  const appearanceCuePattern =
    /\b(hair|eye|eyes|lip|lips|face|frame|build|beard|mustache|skin|complexion|brow|brows|cheek|cheeks|jaw|golden|blonde|brown|black|grey|gray|green|blue|red|pink|tan|hazel|shapely|taut|round|average|short|tall|heavy|bags)\b/gi;
  const outfitCuePattern =
    /\b(dress|apron|shawl|coat|hat|vest|shirt|pants|trousers|uniform|glove|gloves|boot|boots|shoe|shoes|barefoot|tie)\b/gi;
  const detailCueCount = relevantSentences.reduce(
    (count, { sentence, mentionsCharacter }) =>
      count +
      countDetailCueMatches(sentence, appearanceCuePattern) +
      (hasOwnedOutfitDetail(sentence, mentionsCharacter)
        ? countDetailCueMatches(sentence, outfitCuePattern)
        : 0),
    0,
  );
  const score =
    physicalDetails.length * 10 +
    outfitDetails.length * 6 +
    detailCueCount * 2 +
    Math.min(paragraphSnippet.length, 240) / 40;

  return {
    timelineSnippet,
    physicalDetails,
    outfitDetails,
    isPointOfView: isLikelyPointOfViewCharacter(name, chapterText),
    score,
  };
}

function mergeSupplementalCharacterEvidence(
  existing: ReturnType<typeof buildSupplementalCharacterEvidence>,
  incoming: ReturnType<typeof buildSupplementalCharacterEvidence>,
) {
  const physicalDetails = [
    ...new Set([...existing.physicalDetails, ...incoming.physicalDetails]),
  ];
  const outfitDetails = [
    ...new Set([...existing.outfitDetails, ...incoming.outfitDetails]),
  ];
  const score =
    physicalDetails.length * 10 +
    outfitDetails.length * 6 +
    Math.max(existing.score, incoming.score);

  return {
    timelineSnippet: existing.timelineSnippet || incoming.timelineSnippet,
    physicalDetails,
    outfitDetails,
    isPointOfView: existing.isPointOfView || incoming.isPointOfView,
    score,
  };
}

function buildSupplementalSummary(
  name: string,
  category: SupportedCategory,
  snippet: string,
  chapterText = "",
  index = 0,
  characterEvidence?: ReturnType<typeof buildSupplementalCharacterEvidence>,
) {
  if (category === "character") {
    const evidence =
      characterEvidence ??
      buildSupplementalCharacterEvidence(name, chapterText, index);
    return [
      "## Core Status",
      `- Full name: ${name}`,
      "- Canon status: Unconfirmed",
      "- On-page status: Mentioned or on-page in the current chapter snapshot",
      ...(evidence.isPointOfView
        ? [
            "- Chapter role: Point-of-view character in current chapter snapshot",
          ]
        : []),
      "",
      "## Identity",
      "- Occupation / function: Missing",
      "- Affiliation(s): Missing",
      "",
      "## Physical Description",
      ...(evidence.physicalDetails.length
        ? evidence.physicalDetails.map(
            (detail) => `- Current chapter snapshot: ${detail}`,
          )
        : [
            "- Missing / unestablished: No reliable physical description established by automatic fallback extraction.",
          ]),
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
      `- Current chapter snapshot: ${evidence.timelineSnippet || snippet || `${name} is named in the current chapter snapshot.`}`,
      "",
      "## Outfit / Appearance by Scene",
      ...(evidence.outfitDetails.length
        ? evidence.outfitDetails.map(
            (detail) => `- Current chapter snapshot: ${detail}`,
          )
        : ["- Current chapter snapshot: Missing / unestablished"]),
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
  const foundScores = new Map<string, number>();
  const foundCharacterEvidence = new Map<
    string,
    ReturnType<typeof buildSupplementalCharacterEvidence>
  >();
  const existingKeys = new Set(
    existingEntities.map(
      (entity) => `${entity.category}:${entity.name.trim().toLowerCase()}`,
    ),
  );

  function matchesExistingEntityReference(name: string, currentKey?: string) {
    const normalized = name.trim().toLowerCase();
    const slug = makeSlug(name);

    if (!normalized || existingEntitySlugs.has(slug)) {
      return false;
    }

    return [
      ...existingEntities,
      ...Array.from(found.entries())
        .filter(([key]) => key !== currentKey)
        .map(([, entity]) => entity),
    ].some((entity) => {
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
    });
  }

  function findUpgradeableCharacterKey(name: string) {
    const normalized = name.trim().toLowerCase();
    if (!normalized) {
      return null;
    }

    const matches = Array.from(found.entries()).filter(([, entity]) => {
      if (entity.category !== "character") {
        return false;
      }

      const tokens = entity.name
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);

      return tokens.length > 1 && tokens.includes(normalized);
    });

    return matches.length === 1 ? matches[0][0] : null;
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
    const upgradeKey =
      category === "character" && cleaned.split(/\s+/).length === 1
        ? findUpgradeableCharacterKey(cleaned)
        : null;
    const hasChapterWideLocationEvidence = hasChapterWideSingleWordEvidence(
      cleaned,
      "location",
      chapterText,
    );
    const hasChapterWideCharacterEvidence = hasChapterWideSingleWordEvidence(
      cleaned,
      "character",
      chapterText,
    );
    const resolvedCategory =
      cleaned.split(/\s+/).length === 1 &&
      hasChapterWideLocationEvidence &&
      (!hasChapterWideCharacterEvidence || hasPlaceNameMorphology(cleaned))
        ? "location"
        : category;
    const canonicalName = upgradeKey
      ? (found.get(upgradeKey)?.name ?? cleaned)
      : cleaned;
    const snippet = getSnippet(chapterText, index, canonicalName.length);
    const key =
      upgradeKey ?? `${resolvedCategory}:${canonicalName.toLowerCase()}`;
    const currentEvidence =
      resolvedCategory === "character"
        ? buildSupplementalCharacterEvidence(canonicalName, chapterText, index)
        : null;
    const mergedEvidence =
      currentEvidence && foundCharacterEvidence.has(key)
        ? mergeSupplementalCharacterEvidence(
            foundCharacterEvidence.get(key)!,
            currentEvidence,
          )
        : currentEvidence;
    const candidateScore =
      resolvedCategory === "character"
        ? (mergedEvidence?.score ?? Number.NEGATIVE_INFINITY)
        : Math.min(snippet.length, 160) / 20;

    if (
      !cleaned ||
      singleWordStoplist.has(cleaned) ||
      !hasPlausibleTokenShape(cleaned) ||
      existingKeys.has(key) ||
      (!upgradeKey && matchesExistingEntityReference(cleaned, key)) ||
      shouldDropSingleWordLocationCharacterCollision(
        {
          name: cleaned,
          category: resolvedCategory,
          summary: "",
          isStub: true,
          aliases: [],
          links: [],
        },
        [...existingEntities, ...Array.from(found.values())],
        existingEntitySlugs,
      ) ||
      (!upgradeKey &&
        cleaned.split(/\s+/).length === 1 &&
        !hasStrongSingleWordEvidence(cleaned, resolvedCategory, snippet))
    ) {
      return;
    }

    if (
      found.has(key) &&
      candidateScore <= (foundScores.get(key) ?? Number.NEGATIVE_INFINITY)
    ) {
      return;
    }

    const entity = applyUserCanonDecisionToEntity({
      name: canonicalName,
      category: resolvedCategory,
      summary: buildSupplementalSummary(
        canonicalName,
        resolvedCategory,
        snippet,
        chapterText,
        index,
        mergedEvidence ?? undefined,
      ),
      isStub: true,
      aliases: [],
      links: [],
    });

    if (!entity) {
      return;
    }

    found.set(key, entity);
    foundScores.set(key, candidateScore);
    if (mergedEvidence) {
      foundCharacterEvidence.set(key, mergedEvidence);
    }
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
    const category =
      inferCategory(name, context) ??
      (hasStrongSingleWordEvidence(name, "character", context)
        ? "character"
        : hasStrongSingleWordEvidence(name, "location", context)
          ? "location"
          : hasStrongSingleWordEvidence(name, "item", context)
            ? "item"
            : null);
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
    const aliasMatch = entity.aliases.some((alias) =>
      appearsInChapterText(alias, chapterText),
    );
    const hasStandaloneSingleWord =
      entity.name.split(/\s+/).length === 1
        ? hasStandaloneSingleWordOccurrence(entity.name, chapterText)
        : true;

    if (
      !hasPlausibleTokenShape(entity.name) ||
      shouldDropAsPartialDuplicate(entity, dedupedEntities) ||
      shouldDropCoreNameDuplicate(entity, dedupedEntities) ||
      shouldDropHonorificSurnameDuplicate(entity, dedupedEntities) ||
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
        !existingEntitySlugs.has(makeSlug(entity.name)) &&
        !hasChapterWideSingleWordEvidence(
          entity.name,
          "character",
          chapterText,
        )) ||
      (entity.category === "character" &&
        entity.name.split(/\s+/).length === 1 &&
        !hasChapterWideSingleWordEvidence(
          entity.name,
          "character",
          chapterText,
        ) &&
        hasChapterWideSingleWordEvidence(
          entity.name,
          "location",
          chapterText,
        ) &&
        !existingEntitySlugs.has(makeSlug(entity.name))) ||
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
      aliasMatch ||
      existingEntitySlugs.has(makeSlug(entity.name))
    );
  });

  const groundedEntitiesWithAliases = chapterText
    ? enrichCharacterAliasesFromContext(groundedEntities, chapterText)
    : groundedEntities;

  const supplementedEntities = chapterText
    ? collectSupplementalEntities(
        chapterText,
        groundedEntitiesWithAliases,
        existingEntitySlugs,
      )
    : [];

  return {
    ...parsed,
    entities: [...groundedEntitiesWithAliases, ...supplementedEntities],
  };
}

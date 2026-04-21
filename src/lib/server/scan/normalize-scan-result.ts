import { getDatabase } from "$lib/server/db/client";
import { applyUserCanonDecisionToEntity } from "$lib/server/canon/user-canon-decisions";
import { makeSlug } from "$lib/server/providers/provider";
import { scanResultSchema, type ScanResult } from "$lib/types/scan-result";
import nlp from "compromise";

type SupportedCategory = ScanResult["entities"][number]["category"];

const locationSuffixes = [
  "Bay",
  "Booth",
  "Field",
  "City",
  "Forest",
  "Hall",
  "Hearth",
  "Headquarters",
  "Mansion",
  "Gate",
  "Lake",
  "Gates",
  "Road",
  "Stall",
  "Store",
  "Street",
  "Tower",
  "Tavern",
  "Inn",
  "Manor",
];

const eventSuffixes = ["Ball", "Ceremony", "Festival", "Feast", "Party", "War"];

const mountContextNouns = ["horse", "destrier", "mare", "stallion", "gelding"];

const animalSpeciesNouns = [
  "animal",
  "animals",
  "beast",
  "beasts",
  "bird",
  "birds",
  "boar",
  "boars",
  "cat",
  "cats",
  "creature",
  "creatures",
  "destrier",
  "destriers",
  "dog",
  "dogs",
  "eagle",
  "eagles",
  "falcon",
  "falcons",
  "gelding",
  "geldings",
  "hawk",
  "hawks",
  "horse",
  "horses",
  "mare",
  "mares",
  "panther",
  "panthers",
  "serpent",
  "serpents",
  "spider",
  "spiders",
  "stallion",
  "stallions",
  "viper",
  "vipers",
  "wolf",
  "wolves",
];

const plantSpeciesNouns = [
  "bloom",
  "blooms",
  "blossom",
  "blossoms",
  "briar",
  "briars",
  "daisy",
  "daisies",
  "fern",
  "ferns",
  "flower",
  "flowers",
  "herb",
  "herbs",
  "ivy",
  "lily",
  "lilies",
  "moss",
  "orchid",
  "orchids",
  "petal",
  "petals",
  "reed",
  "reeds",
  "rose",
  "roses",
  "thorn",
  "thorns",
  "vine",
  "vines",
  "weed",
  "weeds",
];

const fantasticalCreatureNouns = [
  "basilisk",
  "basilisks",
  "dragon",
  "dragons",
  "drake",
  "drakes",
  "griffin",
  "griffins",
  "gryphon",
  "gryphons",
  "hydra",
  "hydras",
  "manticore",
  "manticores",
  "phoenix",
  "phoenixes",
  "phoenixes",
  "unicorn",
  "unicorns",
  "wyvern",
  "wyverns",
];

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

const maxOpeningPovReferenceDistance = 650;

const possessiveLocationNouns = [
  "bar",
  "barn",
  "camp",
  "dock",
  "docks",
  "desk",
  "farm",
  "grounds",
  "hall",
  "harbor",
  "harbour",
  "home",
  "house",
  "inn",
  "office",
  "place",
  "plain",
  "plains",
  "restaurant",
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
  "Miss",
  "Ms",
  "Mrs",
  "Mr",
  "Doctor",
  "Dr",
  "Sir",
];

const bareTitleTokens = new Set([...titlePrefixes, "Miss", "Doctor", "Dr"]);

const bareKinshipAliasTokens = new Set([
  "Mama",
  "Papa",
  "Mother",
  "Father",
  "Mom",
  "Dad",
  "Brother",
  "Sister",
  "Grandma",
  "Grandpa",
  "Grandmother",
  "Grandfather",
]);

const uncertainCharacterSuffixes = new Set([
  "something",
  "someone",
  "somebody",
  "for",
]);

const connectorTokens = new Set(["of", "the", "for"]);

const organizationContextPattern =
  /\b(empire|council|guild|order|watch|watchmen|militia|guard|guards|rangers|company|companies|court|army|legion)\b/i;

const blockedSingleWordEntityTags = new Set([
  "Pronoun",
  "Adverb",
  "Determiner",
  "Conjunction",
  "Preposition",
]);

const explicitProperNameTags = new Set([
  "ProperNoun",
  "Place",
  "Person",
  "Honorific",
  "FirstName",
  "LastName",
  "MaleName",
  "FemaleName",
]);

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
  "Have",
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
  "Salt",
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
  "Mama",
  "Papa",
  "Join",
]);

const multiWordLeadingStoplist = new Set([
  "All",
  "And",
  "At",
  "Before",
  "But",
  "Did",
  "Doesn",
  "Don",
  "Every",
  "Fat",
  "Flanking",
  "For",
  "From",
  "Freed",
  "Give",
  "Had",
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
  "Whatever",
  "Tracking",
  "Through",
  "Turned",
  "Joining",
  "Join",
  "Does",
  "Even",
  "Have",
  "Let",
  "Son",
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
  const previousPrevious =
    match.start > 1 ? sentence.terms[match.start - 2] : undefined;
  const normalizedPreviousPrevious = previousPrevious
    ? getNormalizedSentenceTerm(previousPrevious)
    : "";
  const normalizedNext = next ? getNormalizedSentenceTerm(next) : "";
  const possessiveHead = sentence.terms[match.start];
  const previousPhrase = [normalizedPreviousPrevious, normalizedPrevious]
    .filter(Boolean)
    .join(" ");

  return (
    (normalizedPrevious !== "" &&
      locationPrepositions.has(normalizedPrevious)) ||
    previousPhrase === "out of" ||
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

function removeUnsupportedPointOfViewCue(summary: string) {
  const sections = splitSummarySections(summary);
  const unsupportedCuePattern =
    /\b(?:protagonist|main character|lead character|primary character|primary pov|on-page primary character|point-of-view|point of view|pov)\b/i;

  for (const section of sections) {
    section.lines = section.lines.filter(
      (line) => !unsupportedCuePattern.test(line),
    );
  }

  return sections
    .flatMap((section) =>
      section.heading ? [section.heading, ...section.lines] : section.lines,
    )
    .join("\n");
}

function normalizeAliasCandidate(value: string) {
  return value
    .replace(
      /\b(Ms|Mrs|Miss|Mr|Dr|Doctor|Sir|Lady|Lord|Baron|Baroness)\./g,
      "$1",
    )
    .replace(/^["“”'`]+|["“”'`]+$/g, "")
    .replace(/[.,!?;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Strips trailing parenthetical annotations such as "(alias used)" or "(assumed name)"
function stripAliasAnnotation(alias: string): string {
  return alias.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

// Keywords that indicate an alias entry marks an assumed/false name rather than a true name
const aliasAnnotationKeywords =
  /\b(?:alias|assumed|false|fake|pseudonym|cover|pen name|used)\b/i;

// Summary keywords that signal the entity itself is an assumed/false identity
const assumedIdentitySummaryKeywords =
  /\b(?:alias|assumed name|false identity|false name|pseudonym|cover identity|fake name|in-scene alias|alias used)\b/i;

function candidateSummaryIsAssumedIdentity(summary: string): boolean {
  return assumedIdentitySummaryKeywords.test(summary);
}

function isHonorificOnlyAlias(alias: string) {
  const tokens = normalizeAliasCandidate(alias).split(/\s+/).filter(Boolean);
  return (
    (tokens.length > 0 && bareTitleTokens.has(tokens[0])) ||
    (tokens.length === 1 && bareKinshipAliasTokens.has(tokens[0]))
  );
}

function normalizeEntityAliases(
  aliases: string[],
  canonicalName: string,
  category: SupportedCategory,
) {
  const canonical = normalizeAliasCandidate(canonicalName).toLowerCase();
  const normalized = new Set<string>();

  for (const alias of aliases) {
    const cleaned = normalizeAliasCandidate(alias);
    if (!cleaned) {
      continue;
    }

    if (category === "character" && isHonorificOnlyAlias(cleaned)) {
      continue;
    }

    if (cleaned.toLowerCase() === canonical) {
      continue;
    }

    // Drop aliases that are sentence fragments (>6 words likely from prose, not a name)
    if (cleaned.split(/\s+/).length > 6) {
      continue;
    }

    // Drop an alias that is the possessive owner extracted from a Publications entity name
    // e.g. "Branzo Vistani" should not be an alias for "Branzo Vistani's journals"
    if (category === "item") {
      const possessiveMatch = canonicalName.match(/^(.+?)['']s\s+\S/);
      if (
        possessiveMatch &&
        cleaned.toLowerCase() === possessiveMatch[1].toLowerCase()
      ) {
        continue;
      }
    }

    normalized.add(cleaned);
  }

  return [...normalized];
}

function isDistinctCharacterAlias(alias: string, canonicalName: string) {
  const normalizedAlias = normalizeAliasCandidate(alias);
  if (!normalizedAlias) {
    return false;
  }

  const aliasTokens = normalizedAlias.split(/\s+/).filter(Boolean);
  if (aliasTokens.length > 0 && bareTitleTokens.has(aliasTokens[0])) {
    return false;
  }

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

function extractAppositiveCharacterAliases(
  chapterText: string,
  entities: ScanResult["entities"],
) {
  const aliasesByCharacter = new Map<string, Set<string>>();
  const appositivePattern =
    /\b((?:(?:Ms|Mrs|Miss|Mr|Dr|Doctor|Sir|Lady|Lord)\.?\s+)?[A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,2})\.\s*(The\s+[A-Z][A-Za-z'-]+)\b/g;

  for (const match of chapterText.matchAll(appositivePattern)) {
    const character = resolveUniqueCharacterReference(match[1] ?? "", entities);
    const alias = normalizeAliasCandidate(match[2] ?? "");
    if (!character || !isDistinctCharacterAlias(alias, character.name)) {
      continue;
    }

    if (!aliasesByCharacter.has(character.name)) {
      aliasesByCharacter.set(character.name, new Set<string>());
    }
    aliasesByCharacter.get(character.name)?.add(alias);
  }

  return aliasesByCharacter;
}

function enrichCharacterAliasesFromContext(
  entities: ScanResult["entities"],
  chapterText: string,
) {
  const dialogueAliases = extractDialogueExchangeAliases(chapterText, entities);
  const appositiveAliases = extractAppositiveCharacterAliases(
    chapterText,
    entities,
  );

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

    for (const alias of appositiveAliases.get(entity.name) ?? []) {
      aliases.add(alias);
    }

    aliases.delete(normalizeAliasCandidate(entity.name));

    return {
      ...entity,
      aliases: [...aliases],
    };
  });
}

function extractAppositiveLocationAliases(
  chapterText: string,
  entities: ScanResult["entities"],
) {
  const aliasesByLocation = new Map<string, Set<string>>();
  const patterns = [
    /\b([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,3})\s+itself,\s+the\s+([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,3})\b/g,
    /\b([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,3}),\s+the\s+([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,3})\b/g,
  ];
  const locations = entities.filter((entity) => entity.category === "location");

  for (const pattern of patterns) {
    for (const match of chapterText.matchAll(pattern)) {
      const primaryName = sanitizeMatchedName(match[1] ?? "");
      const secondaryName = sanitizeMatchedName(match[2] ?? "");
      const primary = locations.find(
        (entity) =>
          normalizeAliasCandidate(entity.name).toLowerCase() ===
          primaryName.toLowerCase(),
      );
      const secondary = locations.find(
        (entity) =>
          normalizeAliasCandidate(
            stripLeadingArticle(entity.name),
          ).toLowerCase() === secondaryName.toLowerCase(),
      );

      if (!primary || !secondary || primary.name === secondary.name) {
        continue;
      }

      if (!aliasesByLocation.has(primary.name)) {
        aliasesByLocation.set(primary.name, new Set<string>());
      }

      aliasesByLocation.get(primary.name)?.add(secondary.name);
    }
  }

  return aliasesByLocation;
}

function mergeAppositiveLocationEntities(
  entities: ScanResult["entities"],
  chapterText: string,
) {
  const aliasesByLocation = extractAppositiveLocationAliases(
    chapterText,
    entities,
  );
  if (aliasesByLocation.size === 0) {
    return entities;
  }

  const droppedLocationNames = new Set(
    Array.from(aliasesByLocation.values()).flatMap((aliases) =>
      Array.from(aliases),
    ),
  );

  return entities.flatMap((entity) => {
    if (entity.category !== "location") {
      return [entity];
    }

    if (droppedLocationNames.has(entity.name)) {
      return [];
    }

    const extraAliases = Array.from(aliasesByLocation.get(entity.name) ?? []);
    if (extraAliases.length === 0) {
      return [entity];
    }

    return [
      {
        ...entity,
        aliases: normalizeEntityAliases(
          [...entity.aliases, ...extraAliases],
          entity.name,
          entity.category,
        ),
      },
    ];
  });
}

// Single-word sentence-transition words that are never location names.
// Covers adverbs ending in -ly plus common discourse markers.
const sentenceTransitionPattern =
  /^(?:finally|eventually|suddenly|meanwhile|previously|fortunately|unfortunately|lastly|firstly|next|then|also|moreover|however|therefore|otherwise|additionally|consequently|subsequently|indeed|still|yet|now|so|thus|hence|instead|perhaps|certainly|clearly|obviously|similarly|alternatively|notably|meanwhile|admittedly|frankly|honestly|naturally|obviously|presumably|reportedly|supposedly)$/i;

function findAppositiveLocationCanonicalName(name: string, context: string) {
  const strippedName = stripLeadingArticle(sanitizeMatchedName(name));
  if (!strippedName || !context) {
    return null;
  }

  const patterns = [
    new RegExp(
      `\\b([A-Z][A-Za-z'-]+(?:\\s+[A-Z][A-Za-z'-]+){0,3})\\s+itself,\\s+the\\s+${escapeRegExp(strippedName)}\\b`,
      "i",
    ),
    new RegExp(
      `\\b([A-Z][A-Za-z'-]+(?:\\s+[A-Z][A-Za-z'-]+){0,3}),\\s+the\\s+${escapeRegExp(strippedName)}\\b`,
      "i",
    ),
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(context);
    if (match?.[1]) {
      const candidate = sanitizeMatchedName(match[1]);
      // Reject single-word sentence-transition adverbs that appear at the
      // start of a sentence and are never location names (e.g. "Finally, the
      // Red Booth" should not yield "Finally" as the canonical location name).
      const tokens = candidate.split(/\s+/).filter(Boolean);
      if (
        tokens.length === 1 &&
        (sentenceTransitionPattern.test(candidate) ||
          /^[A-Z][a-z]+ly$/i.test(candidate))
      ) {
        continue;
      }
      return candidate;
    }
  }

  return null;
}

function findDescriptiveLocationRootName(name: string, chapterText: string) {
  const tokens = sanitizeMatchedName(name).split(/\s+/).filter(Boolean);
  if (tokens.length !== 2) {
    return null;
  }

  const [rootName, suffix] = tokens;
  if (!/^(?:Manor|House|Hall|Keep|Castle|Tower)$/i.test(suffix)) {
    return null;
  }

  if (
    new RegExp(
      `\\b${escapeRegExp(rootName)}\\s+itself,\\s+the\\s+[A-Z][A-Za-z'-]+(?:\\s+[A-Z][A-Za-z'-]+){0,3}\\b`,
      "i",
    ).test(chapterText) ||
    hasChapterWideSingleWordEvidence(rootName, "location", chapterText)
  ) {
    return rootName;
  }

  return null;
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
  const cleaned = name
    .replace(/\b(Ms|Mrs|Miss|Mr|Dr|Doctor|Sir|Lady|Lord)\./g, "$1")
    .replace(/^(?:But|Had|Whatever)\s+/i, "")
    .replace(/[.,!?;:]+$/g, "")
    .replace(/['’]s$/i, "")
    .replace(/(?:\s+(?:of|the|and|for))+$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (isNamedEventName(cleaned)) {
    return cleaned.replace(
      /^(?:The\s+)?(?:[A-Z][A-Za-z-]+\s+[A-Z][A-Za-z-]+(?:\s+[A-Z][A-Za-z-]+){0,1})['’]s\s+(?=[A-Z])/,
      "",
    );
  }

  return cleaned;
}

function isLikelyPersonName(name: string) {
  const tokens = name.split(/\s+/).filter(Boolean);
  const trailingToken = tokens.at(-1) ?? "";

  return (
    tokens.length > 1 &&
    !name.startsWith("The ") &&
    !/^(?:Daily|Weekly|Monthly|Quarterly|Gazette|Times|Chronicle|Journal)$/i.test(
      trailingToken,
    ) &&
    !tokens.some((token) => connectorTokens.has(token.toLowerCase())) &&
    !locationSuffixes.some(
      (suffix) => name.endsWith(` ${suffix}`) || name === suffix,
    ) &&
    !organizationSuffixes.some(
      (suffix) => name.endsWith(` ${suffix}`) || name === suffix,
    )
  );
}

function isNamedEventName(name: string) {
  return eventSuffixes.some(
    (suffix) => name.endsWith(` ${suffix}`) || name === suffix,
  );
}

function isBusinessLocationName(name: string) {
  return /\b(?:Booth|Stall|Store|Tavern|Inn|Hearth)\b$/i.test(name);
}

function isCollectivePeopleGroupName(name: string) {
  const stripped = stripLeadingArticle(name);
  const tokens = stripped.split(/\s+/).filter(Boolean);

  return name.startsWith("The ") && tokens.length === 1;
}

function singularizeFamilyCollectiveToken(token: string) {
  if (/ies$/i.test(token)) {
    return token.slice(0, -3) + "y";
  }

  if (/(?:ches|shes|sses|xes|zes)$/i.test(token)) {
    return token.slice(0, -2);
  }

  if (/s$/i.test(token) && !/ss$/i.test(token)) {
    return token.slice(0, -1);
  }

  return token;
}

function isFamilyCollectiveReference(name: string, context: string) {
  if (!name.startsWith("The ")) {
    return false;
  }

  const stripped = stripLeadingArticle(name);
  const tokens = stripped.split(/\s+/).filter(Boolean);
  if (tokens.length !== 1 || organizationContextPattern.test(context)) {
    return false;
  }

  const singularToken = singularizeFamilyCollectiveToken(tokens[0]);
  if (
    !singularToken ||
    singularToken.toLowerCase() === tokens[0].toLowerCase()
  ) {
    return false;
  }

  const existingMatch = getDatabase()
    .prepare(
      `SELECT 1
         FROM entities
        WHERE category = 'character'
          AND (
            lower(name) = lower(?) OR
            lower(name) LIKE lower(?)
          )
        LIMIT 1`,
    )
    .get(singularToken, `% ${singularToken}`);

  return Boolean(existingMatch);
}

function isDemonymModifierFragment(name: string, context: string) {
  const stripped = stripLeadingArticle(name);

  return (
    /^([A-Z][a-z]+(?:an|ian|ean|ish|ese))$/i.test(stripped) &&
    new RegExp(
      `\\b${escapeRegExp(stripped)}\\b\\s+(?:court|army|navy|nobility|people|citizens?|soldiers?|barons?)\\b`,
      "i",
    ).test(context)
  );
}

function expandPossessiveBusinessNameFromChapterContext(
  name: string,
  chapterText: string,
) {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed || !chapterText) {
    return trimmed;
  }

  const occurrenceIndex = chapterText
    .toLowerCase()
    .indexOf(trimmed.toLowerCase());
  if (occurrenceIndex === -1) {
    return trimmed;
  }

  const forwardWindow = chapterText.slice(
    occurrenceIndex,
    occurrenceIndex + 120,
  );
  const possessiveBusinessMatch = new RegExp(
    `^(${escapeRegExp(trimmed)}['’]s)\b[^.\n]{0,40}\b(?:restaurant|bakery|pastry\s+shop|shop|store|tavern|inn|cafe|saloon|stall|booth)\b`,
    "i",
  ).exec(forwardWindow);

  return possessiveBusinessMatch?.[1]?.replace(/\s+/g, " ").trim() ?? trimmed;
}

function expandEntityNameFromChapterContext(
  name: string,
  category: SupportedCategory,
  chapterText: string,
) {
  const trimmed = sanitizeMatchedName(name.trim());

  if (!chapterText || !trimmed || category === "character") {
    return trimmed;
  }

  const occurrenceIndex = chapterText
    .toLowerCase()
    .indexOf(trimmed.toLowerCase());

  if (occurrenceIndex !== -1) {
    const forwardWindow = chapterText.slice(
      occurrenceIndex,
      occurrenceIndex + 120,
    );
    const possessiveBusinessMatch = new RegExp(
      `^(${escapeRegExp(trimmed)}['’]s)\\b[^.\n]{0,40}\\b(?:restaurant|bakery|pastry\\s+shop|shop|store|tavern|inn|cafe|saloon|stall|booth)\\b`,
      "i",
    ).exec(forwardWindow);
    if (possessiveBusinessMatch?.[1]) {
      return possessiveBusinessMatch[1].replace(/\s+/g, " ").trim();
    }

    const backwardWindow = chapterText.slice(
      Math.max(0, occurrenceIndex - 80),
      occurrenceIndex + trimmed.length,
    );
    const leadingPhraseMatch = new RegExp(
      `([A-Z][A-Za-z]+(?:['’][A-Za-z]+)?(?:\\s+(?:[A-Z][A-Za-z]+(?:['’][A-Za-z]+)?|of|the|and|for)){0,6}\\s+${escapeRegExp(trimmed)})$`,
      "i",
    ).exec(backwardWindow);
    if (leadingPhraseMatch?.[1]) {
      return sanitizeMatchedName(leadingPhraseMatch[1]);
    }

    if (!trimmed.includes(" for ")) {
      const titledWorkMatch = new RegExp(
        `^${escapeRegExp(trimmed)}\\s+for\\s+[A-Z][A-Za-z'-]+(?:\\s+[A-Z][A-Za-z'-]+){0,3}\\b`,
        "i",
      ).exec(forwardWindow);
      if (titledWorkMatch?.[0]) {
        return sanitizeMatchedName(titledWorkMatch[0]);
      }
    }
  }

  return trimmed;
}

function expandWorkLikeNameFromChapterContext(
  name: string,
  chapterText: string,
) {
  const sanitizedName = sanitizeMatchedName(name.trim());
  const expandedName = expandEntityNameFromChapterContext(
    sanitizedName,
    "item",
    chapterText,
  );

  if (
    expandedName !== sanitizedName &&
    (expandedName.includes(" of ") ||
      expandedName.includes(" for ") ||
      isNamedEventName(expandedName))
  ) {
    return expandedName;
  }

  return sanitizedName;
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

function hasExistingEntityGrounding(
  entity: ScanResult["entities"][number],
  chapterText: string,
) {
  if (!chapterText) {
    return false;
  }

  if (appearsInChapterText(entity.name, chapterText)) {
    return true;
  }

  if (
    entity.aliases.some((alias) => appearsInChapterText(alias, chapterText))
  ) {
    return true;
  }

  if (entity.category !== "character") {
    return false;
  }

  const tokens = stripTitlePrefix(entity.name)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(
      (token) =>
        token.length > 0 &&
        !connectorTokens.has(token.toLowerCase()) &&
        !singleWordStoplist.has(token) &&
        !bareTitleTokens.has(token),
    );

  if (tokens.length < 2) {
    return false;
  }

  return tokens.some(
    (token) =>
      hasStandaloneSingleWordOccurrence(token, chapterText) &&
      hasChapterWideSingleWordEvidence(token, "character", chapterText),
  );
}

function hasPlausibleTokenShape(name: string) {
  const tokens = name.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return false;
  }

  if (tokens.length === 1) {
    return (
      (isCapitalizedToken(tokens[0]) ||
        /^[A-Z][A-Za-z'-]*['’]s$/.test(tokens[0])) &&
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

function onlyAppearsAsConnectedTitleTail(name: string, chapterText: string) {
  if (!chapterText) {
    return false;
  }

  const pattern = new RegExp(`\\b${escapeRegExp(name)}\\b`, "g");
  let sawMatch = false;

  for (const match of chapterText.matchAll(pattern)) {
    const index = match.index ?? -1;
    if (index < 0) {
      continue;
    }

    sawMatch = true;
    const before = chapterText.slice(Math.max(0, index - 12), index);
    if (!/\b(?:of|for)\s+$/i.test(before)) {
      return false;
    }
  }

  return sawMatch;
}

function onlyAppearsAsLeadingConnectedTitleToken(
  name: string,
  chapterText: string,
) {
  if (!chapterText) {
    return false;
  }

  const pattern = new RegExp(`\\b${escapeRegExp(name)}\\b`, "g");
  let sawMatch = false;

  for (const match of chapterText.matchAll(pattern)) {
    const index = match.index ?? -1;
    if (index < 0) {
      continue;
    }

    sawMatch = true;
    const after = chapterText.slice(
      index + name.length,
      index + name.length + 12,
    );
    if (!/^\s+(?:of|for)\b/i.test(after)) {
      return false;
    }
  }

  return sawMatch;
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

function shouldDropSingleWordCharacterItemTitleCollision(
  entity: ScanResult["entities"][number],
  entities: ScanResult["entities"],
  chapterText: string,
) {
  return (
    entity.category === "character" &&
    entity.name.split(/\s+/).length === 1 &&
    (!hasChapterWideSingleWordEvidence(entity.name, "character", chapterText) ||
      onlyAppearsAsLeadingConnectedTitleToken(entity.name, chapterText)) &&
    entities.some(
      (candidate) =>
        candidate.category === "item" &&
        candidate.name.split(/\s+/).length > 1 &&
        candidate.name
          .toLowerCase()
          .split(/\s+/)
          .includes(entity.name.toLowerCase()),
    )
  );
}

function shouldDropMultiWordCharacterTitleTailCollision(
  entity: ScanResult["entities"][number],
  entities: ScanResult["entities"],
  chapterText: string,
) {
  return (
    entity.category === "character" &&
    entity.name.split(/\s+/).length > 1 &&
    onlyAppearsAsConnectedTitleTail(entity.name, chapterText) &&
    entities.some(
      (candidate) =>
        candidate.category === "item" &&
        candidate.name.endsWith(` ${entity.name}`),
    )
  );
}

function shouldDropCoreNameDuplicate(
  entity: ScanResult["entities"][number],
  entities: ScanResult["entities"],
) {
  const normalizeCore = (value: string) =>
    value
      .replace(
        /^(?:the|mr|mrs|ms|miss|captain|sir|lady|lord|baron|baroness|emperor|empress|prince|princess|professor|master|aunt|uncle)\s+/i,
        "",
      )
      .replace(/['’]s$/i, "")
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

function shouldDropRoleDescriptorCharacter(
  entity: ScanResult["entities"][number],
) {
  return (
    (entity.category === "character" &&
      /^(?:Lady|Lord|Baron|Baroness|Prince|Princess|Duke|Duchess|Count|Countess|Emperor|Empress)\s+of\s+/i.test(
        entity.name,
      )) ||
    (entity.category === "character" &&
      /^(?:Son|Daughter|Wife|Husband)\s+of\s+/i.test(entity.name))
  );
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

function shouldDropCharacterAliasDuplicate(
  entity: ScanResult["entities"][number],
  entities: ScanResult["entities"],
) {
  if (entity.category !== "character") {
    return false;
  }

  const normalizedName = normalizeAliasCandidate(entity.name).toLowerCase();
  if (!normalizedName) {
    return false;
  }

  // Pre-compute this entity's own aliases stripped of annotations for mutual-reference checks
  const entityAliasesStripped = entity.aliases.map((a) =>
    normalizeAliasCandidate(stripAliasAnnotation(a)).toLowerCase(),
  );

  return entities.some((candidate) => {
    if (candidate === entity || candidate.category !== "character") {
      return false;
    }

    return candidate.aliases.some((alias) => {
      const rawNorm = normalizeAliasCandidate(alias).toLowerCase();
      const strippedNorm = normalizeAliasCandidate(
        stripAliasAnnotation(alias),
      ).toLowerCase();

      if (rawNorm !== normalizedName && strippedNorm !== normalizedName) {
        return false;
      }

      // If the alias has an annotation marking this as an assumed/false name,
      // entity is the assumed identity — drop it
      if (aliasAnnotationKeywords.test(alias)) {
        return true;
      }

      // Without annotation: only drop if entity doesn't also list the candidate
      // as one of its own aliases (mutual reference means entity is canonical)
      const candidateNormName = normalizeAliasCandidate(
        candidate.name,
      ).toLowerCase();
      if (entityAliasesStripped.includes(candidateNormName)) {
        return false;
      }

      // If the candidate's own summary identifies it as an assumed/false identity,
      // the candidate is the impostor — do not drop this entity
      if (candidateSummaryIsAssumedIdentity(candidate.summary)) {
        return false;
      }

      return true;
    });
  });
}

function shouldDropAliasDuplicate(
  entity: ScanResult["entities"][number],
  entities: ScanResult["entities"],
) {
  const normalizedName = normalizeAliasCandidate(entity.name).toLowerCase();
  if (!normalizedName) {
    return false;
  }

  // Pre-compute this entity's own aliases stripped of annotations
  const entityAliasesStripped = entity.aliases.map((a) =>
    normalizeAliasCandidate(stripAliasAnnotation(a)).toLowerCase(),
  );

  return entities.some((candidate) => {
    if (candidate === entity || candidate.category !== "character") {
      return false;
    }

    return candidate.aliases.some((alias) => {
      const rawNorm = normalizeAliasCandidate(alias).toLowerCase();
      const strippedNorm = normalizeAliasCandidate(
        stripAliasAnnotation(alias),
      ).toLowerCase();

      if (rawNorm !== normalizedName && strippedNorm !== normalizedName) {
        return false;
      }

      // If the alias is annotated as an assumed/false name → drop entity
      if (aliasAnnotationKeywords.test(alias)) {
        return true;
      }

      // Without annotation: only drop if entity doesn't also list the candidate
      // as one of its own aliases (mutual reference means entity is canonical)
      const candidateNormName = normalizeAliasCandidate(
        candidate.name,
      ).toLowerCase();
      if (entityAliasesStripped.includes(candidateNormName)) {
        return false;
      }

      // If the candidate's own summary identifies it as an assumed/false identity,
      // the candidate is the impostor — do not drop this entity
      if (candidateSummaryIsAssumedIdentity(candidate.summary)) {
        return false;
      }

      return true;
    });
  });
}

function shouldDropItemTitleFragmentDuplicate(
  entity: ScanResult["entities"][number],
  entities: ScanResult["entities"],
) {
  if (entity.category === "character") {
    return false;
  }

  const entityTokens = entity.name.toLowerCase().split(/\s+/).filter(Boolean);
  if (entityTokens.length === 0) {
    return false;
  }

  return entities.some((candidate) => {
    if (
      candidate === entity ||
      candidate.category !== "item" ||
      candidate.name.length <= entity.name.length
    ) {
      return false;
    }

    const candidateTokens = candidate.name
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    return entityTokens.every((token) => candidateTokens.includes(token));
  });
}

function mergeCanonicalDuplicateEntities(entities: ScanResult["entities"]) {
  const merged = new Map<string, ScanResult["entities"][number]>();

  for (const entity of entities) {
    const key = `${entity.category}:${entity.name.trim().toLowerCase()}`;
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, entity);
      continue;
    }

    const aliasSet = new Set([...existing.aliases, ...entity.aliases]);
    aliasSet.delete(existing.name);
    aliasSet.delete(entity.name);

    const linkSet = new Set(
      [...existing.links, ...entity.links].map((link) => JSON.stringify(link)),
    );

    merged.set(key, {
      ...existing,
      itemSubtype: existing.itemSubtype ?? entity.itemSubtype,
      summary:
        entity.summary.length > existing.summary.length
          ? entity.summary
          : existing.summary,
      isStub: existing.isStub && entity.isStub,
      aliases: [...aliasSet],
      links: [...linkSet].map((value) => JSON.parse(value)),
    });
  }

  return [...merged.values()];
}

function hasStrongSingleWordEvidence(
  name: string,
  category: SupportedCategory,
  context: string,
) {
  if (category !== "item" && hasBlockedSingleWordTokenRole(name, context)) {
    return false;
  }

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
    const strippedName = stripLeadingArticle(sanitizeMatchedName(name));
    if (
      strippedName &&
      new RegExp(
        `\\b${escapeRegExp(strippedName)}\\s+itself,\\s+the\\s+[A-Z][A-Za-z'-]+(?:\\s+[A-Z][A-Za-z'-]+){0,3}\\b`,
        "i",
      ).test(context)
    ) {
      return true;
    }

    return parseSentencesWithGrammar(context).some((sentence) =>
      hasLocationSentenceRole(name, sentence),
    );
  }

  if (category === "character") {
    if (isNamedAnimalReference(name, context)) {
      return true;
    }

    return parseSentencesWithGrammar(context).some((sentence) =>
      hasHumanSentenceRole(name, sentence),
    );
  }

  return false;
}

function isAnimalKindName(name: string) {
  const tokens = name
    .trim()
    .split(/\s+/)
    .map((token) => normalizeSentenceValue(token))
    .filter(Boolean);

  if (tokens.length === 0) {
    return false;
  }

  const lastToken = tokens[tokens.length - 1];
  return (
    fantasticalCreatureNouns.includes(lastToken) ||
    (tokens.length > 1 && animalSpeciesNouns.includes(lastToken))
  );
}

function isPlantKindName(name: string) {
  const tokens = name
    .trim()
    .split(/\s+/)
    .map((token) => normalizeSentenceValue(token))
    .filter(Boolean);

  if (tokens.length < 2) {
    return false;
  }

  const lastToken = tokens[tokens.length - 1];
  return plantSpeciesNouns.includes(lastToken);
}

function isNamedAnimalReference(name: string, context: string) {
  const escapedName = escapeRegExp(name);
  const mountPattern = mountContextNouns.join("|");
  const animalPattern = animalSpeciesNouns.join("|");

  return (
    new RegExp(
      `\\b(?:his|her|their|a|an|the|bay|black|brown|white|gray|grey|golden|cremello)\\s+(?:${mountPattern}|${animalPattern})\\s*,?\\s*${escapedName}\\b`,
      "i",
    ).test(context) ||
    new RegExp(
      `\\b${escapedName}\\b[^.\\n]{0,24}\\b(?:${mountPattern}|${animalPattern})\\b`,
      "i",
    ).test(context) ||
    new RegExp(
      `\\b(?:rode|rides|riding|mounted|mounts|mounting|hopped\\s+onto|climbed\\s+onto|got\\s+onto|swung\\s+onto|astride|unhitched)\\b[^.\\n]{0,24}\\b${escapedName}\\b`,
      "i",
    ).test(context) ||
    new RegExp(
      `\\b${escapedName}\\b[^.\\n]{0,24}\\b(?:trotting|galloping|cantering|whinnying|snorting|neighing)\\b`,
      "i",
    ).test(context)
  );
}

function inferItemSubtype(name: string, context: string) {
  if (isNamedEventName(name)) {
    return "Events" as const;
  }

  if (hasPublicationOrWorkContext(name, context)) {
    return "Publications" as const;
  }

  if (hasVehicleContext(name, context)) {
    return "Vehicles" as const;
  }

  if (isAnimalKindName(name)) {
    return "Animals" as const;
  }

  if (isPlantKindName(name)) {
    return "Plants" as const;
  }

  if (hasBeverageContext(name, context)) {
    return "Other" as const;
  }

  return null;
}

function hasBlockedSingleWordTokenRole(name: string, context: string) {
  if (!context || name.trim().split(/\s+/).length !== 1) {
    return false;
  }

  return parseSentencesWithGrammar(context).some((sentence) => {
    const match = findReferenceMatch(sentence, name);
    if (!match) {
      return false;
    }

    const hasExplicitProperNameTag = match.terms.some((term) =>
      Array.from(explicitProperNameTags).some((tag) => term.tags.has(tag)),
    );
    const hasBlockedTag = match.terms.some((term) =>
      Array.from(blockedSingleWordEntityTags).some((tag) => term.tags.has(tag)),
    );

    return hasBlockedTag && !hasExplicitProperNameTag;
  });
}

function hasPublicationOrWorkContext(name: string, context: string) {
  const escapedName = escapeRegExp(name);
  const publicationNouns =
    "serials?|stories?|books?|novels?|articles?|columns?|publications?|periodicals?|newspapers?|papers?|magazines?|journals?";
  const periodicalTail = name.split(/\s+/).at(-1) ?? "";
  const looksLikePeriodicalTitle =
    /^(?:Daily|Weekly|Monthly|Quarterly|Gazette|Times|Chronicle|Journal)$/i.test(
      periodicalTail,
    );

  return (
    new RegExp(
      `\\b(?:${publicationNouns})\\b[^.\\n]{0,40}\\bin\\s+${escapedName}\\b`,
      "i",
    ).test(context) ||
    new RegExp(
      `\\b(?:${publicationNouns})\\b[^.\\n]{0,40}\\b(?:called|titled|named)\\s+${escapedName}\\b`,
      "i",
    ).test(context) ||
    new RegExp(
      `\\b(?:${publicationNouns}|issues?)\\b[^.\\n]{0,20}${escapedName}\\b`,
      "i",
    ).test(context) ||
    new RegExp(
      `\\b(?:in|from|inside|within)\\s+${escapedName}\\b[^.\\n]{0,40}\\b(?:${publicationNouns}|issues?)\\b`,
      "i",
    ).test(context) ||
    new RegExp(
      `\\b${escapedName}\\b[^.\\n]{0,40}\\b(?:publications?|periodicals?|newspapers?|papers?|magazines?|journals?)\\b`,
      "i",
    ).test(context) ||
    new RegExp(
      `\\b(?:books?|novels?|stories?|serials?|periodicals?|publications?)\\b[^.\\n]{0,40}\\b(?:in|of|from|called|titled|named)?\\s*${escapedName}\\b`,
      "i",
    ).test(context) ||
    new RegExp(
      `\\b(?:printing|issue|edition|release|released)\\b[^.\\n]{0,20}\\b(?:of\\s+)?${escapedName}\\b`,
      "i",
    ).test(context) ||
    new RegExp(
      `\\b(?:reading|symbolism|metaphor)\\b[^.\\n]{0,12}\\b(?:in|of|from)\\s+${escapedName}\\b`,
      "i",
    ).test(context) ||
    new RegExp(
      `\\b(?:reading|symbolism|metaphor)\\b[^.\\n]{0,60}\\bin\\s+${escapedName}\\b`,
      "i",
    ).test(context) ||
    new RegExp(
      `\\b${escapedName}\\b[^.\\n]{0,40}\\b(?:books?|novels?|stories?|serials?|periodicals?|publications?)\\b`,
      "i",
    ).test(context) ||
    (looksLikePeriodicalTitle &&
      new RegExp(
        `\\b(?:opened|bought|purchased|read|reading)\\b[^.\\n]{0,20}\\b(?:the\\s+)?(?:new\\s+)?${escapedName}\\b`,
        "i",
      ).test(context))
  );
}

function hasVehicleContext(name: string, context: string) {
  if (!name || !context) {
    return false;
  }

  const escapedName = escapeRegExp(name);
  const vehicleNouns =
    "ships?|boats?|vessels?|carriages?|wagons?|coaches?|carts?|buggies|trains?|locomotives?|automobiles?|vehicles?";

  return (
    new RegExp(
      `\b(?:${vehicleNouns})\b[^.\n]{0,40}\b${escapedName}\b`,
      "i",
    ).test(context) ||
    new RegExp(
      `\b${escapedName}\b[^.\n]{0,40}\b(?:${vehicleNouns})\b`,
      "i",
    ).test(context) ||
    new RegExp(
      `\bsister\s+ship\b[^.\n]{0,20}\b${escapedName}\b|\b${escapedName}\b[^.\n]{0,20}\bsister\s+ship\b`,
      "i",
    ).test(context)
  );
}

function hasBeverageContext(name: string, context: string) {
  if (!name || !context) {
    return false;
  }

  const escapedName = escapeRegExp(name);
  const beverageNouns =
    "whiskey|whisky|bourbon|scotch|brandy|rum|gin|vodka|ale|beer|mead|wine|liquor|spirits?|cocktails?|drinks?";

  return (
    new RegExp(
      `\\b${escapedName}['’]s\\b[^.\\n]{0,24}\\b(?:${beverageNouns})\\b`,
      "i",
    ).test(context) ||
    new RegExp(
      `\\b(?:${beverageNouns})\\b[^.\\n]{0,24}\\b${escapedName}['’]s\\b`,
      "i",
    ).test(context) ||
    new RegExp(
      `\\b${escapedName}\\b[^.\\n]{0,24}\\b(?:${beverageNouns})\\b`,
      "i",
    ).test(context)
  );
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
  const looksLikePersonName = isLikelyPersonName(name);
  const hasStrongItemEvidence =
    tokens.length === 1
      ? hasStrongSingleWordEvidence(name, "item", context)
      : false;
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

  if (isNamedAnimalReference(name, context)) {
    return "character";
  }

  if (isAnimalKindName(name)) {
    return "item";
  }

  if (isPlantKindName(name)) {
    return "item";
  }

  if (isNamedEventName(name)) {
    return "item";
  }

  if (tokens.length === 1 && hasBlockedSingleWordTokenRole(name, context)) {
    return null;
  }

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

  // "Lisa Britton's House" / "John's Office" → location, not character
  if (
    new RegExp(
      `['']s\\s+(?:${possessiveLocationNouns.join("|")})\\s*$`,
      "i",
    ).test(name)
  ) {
    return "location";
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

  if (looksLikePersonName && hasCharacterCue) {
    return "character";
  }

  if (isDemonymModifierFragment(name, context)) {
    return null;
  }

  if (isFamilyCollectiveReference(name, context)) {
    return null;
  }

  if (hasPublicationOrWorkContext(name, context)) {
    return "item";
  }

  if (hasBeverageContext(name, context)) {
    return "item";
  }

  if (isBusinessLocationName(name)) {
    return "location";
  }

  if (isCollectivePeopleGroupName(name)) {
    return "organization";
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

  function hasAliasAwareOpeningCharacterFocus(
    entity: ScanResult["entities"][number],
    chapterText: string,
  ) {
    const firstParagraph = getFirstNonEmptyParagraph(chapterText);
    if (!firstParagraph) {
      return false;
    }

    const referenceNames = [entity.name, ...entity.aliases]
      .map((value) => value.trim())
      .filter(Boolean);
    const referenceCandidates = [
      ...new Set(
        referenceNames.flatMap((value) =>
          buildCharacterReferenceCandidates(value),
        ),
      ),
    ].sort((left, right) => right.length - left.length);

    if (referenceCandidates.length === 0) {
      return false;
    }

    const firstReferenceIndex = findFirstCharacterReferenceIndex(
      entity.name,
      firstParagraph,
    );
    if (
      firstReferenceIndex === null ||
      firstReferenceIndex > maxOpeningPovReferenceDistance
    ) {
      return false;
    }

    const openingWindow = firstParagraph.slice(
      firstReferenceIndex,
      firstReferenceIndex + 700,
    );
    const explicitMentionCount =
      openingWindow.match(
        new RegExp(
          `\\b(?:${referenceCandidates.map((candidate) => escapeRegExp(candidate)).join("|")})\\b`,
          "gi",
        ),
      )?.length ?? 0;
    const pronounCount =
      openingWindow.match(/\b(?:he|him|his|she|her|hers)\b/gi)?.length ?? 0;
    const openingCueWindow = openingWindow.slice(0, 260);
    const hasFocusCue =
      hasAppearanceDetailCue(openingCueWindow) ||
      hasOutfitDetailCue(openingCueWindow) ||
      /\b(thought|wondered|knew|hoped|missed|wanted|liked|loved|hated|felt|remembered)\b/i.test(
        openingCueWindow,
      );

    return (
      hasFocusCue &&
      explicitMentionCount >= 1 &&
      (explicitMentionCount >= 2 || pronounCount >= 2)
    );
  }
  const pointOfViewEligible =
    entity.category === "character" &&
    !entity.isStub &&
    !isNamedAnimalReference(entity.name, chapterText) &&
    !/\b(?:animal|horse|mare|stallion|mount|steed|hound|dog|cat|wolf|bird)\b/i.test(
      normalizedSummary,
    );
  const hasOnlyReportedMentions = chapterHasOnlyReportedCharacterMentions(
    entity.name,
    chapterText,
  );
  const hasValidatedPointOfViewEvidence =
    !hasOnlyReportedMentions &&
    pointOfViewEligible &&
    (isLikelyPointOfViewCharacter(entity.name, chapterText) ||
      hasAliasAwareOpeningCharacterFocus(entity, chapterText));

  if (
    pointOfViewEligible &&
    summaryHasExplicitMainCharacterCue(normalizedSummary) &&
    !hasValidatedPointOfViewEvidence
  ) {
    normalizedSummary = removeUnsupportedPointOfViewCue(normalizedSummary);
  }

  if (
    pointOfViewEligible &&
    !summaryHasExplicitMainCharacterCue(normalizedSummary) &&
    hasValidatedPointOfViewEvidence
  ) {
    normalizedSummary = addPointOfViewCueToCharacterSummary(normalizedSummary);
  }

  const rawName = entity.name.trim();
  const rawNameMatch = findFirstNameMatch(rawName, chapterText);
  const expandedWorkLikeName = expandWorkLikeNameFromChapterContext(
    rawName,
    chapterText,
  );
  const sanitizedRawName = sanitizeMatchedName(rawName);
  let normalizedName =
    entity.category === "character"
      ? expandedWorkLikeName !== sanitizedRawName &&
        !isLikelyPersonName(sanitizedRawName)
        ? expandedWorkLikeName
        : normalizeCharacterName(entity.name)
      : expandEntityNameFromChapterContext(
          entity.name,
          entity.category,
          chapterText,
        );

  if (entity.category !== "character" && rawNameMatch?.snippet) {
    const titledWorkMatch = new RegExp(
      `\\b${escapeRegExp(rawName)}\\s+for\\s+[A-Z][A-Za-z'-]+(?:\\s+[A-Z][A-Za-z'-]+){0,3}\\b`,
      "i",
    ).exec(rawNameMatch.snippet);
    if (titledWorkMatch?.[0]) {
      normalizedName = sanitizeMatchedName(titledWorkMatch[0]);
    }

    if (entity.category === "location") {
      const appositiveCanonicalName = findAppositiveLocationCanonicalName(
        rawName,
        rawNameMatch.snippet,
      );
      if (appositiveCanonicalName) {
        normalizedName = appositiveCanonicalName;
      }
    }
  }

  if (entity.category === "location") {
    const descriptiveRootName = findDescriptiveLocationRootName(
      normalizedName,
      chapterText,
    );
    if (descriptiveRootName) {
      normalizedName = descriptiveRootName;
    }
  }

  const matchForSubtype = findFirstNameMatch(normalizedName, chapterText);
  const inferredItemSubtype =
    entity.category === "item"
      ? inferItemSubtype(normalizedName, matchForSubtype?.snippet ?? "")
      : null;
  const normalizedItemSubtype =
    entity.category === "item"
      ? entity.itemSubtype && entity.itemSubtype !== "Other"
        ? entity.itemSubtype
        : (inferredItemSubtype ?? entity.itemSubtype)
      : null;
  const normalizedEntity =
    normalizedName === entity.name &&
    normalizedSummary === entity.summary &&
    (entity.itemSubtype ?? null) === normalizedItemSubtype &&
    JSON.stringify(
      normalizeEntityAliases(entity.aliases, normalizedName, entity.category),
    ) === JSON.stringify(entity.aliases)
      ? entity
      : {
          ...entity,
          name: normalizedName,
          summary: normalizedSummary,
          aliases: normalizeEntityAliases(
            entity.aliases,
            normalizedName,
            entity.category,
          ),
          itemSubtype: normalizedItemSubtype,
        };

  const match = findFirstNameMatch(normalizedEntity.name, chapterText);
  const hasCharacterEvidence =
    normalizedEntity.aliases.length > 0 || normalizedEntity.links.length > 0;
  const inferredCategory = match
    ? (inferCategory(normalizedEntity.name, match.snippet) ??
      inferCategory(normalizedEntity.name, chapterText))
    : inferCategory(normalizedEntity.name, chapterText);
  const publicationContext =
    hasPublicationOrWorkContext(normalizedEntity.name, match?.snippet ?? "") ||
    hasPublicationOrWorkContext(normalizedEntity.name, chapterText);
  const vehicleContext =
    hasVehicleContext(normalizedEntity.name, match?.snippet ?? "") ||
    hasVehicleContext(normalizedEntity.name, chapterText);
  const beverageContext =
    hasBeverageContext(normalizedEntity.name, match?.snippet ?? "") ||
    hasBeverageContext(normalizedEntity.name, chapterText);
  const namedAnimalContext =
    isNamedAnimalReference(normalizedEntity.name, match?.snippet ?? "") ||
    isNamedAnimalReference(normalizedEntity.name, chapterText);
  const strongHumanContext =
    isLikelyPersonName(normalizedEntity.name) &&
    parseSentencesWithGrammar(match?.snippet ?? "").some((sentence) =>
      hasHumanSentenceRole(normalizedEntity.name, sentence),
    );

  if (namedAnimalContext && normalizedEntity.category !== "character") {
    return applyUserCanonDecisionToEntity({
      ...normalizedEntity,
      category: "character",
      itemSubtype: null,
    });
  }

  if (
    publicationContext &&
    !strongHumanContext &&
    (!isLikelyPersonName(normalizedEntity.name) ||
      normalizedEntity.category === "item")
  ) {
    return applyUserCanonDecisionToEntity({
      ...normalizedEntity,
      category: "item",
      itemSubtype:
        normalizedEntity.itemSubtype ??
        inferItemSubtype(normalizedEntity.name, match?.snippet ?? "") ??
        "Publications",
    });
  }

  if (
    vehicleContext &&
    !strongHumanContext &&
    normalizedEntity.category !== "character"
  ) {
    return applyUserCanonDecisionToEntity({
      ...normalizedEntity,
      category: "item",
      itemSubtype: normalizedEntity.itemSubtype ?? "Vehicles",
    });
  }

  if (
    beverageContext &&
    !strongHumanContext &&
    normalizedEntity.category !== "character"
  ) {
    return applyUserCanonDecisionToEntity({
      ...normalizedEntity,
      category: "item",
      itemSubtype:
        normalizedEntity.itemSubtype ??
        inferItemSubtype(normalizedEntity.name, chapterText),
    });
  }

  if (
    normalizedEntity.category === "item" &&
    normalizedEntity.itemSubtype &&
    normalizedEntity.itemSubtype !== "Other" &&
    inferredCategory &&
    inferredCategory !== "item"
  ) {
    return applyUserCanonDecisionToEntity(normalizedEntity);
  }

  if (
    normalizedEntity.category === "location" &&
    normalizedEntity.name.split(/\s+/).length === 1 &&
    hasChapterWideSingleWordEvidence(
      normalizedEntity.name,
      "location",
      chapterText,
    ) &&
    !hasChapterWideSingleWordEvidence(
      normalizedEntity.name,
      "character",
      chapterText,
    )
  ) {
    return applyUserCanonDecisionToEntity(normalizedEntity);
  }

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

  if (
    normalizedEntity.category === "item" &&
    inferredCategory === "character" &&
    (normalizedEntity.itemSubtype === "Publications" ||
      inferredItemSubtype === "Publications" ||
      publicationContext) &&
    !namedAnimalContext &&
    !strongHumanContext
  ) {
    return applyUserCanonDecisionToEntity(normalizedEntity);
  }

  // For single-word names, only override the API's category if there is
  // chapter-wide strong evidence for the inferred category. A single-snippet
  // inference is not reliable enough to outweigh what the API returned.
  // Multi-word names have sufficient morphological signal to rely on inference.
  const isSingleWordName = normalizedEntity.name.split(/\s+/).length === 1;
  const inferredCategoryHasStrongSupport =
    !isSingleWordName ||
    hasChapterWideSingleWordEvidence(
      normalizedEntity.name,
      inferredCategory!,
      chapterText,
    );

  if (
    inferredCategory &&
    inferredCategory !== normalizedEntity.category &&
    inferredCategoryHasStrongSupport
  ) {
    return applyUserCanonDecisionToEntity({
      ...normalizedEntity,
      category: inferredCategory,
      itemSubtype:
        inferredCategory === "item"
          ? (normalizedEntity.itemSubtype ??
            inferItemSubtype(normalizedEntity.name, match?.snippet ?? ""))
          : null,
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
      .split(/\n\s*\n+/)
      .map((segment) => segment.replace(/\s+/g, " ").trim())
      .find((segment) => Boolean(segment) && !/^#\s+/.test(segment)) ?? ""
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

function hasReportedReferenceCue(text: string, name: string) {
  const firstReferenceIndex = findFirstCharacterReferenceIndex(name, text);
  if (firstReferenceIndex === null) {
    return false;
  }

  const leadingWindow = text.slice(
    Math.max(0, firstReferenceIndex - 60),
    firstReferenceIndex,
  );
  const trailingWindow = text.slice(
    firstReferenceIndex,
    firstReferenceIndex + 80,
  );

  return (
    /\b(?:said|says|tell|told|heard|hear|hears|hearing|swore|sworn|claimed|claim|claims|rumor|rumors|named|name|mention|mentioned|mentions|agreed|agree|asked|ask|asks|shouted|yelled|whispered|blamed|blame)\b/i.test(
      leadingWindow,
    ) ||
    /\b(?:what|why|whether)\b/i.test(leadingWindow) ||
    /\bworking\s+for\b/i.test(leadingWindow) ||
    /["“”]/i.test(text) ||
    /\b(?:made\s+(?:me|him|her|them)|paid\s+(?:him|her|them)|wanted|want(?:ed|s)?)\b/i.test(
      trailingWindow,
    )
  );
}

function chapterHasOnlyReportedCharacterMentions(
  name: string,
  chapterText: string,
) {
  const mentioningSentences = parseSentencesWithGrammar(chapterText).filter(
    (sentence) => sentenceMentionsCharacterReference(sentence.text, name),
  );

  if (mentioningSentences.length === 0) {
    return false;
  }

  return mentioningSentences.every(
    (sentence) =>
      hasReportedReferenceCue(sentence.text, name) &&
      !hasAppearanceDetailCue(sentence.text) &&
      !hasOwnedOutfitDetail(sentence.text, true),
  );
}

function hasOpeningNarrativePovThread(
  name: string,
  firstParagraph: string,
  firstReferenceIndex: number,
) {
  const openingWindow = firstParagraph.slice(
    firstReferenceIndex,
    firstReferenceIndex + 700,
  );
  const candidates = buildCharacterReferenceCandidates(name).sort(
    (left, right) => right.length - left.length,
  );
  const explicitMentionCount =
    openingWindow.match(
      new RegExp(
        `\\b(?:${candidates.map((candidate) => escapeRegExp(candidate)).join("|")})\\b`,
        "gi",
      ),
    )?.length ?? 0;
  const pronounFollowUpCount =
    openingWindow.match(/\b(?:he|him|his|she|her|hers)\b/gi)?.length ?? 0;
  const detailSignalCount = [
    hasAppearanceDetailCue(openingWindow),
    hasOutfitDetailCue(openingWindow),
    /\b(thought|wondered|knew|hoped|missed|wanted|liked|loved|hated|felt|remembered)\b/i.test(
      openingWindow,
    ),
  ].filter(Boolean).length;

  if (hasReportedReferenceCue(openingWindow, name)) {
    return false;
  }

  return (
    explicitMentionCount >= 1 &&
    (pronounFollowUpCount >= 2 || explicitMentionCount >= 2) &&
    detailSignalCount >= 1
  );
}

function countCharacterReferenceHits(name: string, chapterText: string) {
  return buildCharacterReferenceCandidates(name).reduce((count, candidate) => {
    const matches = chapterText.match(
      new RegExp(`\\b${escapeRegExp(candidate)}\\b`, "gi"),
    );
    return count + (matches?.length ?? 0);
  }, 0);
}

function findFirstCharacterReferenceIndex(name: string, text: string) {
  let earliestIndex = Number.POSITIVE_INFINITY;

  for (const candidate of buildCharacterReferenceCandidates(name)) {
    const match = new RegExp(`\\b${escapeRegExp(candidate)}\\b`, "i").exec(
      text,
    );
    if (match?.index !== undefined) {
      earliestIndex = Math.min(earliestIndex, match.index);
    }
  }

  return Number.isFinite(earliestIndex) ? earliestIndex : null;
}

function isLikelyPointOfViewCharacter(name: string, chapterText: string) {
  if (!chapterText) {
    return false;
  }

  const firstParagraph = getFirstNonEmptyParagraph(chapterText);
  const firstParagraphSentences = parseSentencesWithGrammar(firstParagraph);
  const firstReferenceIndex = findFirstCharacterReferenceIndex(
    name,
    firstParagraph,
  );

  if (
    firstReferenceIndex === null ||
    firstReferenceIndex > maxOpeningPovReferenceDistance
  ) {
    return false;
  }

  const hasFallbackPovThread = hasOpeningNarrativePovThread(
    name,
    firstParagraph,
    firstReferenceIndex,
  );

  const openingReferenceIndex = firstParagraphSentences.findIndex((sentence) =>
    sentenceMentionsCharacterReference(sentence.text, name),
  );

  if (openingReferenceIndex === -1 || openingReferenceIndex > 2) {
    return hasFallbackPovThread;
  }

  const openingReferenceSentence =
    firstParagraphSentences[openingReferenceIndex];
  if (!openingReferenceSentence) {
    return hasFallbackPovThread;
  }

  if (hasReportedReferenceCue(openingReferenceSentence.text, name)) {
    return false;
  }

  const openingSentenceVerbs = getNormalizedVerbTokens(
    openingReferenceSentence,
  );
  const openingSentenceSupportsPov =
    subjectEndsWithReference(openingReferenceSentence, name) ||
    hasAppearanceDetailCue(openingReferenceSentence.text) ||
    hasOwnedOutfitDetail(openingReferenceSentence.text, true);

  if (
    !openingSentenceSupportsPov &&
    !openingSentenceVerbs.some((verb) => humanActionVerbs.has(verb))
  ) {
    return hasFallbackPovThread;
  }

  let activeReferenceThread = false;
  const relevantSentences: Array<{
    sentence: string;
    mentionsCharacter: boolean;
  }> = [];

  for (const parsedSentence of firstParagraphSentences.slice(
    openingReferenceIndex,
  )) {
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
    return hasFallbackPovThread;
  }

  const mentionCount = relevantSentences.filter(
    ({ mentionsCharacter }) => mentionsCharacter,
  ).length;
  const pronounFollowUpCount = relevantSentences.filter(
    ({ mentionsCharacter, sentence }) =>
      !mentionsCharacter && sentenceHasCharacterPronoun(sentence),
  ).length;

  if (mentionCount < 1 || (pronounFollowUpCount < 1 && mentionCount < 2)) {
    return hasFallbackPovThread;
  }

  const hasFirstParagraphCharacterSignal = relevantSentences.some(
    ({ sentence, mentionsCharacter }) =>
      sentenceHasCharacterPronoun(sentence) ||
      hasAppearanceDetailCue(sentence) ||
      hasOwnedOutfitDetail(sentence, mentionsCharacter),
  );

  if (!hasFirstParagraphCharacterSignal) {
    return hasFallbackPovThread;
  }

  return (
    countCharacterReferenceHits(name, chapterText) >= 2 || hasFallbackPovThread
  );
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

  if (category === "location") {
    return [
      `# ${name}`,
      "",
      "## Core Status",
      "- Type: Location",
      "- Region / jurisdiction: Missing / unestablished",
      "- First appearance: Current chapter snapshot",
      "- Canon status: Unconfirmed",
      "",
      "## Description",
      "### Confirmed physical details",
      `- Current chapter snapshot: ${snippet || `${name} is named in the current chapter snapshot.`}`,
      "### Probable / inferred",
      "- None beyond the directly supported chapter wording yet.",
      "### Missing / unestablished",
      "- Fuller physical, political, social, and event-related details require later confirmation.",
      "",
      "## Function in Story",
      "- Who controls it: Missing / unestablished",
      "- Who frequents it: Missing / unestablished",
      `- Narrative significance: ${name} is referenced in the current chapter snapshot.`,
      "",
      "## Notable Events",
      "- Current chapter snapshot: Mentioned or on-page, but event detail remains thin.",
      "",
      "## Associated Characters",
      "- Missing / unestablished",
      "",
      "## Layout / Spatial Notes",
      "- Entrances/exits: Missing / unestablished",
      "- Important rooms/areas: Missing / unestablished",
      "- Sightlines / travel logic: Missing / unestablished",
      "- Security / hazards: Missing / unestablished",
      "",
      "## Changes Over Time",
      "- No chapter-local change over time established yet.",
      "",
      "## Contradictions / Ambiguities",
      "- None yet, but details remain thin.",
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

    if (!normalized) {
      return false;
    }

    const matchesCurrentEntities = [
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

      if (entity.category === "organization") {
        // "The Empire" → matches "Andrittan Empire" (article-stripped suffix word overlap)
        const candidateStripped = stripLeadingArticle(normalized);
        const entityTokens = entity.name
          .trim()
          .toLowerCase()
          .split(/\s+/)
          .filter(Boolean);
        if (
          candidateStripped &&
          entityTokens.some((t) => t === candidateStripped)
        ) {
          return true;
        }
        return false;
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

    if (matchesCurrentEntities) {
      return true;
    }

    if (existingEntitySlugs.has(slug)) {
      return false;
    }

    return false;
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
    const resolvedName =
      resolvedCategory === "location"
        ? expandPossessiveBusinessNameFromChapterContext(cleaned, chapterText)
        : cleaned;
    const canonicalName = upgradeKey
      ? (found.get(upgradeKey)?.name ?? resolvedName)
      : resolvedName;
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
      (cleaned.split(/\s+/).length === 1 &&
        hasBlockedSingleWordTokenRole(cleaned, snippet)) ||
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
      shouldDropCoreNameDuplicate(
        {
          name: cleaned,
          category: resolvedCategory,
          summary: "",
          isStub: true,
          aliases: [],
          links: [],
        },
        [...existingEntities, ...Array.from(found.values())],
      ) ||
      shouldDropHonorificSurnameDuplicate(
        {
          name: cleaned,
          category: resolvedCategory,
          summary: "",
          isStub: true,
          aliases: [],
          links: [],
        },
        [...existingEntities, ...Array.from(found.values())],
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

    const supplementalCandidate: ScanResult["entities"][number] = {
      name: canonicalName,
      category: resolvedCategory,
      itemSubtype:
        resolvedCategory === "item"
          ? inferItemSubtype(canonicalName, snippet)
          : null,
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
    };

    const entity = applyUserCanonDecisionToEntity(supplementalCandidate);

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
    /\b(?:The\s+)?(?:Ms\.|Mrs\.|Miss|Mr\.|Dr\.|Doctor|Sir|Lady|Lord|[A-Z][A-Za-z]+(?:['’][A-Za-z]+)?)(?:\s+(?:Ms\.|Mrs\.|Miss|Mr\.|Dr\.|Doctor|Sir|Lady|Lord|[A-Z][A-Za-z]+(?:['’][A-Za-z]+)?|of|the|and|for))*\b/g;
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

  // Build slug-keyed lookups from the raw parsed output so that fields which
  // survive the model response can be restored onto final entities even if
  // the normalisation pipeline drops or replaces the originating entity object
  // (e.g. when expandEntityNameFromChapterContext produces a long form that
  // fails the grounding check, causing a supplemental stub to be injected).
  const parentLocationBySlug = new Map<string, string | null>();
  const linksBySlug = new Map<
    string,
    ScanResult["entities"][number]["links"]
  >();
  for (const entity of parsed.entities) {
    const slug = makeSlug(entity.name);
    if (entity.category === "location" && "parentLocationName" in entity) {
      parentLocationBySlug.set(slug, entity.parentLocationName ?? null);
    }
    if (entity.links.length > 0) {
      linksBySlug.set(slug, entity.links);
    }
  }

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
    const existingEntityGrounding = hasExistingEntityGrounding(
      entity,
      chapterText,
    );
    const hasStandaloneSingleWord =
      entity.name.split(/\s+/).length === 1
        ? hasStandaloneSingleWordOccurrence(entity.name, chapterText)
        : true;

    if (
      (entity.category === "item" &&
        ["Animals", "Plants"].includes(entity.itemSubtype ?? "") &&
        !existingEntitySlugs.has(makeSlug(entity.name)) &&
        !isAnimalKindName(entity.name) &&
        !isPlantKindName(entity.name)) ||
      shouldDropMultiWordCharacterTitleTailCollision(
        entity,
        dedupedEntities,
        chapterText,
      ) ||
      !hasPlausibleTokenShape(entity.name) ||
      shouldDropAsPartialDuplicate(entity, dedupedEntities) ||
      shouldDropCoreNameDuplicate(entity, dedupedEntities) ||
      shouldDropRoleDescriptorCharacter(entity) ||
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
      shouldDropSingleWordCharacterItemTitleCollision(
        entity,
        dedupedEntities,
        chapterText,
      ) ||
      shouldDropCharacterAliasDuplicate(entity, dedupedEntities) ||
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
      (existingEntitySlugs.has(makeSlug(entity.name)) &&
        existingEntityGrounding)
    );
  });

  const groundedEntitiesWithAliases = chapterText
    ? enrichCharacterAliasesFromContext(groundedEntities, chapterText)
    : groundedEntities;

  const groundedEntitiesWithoutAliasDuplicates =
    groundedEntitiesWithAliases.filter(
      (entity) =>
        !shouldDropAliasDuplicate(entity, groundedEntitiesWithAliases),
    );

  const supplementedEntities = chapterText
    ? collectSupplementalEntities(
        chapterText,
        groundedEntitiesWithoutAliasDuplicates,
        existingEntitySlugs,
      )
    : [];

  const allEntities = [
    ...groundedEntitiesWithoutAliasDuplicates,
    ...supplementedEntities,
  ];
  const finalEntitiesWithAliases = chapterText
    ? mergeAppositiveLocationEntities(
        enrichCharacterAliasesFromContext(allEntities, chapterText),
        chapterText,
      )
    : allEntities;
  const finalEntities = finalEntitiesWithAliases.filter(
    (entity) =>
      !shouldDropAliasDuplicate(entity, finalEntitiesWithAliases) &&
      !shouldDropCoreNameDuplicate(entity, finalEntitiesWithAliases) &&
      !shouldDropRoleDescriptorCharacter(entity) &&
      !shouldDropSingleWordCharacterItemTitleCollision(
        entity,
        finalEntitiesWithAliases,
        chapterText,
      ) &&
      !shouldDropMultiWordCharacterTitleTailCollision(
        entity,
        finalEntitiesWithAliases,
        chapterText,
      ) &&
      !shouldDropItemTitleFragmentDuplicate(entity, finalEntitiesWithAliases),
  );

  return {
    ...parsed,
    entities: mergeCanonicalDuplicateEntities(finalEntities).map((entity) => {
      const slug = makeSlug(entity.name);
      let result = entity;

      // Restore parentLocationName if it was lost during normalization passes.
      if (entity.category === "location" && !("parentLocationName" in entity)) {
        const pln = parentLocationBySlug.get(slug);
        if (pln !== undefined) {
          result = { ...result, parentLocationName: pln };
        }
      }

      // Restore links if the normalization pipeline dropped them (e.g. when the
      // original provider entity was replaced by a supplemental stub with links: []).
      if (result.links.length === 0) {
        const restored = linksBySlug.get(slug);
        if (restored && restored.length > 0) {
          result = { ...result, links: restored };
        }
      }

      return result;
    }),
  };
}

export interface ComparisonPacketEntity {
  canonicalName: string;
  category: "character" | "location" | "item" | "organization";
  aliases: string[];
  stableFacts: string[];
  openRisks: string[];
}

export interface ChapterScanComparisonPacket {
  entities: ComparisonPacketEntity[];
  chronologyComparisonFacts: string[];
  watchlistNotes: string[];
}

export interface ChapterScanPayload {
  chapter: {
    number: number | null;
    title: string;
    text: string;
  };
  comparisonPacket: ChapterScanComparisonPacket;
}

export interface ChapterScanInputMessage {
  role: "system" | "user";
  content: Array<{
    type: "input_text";
    text: string;
  }>;
}

// Returns the system prompt for chapter scan, with low-canon fallback lines if needed
export function getScanRuntimeSystemPrompt(
  priorCanonCoverage: "none" | "low" | "medium" | "high",
): string {
  const fallbackLines =
    priorCanonCoverage === "none" || priorCanonCoverage === "low"
      ? [
          "Low-canon / empty-wiki behavior:",
          "- If prior canon coverage is none or low, rely primarily on chapter-local evidence.",
          "- If comparisonPacket is sparse, do not treat that as evidence that the chapter lacks important canon.",
          "- Generate strong first-pass summaries directly from chapter text.",
          "- For central, chapter-dominant, or point-of-view characters, assign an initial high-importance classification when supported by the chapter.",
          "- Extract role/title, physical description, visible relationships, location ties, and chapter importance from chapter-local evidence.",
          "- Do not collapse new entity summaries to bare minimum because no prior dossier exists.",
          "- Preserve uncertainty where needed, but do not under-extract details explicitly present in the chapter.",
        ]
      : [];
  return [
    "You extract structured canon from one chapter in one book project.",
    "",
    "Core rules:",
    "- Treat chapter text as primary authority for this scan.",
    "- Use related canon only for comparison, continuity checks, alias normalization, containment support, and contradiction detection.",
    "- Do not invent.",
    "- Do not silently blend older canon into chapter facts.",
    "- Preserve contradictions and ambiguity.",
    "- If unsupported, mark Missing or unestablished.",
    "",
    "Entity scope:",
    "Extract each supported named:",
    "- on-page character",
    "- mentioned-only person",
    "- named individual animal",
    "- location",
    "- organization",
    "- item",
    "- geographic feature",
    "- titled publication/story/serial/book",
    "- named event",
    "",
    "Classification rules:",
    "- category: character | location | item | organization",
    "- itemSubtype allowed only when supported:",
    "  Weapons, Documents, Artifacts, Clothing, Events, Publications, Vehicles, Animals, Plants, Other",
    "- named individual animals => character",
    "- animal kinds/species/fantastical kinds => item + Animals",
    "- titled reading material => item + Publications",
    "- named businesses/taverns/inns/shops/booths => location",
    "- named events => item + Events",
    "",
    "Character importance rules:",
    "- For every character, set characterImportance to main, major, or minor.",
    "- main: protagonist, POV character, chapter-dominant character, or structurally central recurring character.",
    "- major: important recurring/supporting character, politically or plot-significant figure, major relationship character, or character with substantial scene presence.",
    "- minor: brief on-page character, mentioned-only character, servant/guard/shopkeeper with limited narrative weight, or one-off background figure.",
    "- Do not default all new characters to minor merely because the wiki has no prior article.",
    "- If prior canon is sparse, classify from chapter-local evidence.",
    "Alias and normalization rules:",
    "- Prevent duplicates from honorifics, short forms, and role prefixes.",
    "- If a chapter short form maps to known canon, use canonical name and record short form as alias when useful.",
    "- Assumed/false identities are aliases on canonical character, not separate entities.",
    "- For person/place ambiguity, do not guess; use watchlist.",
    "",
    "Location containment rules:",
    "- Set parentLocationName only when supported by chapter text or clearly supported related canon for containment.",
    "- Use direct parent only.",
    "- Do not invent parent locations.",
    "",
    "Links rule:",
    "- Add directional links only when clearly supported.",
    "- Use concise relationType values (proprietor, proprietor-of, member, employer, family).",
    "",
    "Required output keys:",
    "- entities",
    "- chronology",
    "- watchlist",
    "- newCanon",
    "- updatedCanon",
    "- seriesBibleImpact",
    "- fileImpact",
    "- changeLog",
    "",
    "Chronology rules:",
    "- one chronology item per distinct event",
    "- each body includes Event, Location, Characters involved, Consequences, Sources",
    "",
    "Watchlist type rules:",
    "- allowed types only: contradiction, missing-description, name-collision, timeline-risk, relationship-ambiguity, item-clarification, location-risk",
    "- contradiction entries include: Subject, Conflicting claims, Source A, Source B, Notes, Suggested status",
    "",
    "Series bible outcome rule:",
    "- outcome must be one of: no-series-bible-update-needed, series-bible-update-required, series-bible-review-required",
    "",
    "FileImpact rule:",
    "- include create/update/move actions for impacted canon files",
    "- include folder-move actions where reclassification or hierarchy changes are implied",
    "",
    "Return valid JSON only. No markdown code fences.",
    ...fallbackLines,
    "",
    // Additional explicit instructions for chapter-local extraction and classification
    "Chapter-local first-pass extraction instructions:",
    "- Always extract as much detail as is explicitly present in the chapter, even if prior canon is sparse or missing.",
    "- Avoid bare-minimum summaries when comparisonPacket is sparse; do not treat lack of prior canon as lack of importance.",
    "- Assign initial Main/Major/Minor classification from chapter-local evidence when supported.",
  ].join("\n");
}

export function buildChapterScanPayload(input: {
  chapterNumber: number | null;
  chapterTitle: string;
  chapterText: string;
  comparisonPacket: ChapterScanComparisonPacket;
  priorCanonCoverage: "none" | "low" | "medium" | "high";
}): ChapterScanPayload & { priorCanonCoverage: string } {
  return {
    chapter: {
      number: input.chapterNumber,
      title: input.chapterTitle,
      text: input.chapterText,
    },
    comparisonPacket: input.comparisonPacket,
    priorCanonCoverage: input.priorCanonCoverage,
  };
}

// Accepts priorCanonCoverage to inject fallback prompt lines if needed
export function buildChapterScanInput(
  payload: ChapterScanPayload & { priorCanonCoverage: string },
  priorCanonCoverage: "none" | "low" | "medium" | "high",
): ChapterScanInputMessage[] {
  return [
    {
      role: "system",
      content: [
        {
          type: "input_text",
          text: getScanRuntimeSystemPrompt(priorCanonCoverage),
        },
      ],
    },
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: "Structured chapter scan payload:",
        },
        {
          type: "input_text",
          text: JSON.stringify(payload, null, 2),
        },
      ],
    },
  ];
}

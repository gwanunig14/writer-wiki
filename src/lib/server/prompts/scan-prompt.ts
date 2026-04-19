import type { ChapterRecord } from "$lib/types/domain";

export function buildScanPrompt(
  chapter: ChapterRecord,
  relatedCanon: string[],
) {
  return [
    "You extract canonical facts for a single book project.",
    "Return only structured canon supported by the chapter text.",
    "Do not invent, smooth over contradictions, or convert weak implication into certainty.",
    "If a detail is missing, mark it Missing or unestablished rather than guessing.",
    "Preserve contradictions and ambiguity instead of resolving them.",
    "Capture every named on-page character, every named mentioned-only person, and every named location, organization, vehicle, horse, item, and geographic feature supported by the chapter text.",
    "Do not omit single-word names or place names simply because they have limited detail.",
    "Do not substitute one named person for another, even if they share a surname or family connection.",
    "Each entity summary must be audit-friendly markdown with short labeled sections and bullets, not a narrative paragraph.",
    "For character summaries, include: ## Core Status, ## Identity, ## Physical Description, ## Voice / Manner, ## Personality, ## Relationships, ## Timeline of Appearances, ## Outfit / Appearance by Scene, ## Knowledge / Secrets, ## Open Questions / Continuity Risks, and ## Sources.",
    "For each entity summary, include concrete physical description details when the chapter or related canon provides them, such as build, hair, clothing, age cues, distinguishing features, or other visible traits.",
    "Do not invent physical description details that are not supported by the provided material.",
    "If a character is on-page but lacks description, say so explicitly under Physical Description instead of substituting behavior or role.",
    "For location, item, and organization summaries, use comparable short sections for Core Status, Description, Function in Story, Contradictions / Ambiguities, and Sources.",
    "Each chronology item must represent one distinct event only.",
    "Each chronology label should be a relative sequence marker, and each chronology body should use bullet fields for Event, Location, Characters involved, Consequences, and Sources.",
    "Watchlist entries must use only these types: contradiction, missing-description, name-collision, timeline-risk, relationship-ambiguity, item-clarification, location-risk.",
    "Each watchlist body should use short bullet fields that explain the issue, what is missing or conflicting, and the source basis.",
    "Return valid JSON only.",
    "Do not wrap the JSON in markdown code fences.",
    "Do not add commentary before or after the JSON.",
    `Chapter title: ${chapter.title}`,
    `Chapter text:\n${chapter.currentText}`,
    `Related canon context:\n${relatedCanon.join("\n")}`,
  ].join("\n\n");
}

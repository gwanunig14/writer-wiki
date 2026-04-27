// Structured entity subtype inference for normalization and reconciliation
// Used by both normalize-scan-result and reconcile-canon
import type { ScanEntity } from "$lib/types/scan-result";

/**
 * Infers the entity subtype for wiki foldering and classification.
 * - For items: returns itemSubtype
 * - For non-characters: returns null
 * - For characters: returns Main/Major/Minor if present, else null
 * - Falls back to summary text heuristic if no structured field is present
 */
export function inferEntitySubtype(entity: ScanEntity): string | null {
  if (entity.category === "item") {
    return entity.itemSubtype ?? null;
  }
  if (entity.category !== "character") {
    return null;
  }
  if (entity.characterImportance === "main") {
    return "Main";
  }
  if (entity.characterImportance === "major") {
    return "Major";
  }
  if (entity.characterImportance === "minor") {
    return "Minor";
  }
  // Fallback: summary text heuristic (legacy)
  const text = `${entity.name} ${entity.summary}`.toLowerCase();
  if (
    /\b(?:protagonist|main character|lead character|primary character|on-page primary character)\b/.test(
      text,
    )
  ) {
    return "Main";
  }
  if (/\b(?:primary pov|point-of-view|point of view|pov)\b/.test(text)) {
    return "Main";
  }
  if (
    /\b(?:major character|important recurring|recurring character|supporting character|politically significant|plot-significant|substantial scene presence|central supporting)\b/.test(
      text,
    )
  ) {
    return "Major";
  }
  return null;
}

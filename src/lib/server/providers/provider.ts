import { createHash } from "node:crypto";
import type { ProviderName } from "$lib/types/domain";
import type { ScanResult } from "$lib/types/scan-result";
import { AnthropicProvider } from "./anthropic";
import { OpenAIProvider } from "./openai";

export interface AIProvider {
  readonly name: ProviderName;
  testConnection(apiKey: string): Promise<{ ok: boolean; message: string }>;
  scanChapter(input: {
    prompt: string;
    chapterText: string;
    chapterLabel: string;
    apiKey: string;
    userBlocking?: boolean;
    escalationHints?: {
      highContradictionDensity: boolean;
      highEntityAmbiguity: boolean;
      majorSeriesBibleImpact: boolean;
      highReconciliationRisk: boolean;
      validationRetryCount: number;
    };
  }): Promise<ScanResult>;
  answerCanonQuestion(input: {
    question: string;
    evidence: string[];
    apiKey: string;
  }): Promise<{
    direct: string;
    confirmedEvidence: string[];
    inferred: string[];
    unresolved: string[];
  }>;
}

const providers = {
  openai: new OpenAIProvider(),
  anthropic: new AnthropicProvider(),
} satisfies Record<ProviderName, AIProvider>;

export function getProvider(providerName: ProviderName) {
  return providers[providerName];
}

export function makeSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function parseJsonResponseText(payload: string) {
  const trimmed = payload.trim();
  if (!trimmed) {
    throw new Error("Provider returned an empty scan payload.");
  }

  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const unfenced = fencedMatch ? fencedMatch[1].trim() : trimmed;

  try {
    return JSON.parse(unfenced);
  } catch {
    const objectStart = unfenced.indexOf("{");
    const objectEnd = unfenced.lastIndexOf("}");
    if (objectStart === -1 || objectEnd === -1 || objectEnd <= objectStart) {
      throw new Error(
        "Provider returned scan content that did not contain valid JSON.",
      );
    }

    return JSON.parse(unfenced.slice(objectStart, objectEnd + 1));
  }
}

export function formatLogPreview(value: string, maxLength = 400) {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }

  return `${compact.slice(0, maxLength)}...`;
}

export function extractDeterministicCanon(
  chapterText: string,
  chapterLabel: string,
): ScanResult {
  const matches = [
    ...chapterText.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g),
  ];
  const seen = new Set<string>();
  const entities = matches
    .map((match) => match[1].trim())
    .filter((name) => name.length > 2)
    .filter((name) => {
      const key = name.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 12)
    .map((name) => ({
      name,
      category: "character" as const,
      summary: [
        "## Core Status",
        `- Canon status: Unconfirmed`,
        `- On-page status: Mentioned in ${chapterLabel}`,
        "",
        "## Identity",
        "- Occupation / function: Missing",
        "- Affiliation(s): Missing",
        "",
        "## Physical Description",
        `- Missing / unestablished: No supported physical description is available in ${chapterLabel}.`,
        "",
        "## Role in Current Canon",
        `- ${name} is named in ${chapterLabel}, but supporting details remain thin.`,
        "",
        "## Open Questions / Continuity Risks",
        "- Missing: identity, role, and relationship details require later confirmation.",
        "",
        "## Sources",
        `- Source: ${chapterLabel}`,
      ].join("\n"),
      isStub: true,
      aliases: [],
      links: [],
    }));

  const digest = createHash("sha1")
    .update(chapterText)
    .digest("hex")
    .slice(0, 10);

  return {
    entities,
    chronology: [
      {
        label: `${chapterLabel} snapshot ${digest}`,
        body: [
          `- Event: ${chapterLabel} was scanned and reconciled against the current canon.`,
          "- Location: Missing",
          `- Characters involved: ${entities.length ? entities.map((entity) => entity.name).join(", ") : "None clearly established"}`,
          `- Consequences: Canon records were refreshed from ${chapterLabel}.`,
          `- Sources: ${chapterLabel}`,
        ].join("\n"),
        confidence: "confirmed",
      },
    ],
    watchlist: [],
    newCanon: entities.map((entity) => entity.name),
    updatedCanon: [],
    seriesBibleImpact: {
      outcome: "no-series-bible-update-needed",
      rationale: "No high-level series-bible deltas were detected.",
      impactedSections: [],
    },
    fileImpact: [],
    changeLog: [
      `Scanned ${chapterLabel} with deterministic local fallback mode.`,
    ],
    summary: {
      articlesCreated: entities.map((entity) => entity.name),
      articlesUpdated: [],
      stubsCreated: entities.map((entity) => entity.name),
      chronologyUpdated: [`${chapterLabel} snapshot ${digest}`],
      continuityUpdated: [],
      contradictionsFlagged: [],
    },
  };
}

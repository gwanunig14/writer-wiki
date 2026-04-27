import { describe, expect, it } from "vitest";
import {
  buildChapterScanInput,
  buildChapterScanPayload,
} from "$lib/server/prompts/scan-prompt";
import { scanResultSchema } from "$lib/types/scan-result";
import {
  extractDeterministicCanon,
  makeSlug,
  parseJsonResponseText,
} from "$lib/server/providers/provider";

describe("foundation services", () => {
  it("normalizes deterministic scan results", () => {
    const result = extractDeterministicCanon(
      "Alice meets Bob inside Harbor City.",
    );
    expect(scanResultSchema.parse(result).entities.length).toBeGreaterThan(0);
  });

  it("builds stable slugs", () => {
    expect(makeSlug("Harbor City")).toBe("harbor-city");
  });

  it("parses fenced provider JSON payloads", () => {
    const payload = [
      "```json",
      "{",
      '  "entities": [],',
      '  "chronology": [],',
      '  "watchlist": [],',
      '  "newCanon": [],',
      '  "updatedCanon": [],',
      '  "seriesBibleImpact": {',
      '    "outcome": "no-series-bible-update-needed",',
      '    "rationale": "",',
      '    "impactedSections": []',
      "  },",
      '  "fileImpact": [],',
      '  "changeLog": []',
      "}",
      "```",
    ].join("\n");

    const parsed = parseJsonResponseText(payload);

    expect(scanResultSchema.parse(parsed).entities).toEqual([]);
  });

  it("parses provider JSON with extra prose around it", () => {
    const parsed = parseJsonResponseText(`Here is the scan result:
{
  "entities": [],
  "chronology": [],
  "watchlist": [],
  "newCanon": [],
  "updatedCanon": [],
  "seriesBibleImpact": {
    "outcome": "no-series-bible-update-needed",
    "rationale": "",
    "impactedSections": []
  },
  "fileImpact": [],
  "changeLog": []
}`);

    expect(scanResultSchema.parse(parsed).newCanon).toEqual([]);
  });

  it("builds lean responses-api input payloads", () => {
    const payload = buildChapterScanPayload({
      chapterNumber: 1,
      chapterTitle: "Chapter 1",
      chapterText: "Marcus is tall, broad-shouldered, and red-haired.",
      comparisonPacket: {
        entities: [
          {
            canonicalName: "Marcus Day",
            category: "character",
            aliases: ["Marcus"],
            stableFacts: ["A bounty hunter with a scar over one eyebrow."],
            openRisks: [],
          },
        ],
        chronologyComparisonFacts: ["Chapter 1 opens at the city gate."],
        watchlistNotes: ["No contradictions noted yet."],
      },
    });
    const requestInput = buildChapterScanInput(payload);

    expect(requestInput[0]?.role).toBe("system");
    expect(requestInput[1]?.role).toBe("user");
    expect(requestInput[1]?.content[0]?.text).toContain(
      "Structured chapter scan payload:",
    );
    expect(requestInput[1]?.content[1]?.text).toContain("comparisonPacket");
  });
});

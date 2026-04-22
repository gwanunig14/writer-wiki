import { describe, expect, it } from "vitest";
import { buildScanPrompt } from "$lib/server/prompts/scan-prompt";
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
      '  "summary": {',
      '    "articlesCreated": [],',
      '    "articlesUpdated": [],',
      '    "stubsCreated": [],',
      '    "chronologyUpdated": [],',
      '    "continuityUpdated": [],',
      '    "contradictionsFlagged": []',
      "  }",
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
  "summary": {
    "articlesCreated": [],
    "articlesUpdated": [],
    "stubsCreated": [],
    "chronologyUpdated": [],
    "continuityUpdated": [],
    "contradictionsFlagged": []
  }
}`);

    expect(scanResultSchema.parse(parsed).summary.articlesCreated).toEqual([]);
  });

  it("asks scan summaries to include supported physical description", () => {
    const prompt = buildScanPrompt(
      {
        id: "chapter-1",
        number: 1,
        title: "Chapter 1",
        currentText: "Marcus is tall, broad-shouldered, and red-haired.",
        status: "saved",
        latestVersionId: null,
        lastScannedVersionId: null,
        createdAt: "2026-04-19T00:00:00.000Z",
        updatedAt: "2026-04-19T00:00:00.000Z",
      },
      ["Marcus Day: A bounty hunter with a scar over one eyebrow."],
    );

    expect(prompt).toContain("Treat chapter text as primary authority");
    expect(prompt).toContain("Preserve contradictions and ambiguity");
    expect(prompt).toContain("allowed types only");
    expect(prompt).toContain("Series bible impact");
    expect(prompt).toContain("File impact");
    expect(prompt).toContain("Return valid JSON only");
  });
});

import type { ScanResult, ScanSummary } from "$lib/types/scan-result";
import { makeSlug } from "$lib/server/providers/provider";

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function impactsNameByAction(input: {
  result: ScanResult;
  name: string;
  action: "create" | "update";
}) {
  const slug = makeSlug(input.name);
  if (!slug) {
    return false;
  }

  return input.result.fileImpact.some(
    (item) =>
      item.action === input.action &&
      item.targetPath.toLowerCase().includes(slug.toLowerCase()),
  );
}

export function deriveScanSummary(result: ScanResult): ScanSummary {
  const createdFromFileImpact = result.newCanon.filter((name) =>
    impactsNameByAction({ result, name, action: "create" }),
  );
  const updatedFromFileImpact = result.updatedCanon.filter((name) =>
    impactsNameByAction({ result, name, action: "update" }),
  );

  return {
    articlesCreated: unique(
      createdFromFileImpact.length > 0
        ? createdFromFileImpact
        : result.newCanon,
    ),
    articlesUpdated: unique(
      updatedFromFileImpact.length > 0
        ? updatedFromFileImpact
        : result.updatedCanon,
    ),
    stubsCreated: unique(
      result.entities
        .filter((entity) => entity.isStub)
        .map((entity) => entity.name),
    ),
    chronologyUpdated: unique(result.chronology.map((item) => item.label)),
    continuityUpdated: unique(result.watchlist.map((item) => item.subject)),
    contradictionsFlagged: unique(
      result.watchlist
        .filter((item) => item.type === "contradiction")
        .map((item) => item.subject),
    ),
  };
}

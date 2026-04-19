import {
  listEntities,
  type EntitySummaryRecord,
} from "$lib/server/db/repositories/entity-repository";
import { getDatabase } from "$lib/server/db/client";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentionsEntity(text: string, entityName: string) {
  return new RegExp(`\\b${escapeRegExp(entityName)}\\b`, "i").test(text);
}

export function getBacklinksForEntity(entity: EntitySummaryRecord) {
  const backlinks = new Set<string>();
  const allEntities = listEntities();

  for (const candidate of allEntities) {
    if (candidate.id === entity.id) {
      continue;
    }

    if (mentionsEntity(candidate.articleBody, entity.name)) {
      backlinks.add(candidate.name);
    }
  }

  const generatedPages = getDatabase()
    .prepare("SELECT body FROM generated_pages ORDER BY updated_at DESC")
    .all() as Array<Record<string, unknown>>;

  for (const page of generatedPages) {
    if (mentionsEntity(String(page.body), entity.name)) {
      backlinks.add("Generated canon page");
      break;
    }
  }

  return Array.from(backlinks).sort((left, right) => left.localeCompare(right));
}

import type { WikiPage } from "$lib/types/domain";
import {
  listActiveWatchlistEntries,
  listResolvedWatchlistEntries,
} from "$lib/server/canon/continuity-manager";
import {
  getEntityById,
  listAliasesForEntity,
  listEntities,
  listEntitiesByCategory,
  type EntitySummaryRecord,
} from "$lib/server/db/repositories/entity-repository";
import { getBacklinksForEntity } from "./backlink-index";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceOutsideMarkdownLinks(
  text: string,
  pattern: RegExp,
  replacement: string,
) {
  return text
    .split(/(\[[^\]]+\]\([^\)]+\))/g)
    .map((segment) =>
      segment.startsWith("[") && segment.includes("](")
        ? segment
        : segment.replace(pattern, replacement),
    )
    .join("");
}

function collectEntityLinkNames(entities: EntitySummaryRecord[]) {
  const tokenFrequency = new Map<string, number>();

  for (const entity of entities) {
    if (entity.category !== "character") {
      continue;
    }

    const [firstToken] = entity.name.split(/\s+/);
    if (!firstToken || firstToken.length < 3) {
      continue;
    }

    const normalized = firstToken.toLowerCase();
    tokenFrequency.set(normalized, (tokenFrequency.get(normalized) ?? 0) + 1);
  }

  return entities.flatMap((entity) => {
    const linkNames = [entity.name];

    if (entity.category === "character") {
      const [firstToken] = entity.name.split(/\s+/);
      if (firstToken && firstToken.length >= 3) {
        const normalized = firstToken.toLowerCase();
        if (tokenFrequency.get(normalized) === 1) {
          linkNames.push(firstToken);
        }
      }
    }

    return linkNames
      .sort((left, right) => right.length - left.length)
      .map((linkName) => ({
        ...entity,
        linkName,
      }));
  });
}

function linkifyCanonText(text: string, currentSlug?: string) {
  return collectEntityLinkNames(listEntities())
    .sort((left, right) => right.linkName.length - left.linkName.length)
    .reduce((output, entity) => {
      if (entity.slug === currentSlug) {
        return output;
      }

      return replaceOutsideMarkdownLinks(
        output,
        new RegExp(`\\b${escapeRegExp(entity.linkName)}\\b`, "g"),
        `[${entity.linkName}](/wiki/${entity.category}/${entity.slug})`,
      );
    }, text);
}

export function buildEntityWikiPage(entity: EntitySummaryRecord): WikiPage {
  const aliases = listAliasesForEntity(entity.id);
  const locationNames = listEntitiesByCategory("location")
    .filter((location) => location.id !== entity.id)
    .map((location) => location.name);
  const parentLocation = entity.parentEntityId
    ? getEntityById(entity.parentEntityId)
    : null;

  return {
    title: entity.name,
    kind: "article",
    category: entity.category,
    isStub: entity.isStub,
    body: linkifyCanonText(entity.articleBody, entity.slug).trim(),
    updatedAt: entity.updatedAt,
    backlinks: getBacklinksForEntity(entity),
    aliases,
    editableEntity: {
      id: entity.id,
      name: entity.name,
      slug: entity.slug,
      category: entity.category,
      articleBody: entity.articleBody,
      folderPath: entity.subtype ?? "",
      parentLocationName: parentLocation?.name,
      availableLocationNames: locationNames,
    },
  };
}

export function buildGeneratedWikiPage(input: {
  title: string;
  kind: WikiPage["kind"];
  category?: string;
  body: string;
  updatedAt?: string;
}) {
  const continuityItems =
    input.kind === "continuity" ? listActiveWatchlistEntries() : undefined;
  const resolvedContinuityItems =
    input.kind === "continuity" ? listResolvedWatchlistEntries() : undefined;

  return {
    title: input.title,
    kind: input.kind,
    category: input.category,
    body:
      input.kind === "category-all" ? input.body : linkifyCanonText(input.body),
    updatedAt: input.updatedAt,
    backlinks: [],
    continuityItems,
    resolvedContinuityItems,
  } satisfies WikiPage;
}

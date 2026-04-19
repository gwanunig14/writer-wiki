import type { WikiNode } from "$lib/types/domain";
import type { EntitySummaryRecord } from "$lib/server/db/repositories/entity-repository";

type Category = EntitySummaryRecord["category"];

function parseSubtypePath(subtype: string | null) {
  return (subtype ?? "")
    .split(/[>/]/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function createArticleNode(entity: EntitySummaryRecord): WikiNode {
  return {
    id: entity.id,
    label: entity.name,
    kind: "article",
    href: `/wiki/${entity.category}/${entity.slug}`,
    isStub: entity.isStub,
  };
}

function inferCharacterSegments(entity: EntitySummaryRecord) {
  const text = `${entity.name} ${entity.articleBody}`.toLowerCase();
  if (parseSubtypePath(entity.subtype).length > 0) {
    return parseSubtypePath(entity.subtype);
  }

  if (
    /\bprotagonist|main character|lead character|point-of-view|pov\b/.test(text)
  ) {
    return ["Main"];
  }

  if (
    !entity.isStub &&
    /\bally|companion|wife|husband|mother|father|son|daughter|captain|criminal|felon|member|baron|infamous|bounty hunter\b/.test(
      text,
    )
  ) {
    return ["Major"];
  }

  return ["Minor"];
}

function inferItemSegments(entity: EntitySummaryRecord) {
  const text = `${entity.name} ${entity.articleBody}`.toLowerCase();
  if (parseSubtypePath(entity.subtype).length > 0) {
    return parseSubtypePath(entity.subtype);
  }

  if (/\bhorse|destrier|mare|stallion|gelding|mount|rides?\b/.test(text)) {
    return ["Vehicles"];
  }

  if (
    /\brevolver|pistol|rifle|shotgun|knife|dagger|blade|sword|bow|arrow\b/.test(
      text,
    )
  ) {
    return ["Weapons"];
  }

  if (
    /\bdress|hat|boots|gloves?|cloak|robe|coat|uniform|shirt|pants\b/.test(text)
  ) {
    return ["Clothing"];
  }

  if (
    /\bletter|document|map|journal|ledger|note|warrant|paper|deed|contract\b/.test(
      text,
    )
  ) {
    return ["Documents"];
  }

  if (/\bbook|chronicle|legend|manuscript|gazette|publication\b/.test(text)) {
    return ["Publications"];
  }

  if (
    /\bchalice|artifact|relic|amulet|ring|talisman|orb|idol|crown\b/.test(text)
  ) {
    return ["Artifacts"];
  }

  return ["Other"];
}

function inferOrganizationSegments(entity: EntitySummaryRecord) {
  const text = `${entity.name} ${entity.articleBody}`.toLowerCase();
  if (parseSubtypePath(entity.subtype).length > 0) {
    return parseSubtypePath(entity.subtype);
  }

  if (/\bempire|council|court|watch\b/.test(text)) {
    return ["Government"];
  }

  if (/\bsharpshooters|army|legion|militia|guard|rangers\b/.test(text)) {
    return ["Military"];
  }

  if (/\bguild|order|company|companies\b/.test(text)) {
    return ["Civic"];
  }

  return ["General"];
}

function inferLocationParents(locations: EntitySummaryRecord[]) {
  const parentById = new Map<string, string>();

  for (const entity of locations) {
    const text = entity.articleBody.toLowerCase();
    const entityName = entity.name.toLowerCase();
    let bestMatch: { id: string; score: number } | null = null;

    for (const candidate of locations) {
      if (candidate.id === entity.id) {
        continue;
      }

      const candidateName = candidate.name.toLowerCase();
      if (candidateName.includes(entityName)) {
        continue;
      }

      let score = 0;
      if (entityName.startsWith(`${candidateName} `)) {
        score += 300;
      }
      if (
        new RegExp(
          `\\b${candidateName.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}['’]s\\b`,
          "i",
        ).test(text)
      ) {
        score += 180;
      }
      if (
        new RegExp(
          `\\b(?:in|within|inside|at|of|from|near|outside|overlooking)\\s+${candidateName.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`,
          "i",
        ).test(text)
      ) {
        score += 200;
      }

      if (score === 0) {
        continue;
      }

      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { id: candidate.id, score };
      }
    }

    if (bestMatch) {
      parentById.set(entity.id, bestMatch.id);
    }
  }

  return parentById;
}

function buildLocationFolderSegments(
  entity: EntitySummaryRecord,
  locations: EntitySummaryRecord[],
) {
  const explicit = parseSubtypePath(entity.subtype);
  if (explicit.length > 0) {
    return explicit;
  }

  const parentById = new Map<string, string>();
  for (const location of locations) {
    if (location.parentEntityId) {
      parentById.set(location.id, location.parentEntityId);
    }
  }
  for (const [childId, parentId] of inferLocationParents(locations)) {
    if (!parentById.has(childId)) {
      parentById.set(childId, parentId);
    }
  }
  const childrenByParent = new Map<string, string[]>();
  for (const [childId, parentId] of parentById) {
    const existingChildren = childrenByParent.get(parentId) ?? [];
    existingChildren.push(childId);
    childrenByParent.set(parentId, existingChildren);
  }

  const byId = new Map(locations.map((location) => [location.id, location]));
  const segments: string[] = [];
  const visited = new Set<string>();
  let currentParentId = parentById.get(entity.id);

  while (currentParentId && !visited.has(currentParentId)) {
    visited.add(currentParentId);
    const parent = byId.get(currentParentId);
    if (!parent) {
      break;
    }
    segments.unshift(parent.name);
    currentParentId = parentById.get(currentParentId);
  }

  const hasChildren = (childrenByParent.get(entity.id)?.length ?? 0) > 0;
  if (segments.length > 0) {
    return hasChildren ? [...segments, entity.name] : segments;
  }

  return hasChildren ? [entity.name] : ["Unplaced"];
}

export function getEntityFolderSegments(
  entity: EntitySummaryRecord,
  categoryEntities: EntitySummaryRecord[],
) {
  switch (entity.category) {
    case "character":
      return inferCharacterSegments(entity);
    case "item":
      return inferItemSegments(entity);
    case "organization":
      return inferOrganizationSegments(entity);
    case "location":
      return buildLocationFolderSegments(entity, categoryEntities);
  }
}

export function buildCategoryTreeNodes(
  category: Category,
  entities: EntitySummaryRecord[],
) {
  const folderLookup = new Map<string, WikiNode>();
  const roots: WikiNode[] = [];

  function ensureFolder(path: string[]) {
    let cursor = roots;
    const traversed: string[] = [];

    for (const segment of path) {
      traversed.push(segment);
      const key = traversed.join("/");
      let folder = folderLookup.get(key);

      if (!folder) {
        folder = {
          id: `${category}-folder-${key.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          label: segment,
          kind: "folder",
          children: [],
        };
        folderLookup.set(key, folder);
        cursor.push(folder);
      }

      cursor = folder.children ?? [];
    }

    return cursor;
  }

  for (const entity of entities) {
    const segments = getEntityFolderSegments(entity, entities);
    const container = ensureFolder(segments);
    container.push(createArticleNode(entity));
  }

  return roots;
}

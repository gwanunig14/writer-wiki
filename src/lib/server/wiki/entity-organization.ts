import { getDatabase } from "$lib/server/db/client";
import type { WikiNode } from "$lib/types/domain";
import type { EntitySummaryRecord } from "$lib/server/db/repositories/entity-repository";

type Category = EntitySummaryRecord["category"];

export const CHARACTER_FOLDER_OPTIONS = ["Main", "Major", "Minor"] as const;

const characterFolderOrder = new Map<string, number>(
  CHARACTER_FOLDER_OPTIONS.map((label, index) => [label, index]),
);

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

function buildCharacterChapterCountMap(entities: EntitySummaryRecord[]) {
  if (entities.length === 0) {
    return new Map<string, number>();
  }

  const placeholders = entities.map(() => "?").join(", ");
  let rows: Array<Record<string, unknown>> = [];

  try {
    rows = getDatabase()
      .prepare(
        `SELECT target_id, COUNT(DISTINCT source_chapter_id) AS chapter_count
           FROM derived_dependencies
          WHERE target_type = 'entity' AND target_id IN (${placeholders})
          GROUP BY target_id`,
      )
      .all(...entities.map((entity) => entity.id)) as Array<
      Record<string, unknown>
    >;
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !error.message.includes("no such table: derived_dependencies")
    ) {
      throw error;
    }
  }

  return new Map(
    rows.map((row) => [String(row.target_id), Number(row.chapter_count ?? 0)]),
  );
}

function inferCharacterSegments(
  entity: EntitySummaryRecord,
  chapterAppearanceCount = 0,
) {
  // Prefer characterImportance if present
  if (entity.characterImportance === "main") return ["Main"];
  if (entity.characterImportance === "major") return ["Major"];
  if (entity.characterImportance === "minor") return ["Minor"];

  // Fallback to subtype path if present
  if (parseSubtypePath(entity.subtype).length > 0) {
    return parseSubtypePath(entity.subtype);
  }

  // Fallback to chapter appearance count
  if (chapterAppearanceCount >= 2) {
    return ["Major"];
  }

  return ["Minor"];
}

function inferItemSegments(entity: EntitySummaryRecord) {
  const text = `${entity.name} ${entity.articleBody}`.toLowerCase();
  if (parseSubtypePath(entity.subtype).length > 0) {
    return parseSubtypePath(entity.subtype);
  }

  if (
    /\bball|balls|festival|festivals|ceremony|ceremonies|feast|feasts|party|parties|war|wars\b/.test(
      text,
    )
  ) {
    return ["Events"];
  }

  if (
    /\bhorse|horses|destrier|destriers|mare|mares|stallion|stallions|gelding|geldings|panther|panthers|viper|vipers|wolf|wolves|dog|dogs|cat|cats|bird|birds|hawk|hawks|falcon|falcons|eagle|eagles|boar|boars|bear|bears|serpent|serpents|spider|spiders|beast|beasts|creature|creatures|animal|animals\b/.test(
      text,
    )
  ) {
    return ["Animals"];
  }

  if (
    /\bbloom|blooms|blossom|blossoms|briar|briars|daisy|daisies|fern|ferns|flower|flowers|herb|herbs|ivy|lily|lilies|moss|orchid|orchids|petal|petals|reed|reeds|rose|roses|thorn|thorns|vine|vines|weed|weeds\b/.test(
      text,
    )
  ) {
    return ["Plants"];
  }

  if (
    /\bcart|carriage|wagon|coach|buggy|boat|ship|train|locomotive|automobile|vehicle\b/.test(
      text,
    )
  ) {
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

/**
 * Check if assigning `parentId` as the parent of `childId` would create a cycle
 * in the parent chain. Returns true if a cycle would be created, false otherwise.
 */
function wouldCreateCycle(
  childId: string,
  parentId: string,
  parentById: Map<string, string>,
): boolean {
  if (childId === parentId) {
    return true; // Direct self-loop
  }

  let current = parentId;
  const visited = new Set<string>();

  while (current) {
    if (visited.has(current)) {
      // We've entered a cycle in the existing parentById map; this is fine,
      // we're just checking whether adding the edge would create one.
      break;
    }

    if (current === childId) {
      // Found a path back to childId; assigning parentId would create a cycle
      return true;
    }

    visited.add(current);
    current = parentById.get(current);
  }

  return false;
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
      const entityTokenCount = entityName.split(/\s+/).filter(Boolean).length;
      const candidateTokenCount = candidateName
        .split(/\s+/)
        .filter(Boolean).length;
      if (candidateName.includes(entityName)) {
        continue;
      }
      if (candidateTokenCount > entityTokenCount) {
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
          `\\b(?:in|within|inside|at)\\s+${candidateName.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`,
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
      // Guard against cycles: do not assign a parent if that parent eventually
      // points back to this entity through the parent chain (either in the inferred
      // map or via the DB parentEntityId field).
      if (!wouldCreateCycle(entity.id, bestMatch.id, parentById)) {
        parentById.set(entity.id, bestMatch.id);
      }
    }
  }

  // Second pass: sibling-parent inheritance.
  // If entity C has no direct-evidence parent yet, but its article body mentions
  // entity B (any co-location reference), and B has an assigned parent P, then
  // C likely shares that regional parent. This captures "C is near B, B is in P,
  // so C is also in P" when the text signal exists in the article body.
  const byId = new Map(locations.map((loc) => [loc.id, loc]));
  for (const entity of locations) {
    if (parentById.has(entity.id)) {
      continue; // already has a direct-evidence parent
    }
    const text = entity.articleBody.toLowerCase();
    let bestSiblingMatch: { id: string; score: number } | null = null;

    for (const sibling of locations) {
      if (sibling.id === entity.id) {
        continue;
      }
      const siblingParentId = parentById.get(sibling.id);
      if (!siblingParentId) {
        continue; // sibling has no parent to inherit
      }
      const siblingParent = byId.get(siblingParentId);
      if (!siblingParent) {
        continue;
      }
      // Only inherit from siblings whose inferred parent is a broader region
      // (i.e., the parent has fewer name tokens than the sibling — avoids
      // inheriting from a building's room, etc.)
      const siblingTokens = sibling.name.split(/\s+/).filter(Boolean).length;
      const parentTokens = siblingParent.name
        .split(/\s+/)
        .filter(Boolean).length;
      if (parentTokens >= siblingTokens) {
        continue;
      }
      const siblingNameEscaped = sibling.name
        .toLowerCase()
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`\\b${siblingNameEscaped}\\b`).test(text)) {
        const score = 60;
        if (!bestSiblingMatch || score > bestSiblingMatch.score) {
          bestSiblingMatch = { id: siblingParentId, score };
        }
      }
    }

    if (bestSiblingMatch) {
      // Also guard the sibling inheritance to avoid cycles
      if (!wouldCreateCycle(entity.id, bestSiblingMatch.id, parentById)) {
        parentById.set(entity.id, bestSiblingMatch.id);
      }
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
  const inferredParentById = inferLocationParents(locations);
  for (const [childId, parentId] of inferredParentById) {
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

  return hasChildren ? [entity.name] : ["Location uncertain"];
}

export function getEntityFolderSegments(
  entity: EntitySummaryRecord,
  categoryEntities: EntitySummaryRecord[],
  context?: {
    characterChapterCounts?: Map<string, number>;
  },
) {
  switch (entity.category) {
    case "character":
      return inferCharacterSegments(
        entity,
        context?.characterChapterCounts?.get(entity.id) ?? 0,
      );
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
  const characterChapterCounts =
    category === "character"
      ? buildCharacterChapterCountMap(entities)
      : undefined;

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
    const segments = getEntityFolderSegments(entity, entities, {
      characterChapterCounts,
    });
    const container = ensureFolder(segments);
    container.push(createArticleNode(entity));
  }

  function sortNodes(nodes: WikiNode[], parentLabel?: string) {
    nodes.sort((left, right) => {
      if (category === "location") {
        const leftIsLocationUncertain =
          left.kind === "folder" &&
          left.label.localeCompare("Location uncertain", undefined, {
            sensitivity: "base",
          }) === 0;
        const rightIsLocationUncertain =
          right.kind === "folder" &&
          right.label.localeCompare("Location uncertain", undefined, {
            sensitivity: "base",
          }) === 0;
        if (leftIsLocationUncertain !== rightIsLocationUncertain) {
          return leftIsLocationUncertain ? 1 : -1;
        }
      }

      if (category === "location" && parentLabel) {
        const leftIsDossier =
          left.kind === "article" &&
          left.label.localeCompare(parentLabel, undefined, {
            sensitivity: "base",
          }) === 0;
        const rightIsDossier =
          right.kind === "article" &&
          right.label.localeCompare(parentLabel, undefined, {
            sensitivity: "base",
          }) === 0;

        if (leftIsDossier !== rightIsDossier) {
          return leftIsDossier ? -1 : 1;
        }
      }

      if (
        category === "character" &&
        left.kind === "folder" &&
        right.kind === "folder"
      ) {
        const leftRank =
          characterFolderOrder.get(left.label) ?? Number.MAX_SAFE_INTEGER;
        const rightRank =
          characterFolderOrder.get(right.label) ?? Number.MAX_SAFE_INTEGER;
        if (leftRank !== rightRank) {
          return leftRank - rightRank;
        }
      }

      if (left.kind !== right.kind) {
        return left.kind === "folder" ? -1 : 1;
      }

      return left.label.localeCompare(right.label, undefined, {
        sensitivity: "base",
      });
    });

    for (const node of nodes) {
      if (node.children) {
        sortNodes(node.children, node.label);
      }
    }
  }

  sortNodes(roots);

  return roots;
}

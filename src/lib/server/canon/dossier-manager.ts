import type { ScanEntity, ExtractedFact } from "$lib/types/scan-result";

export function buildCharacterArticleBody(entity: ScanEntity): string {
  const lines: string[] = [];
  // Overview summary
  if (entity.summary && entity.summary.trim()) {
    lines.push(entity.summary.trim(), "");
  }

  // Helper to group facts by field prefix
  function groupFacts(prefix: string): ExtractedFact[] {
    return (entity.facts || []).filter((f) => f.field.startsWith(prefix));
  }

  // Role / Titles
  lines.push("## Role / Titles");
  const roleFacts = groupFacts("role.");
  if (roleFacts.length > 0) {
    for (const fact of roleFacts) {
      lines.push(`- ${fact.value}`);
    }
  } else {
    lines.push("- Missing / unestablished");
  }
  lines.push("");

  // Physical Description
  lines.push("## Physical Description");
  const appearanceFacts = groupFacts("appearance.");
  if (appearanceFacts.length > 0) {
    for (const fact of appearanceFacts) {
      lines.push(`- ${fact.value}`);
    }
  } else {
    lines.push("- Missing / unestablished");
  }
  lines.push("");

  // Relationships
  lines.push("## Relationships");
  const relationshipFacts = groupFacts("relationship.");
  if (relationshipFacts.length > 0) {
    for (const fact of relationshipFacts) {
      lines.push(`- ${fact.value}`);
    }
  } else {
    lines.push("- Missing / unestablished");
  }
  lines.push("");

  // Outfit / Appearance by Scene
  lines.push("## Outfit / Appearance by Scene");
  const outfitFacts = groupFacts("appearance.clothing").concat(
    groupFacts("appearance.outfit"),
  );
  if (outfitFacts.length > 0) {
    for (const fact of outfitFacts) {
      lines.push(`- ${fact.value}`);
    }
  } else {
    lines.push("- Missing / unestablished");
  }

  return lines.join("\n").trim();
}
import { rmSync } from "node:fs";
import { join } from "node:path";
import { getDatabase, makeId, nowIso } from "$lib/server/db/client";
import { getAppPaths } from "$lib/server/settings/config";
import type { EntityCategory } from "$lib/types/domain";
import {
  upsertUserCanonDecision,
  type UserCanonDecision,
} from "./user-canon-decisions";
import { regenerateProjectFiles } from "$lib/server/sync/projector";
import { regenerateGeneratedPages } from "$lib/server/scan/reconcile-canon";
import { CHARACTER_FOLDER_OPTIONS } from "$lib/server/wiki/entity-organization";

const categoryLabels = {
  character: "Characters",
  location: "Locations",
  item: "Items",
  organization: "Organizations",
} as const;

function normalizeName(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeFolderPath(value: string | undefined) {
  return (value ?? "")
    .split(/[>/]/)
    .map((segment) => normalizeName(segment))
    .filter(Boolean)
    .join("/");
}

function normalizeCharacterFolderPath(value: string | undefined) {
  const normalized = normalizeName(value ?? "");
  if (!normalized) {
    return "";
  }

  const matched = CHARACTER_FOLDER_OPTIONS.find(
    (option) => option.toLowerCase() === normalized.toLowerCase(),
  );

  if (!matched) {
    throw new Error(
      `Character tier must be one of: ${CHARACTER_FOLDER_OPTIONS.join(", ")}.`,
    );
  }

  return matched;
}

function getEntityByCategoryAndSlug(category: string, slug: string) {
  return getDatabase()
    .prepare("SELECT * FROM entities WHERE category = ? AND slug = ? LIMIT 1")
    .get(category, slug) as Record<string, unknown> | undefined;
}

function getEntityById(entityId: string) {
  return getDatabase()
    .prepare("SELECT * FROM entities WHERE id = ? LIMIT 1")
    .get(entityId) as Record<string, unknown> | undefined;
}

function resolveLocationParentEntityId(input: {
  entityId: string;
  category: EntityCategory;
  parentLocationName?: string;
}) {
  if (input.category !== "location") {
    return null;
  }

  const parentLocationName = normalizeName(input.parentLocationName ?? "");
  if (!parentLocationName) {
    return null;
  }

  const parent = findEntityByNameOrAlias(parentLocationName);
  if (!parent || parent.category !== "location") {
    throw new Error("Parent location dossier not found.");
  }

  if (String(parent.id) === input.entityId) {
    throw new Error("A location cannot be its own parent.");
  }

  return String(parent.id);
}

function findEntityByNameOrAlias(name: string) {
  const db = getDatabase();
  const existingByName = db
    .prepare("SELECT * FROM entities WHERE lower(name) = lower(?) LIMIT 1")
    .get(name) as Record<string, unknown> | undefined;
  if (existingByName) {
    return existingByName;
  }

  return db
    .prepare(
      `SELECT e.*
         FROM entity_aliases a
         JOIN entities e ON e.id = a.entity_id
        WHERE lower(a.alias) = lower(?)
        LIMIT 1`,
    )
    .get(name) as Record<string, unknown> | undefined;
}

function listEntityAliases(entityId: string) {
  return getDatabase()
    .prepare(
      "SELECT alias FROM entity_aliases WHERE entity_id = ? ORDER BY alias",
    )
    .all(entityId)
    .map((row) => String((row as Record<string, unknown>).alias));
}

function persistAliases(entityId: string, aliases: string[]) {
  const db = getDatabase();
  const uniqueAliases = [
    ...new Set(aliases.map((alias) => normalizeName(alias)).filter(Boolean)),
  ];

  for (const alias of uniqueAliases) {
    const existing = db
      .prepare(
        "SELECT id FROM entity_aliases WHERE entity_id = ? AND lower(alias) = lower(?) LIMIT 1",
      )
      .get(entityId, alias) as Record<string, unknown> | undefined;
    if (existing) {
      continue;
    }

    db.prepare(
      "INSERT INTO entity_aliases (id, entity_id, alias, source_chapter_id, created_at) VALUES (?, ?, ?, NULL, ?)",
    ).run(makeId(), entityId, alias, nowIso());
  }
}

function deleteEntityById(entityId: string) {
  const db = getDatabase();
  db.prepare("DELETE FROM entity_aliases WHERE entity_id = ?").run(entityId);
  db.prepare(
    "DELETE FROM entity_links WHERE from_entity_id = ? OR to_entity_id = ?",
  ).run(entityId, entityId);
  db.prepare("DELETE FROM entities WHERE id = ?").run(entityId);
}

function removeProjectedEntityFile(category: EntityCategory, slug: string) {
  const { projectDataDir } = getAppPaths();
  const filePath = join(
    projectDataDir,
    "wiki",
    categoryLabels[category],
    `${slug}.md`,
  );
  rmSync(filePath, { force: true });
}

function refreshCanonOutputs() {
  regenerateGeneratedPages();
  regenerateProjectFiles();
}

function mergeEntityLinks(sourceEntityId: string, targetEntityId: string) {
  const db = getDatabase();
  db.prepare(
    "UPDATE entity_links SET from_entity_id = ? WHERE from_entity_id = ?",
  ).run(targetEntityId, sourceEntityId);
  db.prepare(
    "UPDATE entity_links SET to_entity_id = ? WHERE to_entity_id = ?",
  ).run(targetEntityId, sourceEntityId);
  db.prepare(
    "DELETE FROM entity_links WHERE from_entity_id = to_entity_id",
  ).run();
}

function mergeDecisionFromEntities(input: {
  sourceName: string;
  sourceAliases: string[];
  targetName: string;
  targetCategory: EntityCategory;
  targetArticleBody: string;
  notes?: string;
}) {
  return {
    matchNames: [input.sourceName, ...input.sourceAliases].map((name) =>
      normalizeName(name),
    ),
    action: "merge" as const,
    mergeIntoName: normalizeName(input.targetName),
    category: input.targetCategory,
    articleBody: input.targetArticleBody.trim(),
    notes: input.notes,
  } satisfies Omit<UserCanonDecision, "updatedAt">;
}

export function mergeDossierBySlug(input: {
  currentCategory: string;
  slug: string;
  targetName: string;
  notes?: string;
}) {
  const sourceEntity = getEntityByCategoryAndSlug(
    input.currentCategory,
    input.slug,
  );
  if (!sourceEntity) {
    throw new Error("Dossier not found.");
  }

  const sourceEntityId = String(sourceEntity.id);
  const targetEntity = findEntityByNameOrAlias(input.targetName);
  if (!targetEntity) {
    throw new Error("Merge target dossier not found.");
  }

  const targetEntityId = String(targetEntity.id);
  if (sourceEntityId === targetEntityId) {
    throw new Error("A dossier cannot be merged with itself.");
  }

  const sourceName = String(sourceEntity.name);
  const sourceAliases = listEntityAliases(sourceEntityId);
  const targetName = String(targetEntity.name);
  const targetCategory = targetEntity.category as EntityCategory;
  const targetSlug = String(targetEntity.slug);
  const targetArticleBody = String(targetEntity.article_body ?? "");
  const sourceCategory = sourceEntity.category as EntityCategory;

  upsertUserCanonDecision(
    mergeDecisionFromEntities({
      sourceName,
      sourceAliases,
      targetName,
      targetCategory,
      targetArticleBody,
      notes: input.notes,
    }),
  );

  persistAliases(
    targetEntityId,
    [sourceName, ...sourceAliases, ...listEntityAliases(targetEntityId)].filter(
      (alias) =>
        normalizeName(alias).toLowerCase() !== targetName.toLowerCase(),
    ),
  );
  mergeEntityLinks(sourceEntityId, targetEntityId);

  const refreshedTarget = getEntityById(targetEntityId);
  if (
    refreshedTarget &&
    String(refreshedTarget.is_stub) === "1" &&
    String(sourceEntity.is_stub) !== "1"
  ) {
    getDatabase()
      .prepare(
        "UPDATE entities SET article_body = ?, is_stub = '0', updated_at = ? WHERE id = ?",
      )
      .run(
        String(sourceEntity.article_body ?? targetArticleBody),
        nowIso(),
        targetEntityId,
      );
  }

  deleteEntityById(sourceEntityId);
  removeProjectedEntityFile(sourceCategory, input.slug);
  refreshCanonOutputs();

  return {
    redirectHref: `/wiki/${targetCategory}/${targetSlug}`,
    merged: true,
  };
}

function buildDecisionFromEntity(input: {
  existingName: string;
  existingAliases: string[];
  name: string;
  category: EntityCategory;
  articleBody: string;
  suppress: boolean;
  notes?: string;
}) {
  const matchNames = [
    input.existingName,
    ...input.existingAliases,
    input.name,
  ].map((name) => normalizeName(name));

  if (input.suppress) {
    return {
      matchNames,
      action: "suppress" as const,
      notes: input.notes,
    } satisfies Omit<UserCanonDecision, "updatedAt">;
  }

  return {
    matchNames,
    action: "override" as const,
    canonicalName: normalizeName(input.name),
    category: input.category,
    articleBody: input.articleBody.trim(),
    notes: input.notes,
  } satisfies Omit<UserCanonDecision, "updatedAt">;
}

export function updateDossierBySlug(input: {
  currentCategory: string;
  slug: string;
  name: string;
  category: EntityCategory;
  articleBody: string;
  folderPath?: string;
  parentLocationName?: string;
  suppress?: boolean;
  mergeIntoName?: string;
  notes?: string;
}) {
  const mergeTargetName = input.mergeIntoName?.trim();
  if (mergeTargetName) {
    return mergeDossierBySlug({
      currentCategory: input.currentCategory,
      slug: input.slug,
      targetName: mergeTargetName,
      notes: input.notes,
    });
  }

  const entity = getEntityByCategoryAndSlug(input.currentCategory, input.slug);
  if (!entity) {
    throw new Error("Dossier not found.");
  }

  const entityId = String(entity.id);
  const existingName = String(entity.name);
  const existingCategory = entity.category as EntityCategory;
  const existingAliases = listEntityAliases(entityId);
  const folderPath =
    input.category === "character"
      ? normalizeCharacterFolderPath(input.folderPath)
      : normalizeFolderPath(input.folderPath);
  const parentEntityId = resolveLocationParentEntityId({
    entityId,
    category: input.category,
    parentLocationName: input.parentLocationName,
  });

  // If character, build articleBody from structured fields
  let articleBody = input.articleBody;
  if (input.category === "character") {
    // Try to parse input.articleBody as JSON ScanEntity, else fallback to input fields
    let entity: ScanEntity | null = null;
    try {
      entity =
        typeof input.articleBody === "string" &&
        input.articleBody.trim().startsWith("{")
          ? JSON.parse(input.articleBody)
          : null;
    } catch {}
    if (!entity) {
      // Fallback: build from input fields if available
      entity = {
        name: input.name,
        category: "character",
        summary: input.articleBody,
        isStub: false,
        aliases: [],
        links: [],
        characterImportance: null,
        roleTitleFacts: (input as any).roleTitleFacts ?? [],
        physicalDescription: (input as any).physicalDescription ?? [],
        relationshipFacts: (input as any).relationshipFacts ?? [],
        outfitByScene: (input as any).outfitByScene ?? [],
        itemSubtype: null,
        parentLocationName: null,
      };
    }
    articleBody = buildCharacterArticleBody(entity);
  }

  const decision = buildDecisionFromEntity({
    existingName,
    existingAliases,
    name: input.name,
    category: input.category,
    articleBody,
    suppress: Boolean(input.suppress),
    notes: input.notes,
  });

  upsertUserCanonDecision(decision);

  if (input.suppress) {
    deleteEntityById(entityId);
    removeProjectedEntityFile(existingCategory, input.slug);
    refreshCanonOutputs();

    return {
      redirectHref: `/wiki/${existingCategory}/${existingCategory}-all`,
      suppressed: true,
    };
  }

  getDatabase()
    .prepare(
      `UPDATE entities
         SET name = ?, category = ?, subtype = ?, parent_entity_id = ?, article_body = ?, is_stub = '0', updated_at = ?
       WHERE id = ?`,
    )
    .run(
      normalizeName(input.name),
      input.category,
      folderPath || null,
      parentEntityId,
      articleBody.trim(),
      nowIso(),
      entityId,
    );

  persistAliases(entityId, [...existingAliases, existingName]);
  if (existingCategory !== input.category) {
    removeProjectedEntityFile(existingCategory, input.slug);
  }
  refreshCanonOutputs();

  return {
    redirectHref: `/wiki/${input.category}/${input.slug}`,
    suppressed: false,
  };
}

export function applyChatCanonAction(action: {
  type: "suppress-dossier" | "reclassify-dossier" | "merge-dossier";
  name: string;
  category?: EntityCategory;
  targetName?: string;
  notes?: string;
}) {
  const existing = findEntityByNameOrAlias(action.name);

  if (action.type === "suppress-dossier") {
    const existingName = existing ? String(existing.name) : action.name;
    const existingAliases = existing
      ? listEntityAliases(String(existing.id))
      : [];
    upsertUserCanonDecision({
      matchNames: [existingName, ...existingAliases, action.name],
      action: "suppress",
      notes: action.notes,
    });

    if (existing) {
      deleteEntityById(String(existing.id));
      removeProjectedEntityFile(
        existing.category as EntityCategory,
        String(existing.slug),
      );
      refreshCanonOutputs();
      return `Suppressed the dossier for ${existingName}. Future scans will ignore that name unless you change the local decision.`;
    }

    return `Stored a local rule to ignore ${action.name} as a dossier in future scans.`;
  }

  if (action.type === "merge-dossier") {
    if (!existing) {
      throw new Error("The dossier to merge was not found.");
    }

    if (!action.targetName?.trim()) {
      throw new Error("Merge actions require a target dossier name.");
    }

    mergeDossierBySlug({
      currentCategory: String(existing.category),
      slug: String(existing.slug),
      targetName: action.targetName,
      notes: action.notes,
    });
    const target = findEntityByNameOrAlias(action.targetName);
    const resolvedTargetName = target ? String(target.name) : action.targetName;
    return `Merged ${String(existing.name)} into ${resolvedTargetName}. Future scans will fold those names into the same dossier.`;
  }

  if (!action.category) {
    throw new Error("Reclassification actions require a target category.");
  }

  const existingName = existing ? String(existing.name) : action.name;
  const existingAliases = existing
    ? listEntityAliases(String(existing.id))
    : [];
  const existingBody = existing ? String(existing.article_body) : "";
  upsertUserCanonDecision({
    matchNames: [existingName, ...existingAliases, action.name],
    action: "override",
    canonicalName: existingName,
    category: action.category,
    articleBody: existingBody,
    notes: action.notes,
  });

  if (existing) {
    const previousCategory = existing.category as EntityCategory;
    getDatabase()
      .prepare(
        "UPDATE entities SET category = ?, is_stub = '0', updated_at = ? WHERE id = ?",
      )
      .run(action.category, nowIso(), String(existing.id));
    if (previousCategory !== action.category) {
      removeProjectedEntityFile(previousCategory, String(existing.slug));
    }
    refreshCanonOutputs();
    return `Reclassified ${existingName} as ${action.category}. Future scans will keep that category unless you change the local decision.`;
  }

  return `Stored a local rule to classify ${action.name} as ${action.category} when it appears in future scans.`;
}

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getAppPaths } from "$lib/server/settings/config";
import type { EntityCategory } from "$lib/types/domain";
import type { ScanResult } from "$lib/types/scan-result";

export interface UserCanonDecision {
  matchNames: string[];
  action: "suppress" | "override" | "merge";
  category?: EntityCategory;
  itemSubtype?: ScanResult["entities"][number]["itemSubtype"];
  canonicalName?: string;
  mergeIntoName?: string;
  articleBody?: string;
  notes?: string;
  updatedAt: string;
}

const supportedItemSubtypeValues = [
  "Weapons",
  "Documents",
  "Artifacts",
  "Clothing",
  "Events",
  "Publications",
  "Vehicles",
  "Animals",
  "Plants",
  "Other",
] as const satisfies NonNullable<UserCanonDecision["itemSubtype"]>[];

const supportedItemSubtypes = new Set<string>(supportedItemSubtypeValues);

function normalizeMatchName(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function uniqueNames(values: string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values.map((item) => item.replace(/\s+/g, " ").trim())) {
    if (!value) {
      continue;
    }

    const normalized = normalizeMatchName(value);
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    unique.push(value);
  }

  return unique;
}

function ensureDecisionFile() {
  const { userCanonDecisionsPath } = getAppPaths();
  mkdirSync(dirname(userCanonDecisionsPath), { recursive: true });

  if (!existsSync(userCanonDecisionsPath)) {
    writeFileSync(userCanonDecisionsPath, "[]\n");
  }

  return userCanonDecisionsPath;
}

function parseDecisionList(input: unknown) {
  if (!Array.isArray(input)) {
    return [] as UserCanonDecision[];
  }

  return input.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const record = item as Record<string, unknown>;
    const action = record.action;
    if (action !== "suppress" && action !== "override" && action !== "merge") {
      return [];
    }

    const matchNames = uniqueNames(
      Array.isArray(record.matchNames)
        ? record.matchNames.filter(
            (value): value is string => typeof value === "string",
          )
        : [],
    );

    if (matchNames.length === 0) {
      return [];
    }

    const category = record.category;
    const normalizedCategory =
      category === "character" ||
      category === "location" ||
      category === "item" ||
      category === "organization"
        ? category
        : undefined;
    const itemSubtype = record.itemSubtype;
    const normalizedItemSubtype =
      typeof itemSubtype === "string" && supportedItemSubtypes.has(itemSubtype)
        ? (itemSubtype as UserCanonDecision["itemSubtype"])
        : undefined;

    return [
      {
        matchNames,
        action,
        category: normalizedCategory,
        itemSubtype: normalizedItemSubtype,
        canonicalName:
          typeof record.canonicalName === "string"
            ? record.canonicalName.trim() || undefined
            : undefined,
        mergeIntoName:
          typeof record.mergeIntoName === "string"
            ? record.mergeIntoName.trim() || undefined
            : undefined,
        articleBody:
          typeof record.articleBody === "string"
            ? record.articleBody.trim() || undefined
            : undefined,
        notes:
          typeof record.notes === "string"
            ? record.notes.trim() || undefined
            : undefined,
        updatedAt:
          typeof record.updatedAt === "string"
            ? record.updatedAt
            : new Date().toISOString(),
      } satisfies UserCanonDecision,
    ];
  });
}

function writeDecisionList(decisions: UserCanonDecision[]) {
  writeFileSync(
    ensureDecisionFile(),
    `${JSON.stringify(decisions, null, 2)}\n`,
  );
}

export function listUserCanonDecisions() {
  const contents = readFileSync(ensureDecisionFile(), "utf-8");

  try {
    return parseDecisionList(JSON.parse(contents));
  } catch {
    return [] as UserCanonDecision[];
  }
}

export function findUserCanonDecisionByNames(names: string[]) {
  const candidates = new Set(
    names.map((name) => normalizeMatchName(name)).filter(Boolean),
  );
  if (candidates.size === 0) {
    return null;
  }

  return (
    listUserCanonDecisions().find((decision) =>
      decision.matchNames.some((name) =>
        candidates.has(normalizeMatchName(name)),
      ),
    ) ?? null
  );
}

export function upsertUserCanonDecision(
  decision: Omit<UserCanonDecision, "updatedAt">,
) {
  const matchNames = uniqueNames(decision.matchNames);
  if (matchNames.length === 0) {
    throw new Error("User canon decisions require at least one match name.");
  }

  const decisions = listUserCanonDecisions();
  const decisionNames = new Set(
    matchNames.map((name) => normalizeMatchName(name)),
  );
  const nextDecision: UserCanonDecision = {
    ...decision,
    matchNames,
    updatedAt: new Date().toISOString(),
  };
  const existingIndex = decisions.findIndex((record) =>
    record.matchNames.some((name) =>
      decisionNames.has(normalizeMatchName(name)),
    ),
  );

  if (existingIndex >= 0) {
    const existing = decisions[existingIndex];
    decisions[existingIndex] = {
      ...nextDecision,
      matchNames: uniqueNames([
        ...existing.matchNames,
        ...nextDecision.matchNames,
      ]),
    };
  } else {
    decisions.push(nextDecision);
  }

  writeDecisionList(decisions);
  return findUserCanonDecisionByNames(matchNames);
}

export function applyUserCanonDecisionToEntity(
  entity: ScanResult["entities"][number],
) {
  const decision = findUserCanonDecisionByNames([
    entity.name,
    ...entity.aliases,
  ]);
  if (!decision) {
    return entity;
  }

  if (decision.action === "suppress") {
    return null;
  }

  const canonicalName =
    decision.action === "merge"
      ? decision.mergeIntoName?.trim() || entity.name
      : decision.canonicalName?.trim() || entity.name;
  const canonicalAliases = uniqueNames([
    ...entity.aliases,
    ...decision.matchNames.filter(
      (name) => normalizeMatchName(name) !== normalizeMatchName(canonicalName),
    ),
    entity.name,
  ]).filter(
    (name) => normalizeMatchName(name) !== normalizeMatchName(canonicalName),
  );

  return {
    ...entity,
    name: canonicalName,
    category: decision.category ?? entity.category,
    itemSubtype:
      (decision.category ?? entity.category) === "item"
        ? (decision.itemSubtype ?? entity.itemSubtype)
        : null,
    summary: decision.articleBody?.trim() || entity.summary,
    aliases: canonicalAliases,
  };
}

export function shouldSuppressCanonName(...names: string[]) {
  return findUserCanonDecisionByNames(names)?.action === "suppress";
}

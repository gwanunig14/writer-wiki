import { z } from "zod";

export const itemSubtypeSchema = z.enum([
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
]);

// Fact confidence and persistence enums
export const factConfidenceSchema = z.enum([
  "confirmed",
  "probable",
  "possible",
]);

export const factPersistenceSchema = z.enum([
  "stable",
  "scene-specific",
  "temporary",
  "unknown",
]);

export const factFieldSchema = z.enum([
  "role.title",
  "role.status",
  "role.function",

  "appearance.age",
  "appearance.height",
  "appearance.build",
  "appearance.hairColor",
  "appearance.hairStyle",
  "appearance.eyeColor",
  "appearance.face",
  "appearance.scars",
  "appearance.clothing",
  "appearance.accessories",
  "appearance.general",

  "relationship.family",
  "relationship.employment",
  "relationship.alliance",
  "relationship.ownership",
  "relationship.rivalry",

  "location.parent",
  "location.type",
  "location.description",
  "location.feature",

  "item.subtype",
  "item.owner",
  "item.description",

  "organization.member",
  "organization.leader",
  "organization.type",

  "event.participant",
  "event.location",
  "event.consequence",

  "other",
]);

export const extractedFactSchema = z.object({
  entityName: z.string().min(1),
  entityCategory: z.enum(["character", "location", "item", "organization"]),
  field: factFieldSchema,
  value: z.string().min(1),
  evidence: z.string().min(1),
  confidence: factConfidenceSchema.default("confirmed"),
  persistence: factPersistenceSchema.default("unknown"),
  sceneLabel: z.string().nullable().default(null),
  sourceChapterId: z.string().nullable().default(null),
  sourceChapterNumber: z.number().nullable().default(null),
});

// Entity-level fields and facts
export const scanEntitySchema = z.object({
  name: z.string().min(1),
  category: z.enum(["character", "location", "item", "organization"]),
  itemSubtype: itemSubtypeSchema.optional().nullable(),
  parentLocationName: z.string().optional().nullable(),
  summary: z.string().optional().default(""),
  isStub: z.boolean(),
  aliases: z.array(z.string()).default([]),
  links: z
    .array(z.object({ targetName: z.string(), relationType: z.string() }))
    .default([]),
  characterImportance: z
    .enum(["main", "major", "minor"])
    .nullable()
    .default(null),
  facts: z.array(extractedFactSchema).default([]),
});

export const chronologyItemSchema = z.object({
  label: z.string().min(1),
  body: z.string().min(1),
  confidence: z.enum(["confirmed", "probable", "possible"]).default("probable"),
});

export const watchlistItemSchema = z.object({
  type: z.enum([
    "contradiction",
    "missing-description",
    "name-collision",
    "timeline-risk",
    "relationship-ambiguity",
    "item-clarification",
    "location-risk",
  ]),
  subject: z.string().min(1),
  body: z.string().min(1),
});

export const seriesBibleImpactSchema = z.object({
  outcome: z
    .enum([
      "no-series-bible-update-needed",
      "series-bible-update-required",
      "series-bible-review-required",
    ])
    .default("no-series-bible-update-needed"),
  rationale: z.string().default(""),
  impactedSections: z.array(z.string()).default([]),
});

export const fileImpactItemSchema = z.object({
  targetPath: z.string().min(1),
  action: z.enum(["create", "update", "move"]).default("update"),
  reason: z.string().default(""),
});

export const scanResultSchema = z.object({
  entities: z.array(scanEntitySchema).default([]),
  chronology: z.array(chronologyItemSchema).default([]),
  watchlist: z.array(watchlistItemSchema).default([]),
  newCanon: z.array(z.string()).default([]),
  updatedCanon: z.array(z.string()).default([]),
  seriesBibleImpact: seriesBibleImpactSchema.default({
    outcome: "no-series-bible-update-needed",
    rationale: "",
    impactedSections: [],
  }),
  fileImpact: z.array(fileImpactItemSchema).default([]),
  changeLog: z.array(z.string()).default([]),
});

export const scanSummarySchema = z.object({
  articlesCreated: z.array(z.string()).default([]),
  articlesUpdated: z.array(z.string()).default([]),
  stubsCreated: z.array(z.string()).default([]),
  chronologyUpdated: z.array(z.string()).default([]),
  continuityUpdated: z.array(z.string()).default([]),
  contradictionsFlagged: z.array(z.string()).default([]),
});

export type FactConfidence = z.infer<typeof factConfidenceSchema>;
export type FactPersistence = z.infer<typeof factPersistenceSchema>;
export type ExtractedFact = z.infer<typeof extractedFactSchema>;
export type ScanEntity = z.infer<typeof scanEntitySchema>;
export type ScanResult = z.infer<typeof scanResultSchema>;
export type ScanSummary = z.infer<typeof scanSummarySchema>;
export type FactField = z.infer<typeof factFieldSchema>;

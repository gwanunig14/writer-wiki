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

export const scanEntitySchema = z.object({
  name: z.string().min(1),
  category: z.enum(["character", "location", "item", "organization"]),
  itemSubtype: itemSubtypeSchema.optional().nullable(),
  parentLocationName: z.string().optional().nullable(),
  summary: z.string().min(1),
  isStub: z.boolean(),
  aliases: z.array(z.string()).default([]),
  links: z
    .array(z.object({ targetName: z.string(), relationType: z.string() }))
    .default([]),
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
  summary: z.object({
    articlesCreated: z.array(z.string()).default([]),
    articlesUpdated: z.array(z.string()).default([]),
    stubsCreated: z.array(z.string()).default([]),
    chronologyUpdated: z.array(z.string()).default([]),
    continuityUpdated: z.array(z.string()).default([]),
    contradictionsFlagged: z.array(z.string()).default([]),
  }),
});

export type ScanResult = z.infer<typeof scanResultSchema>;
export type ScanEntity = z.infer<typeof scanEntitySchema>;

import { error, json } from "@sveltejs/kit";
import { z } from "zod";
import { updateDossierBySlug } from "$lib/server/canon/dossier-manager";
import { getWikiPage } from "$lib/server/db/repositories/wiki-repository";

const updateDossierSchema = z.object({
  name: z.string().min(1),
  category: z.enum(["character", "location", "item", "organization"]),
  articleBody: z.string().min(1),
  folderPath: z.string().optional(),
  parentLocationName: z.string().optional(),
  suppress: z.boolean().optional(),
  mergeIntoName: z.string().optional(),
  notes: z.string().optional(),
});

export async function GET({ params }) {
  const page = getWikiPage(params.category, params.slug);
  if (!page) {
    throw error(404, "Wiki page not found.");
  }

  return json(page);
}

export async function PUT({ params, request }) {
  const page = getWikiPage(params.category, params.slug);
  if (!page || page.kind !== "article") {
    throw error(404, "Editable dossier not found.");
  }

  const payload = updateDossierSchema.parse(await request.json());
  return json(
    updateDossierBySlug({
      currentCategory: params.category,
      slug: params.slug,
      ...payload,
    }),
  );
}

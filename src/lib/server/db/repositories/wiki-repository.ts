import type { WikiNode, WikiPage } from "$lib/types/domain";
import {
  getEntityByCategoryAndSlug,
  listEntitiesByCategory,
} from "$lib/server/db/repositories/entity-repository";
import { buildCategoryTreeNodes } from "$lib/server/wiki/entity-organization";
import { getDatabase } from "$lib/server/db/client";
import {
  buildEntityWikiPage,
  buildGeneratedWikiPage,
} from "$lib/server/sync/wiki-generator";

const categoryConfig = [
  { key: "character", label: "Characters" },
  { key: "location", label: "Locations" },
  { key: "item", label: "Items" },
  { key: "organization", label: "Organizations" },
] as const;

function getGeneratedPage(slug: string) {
  const row = getDatabase()
    .prepare("SELECT * FROM generated_pages WHERE slug = ? LIMIT 1")
    .get(slug) as Record<string, unknown> | undefined;

  if (!row) {
    return null;
  }

  return {
    id: String(row.id),
    pageType: String(row.page_type),
    category: (row.category as string | null) ?? undefined,
    slug: String(row.slug),
    body: String(row.body),
    updatedAt: String(row.updated_at),
  };
}

export function getWikiTree(): WikiNode[] {
  const categoryNodes: WikiNode[] = [];

  for (const { key, label } of categoryConfig) {
    const entities = listEntitiesByCategory(key);
    if (entities.length === 0) {
      continue;
    }

    categoryNodes.push({
      id: `${key}-root`,
      label,
      kind: "category",
      href: `/wiki/${key}/${key}-all`,
      children: [
        {
          id: `${key}-all`,
          label: `All ${label}`,
          kind: "generated-page",
          href: `/wiki/${key}/${key}-all`,
        },
        ...buildCategoryTreeNodes(key, entities),
      ],
    });
  }

  const chronology = getGeneratedPage("chronology");
  const continuity = getGeneratedPage("continuity-watchlist");

  if (chronology) {
    categoryNodes.push({
      id: chronology.id,
      label: "Chronology",
      kind: "generated-page",
      href: "/chronology",
    });
  }

  if (continuity) {
    categoryNodes.push({
      id: continuity.id,
      label: "Continuity",
      kind: "generated-page",
      href: "/continuity",
    });
  }

  return categoryNodes;
}

export function getWikiPage(category: string, slug: string): WikiPage | null {
  if (slug === `${category}-all`) {
    const generated = getGeneratedPage(slug);
    if (!generated) {
      return null;
    }

    return buildGeneratedWikiPage({
      title: `All ${category[0].toUpperCase()}${category.slice(1)}s`,
      kind: "category-all",
      category,
      body: generated.body,
      updatedAt: generated.updatedAt,
    });
  }

  if (category === "chronology" && slug === "chronology") {
    const generated = getGeneratedPage("chronology");
    return generated
      ? buildGeneratedWikiPage({
          title: "Chronology",
          kind: "chronology",
          category,
          body: generated.body,
          updatedAt: generated.updatedAt,
        })
      : null;
  }

  if (category === "continuity" && slug === "continuity-watchlist") {
    const generated = getGeneratedPage("continuity-watchlist");
    return generated
      ? buildGeneratedWikiPage({
          title: "Continuity Watchlist",
          kind: "continuity",
          category,
          body: generated.body,
          updatedAt: generated.updatedAt,
        })
      : null;
  }

  const entity = getEntityByCategoryAndSlug(category, slug);
  return entity ? buildEntityWikiPage(entity) : null;
}

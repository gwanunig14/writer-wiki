import { describe, expect, it } from "vitest";
import {
  buildCategoryTreeNodes,
  getEntityFolderSegments,
} from "$lib/server/wiki/entity-organization";
import type { EntitySummaryRecord } from "$lib/server/db/repositories/entity-repository";

function makeEntity(
  overrides: Partial<EntitySummaryRecord>,
): EntitySummaryRecord {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name: overrides.name ?? "Unknown",
    slug: overrides.slug ?? "unknown",
    category: overrides.category ?? "character",
    subtype: overrides.subtype ?? null,
    parentEntityId: overrides.parentEntityId ?? null,
    isStub: overrides.isStub ?? false,
    articleBody: overrides.articleBody ?? "",
    createdFromChapterId: overrides.createdFromChapterId ?? null,
    updatedAt: overrides.updatedAt ?? new Date().toISOString(),
  };
}

describe("entity organization", () => {
  it("groups characters into main, major, and minor folders", () => {
    const main = makeEntity({
      name: "Marcus Day",
      slug: "marcus-day",
      category: "character",
      articleBody: "Protagonist bounty hunter returning home.",
    });
    const minor = makeEntity({
      name: "George",
      slug: "george",
      category: "character",
      isStub: true,
      articleBody: "Mentioned only.",
    });

    expect(getEntityFolderSegments(main, [main])).toEqual(["Main"]);
    expect(getEntityFolderSegments(minor, [minor])).toEqual(["Minor"]);
  });

  it("groups horse items into vehicles", () => {
    const horse = makeEntity({
      name: "Fleck",
      slug: "fleck",
      category: "item",
      articleBody: "Marcus rode the horse Fleck back to town.",
    });

    expect(getEntityFolderSegments(horse, [horse])).toEqual(["Vehicles"]);
  });

  it("creates nested location folders from parent place references", () => {
    const vistana = makeEntity({
      name: "Vistana",
      slug: "vistana",
      category: "location",
      articleBody: "Region containing Kinburgh.",
    });
    const kinburgh = makeEntity({
      name: "Kinburgh",
      slug: "kinburgh",
      category: "location",
      articleBody: "Large stone metropolis in Vistana. Contains Watch Hall.",
    });
    const watchHall = makeEntity({
      name: "Watch Hall",
      slug: "watch-hall",
      category: "location",
      articleBody: "Kinburgh's Watch Hall was a long building.",
    });

    expect(
      getEntityFolderSegments(vistana, [vistana, kinburgh, watchHall]),
    ).toEqual(["Vistana"]);
    expect(
      getEntityFolderSegments(kinburgh, [vistana, kinburgh, watchHall]),
    ).toEqual(["Vistana", "Kinburgh"]);
    expect(
      getEntityFolderSegments(watchHall, [vistana, kinburgh, watchHall]),
    ).toEqual(["Vistana", "Kinburgh"]);
  });

  it("prefers explicit parent locations over text inference", () => {
    const vistana = makeEntity({
      id: "vistana",
      name: "Vistana",
      slug: "vistana",
      category: "location",
      articleBody: "Region.",
    });
    const kinburgh = makeEntity({
      id: "kinburgh",
      name: "Kinburgh",
      slug: "kinburgh",
      category: "location",
      articleBody: "City.",
      parentEntityId: "vistana",
    });

    expect(getEntityFolderSegments(kinburgh, [vistana, kinburgh])).toEqual([
      "Vistana",
    ]);
  });

  it("prefers explicit folder paths over inferred folders", () => {
    const item = makeEntity({
      name: "Belt",
      slug: "belt",
      category: "item",
      subtype: "Animals/Riding Horses",
      articleBody: "Horse item.",
    });

    expect(getEntityFolderSegments(item, [item])).toEqual([
      "Animals",
      "Riding Horses",
    ]);
  });

  it("builds nested tree nodes for grouped entities", () => {
    const marcus = makeEntity({
      name: "Marcus Day",
      slug: "marcus-day",
      category: "character",
      articleBody: "Protagonist bounty hunter.",
    });
    const george = makeEntity({
      name: "George",
      slug: "george",
      category: "character",
      isStub: true,
      articleBody: "Mentioned only.",
    });

    const nodes = buildCategoryTreeNodes("character", [marcus, george]);
    expect(nodes.map((node) => node.label)).toEqual(
      expect.arrayContaining(["Main", "Minor"]),
    );
  });
});

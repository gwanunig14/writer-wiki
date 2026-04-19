import { beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDatabase, resetDatabaseForTests } from "$lib/server/db/client";
import { migrate } from "$lib/server/db/migrate";
import {
  upsertChapter,
  listChapters,
} from "$lib/server/db/repositories/chapter-repository";
import { listEntities } from "$lib/server/db/repositories/entity-repository";
import { resetPathsForTests } from "$lib/server/settings/config";
import { dismissWatchlistEntry } from "$lib/server/canon/continuity-manager";
import { normalizeScanResult } from "$lib/server/scan/normalize-scan-result";
import { markLaterAffectedChaptersStale } from "$lib/server/scan/rescan-propagation";
import { reconcileCanon } from "$lib/server/scan/reconcile-canon";

const testRoot = join(process.cwd(), ".tmp-test-data-unit");

describe("scan pipeline", () => {
  beforeEach(() => {
    resetDatabaseForTests();
    resetPathsForTests();
    rmSync(testRoot, { force: true, recursive: true });
    process.env.ACK_DATA_DIR = testRoot;
    process.env.ACK_DB_PATH = join(testRoot, "author-canon-keeper.sqlite");
    process.env.ACK_PROJECT_DATA_DIR = join(testRoot, "project-data");
    migrate();
  });

  it("deduplicates normalized scan entities", () => {
    const normalized = normalizeScanResult(
      {
        entities: [
          {
            name: "Alice",
            category: "character",
            summary: "First summary",
            isStub: true,
            aliases: [],
            links: [],
          },
          {
            name: "Alice",
            category: "character",
            summary: "Duplicate summary",
            isStub: true,
            aliases: [],
            links: [],
          },
        ],
        chronology: [],
        watchlist: [],
        summary: {
          articlesCreated: ["Alice"],
          articlesUpdated: [],
          stubsCreated: ["Alice"],
          chronologyUpdated: [],
          continuityUpdated: [],
          contradictionsFlagged: [],
        },
      },
      "Alice meets Alice inside Harbor City.",
    );

    expect(
      normalized.entities.filter(
        (entity) => entity.category === "character" && entity.name === "Alice",
      ),
    ).toHaveLength(1);
  });

  it("supplements missed named entities from the chapter text", () => {
    const normalized = normalizeScanResult(
      {
        entities: [
          {
            name: "Marcus Day",
            category: "character",
            summary: "Existing summary",
            isStub: false,
            aliases: [],
            links: [],
          },
        ],
        chronology: [],
        watchlist: [],
        summary: {
          articlesCreated: [],
          articlesUpdated: [],
          stubsCreated: [],
          chronologyUpdated: [],
          continuityUpdated: [],
          contradictionsFlagged: [],
        },
      },
      "Marcus Day rode into Elton with Claudia. He left his horse, Fleck, outside The Warm Hearth. Later he returned toward Redden Field and the harbor at Rulfshire Bay.",
    );

    expect(
      normalized.entities.some((entity) => entity.name === "Claudia"),
    ).toBe(true);
    expect(normalized.entities.some((entity) => entity.name === "Elton")).toBe(
      true,
    );
    expect(normalized.entities.some((entity) => entity.name === "Fleck")).toBe(
      true,
    );
    expect(
      normalized.entities.some((entity) => entity.name === "The Warm Hearth"),
    ).toBe(true);
    expect(
      normalized.entities.some((entity) => entity.name === "Redden Field"),
    ).toBe(true);
    expect(
      normalized.entities.some((entity) => entity.name === "Rulfshire Bay"),
    ).toBe(true);
  });

  it("drops ungrounded hallucinated entities while keeping grounded ones", () => {
    const normalized = normalizeScanResult(
      {
        entities: [
          {
            name: "John Essex",
            category: "character",
            summary: "Hallucinated summary",
            isStub: false,
            aliases: [],
            links: [],
          },
          {
            name: "Mina Essex",
            category: "character",
            summary: "Grounded summary",
            isStub: false,
            aliases: [],
            links: [],
          },
        ],
        chronology: [],
        watchlist: [],
        summary: {
          articlesCreated: [],
          articlesUpdated: [],
          stubsCreated: [],
          chronologyUpdated: [],
          continuityUpdated: [],
          contradictionsFlagged: [],
        },
      },
      "Mina Essex leaned across the bar and watched Marcus Day closely.",
    );

    expect(
      normalized.entities.some((entity) => entity.name === "Mina Essex"),
    ).toBe(true);
    expect(
      normalized.entities.some((entity) => entity.name === "John Essex"),
    ).toBe(false);
  });

  it("drops junk character tokens and single-name location collisions", () => {
    const normalized = normalizeScanResult(
      {
        entities: [
          {
            name: "Austin Moon",
            category: "character",
            summary: "Grounded summary",
            isStub: false,
            aliases: [],
            links: [],
          },
          {
            name: "Plato Brice",
            category: "character",
            summary: "Grounded summary",
            isStub: false,
            aliases: [],
            links: [],
          },
          {
            name: "Marcus Day",
            category: "character",
            summary: "Grounded summary",
            isStub: false,
            aliases: [],
            links: [],
          },
          {
            name: "Cards",
            category: "character",
            summary: "Junk summary",
            isStub: true,
            aliases: [],
            links: [],
          },
          {
            name: "Give",
            category: "character",
            summary: "Junk summary",
            isStub: true,
            aliases: [],
            links: [],
          },
          {
            name: "Ms",
            category: "character",
            summary: "Junk summary",
            isStub: true,
            aliases: [],
            links: [],
          },
          {
            name: "Warm Hearth",
            category: "character",
            summary: "Wrong category summary",
            isStub: true,
            aliases: [],
            links: [],
          },
          {
            name: "Imperial Sharpshooters",
            category: "character",
            summary: "Wrong category summary",
            isStub: true,
            aliases: [],
            links: [],
          },
          {
            name: "Austin",
            category: "location",
            summary: "Wrong category summary",
            isStub: true,
            aliases: [],
            links: [],
          },
          {
            name: "Brice",
            category: "location",
            summary: "Wrong category summary",
            isStub: true,
            aliases: [],
            links: [],
          },
          {
            name: "Marcus",
            category: "location",
            summary: "Wrong category summary",
            isStub: true,
            aliases: [],
            links: [],
          },
        ],
        chronology: [],
        watchlist: [],
        summary: {
          articlesCreated: [],
          articlesUpdated: [],
          stubsCreated: [],
          chronologyUpdated: [],
          continuityUpdated: [],
          contradictionsFlagged: [],
        },
      },
      "Austin Moon and Marcus Day met Plato Brice at The Warm Hearth. Mina Essex said the Imperial Sharpshooters were quartered nearby. He gave Billy Luther a deck of cards.",
    );

    expect(normalized.entities.some((entity) => entity.name === "Cards")).toBe(
      false,
    );
    expect(normalized.entities.some((entity) => entity.name === "Give")).toBe(
      false,
    );
    expect(normalized.entities.some((entity) => entity.name === "Ms")).toBe(
      false,
    );
    expect(
      normalized.entities.some(
        (entity) =>
          entity.name === "Warm Hearth" && entity.category === "character",
      ),
    ).toBe(false);
    expect(
      normalized.entities.some(
        (entity) => entity.name === "Austin" && entity.category === "location",
      ),
    ).toBe(false);
    expect(
      normalized.entities.some(
        (entity) => entity.name === "Brice" && entity.category === "location",
      ),
    ).toBe(false);
    expect(
      normalized.entities.some(
        (entity) => entity.name === "Marcus" && entity.category === "location",
      ),
    ).toBe(false);
    expect(
      normalized.entities.some(
        (entity) =>
          entity.name === "Imperial Sharpshooters" &&
          entity.category === "organization",
      ),
    ).toBe(true);
    expect(
      normalized.entities.some(
        (entity) =>
          entity.name === "The Warm Hearth" && entity.category === "location",
      ),
    ).toBe(true);
  });

  it("drops single-word location duplicates even when the character is later referenced by first or last name alone", () => {
    const normalized = normalizeScanResult(
      {
        entities: [
          {
            name: "Austin Moon",
            category: "character",
            summary: "Grounded summary",
            isStub: false,
            aliases: [],
            links: [],
          },
          {
            name: "Plato Brice",
            category: "character",
            summary: "Grounded summary",
            isStub: false,
            aliases: [],
            links: [],
          },
          {
            name: "Marcus Day",
            category: "character",
            summary: "Grounded summary",
            isStub: false,
            aliases: [],
            links: [],
          },
          {
            name: "Austin",
            category: "location",
            summary: "Wrong category summary",
            isStub: true,
            aliases: [],
            links: [],
          },
          {
            name: "Brice",
            category: "location",
            summary: "Wrong category summary",
            isStub: true,
            aliases: [],
            links: [],
          },
          {
            name: "Marcus",
            category: "location",
            summary: "Wrong category summary",
            isStub: true,
            aliases: [],
            links: [],
          },
        ],
        chronology: [],
        watchlist: [],
        summary: {
          articlesCreated: [],
          articlesUpdated: [],
          stubsCreated: [],
          chronologyUpdated: [],
          continuityUpdated: [],
          contradictionsFlagged: [],
        },
      },
      "Austin Moon took a seat while Austin watched the door. Marcus Day spoke first, and Marcus later nodded toward Plato Brice. Brice laughed and waved Billy Luther closer.",
    );

    expect(
      normalized.entities.some(
        (entity) => entity.name === "Austin" && entity.category === "location",
      ),
    ).toBe(false);
    expect(
      normalized.entities.some(
        (entity) => entity.name === "Brice" && entity.category === "location",
      ),
    ).toBe(false);
    expect(
      normalized.entities.some(
        (entity) => entity.name === "Marcus" && entity.category === "location",
      ),
    ).toBe(false);
    expect(
      normalized.entities.some(
        (entity) =>
          entity.name === "Plato Brice" && entity.category === "character",
      ),
    ).toBe(true);
  });

  it("prefers character interpretation for possessive owner references and avoids alias-only supplements", () => {
    const normalized = normalizeScanResult(
      {
        entities: [
          {
            name: "Marcus Day",
            category: "character",
            summary: "Grounded summary",
            isStub: false,
            aliases: ["Marcus"],
            links: [],
          },
          {
            name: "Austin Moon",
            category: "character",
            summary: "Grounded summary",
            isStub: false,
            aliases: ["Austin"],
            links: [],
          },
          {
            name: "Claudia",
            category: "character",
            summary: "Grounded summary",
            isStub: false,
            aliases: ["Claudia Day"],
            links: [],
          },
        ],
        chronology: [],
        watchlist: [],
        summary: {
          articlesCreated: [],
          articlesUpdated: [],
          stubsCreated: [],
          chronologyUpdated: [],
          continuityUpdated: [],
          contradictionsFlagged: [],
        },
      },
      "Marcus Day came home to Claudia. Claudia asked whether Marcus had gone to Plato Brice's saloon to catch Porter. Austin Moon laughed, and Austin helped Marcus unhitch Fleck outside.",
    );

    expect(
      normalized.entities.some(
        (entity) => entity.name === "Claudia" && entity.category === "location",
      ),
    ).toBe(false);
    expect(
      normalized.entities.some(
        (entity) => entity.name === "Austin" && entity.category === "character",
      ),
    ).toBe(false);
    expect(
      normalized.entities.some(
        (entity) => entity.name === "Marcus" && entity.category === "character",
      ),
    ).toBe(false);
    expect(
      normalized.entities.some(
        (entity) =>
          entity.name === "Plato Brice" && entity.category === "location",
      ),
    ).toBe(false);
    expect(
      normalized.entities.some(
        (entity) =>
          entity.name === "Plato Brice" && entity.category === "character",
      ),
    ).toBe(true);
  });

  it("drops dialogue fragments and avoids cross-category duplicate supplements", () => {
    const normalized = normalizeScanResult(
      {
        entities: [
          {
            name: "Marcus Day",
            category: "character",
            summary: "Grounded summary",
            isStub: false,
            aliases: ["Marcus"],
            links: [],
          },
          {
            name: "Claudia",
            category: "character",
            summary: "Grounded summary",
            isStub: false,
            aliases: [],
            links: [],
          },
          {
            name: "Austin Moon",
            category: "character",
            summary: "Grounded summary",
            isStub: false,
            aliases: ["Austin"],
            links: [],
          },
          {
            name: "Jeanne Barrow",
            category: "character",
            summary: "Grounded summary",
            isStub: false,
            aliases: ["Jeanne"],
            links: [],
          },
        ],
        chronology: [],
        watchlist: [],
        summary: {
          articlesCreated: [],
          articlesUpdated: [],
          stubsCreated: [],
          chronologyUpdated: [],
          continuityUpdated: [],
          contradictionsFlagged: [],
        },
      },
      '"And Austin?" Claudia asked. "How much did you earn?" Before Claudia moved in, the house was bare. Just told me he was working for the Shadow King. Tell Captain Carpenter that Marcus Day is here. Tracking Louis Porter. Then Vistani assumed it was a city built around a hill. Jeanne rode her cremello horse, Powder, to the bell rope. "Oh really?" The honor of driving the carts fell to Austin today with his bay destrier, Belt, trotting beside him. He hopped onto Fleck and turned towards home. "Thank you," she said.',
    );

    for (const junkName of [
      "And Austin",
      "Before Claudia",
      "How",
      "Join the City Watch",
      "Just",
      "Motherhood",
      "Oh",
      "See",
      "Thank",
      "Tell Captain Carpenter",
      "Tracking Louis Porter",
      "Then Vistani",
      "Watchman",
    ]) {
      expect(
        normalized.entities.some((entity) => entity.name === junkName),
      ).toBe(false);
    }

    expect(
      normalized.entities.some(
        (entity) =>
          entity.name === "City Watchmen" && entity.category === "character",
      ),
    ).toBe(false);

    expect(
      normalized.entities.some(
        (entity) => entity.name === "Powder" && entity.category === "character",
      ),
    ).toBe(false);
    expect(
      normalized.entities.some(
        (entity) => entity.name === "Belt" && entity.category === "character",
      ),
    ).toBe(false);
    expect(
      normalized.entities.some(
        (entity) => entity.name === "Fleck" && entity.category === "character",
      ),
    ).toBe(false);
  });

  it("drops standalone first-name character pages when a fuller character name already exists", () => {
    const normalized = normalizeScanResult(
      {
        entities: [
          {
            name: "Austin Moon",
            category: "character",
            summary: "Grounded summary",
            isStub: false,
            aliases: [],
            links: [],
          },
          {
            name: "Austin",
            category: "character",
            summary: "Alias-like summary",
            isStub: true,
            aliases: [],
            links: [],
          },
          {
            name: "Jeanne Barrow",
            category: "character",
            summary: "Grounded summary",
            isStub: false,
            aliases: [],
            links: [],
          },
          {
            name: "Jeanne",
            category: "character",
            summary: "Alias-like summary",
            isStub: true,
            aliases: [],
            links: [],
          },
        ],
        chronology: [],
        watchlist: [],
        summary: {
          articlesCreated: [],
          articlesUpdated: [],
          stubsCreated: [],
          chronologyUpdated: [],
          continuityUpdated: [],
          contradictionsFlagged: [],
        },
      },
      "Austin Moon rode with Jeanne Barrow. Austin laughed, and Jeanne answered from the saddle.",
    );

    expect(
      normalized.entities.some(
        (entity) => entity.name === "Austin" && entity.category === "character",
      ),
    ).toBe(false);
    expect(
      normalized.entities.some(
        (entity) => entity.name === "Jeanne" && entity.category === "character",
      ),
    ).toBe(false);
    expect(
      normalized.entities.some(
        (entity) =>
          entity.name === "Austin Moon" && entity.category === "character",
      ),
    ).toBe(true);
    expect(
      normalized.entities.some(
        (entity) =>
          entity.name === "Jeanne Barrow" && entity.category === "character",
      ),
    ).toBe(true);
  });

  it("strips title prefixes from full character names", () => {
    const normalized = normalizeScanResult(
      {
        entities: [
          {
            name: "Lady Jane Doe",
            category: "character",
            summary: "Grounded summary",
            isStub: false,
            aliases: [],
            links: [],
          },
          {
            name: "Captain Carpenter",
            category: "character",
            summary: "Single-name title form",
            isStub: true,
            aliases: [],
            links: [],
          },
        ],
        chronology: [],
        watchlist: [],
        summary: {
          articlesCreated: [],
          articlesUpdated: [],
          stubsCreated: [],
          chronologyUpdated: [],
          continuityUpdated: [],
          contradictionsFlagged: [],
        },
      },
      "Lady Jane Doe entered the room. Captain Carpenter nodded once.",
    );

    expect(
      normalized.entities.some(
        (entity) =>
          entity.name === "Jane Doe" && entity.category === "character",
      ),
    ).toBe(true);
    expect(
      normalized.entities.some(
        (entity) =>
          entity.name === "Lady Jane Doe" && entity.category === "character",
      ),
    ).toBe(false);
    expect(
      normalized.entities.some(
        (entity) =>
          entity.name === "Captain Carpenter" &&
          entity.category === "character",
      ),
    ).toBe(true);
  });

  it("classifies 'The Shadow King' as a character and 'The City Watch' as an organization", () => {
    const normalized = normalizeScanResult(
      {
        entities: [
          {
            name: "The Shadow King",
            category: "location",
            summary: "Wrong category summary",
            isStub: true,
            aliases: [],
            links: [],
          },
          {
            name: "The City Watch",
            category: "location",
            summary: "Wrong category summary",
            isStub: true,
            aliases: [],
            links: [],
          },
        ],
        chronology: [],
        watchlist: [],
        summary: {
          articlesCreated: [],
          articlesUpdated: [],
          stubsCreated: [],
          chronologyUpdated: [],
          continuityUpdated: [],
          contradictionsFlagged: [],
        },
      },
      "Louis Porter swore The Shadow King paid him to do it. The City Watch took the prisoners and processed the warrants.",
    );

    expect(
      normalized.entities.some(
        (entity) =>
          entity.name === "The Shadow King" && entity.category === "character",
      ),
    ).toBe(true);
    expect(
      normalized.entities.some(
        (entity) =>
          entity.name === "The City Watch" &&
          entity.category === "organization",
      ),
    ).toBe(true);
  });

  it("suppresses user-blocked names from provider and supplemental entities", () => {
    mkdirSync(join(testRoot, "project-data", "system"), { recursive: true });
    writeFileSync(
      join(testRoot, "project-data", "system", "user-canon-decisions.json"),
      JSON.stringify([
        {
          matchNames: ["Jurt"],
          action: "suppress",
          notes: "Book-specific exclamation.",
        },
      ]),
    );

    const normalized = normalizeScanResult(
      {
        entities: [
          {
            name: "Jurt",
            category: "character",
            summary: "Wrongly treated as a person.",
            isStub: true,
            aliases: [],
            links: [],
          },
        ],
        chronology: [],
        watchlist: [],
        summary: {
          articlesCreated: [],
          articlesUpdated: [],
          stubsCreated: [],
          chronologyUpdated: [],
          continuityUpdated: [],
          contradictionsFlagged: [],
        },
      },
      "Alice shouted Jurt and Bob froze in Harbor City.",
    );

    expect(normalized.entities.some((entity) => entity.name === "Jurt")).toBe(
      false,
    );
  });

  it("reclassifies provider entities from local user decisions", () => {
    mkdirSync(join(testRoot, "project-data", "system"), { recursive: true });
    writeFileSync(
      join(testRoot, "project-data", "system", "user-canon-decisions.json"),
      JSON.stringify([
        {
          matchNames: ["The City Watch", "City Watch", "The Watch"],
          action: "override",
          category: "organization",
          canonicalName: "The City Watch",
          articleBody: "Manual override body.",
        },
      ]),
    );

    const normalized = normalizeScanResult(
      {
        entities: [
          {
            name: "The City Watch",
            category: "location",
            summary: "Wrong category summary",
            isStub: true,
            aliases: [],
            links: [],
          },
        ],
        chronology: [],
        watchlist: [],
        summary: {
          articlesCreated: [],
          articlesUpdated: [],
          stubsCreated: [],
          chronologyUpdated: [],
          continuityUpdated: [],
          contradictionsFlagged: [],
        },
      },
      "The City Watch took the prisoners and processed the warrants.",
    );

    expect(normalized.entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "The City Watch",
          category: "organization",
          summary: "Manual override body.",
        }),
      ]),
    );
  });

  it("merges provider aliases into the target dossier from local user decisions", () => {
    mkdirSync(join(testRoot, "project-data", "system"), { recursive: true });
    writeFileSync(
      join(testRoot, "project-data", "system", "user-canon-decisions.json"),
      JSON.stringify([
        {
          matchNames: ["Warm Hearth", "Hearth"],
          action: "merge",
          mergeIntoName: "The Warm Hearth",
          category: "location",
          articleBody: "Canonical inn dossier.",
        },
      ]),
    );

    const normalized = normalizeScanResult(
      {
        entities: [
          {
            name: "Warm Hearth",
            category: "location",
            summary: "Alias form from the provider.",
            isStub: true,
            aliases: ["Hearth"],
            links: [],
          },
        ],
        chronology: [],
        watchlist: [],
        summary: {
          articlesCreated: [],
          articlesUpdated: [],
          stubsCreated: [],
          chronologyUpdated: [],
          continuityUpdated: [],
          contradictionsFlagged: [],
        },
      },
      "They stopped at The Warm Hearth before sunset.",
    );

    expect(normalized.entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "The Warm Hearth",
          category: "location",
        }),
      ]),
    );
    expect(normalized.entities[0]?.aliases).toEqual(
      expect.arrayContaining(["Warm Hearth", "Hearth"]),
    );
  });

  it("stores aliases and merges canonical entity variants into one dossier", () => {
    const chapter = upsertChapter({
      number: 1,
      title: "One",
      text: "Marcus returns to the tavern.",
    });

    reconcileCanon(chapter.id, {
      entities: [
        {
          name: "The Warm Hearth",
          category: "location",
          summary: "A tavern in Elton.",
          isStub: false,
          aliases: ["Warm Hearth"],
          links: [],
        },
      ],
      chronology: [],
      watchlist: [],
      summary: {
        articlesCreated: ["The Warm Hearth"],
        articlesUpdated: [],
        stubsCreated: [],
        chronologyUpdated: [],
        continuityUpdated: [],
        contradictionsFlagged: [],
      },
    });

    reconcileCanon(chapter.id, {
      entities: [
        {
          name: "Hearth",
          category: "location",
          summary: "The same tavern, referenced more casually.",
          isStub: false,
          aliases: [],
          links: [],
        },
      ],
      chronology: [],
      watchlist: [],
      summary: {
        articlesCreated: [],
        articlesUpdated: ["Hearth"],
        stubsCreated: [],
        chronologyUpdated: [],
        continuityUpdated: [],
        contradictionsFlagged: [],
      },
    });

    const entities = listEntities().filter(
      (entity) => entity.category === "location",
    );
    const aliasRows = getDatabase()
      .prepare(
        `SELECT a.alias
           FROM entity_aliases a
           JOIN entities e ON e.id = a.entity_id
          WHERE e.slug = ?
          ORDER BY a.alias`,
      )
      .all("the-warm-hearth") as Array<{ alias: string }>;

    expect(
      entities.filter((entity) => entity.slug === "the-warm-hearth"),
    ).toHaveLength(1);
    expect(
      entities.find((entity) => entity.slug === "the-warm-hearth")?.name,
    ).toBe("The Warm Hearth");
    expect(aliasRows.map((row) => row.alias)).toEqual(
      expect.arrayContaining(["Warm Hearth", "Hearth"]),
    );
  });

  it("merges The Watch into The City Watch while keeping City Watchmen separate", () => {
    const chapter = upsertChapter({
      number: 1,
      title: "One",
      text: "The watch takes custody of the prisoners.",
    });

    reconcileCanon(chapter.id, {
      entities: [
        {
          name: "The City Watch",
          category: "organization",
          summary: "The town's lawkeeping organization.",
          isStub: false,
          aliases: [],
          links: [],
        },
        {
          name: "City Watchmen",
          category: "organization",
          summary: "Individual watchmen employed by the City Watch.",
          isStub: false,
          aliases: [],
          links: [],
        },
      ],
      chronology: [],
      watchlist: [],
      summary: {
        articlesCreated: ["The City Watch", "City Watchmen"],
        articlesUpdated: [],
        stubsCreated: [],
        chronologyUpdated: [],
        continuityUpdated: [],
        contradictionsFlagged: [],
      },
    });

    reconcileCanon(chapter.id, {
      entities: [
        {
          name: "The Watch",
          category: "organization",
          summary: "A shorter reference to the same lawkeeping group.",
          isStub: false,
          aliases: [],
          links: [],
        },
      ],
      chronology: [],
      watchlist: [],
      summary: {
        articlesCreated: [],
        articlesUpdated: ["The Watch"],
        stubsCreated: [],
        chronologyUpdated: [],
        continuityUpdated: [],
        contradictionsFlagged: [],
      },
    });

    const organizations = listEntities().filter(
      (entity) => entity.category === "organization",
    );
    const cityWatch = organizations.find(
      (entity) => entity.name === "The City Watch",
    );
    const cityWatchAliases = getDatabase()
      .prepare(
        `SELECT a.alias
           FROM entity_aliases a
           JOIN entities e ON e.id = a.entity_id
          WHERE e.name = ?
          ORDER BY a.alias`,
      )
      .all("The City Watch") as Array<{ alias: string }>;

    expect(cityWatch).toBeDefined();
    expect(
      organizations.filter((entity) => entity.slug === "city-watchmen"),
    ).toHaveLength(1);
    expect(cityWatchAliases.map((row) => row.alias)).toEqual(
      expect.arrayContaining(["City Watch", "The Watch", "Watch"]),
    );
  });

  it("marks later chapters stale during rescan propagation", () => {
    const first = upsertChapter({ number: 1, title: "One", text: "Alpha" });
    const second = upsertChapter({ number: 2, title: "Two", text: "Beta" });
    const third = upsertChapter({ number: 3, title: "Three", text: "Gamma" });

    const affected = markLaterAffectedChaptersStale(first.id);
    const chapters = listChapters();

    expect(affected).toEqual([second.id, third.id]);
    expect(chapters.find((chapter) => chapter.id === second.id)?.status).toBe(
      "stale",
    );
    expect(chapters.find((chapter) => chapter.id === third.id)?.status).toBe(
      "stale",
    );
  });

  it("promotes a stub in place when later scans add substantive detail", () => {
    const chapter = upsertChapter({
      number: 1,
      title: "One",
      text: "Marcus rides into town.",
    });

    reconcileCanon(chapter.id, {
      entities: [
        {
          name: "Billy Luther",
          category: "character",
          summary: "Named in passing.",
          isStub: true,
          aliases: [],
          links: [],
        },
      ],
      chronology: [],
      watchlist: [],
      summary: {
        articlesCreated: ["Billy Luther"],
        articlesUpdated: [],
        stubsCreated: ["Billy Luther"],
        chronologyUpdated: [],
        continuityUpdated: [],
        contradictionsFlagged: [],
      },
    });

    reconcileCanon(chapter.id, {
      entities: [
        {
          name: "Billy Luther",
          category: "character",
          summary:
            "A felon thought to be long dead, tattooed with playing cards, and currently working as bartender at The Warm Hearth.",
          isStub: true,
          aliases: [],
          links: [],
        },
      ],
      chronology: [],
      watchlist: [],
      summary: {
        articlesCreated: [],
        articlesUpdated: ["Billy Luther"],
        stubsCreated: [],
        chronologyUpdated: [],
        continuityUpdated: [],
        contradictionsFlagged: [],
      },
    });

    const billy = listEntities().find(
      (entity) => entity.name === "Billy Luther",
    );

    expect(billy?.isStub).toBe(false);
  });

  it("does not downgrade an established entity back to stub", () => {
    const chapter = upsertChapter({
      number: 1,
      title: "One",
      text: "Marcus rides into town.",
    });

    reconcileCanon(chapter.id, {
      entities: [
        {
          name: "Marcus Day",
          category: "character",
          summary:
            "A bounty hunter who tracks criminals, supports his family, and plans to retire to a farm after five more years of work.",
          isStub: false,
          aliases: [],
          links: [],
        },
      ],
      chronology: [],
      watchlist: [],
      summary: {
        articlesCreated: ["Marcus Day"],
        articlesUpdated: [],
        stubsCreated: [],
        chronologyUpdated: [],
        continuityUpdated: [],
        contradictionsFlagged: [],
      },
    });

    reconcileCanon(chapter.id, {
      entities: [
        {
          name: "Marcus Day",
          category: "character",
          summary: "Named in passing.",
          isStub: true,
          aliases: [],
          links: [],
        },
      ],
      chronology: [],
      watchlist: [],
      summary: {
        articlesCreated: [],
        articlesUpdated: ["Marcus Day"],
        stubsCreated: [],
        chronologyUpdated: [],
        continuityUpdated: [],
        contradictionsFlagged: [],
      },
    });

    const marcus = listEntities().find(
      (entity) => entity.name === "Marcus Day",
    );

    expect(marcus?.isStub).toBe(false);
  });

  it("promotes concise but descriptive one-sentence dossiers", () => {
    const chapter = upsertChapter({
      number: 1,
      title: "One",
      text: "Marcus mounts Fleck.",
    });

    reconcileCanon(chapter.id, {
      entities: [
        {
          name: "Fleck",
          category: "item",
          summary:
            "Marcus Day's faithful speckled gray horse used for traveling long distances.",
          isStub: true,
          aliases: [],
          links: [],
        },
      ],
      chronology: [],
      watchlist: [],
      summary: {
        articlesCreated: ["Fleck"],
        articlesUpdated: [],
        stubsCreated: [],
        chronologyUpdated: [],
        continuityUpdated: [],
        contradictionsFlagged: [],
      },
    });

    const fleck = listEntities().find((entity) => entity.name === "Fleck");

    expect(fleck?.isStub).toBe(false);
  });

  it("keeps chronology and continuity entries from multiple chapters", () => {
    const first = upsertChapter({ number: 1, title: "Arrival", text: "Alpha" });
    const second = upsertChapter({
      number: 2,
      title: "Aftermath",
      text: "Beta",
    });

    reconcileCanon(first.id, {
      entities: [],
      chronology: [
        {
          label: "Before the tavern fight",
          body: "Marcus arrives in town and takes stock of the streets.",
          confidence: "confirmed",
        },
      ],
      watchlist: [
        {
          type: "timeline-risk",
          subject: "Arrival sequence",
          body: "Order between Marcus's arrival and the first tavern rumor remains unclear.",
        },
      ],
      summary: {
        articlesCreated: [],
        articlesUpdated: [],
        stubsCreated: [],
        chronologyUpdated: ["Before the tavern fight"],
        continuityUpdated: ["Arrival sequence"],
        contradictionsFlagged: [],
      },
    });

    reconcileCanon(second.id, {
      entities: [],
      chronology: [
        {
          label: "After the tavern fight",
          body: "Louis Porter is captured and handed over to the authorities.",
          confidence: "probable",
        },
      ],
      watchlist: [
        {
          type: "missing-description",
          subject: "Billy Luther",
          body: "Missing fields: build, clothing, and age cues are not yet established on-page.",
        },
      ],
      summary: {
        articlesCreated: [],
        articlesUpdated: [],
        stubsCreated: [],
        chronologyUpdated: ["After the tavern fight"],
        continuityUpdated: ["Billy Luther"],
        contradictionsFlagged: [],
      },
    });

    const db = getDatabase();
    const chronologyPage = db
      .prepare("SELECT body FROM generated_pages WHERE slug = ? LIMIT 1")
      .get("chronology") as { body: string } | undefined;
    const continuityPage = db
      .prepare("SELECT body FROM generated_pages WHERE slug = ? LIMIT 1")
      .get("continuity-watchlist") as { body: string } | undefined;

    expect(chronologyPage?.body).toContain("# Chronology Master");
    expect(chronologyPage?.body).toContain("### Before the tavern fight");
    expect(chronologyPage?.body).toContain("### After the tavern fight");
    expect(chronologyPage?.body).toContain("## Date / Sequence Ambiguities");
    expect(continuityPage?.body).toContain("# Continuity Watchlist");
    expect(continuityPage?.body).toContain("## Timeline Risks");
    expect(continuityPage?.body).toContain("## Missing Descriptions");
    expect(continuityPage?.body).toContain("### Billy Luther");
  });

  it("replaces prior chronology and continuity entries for the rescanned chapter only", () => {
    const chapter = upsertChapter({
      number: 1,
      title: "Arrival",
      text: "Alpha",
    });

    reconcileCanon(chapter.id, {
      entities: [],
      chronology: [
        {
          label: "First version",
          body: "Marcus arrives in town.",
          confidence: "confirmed",
        },
      ],
      watchlist: [
        {
          type: "timeline-risk",
          subject: "Old sequence risk",
          body: "Original order remains uncertain.",
        },
      ],
      summary: {
        articlesCreated: [],
        articlesUpdated: [],
        stubsCreated: [],
        chronologyUpdated: ["First version"],
        continuityUpdated: ["Old sequence risk"],
        contradictionsFlagged: [],
      },
    });

    reconcileCanon(chapter.id, {
      entities: [],
      chronology: [
        {
          label: "Revised version",
          body: "Marcus arrives in town after nightfall.",
          confidence: "confirmed",
        },
      ],
      watchlist: [
        {
          type: "missing-description",
          subject: "Night watchman",
          body: "Missing fields: no stable physical description has been established.",
        },
      ],
      summary: {
        articlesCreated: [],
        articlesUpdated: [],
        stubsCreated: [],
        chronologyUpdated: ["Revised version"],
        continuityUpdated: ["Night watchman"],
        contradictionsFlagged: [],
      },
    });

    const db = getDatabase();
    const chronologyEntries = db
      .prepare("SELECT label FROM chronology_entries ORDER BY label")
      .all() as Array<{ label: string }>;
    const watchlistEntries = db
      .prepare("SELECT subject FROM watchlist_entries ORDER BY subject")
      .all() as Array<{ subject: string }>;

    expect(chronologyEntries).toEqual([{ label: "Revised version" }]);
    expect(watchlistEntries).toEqual([{ subject: "Night watchman" }]);
  });

  it("dismisses continuity items by resolving them, keeping them queryable, and regenerating the watchlist page", () => {
    const chapter = upsertChapter({
      number: 1,
      title: "Arrival",
      text: "Alpha",
    });

    reconcileCanon(chapter.id, {
      entities: [],
      chronology: [],
      watchlist: [
        {
          type: "timeline-risk",
          subject: "Old sequence risk",
          body: "Original order remains uncertain.",
        },
      ],
      summary: {
        articlesCreated: [],
        articlesUpdated: [],
        stubsCreated: [],
        chronologyUpdated: [],
        continuityUpdated: ["Old sequence risk"],
        contradictionsFlagged: [],
      },
    });

    const db = getDatabase();
    const watchlistEntry = db
      .prepare("SELECT id FROM watchlist_entries WHERE subject = ? LIMIT 1")
      .get("Old sequence risk") as { id: string } | undefined;

    expect(watchlistEntry).toBeDefined();

    dismissWatchlistEntry(watchlistEntry!.id);

    const resolvedEntry = db
      .prepare(
        "SELECT subject, status FROM watchlist_entries WHERE id = ? LIMIT 1",
      )
      .get(watchlistEntry!.id) as
      | { subject: string; status: string }
      | undefined;
    const continuityPage = db
      .prepare("SELECT body FROM generated_pages WHERE slug = ? LIMIT 1")
      .get("continuity-watchlist") as { body: string } | undefined;

    expect(resolvedEntry?.status).toBe("resolved");
    expect(resolvedEntry?.subject).toBe("Old sequence risk");
    expect(continuityPage?.body).not.toContain("### Old sequence risk");
    expect(continuityPage?.body).toContain("- None currently flagged.");
  });
});

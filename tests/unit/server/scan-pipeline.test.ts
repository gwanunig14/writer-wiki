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
    mkdirSync(testRoot, { recursive: true });
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
    expect(
      normalized.entities.some(
        (entity) => entity.name === "Elton" && entity.category === "location",
      ),
    ).toBe(true);
    expect(
      normalized.entities.some(
        (entity) => entity.name === "Elton" && entity.category === "character",
      ),
    );
    expect(
      normalized.entities.some(
        (entity) => entity.name === "Elton" && entity.category === "character",
      ),
    ).toBe(false);
    expect(normalized.entities.some((entity) => entity.name === "Fleck")).toBe(
      true,
    );
    expect(
      normalized.entities.some(
        (entity) => entity.name === "Fleck" && entity.category === "character",
      ),
    ).toBe(true);
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

  it("upgrades supplemental character summaries when a later mention has stronger description detail", () => {
    const chapterText = [
      "Marcus Day came home to Claudia, his wife.",
      "Claudia, his wife, hadn't lit the crystals yet, but smoke billowed from the chimney.",
      "His wife pushed a strand of her golden hair behind her ear and stuck her knife into the chopping board.",
      "Her pink lips were in a wide grin and she wiped flour onto the white apron covering a light purple dress covered in varied patches.",
      "She cooked barefoot because she hated shoes, but her only shawl, a hand-knit, grey one, was draped over her arms to keep her warm.",
      "He wrapped his arms around her taut, shapely frame and she closed her round, bright green eyes.",
    ].join(" ");

    const normalized = normalizeScanResult(
      {
        entities: [
          {
            name: "Marcus Day",
            category: "character",
            summary: "A bounty hunter returning home.",
            isStub: false,
            aliases: ["Marcus"],
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
      chapterText,
    );

    const claudia = normalized.entities.find(
      (entity) => entity.name === "Claudia" && entity.category === "character",
    );

    expect(claudia).toBeDefined();
    expect(claudia?.summary).toContain("golden hair");
    expect(claudia?.summary).toContain("bright green eyes");
    expect(claudia?.summary).toContain("light purple dress");
    expect(claudia?.summary).toContain("hand-knit, grey one");
  });

  it("treats a chapter-opening focal character as point-of-view and extracts self-description instead of scene description", () => {
    const chapterText = [
      "Dr. Isaiah Essex loosened his silk tie and yawned.",
      "It was a pleasant evening for a walk.",
      "Their orange glow cast a variety of flickering shadows on every building.",
      "Twelve of those shadows belonged to Isaiah.",
      "Not that he was short; he was decidedly average.",
      "Isaiah hadn't thought to grab his leather gloves and blew on his hands.",
      "A chilly wind blew down the street, and the coffee-brown hairs of his mustache tickled his upper lip.",
      "Another light caught his hazel eye.",
      "His collar was undone.",
      "He didn't have any hat on, and his hair and mustache hadn't been combed since that morning.",
      "Heavy bags pulled on his eyes.",
      "Isaiah did not entertain in his house.",
      "Isaiah filled the kettle with water and brought it back to the stove.",
      "Six chapters in and Wilson's suggestion still seemed outrageous to Isaiah.",
      "Isaiah crept to the hallway's first door on the left.",
      "Isaiah jumped to his feet.",
      "Isaiah knelt and placed his hand on her knee.",
      "Isaiah slowly finished his tea.",
    ].join(" ");

    const normalized = normalizeScanResult(
      {
        entities: [],
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
      chapterText,
    );

    const isaiah = normalized.entities.find(
      (entity) =>
        entity.name === "Isaiah Essex" && entity.category === "character",
    );

    expect(isaiah).toBeDefined();
    expect(isaiah?.summary).toContain("Point-of-view character");
    expect(isaiah?.summary).toContain("silk tie");
    expect(isaiah?.summary).toContain("coffee-brown hairs of his mustache");
    expect(isaiah?.summary).toContain("hazel eye");
    expect(isaiah?.summary).not.toContain(
      "flickering shadows on every building",
    );
  });

  it("moves appearance traits out of Identity and into Physical Description", () => {
    const normalized = normalizeScanResult(
      {
        entities: [
          {
            name: "Marcus Day",
            category: "character",
            summary: [
              "## Core Status",
              "- Male bounty hunter",
              "",
              "## Identity",
              "- Male, green-eyed, bounty hunter",
              "- Married to Claudia",
              "",
              "## Physical Description",
              "- Missing / unestablished: No supported physical description is available in the current chapter snapshot.",
              "",
              "## Sources",
              "- Source: Current chapter snapshot",
            ].join("\n"),
            isStub: false,
            aliases: ["Marcus"],
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
      "Marcus Day returned home after the hunt.",
    );

    const marcus = normalized.entities.find(
      (entity) => entity.name === "Marcus Day",
    );

    expect(marcus).toBeDefined();
    expect(marcus?.summary).toContain("## Identity\n- Male, bounty hunter");
    expect(marcus?.summary).toContain("## Physical Description\n- Green-eyed");
    expect(marcus?.summary).not.toContain(
      "## Identity\n- Male, green-eyed, bounty hunter",
    );
    expect(marcus?.summary).not.toContain(
      "No supported physical description is available in the current chapter snapshot.",
    );
  });

  it("suppresses leading-preposition false positives like To Isaiah", () => {
    const normalized = normalizeScanResult(
      {
        entities: [],
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
      "To Isaiah's annoyance, one of those dressers appeared to be empty.",
    );

    expect(
      normalized.entities.some((entity) => entity.name === "To Isaiah"),
    ).toBe(false);
  });

  it("does not turn prose words from Chapter 2 into single-word character pages", () => {
    const chapterText = [
      "Brushes of various uses he didn't understand lay on her vanity table with no rhyme or reason.",
      "Baron Salem Lighton, the war hero, was especially well represented in her odd collage.",
      "Only men who called on young ladies at this hour did so with expectations.",
      "They did not make a habit of lingering, caroused with criminals, or eaten with them.",
      "Marcus Day came home to Claudia.",
      "Poor Jane was holding Michael while Bill Taylor asked if Isaiah was certain.",
    ].join(" ");

    const normalized = normalizeScanResult(
      {
        entities: [
          {
            name: "Bill Taylor",
            category: "character",
            summary: "Grounded summary",
            isStub: false,
            aliases: ["Bill"],
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
      chapterText,
    );

    for (const junkName of [
      "Brushes",
      "Especially",
      "Eaten",
      "Caroused",
      "Commotion",
      "Foam",
    ]) {
      expect(
        normalized.entities.some((entity) => entity.name === junkName),
      ).toBe(false);
    }
  });

  it("suppresses discourse-word supplemental entities and preserves publication items", () => {
    const chapterText = [
      "Their orange glow cast a variety of flickering shadows on every building.",
      "Furthermore, the only men who called on young ladies at this hour did so with expectations.",
      "Especially if he asked where the shootout was rather than where she was.",
      "For your information, there's a current serial in Twice Monthly called Fortunes of Fate that I'm positively addicted to.",
    ].join(" ");

    const normalized = normalizeScanResult(
      {
        entities: [
          {
            name: "Twice Monthly",
            category: "item",
            itemSubtype: "Publications",
            summary: "A periodical publication.",
            isStub: true,
            aliases: [],
            links: [],
          },
          {
            name: "Fortunes of Fate",
            category: "item",
            itemSubtype: "Publications",
            summary: "A serial story.",
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
      chapterText,
    );

    expect(
      normalized.entities.find((entity) => entity.name === "Twice Monthly")
        ?.category,
    ).toBe("item");
    expect(
      normalized.entities.find((entity) => entity.name === "Twice Monthly")
        ?.itemSubtype,
    ).toBe("Publications");
    expect(
      normalized.entities.find((entity) => entity.name === "Fortunes of Fate")
        ?.category,
    ).toBe("item");
    expect(
      normalized.entities.find((entity) => entity.name === "Fortunes of Fate")
        ?.itemSubtype,
    ).toBe("Publications");

    for (const junkName of ["Their", "Furthermore", "Especially"]) {
      expect(
        normalized.entities.some((entity) => entity.name === junkName),
      ).toBe(false);
    }
  });

  it("supplements titled works as publication items instead of character stubs", () => {
    const chapterText =
      "For your information, there is a current serial in Twice Monthly called Fortunes of Fate that I am positively addicted to.";

    const normalized = normalizeScanResult(
      {
        entities: [],
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
      chapterText,
    );

    const twiceMonthly = normalized.entities.find(
      (entity) => entity.name === "Twice Monthly",
    );
    const fortunesOfFate = normalized.entities.find(
      (entity) => entity.name === "Fortunes of Fate",
    );

    expect(twiceMonthly?.category).toBe("item");
    expect(twiceMonthly?.itemSubtype).toBe("Publications");
    expect(fortunesOfFate?.category).toBe("item");
    expect(fortunesOfFate?.itemSubtype).toBe("Publications");
  });

  it("classifies chapter 3 style events, businesses, and aliases conservatively", () => {
    const chapterText = [
      "The Vistan crystal lights were off and uselessly lined the walkway.",
      "First stop was Reuel's General Store.",
      "Finally, the Red Booth.",
      "The Baron Kinborough's Spring's Awakening Ball is tonight.",
      "She had been looking forward to it for the six weeks since the Midwinter Ball.",
      "At 'The Arrival of Winter Ball,' Lady Stewart wore a dress that showed her ankles.",
      "Ms. Patricia. The Witch.",
      "Had Aunt Matilda finally decided to tell her about the money?",
      "Whatever Felix had been up to smelled amazing.",
      "But Iris kept walking.",
    ].join(" ");

    const normalized = normalizeScanResult(
      {
        entities: [
          {
            name: "Ms. Patricia",
            category: "character",
            summary: "Grounded character.",
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
      chapterText,
    );

    expect(
      normalized.entities.some(
        (entity) =>
          entity.name === "The Vistan" && entity.category === "organization",
      ),
    ).toBe(true);
    expect(
      normalized.entities.some(
        (entity) =>
          entity.name === "Reuel's General Store" &&
          entity.category === "location",
      ),
    ).toBe(true);
    expect(
      normalized.entities.some(
        (entity) =>
          entity.name === "Red Booth" && entity.category === "location",
      ),
    ).toBe(true);
    expect(
      normalized.entities.some(
        (entity) =>
          entity.name === "Spring's Awakening Ball" &&
          entity.category === "item",
      ),
    ).toBe(true);
    expect(
      normalized.entities.some(
        (entity) =>
          entity.name === "Midwinter Ball" && entity.category === "item",
      ),
    ).toBe(true);
    expect(
      normalized.entities.some(
        (entity) =>
          entity.name === "The Arrival of Winter Ball" &&
          entity.category === "item",
      ),
    ).toBe(true);
    expect(
      normalized.entities.find((entity) => entity.name === "Ms Patricia")
        ?.aliases ?? [],
    ).toContain("The Witch");
    expect(
      normalized.entities.some((entity) => entity.name === "The Witch"),
    ).toBe(false);
    expect(
      normalized.entities.some((entity) => entity.name === "General Store"),
    ).toBe(false);
    expect(
      normalized.entities.some((entity) => entity.name === "Awakening Ball"),
    ).toBe(false);
    expect(
      normalized.entities.some((entity) => entity.name === "But Iris"),
    ).toBe(false);
    expect(
      normalized.entities.some(
        (entity) =>
          entity.name === "Aunt Matilda" && entity.category === "character",
      ),
    ).toBe(true);
    expect(
      normalized.entities.some((entity) => entity.name === "Whatever Felix"),
    ).toBe(false);
  });

  it("does not treat ordinary named-person phrasing as publication context", () => {
    const normalized = normalizeScanResult(
      {
        entities: [],
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
      "Every felon in the empire knew about The Warm Hearth, and Marcus was looking for one named Louis Porter.",
    );

    const louisPorter = normalized.entities.find(
      (entity) => entity.name === "Louis Porter",
    );

    expect(louisPorter?.category).toBe("character");
    expect(louisPorter?.itemSubtype).toBeNull();
  });

  it("normalizes possessive business names for supplemental locations", () => {
    mkdirSync(join(testRoot, "project-data", "system"), { recursive: true });
    writeFileSync(
      join(testRoot, "project-data", "system", "user-canon-decisions.json"),
      JSON.stringify([
        {
          matchNames: ["Hartwell", "Hartwell's"],
          action: "override",
          category: "location",
          canonicalName: "Hartwell's",
        },
      ]),
    );

    const normalized = normalizeScanResult(
      {
        entities: [],
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
      "Jonathan pointed at Hartwell's, a restaurant the family knew well.",
    );

    expect(
      normalized.entities.some(
        (entity) =>
          entity.name === "Hartwell's" && entity.category === "location",
      ),
    ).toBe(true);
    expect(
      normalized.entities.some((entity) => entity.name === "Hartwell"),
    ).toBe(false);
  });

  it("treats lake-named places as locations when extracted from context", () => {
    const normalized = normalizeScanResult(
      {
        entities: [],
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
      "Jasper Lake tea is delicious when it hasn't spent weeks in a shipping barrel.",
    );

    expect(
      normalized.entities.some(
        (entity) =>
          entity.name === "Jasper Lake" && entity.category === "location",
      ),
    ).toBe(true);
  });

  it("classifies possessive whiskey brands as items, not locations", () => {
    const normalized = normalizeScanResult(
      {
        entities: [
          {
            name: "Brifford",
            category: "location",
            summary: "Mentioned in the chapter.",
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
      "Marcus ordered the second cheapest whiskey, because the cheapest, Brifford's, was only suitable for leather polish.",
    );

    expect(normalized.entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Brifford",
          category: "item",
        }),
      ]),
    );
  });

  it("reclassifies ship-like provider locations as vehicle items", () => {
    mkdirSync(join(testRoot, "project-data", "system"), { recursive: true });
    writeFileSync(
      join(testRoot, "project-data", "system", "user-canon-decisions.json"),
      JSON.stringify([
        {
          matchNames: ["The Ivory Crown"],
          action: "override",
          category: "item",
          itemSubtype: "Vehicles",
          canonicalName: "The Ivory Crown",
        },
      ]),
    );

    const normalized = normalizeScanResult(
      {
        entities: [
          {
            name: "The Ivory Crown",
            category: "location",
            summary: "A place mentioned in the chapter.",
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
      "Scarlet would have been unmatched in all of Vistana except that it was coming alongside its sister ship, The Ivory Crown.",
    );

    expect(normalized.entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "The Ivory Crown",
          category: "item",
          itemSubtype: "Vehicles",
        }),
      ]),
    );
  });

  it("drops single-word kinship aliases from provider character entries", () => {
    const normalized = normalizeScanResult(
      {
        entities: [
          {
            name: "Emperor Darius IV",
            category: "character",
            summary: "The emperor and father of Gabrielle.",
            isStub: true,
            aliases: ["Papa"],
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
      "Gabrielle hadn't seen Emperor Darius IV in three years. Papa was dying.",
    );

    expect(normalized.entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Emperor Darius IV",
          aliases: [],
        }),
      ]),
    );
  });

  it("clears item subtypes from non-item provider entities", () => {
    const normalized = normalizeScanResult(
      {
        entities: [
          {
            name: "The Empire",
            category: "organization",
            itemSubtype: "Other",
            summary: "A political entity.",
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
      "The Empire's politics touched every household in Vistana.",
    );

    expect(normalized.entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "The Empire",
          category: "organization",
          itemSubtype: null,
        }),
      ]),
    );
  });

  it("does not extract demonym modifiers as standalone organizations", () => {
    const normalized = normalizeScanResult(
      {
        entities: [],
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
      "The Vistanan court can be quite dull in peacetime.",
    );

    expect(
      normalized.entities.some((entity) => entity.name === "The Vistanan"),
    ).toBe(false);
  });

  it("expands clipped provider event and work titles from chapter context", () => {
    const chapterText = [
      "Ms. Patricia reminded Iris that the Baron Kinborough's 'Spring's Awakening Ball' was tonight.",
      "Professor Tarvil praised her reading of the symbolism in Elegy for Clark Rivers.",
    ].join(" ");

    const normalized = normalizeScanResult(
      {
        entities: [
          {
            name: "Awakening Ball",
            category: "item",
            itemSubtype: "Other",
            summary: "A social event.",
            isStub: true,
            aliases: [],
            links: [],
          },
          {
            name: "Elegy",
            category: "location",
            summary: "A place.",
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
      chapterText,
    );

    expect(
      normalized.entities.some(
        (entity) =>
          entity.name === "Spring's Awakening Ball" &&
          entity.category === "item",
      ),
    ).toBe(true);
    expect(
      normalized.entities.some(
        (entity) =>
          entity.name === "Elegy for Clark Rivers" &&
          entity.category === "item" &&
          entity.itemSubtype === "Publications",
      ),
    ).toBe(true);
    expect(
      normalized.entities.some((entity) => entity.name === "Awakening Ball"),
    ).toBe(false);
    expect(normalized.entities.some((entity) => entity.name === "Elegy")).toBe(
      false,
    );
  });

  it("keeps provider publication titles as items and drops title fragments from chapter 3 prose", () => {
    const chapterText = [
      "She opened the new Twice Monthly.",
      "One of its current serials, Fortunes of Fate, was all the rage and the author, Catherine Suffolk, had become famous.",
      "Flanking Ms. Patricia were the day's dressing crew.",
      "She had to agree with Ms. Patricia for once; at least she wasn't going anywhere in this anathema to fashion.",
      "Professor Tarvil praised her reading of the symbolism in Elegy for Clark Rivers.",
    ].join(" ");

    const normalized = normalizeScanResult(
      {
        entities: [
          {
            name: "Twice Monthly",
            category: "character",
            summary: "A named entity.",
            isStub: true,
            aliases: [],
            links: [],
          },
          {
            name: "Fortunes of Fate",
            category: "character",
            summary: "A named entity.",
            isStub: true,
            aliases: [],
            links: [],
          },
          {
            name: "Clark Rivers",
            category: "character",
            summary: "A named entity.",
            isStub: true,
            aliases: [],
            links: [],
          },
          {
            name: "Elegy for Clark Rivers",
            category: "item",
            itemSubtype: "Publications",
            summary: "A literary work.",
            isStub: true,
            aliases: [],
            links: [],
          },
          {
            name: "Patricia for",
            category: "character",
            summary: "A named entity.",
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
      chapterText,
    );

    expect(
      normalized.entities.some(
        (entity) =>
          entity.name === "Twice Monthly" &&
          entity.category === "item" &&
          entity.itemSubtype === "Publications",
      ),
    ).toBe(true);
    expect(
      normalized.entities.some(
        (entity) =>
          entity.name === "Fortunes of Fate" &&
          entity.category === "item" &&
          entity.itemSubtype === "Publications",
      ),
    ).toBe(true);
    expect(
      normalized.entities.some(
        (entity) =>
          entity.name === "Elegy for Clark Rivers" &&
          entity.category === "item" &&
          entity.itemSubtype === "Publications",
      ),
    ).toBe(true);
    expect(
      normalized.entities.some((entity) => entity.name === "Patricia for"),
    ).toBe(false);
    expect(normalized.entities.some((entity) => entity.name === "Elegy")).toBe(
      false,
    );
    expect(normalized.entities.some((entity) => entity.name === "Clark")).toBe(
      false,
    );
    expect(
      normalized.entities.some((entity) => entity.name === "Clark Rivers"),
    ).toBe(false);
  });

  it("reclassifies miscategorized provider people away from item when publication evidence is absent", () => {
    const normalized = normalizeScanResult(
      {
        entities: [
          {
            name: "Bradford Wilson",
            category: "item",
            itemSubtype: "Other",
            summary: "An inventor from Gralsha.",
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
      "An inventor in Gralsha named Bradford Wilson had posited that machines could be designed to build other machines in a factory.",
    );

    const bradfordWilson = normalized.entities.find(
      (entity) => entity.name === "Bradford Wilson",
    );

    expect(bradfordWilson?.category).toBe("character");
    expect(bradfordWilson?.itemSubtype).toBeNull();
  });

  it("does not add honorific-only aliases from dialogue context", () => {
    const chapterText = [
      'Marcus took her hand. "It\'s been nice to meet you, Miss...?"',
      '"Essex. Mina Essex."',
    ].join(" ");

    const normalized = normalizeScanResult(
      {
        entities: [
          {
            name: "Marcus Day",
            category: "character",
            summary: "Grounded character.",
            isStub: false,
            aliases: [],
            links: [],
          },
          {
            name: "Mina Essex",
            category: "character",
            summary: "Grounded character.",
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
      chapterText,
    );

    expect(
      normalized.entities.find((entity) => entity.name === "Marcus Day")
        ?.aliases ?? [],
    ).not.toContain("Miss Essex");
    expect(
      normalized.entities.find((entity) => entity.name === "Mina Essex")
        ?.aliases ?? [],
    ).not.toContain("Miss Essex");
  });

  it("drops separate alias dossiers when another character already claims that alias", () => {
    const normalized = normalizeScanResult(
      {
        entities: [
          {
            name: "Louis Porter",
            category: "character",
            summary: "Grounded character.",
            isStub: false,
            aliases: ["John Letterer"],
            links: [],
          },
          {
            name: "John Letterer",
            category: "character",
            summary: "Duplicate alias dossier.",
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
      "Louis Porter played under the fake name John Letterer.",
    );

    expect(
      normalized.entities.some((entity) => entity.name === "Louis Porter"),
    ).toBe(true);
    expect(
      normalized.entities.some((entity) => entity.name === "John Letterer"),
    ).toBe(false);
  });

  it("drops honorific-only provider aliases during normalization", () => {
    const normalized = normalizeScanResult(
      {
        entities: [
          {
            name: "Mina Essex",
            category: "character",
            summary: "Grounded character.",
            isStub: false,
            aliases: ["Miss Essex", "Mina"],
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
      "Mina Essex returned home safely.",
    );

    const mina = normalized.entities.find(
      (entity) => entity.name === "Mina Essex",
    );

    expect(mina?.aliases).toContain("Mina");
    expect(mina?.aliases).not.toContain("Miss Essex");
  });

  it("does not create cross-category duplicates for existing publication items on rescans", () => {
    const chapter = upsertChapter({
      number: 2,
      title: "Two",
      text: "For your information, there's a current serial in Twice Monthly called Fortunes of Fate that I'm positively addicted to.",
    });

    reconcileCanon(chapter.id, {
      entities: [
        {
          name: "Twice Monthly",
          category: "item",
          itemSubtype: "Publications",
          summary: "A periodical publication.",
          isStub: true,
          aliases: [],
          links: [],
        },
        {
          name: "Fortunes of Fate",
          category: "item",
          itemSubtype: "Publications",
          summary: "A serial story.",
          isStub: true,
          aliases: [],
          links: [],
        },
      ],
      chronology: [],
      watchlist: [],
      summary: {
        articlesCreated: ["Twice Monthly", "Fortunes of Fate"],
        articlesUpdated: [],
        stubsCreated: [],
        chronologyUpdated: [],
        continuityUpdated: [],
        contradictionsFlagged: [],
      },
    });

    const normalized = normalizeScanResult(
      {
        entities: [
          {
            name: "Twice Monthly",
            category: "item",
            itemSubtype: "Publications",
            summary: "A periodical publication.",
            isStub: true,
            aliases: [],
            links: [],
          },
          {
            name: "Fortunes of Fate",
            category: "item",
            itemSubtype: "Publications",
            summary: "A serial story.",
            isStub: true,
            aliases: [],
            links: [],
          },
        ],
        chronology: [],
        watchlist: [],
        summary: {
          articlesCreated: [],
          articlesUpdated: ["Twice Monthly", "Fortunes of Fate"],
          stubsCreated: [],
          chronologyUpdated: [],
          continuityUpdated: [],
          contradictionsFlagged: [],
        },
      },
      chapter.currentText,
    );

    expect(
      normalized.entities.filter((entity) => entity.name === "Twice Monthly"),
    ).toHaveLength(1);
    expect(
      normalized.entities.filter(
        (entity) => entity.name === "Fortunes of Fate",
      ),
    ).toHaveLength(1);
    expect(
      normalized.entities.find((entity) => entity.name === "Twice Monthly")
        ?.category,
    ).toBe("item");
    expect(
      normalized.entities.find((entity) => entity.name === "Twice Monthly")
        ?.itemSubtype,
    ).toBe("Publications");
    expect(
      normalized.entities.find((entity) => entity.name === "Fortunes of Fate")
        ?.category,
    ).toBe("item");
    expect(
      normalized.entities.find((entity) => entity.name === "Fortunes of Fate")
        ?.itemSubtype,
    ).toBe("Publications");

    reconcileCanon(chapter.id, normalized);

    expect(
      listEntities().find((entity) => entity.name === "Twice Monthly")?.subtype,
    ).toBe("Publications");
    expect(
      listEntities().find((entity) => entity.name === "Fortunes of Fate")
        ?.subtype,
    ).toBe("Publications");
  });

  it("drops generic single-word provider character entries without proper-name evidence", () => {
    const chapterText = [
      "Women waited by the rail while Marcus asked about Louis.",
      "Some said the fog would lift by noon.",
      "Maybes drifted through the room as the argument stalled.",
      "Foam slid off the horse and onto the stones.",
    ].join(" ");

    const normalized = normalizeScanResult(
      {
        entities: [
          {
            name: "Women",
            category: "character",
            summary: "Incorrect provider guess.",
            isStub: true,
            aliases: [],
            links: [],
          },
          {
            name: "Some",
            category: "character",
            summary: "Incorrect provider guess.",
            isStub: true,
            aliases: [],
            links: [],
          },
          {
            name: "Maybes",
            category: "character",
            summary: "Incorrect provider guess.",
            isStub: true,
            aliases: [],
            links: [],
          },
          {
            name: "Foam",
            category: "character",
            summary: "Incorrect provider guess.",
            isStub: true,
            aliases: [],
            links: [],
          },
          {
            name: "Marcus Day",
            category: "character",
            summary: "Grounded summary.",
            isStub: false,
            aliases: ["Marcus"],
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
      chapterText,
    );

    for (const junkName of ["Women", "Some", "Maybes", "Foam"]) {
      expect(
        normalized.entities.some((entity) => entity.name === junkName),
      ).toBe(false);
    }

    expect(
      normalized.entities.some((entity) => entity.name === "Marcus Day"),
    ).toBe(true);
  });

  it("does not supplement generic single-word nouns from chapter prose", () => {
    const chapterText = [
      "Foam was forming on her lips.",
      "Maybes were unreliable.",
      "Some were stopped; most were not.",
      "Widow or modern fashion statement? Women had started ignore the traditional Andrittan color meanings.",
      "Marcus Day asked Claudia whether Louis Porter had already left The Warm Hearth.",
    ].join(" ");

    const normalized = normalizeScanResult(
      {
        entities: [
          {
            name: "Marcus Day",
            category: "character",
            summary: "Grounded summary.",
            isStub: false,
            aliases: ["Marcus"],
            links: [],
          },
          {
            name: "Claudia",
            category: "character",
            summary: "Grounded summary.",
            isStub: false,
            aliases: [],
            links: [],
          },
          {
            name: "Louis Porter",
            category: "character",
            summary: "Grounded summary.",
            isStub: false,
            aliases: ["Porter"],
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
      chapterText,
    );

    for (const junkName of ["Foam", "Some", "Women", "Maybes"]) {
      expect(
        normalized.entities.some((entity) => entity.name === junkName),
      ).toBe(false);
    }
  });

  it("does not mark repeated non-focal names as point-of-view characters", () => {
    const chapterText = [
      "Kinburgh sat below the hill, all smokestacks and slate roofs.",
      "Kinburgh's walls caught the late sun while the market bells rang.",
      "By dusk Kinburgh had swallowed the last of the wagons.",
      "Louis Porter swore The Shadow King paid him to do it.",
      "Every rumor in the district led back to The Shadow King.",
      "Marcus heard The Shadow King named again at the tavern.",
      "Later, Kinburgh returned to the conversation as Marcus traced the route north.",
      "No one agreed on what The Shadow King wanted, only that the name kept surfacing.",
      "Kinburgh remained restless long after the crowd had gone.",
    ].join(" ");

    const normalized = normalizeScanResult(
      {
        entities: [
          {
            name: "Kinburgh",
            category: "character",
            summary: "Wrong category summary.",
            isStub: true,
            aliases: [],
            links: [],
          },
          {
            name: "The Shadow King",
            category: "character",
            summary: "Shadowy figure in the background.",
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
      chapterText,
    );

    const kinburgh = normalized.entities.find(
      (entity) => entity.name === "Kinburgh",
    );
    const shadowKing = normalized.entities.find(
      (entity) => entity.name === "The Shadow King",
    );

    expect(kinburgh?.category).toBe("location");
    expect(kinburgh?.summary).not.toContain("Point-of-view character");
    expect(shadowKing?.summary).not.toContain("Point-of-view character");
  });

  it("does not mark reported or accusatory mentions as point-of-view focus", () => {
    const chapterText = [
      'Louis Porter shouted, "The Shadow King made me do it."',
      "Marcus heard The Shadow King named again at the tavern.",
      "Every rumor in the district led back to The Shadow King.",
      "No one agreed on what The Shadow King wanted.",
    ].join(" ");

    const normalized = normalizeScanResult(
      {
        entities: [
          {
            name: "The Shadow King",
            category: "character",
            summary: [
              "## Core Status",
              "- On-page character",
              "- Chapter role: Point-of-view character in current chapter snapshot",
              "",
              "## Description",
              "- Unconfirmed figure in local rumor.",
            ].join("\n"),
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
      chapterText,
    );

    const shadowKing = normalized.entities.find(
      (entity) => entity.name === "The Shadow King",
    );

    expect(shadowKing?.summary).not.toContain("Point-of-view character");
  });

  it("classifies possessive place references like Elton's townhouses as locations", () => {
    const chapterText = [
      "Another light caught his hazel eye, though, the only other one on the street, glowing in the upper window of a green house.",
      "Tall, thin and pressed against its neighbors, like all of Elton's townhouses, this one was thoroughly modern with good sized, arched windows, a bay window, and a gabled roof.",
      "In fact, Isaiah had been entertained at the Britton's house several times.",
    ].join(" ");

    const normalized = normalizeScanResult(
      {
        entities: [],
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
      chapterText,
    );

    expect(
      normalized.entities.some(
        (entity) => entity.name === "Elton" && entity.category === "location",
      ),
    ).toBe(true);
    expect(
      normalized.entities.some(
        (entity) => entity.name === "Elton" && entity.category === "character",
      ),
    ).toBe(false);
    expect(
      normalized.entities.some((entity) => entity.name === "The Essexes"),
    ).toBe(false);
  });

  it("treats it-based city descriptions as location evidence for ambiguous single-word names", () => {
    const chapterText = [
      "A gun fight? Elton had some problems, there was the occasional murder like anywhere else, but a gun fight?",
      "The Essexes had settled in Elton because it was a newer city, only about 40 years old, and it was small.",
    ].join(" ");

    const normalized = normalizeScanResult(
      {
        entities: [],
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
      chapterText,
    );

    expect(
      normalized.entities.some(
        (entity) => entity.name === "Elton" && entity.category === "location",
      ),
    ).toBe(true);
    expect(
      normalized.entities.some(
        (entity) => entity.name === "Elton" && entity.category === "character",
      ),
    ).toBe(false);
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

  it("does not keep existing canon entities that have no chapter-local grounding", () => {
    const normalized = normalizeScanResult(
      {
        entities: [
          {
            name: "Marcus Day",
            category: "character",
            summary: "Existing canon character.",
            isStub: false,
            aliases: [],
            links: [],
          },
          {
            name: "Mina Essex",
            category: "character",
            summary: "Grounded character.",
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
      "Mina Essex leaned against the doorway and listened for footsteps in the hall.",
    );

    expect(
      normalized.entities.some((entity) => entity.name === "Mina Essex"),
    ).toBe(true);
    expect(
      normalized.entities.some((entity) => entity.name === "Marcus Day"),
    ).toBe(false);
  });

  it("does not supplement article-free or honorific duplicate names", () => {
    const normalized = normalizeScanResult(
      {
        entities: [
          {
            name: "The Warm Hearth",
            category: "location",
            summary: "Grounded location.",
            isStub: false,
            aliases: [],
            links: [],
          },
          {
            name: "Mina Essex",
            category: "character",
            summary: "Grounded character.",
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
      'The Warm Hearth loomed over the street while Marcus waited outside Warm Hearth until the door opened. "Miss Essex. Mina Essex." Mina Essex looked up from the doorway.',
    );

    expect(
      normalized.entities.some((entity) => entity.name === "Warm Hearth"),
    ).toBe(false);
    expect(
      normalized.entities.some((entity) => entity.name === "Miss Essex"),
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
    ).toBe(true);
    expect(
      normalized.entities.some(
        (entity) => entity.name === "Belt" && entity.category === "character",
      ),
    ).toBe(true);
    expect(
      normalized.entities.some(
        (entity) => entity.name === "Fleck" && entity.category === "character",
      ),
    ).toBe(true);
  });

  it("reclassifies named horses from publication items back to characters", () => {
    const normalized = normalizeScanResult(
      {
        entities: [
          {
            name: "Powder",
            category: "item",
            itemSubtype: "Publications",
            summary: "Provider mislabeled Powder as a publication.",
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
      "Jeanne rode her cremello horse, Powder, to the bell rope.",
    );

    expect(
      normalized.entities.some(
        (entity) =>
          entity.name === "Powder" &&
          entity.category === "character" &&
          entity.itemSubtype === null,
      ),
    ).toBe(true);
  });

  it("classifies animal species or creature kinds as item Animals", () => {
    const normalized = normalizeScanResult(
      {
        entities: [],
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
      "The hunters tracked Kandar Panthers through the ruins, and later found signs of Kandar Vipers near the well.",
    );

    expect(
      normalized.entities.find((entity) => entity.name === "Kandar Panthers")
        ?.category,
    ).toBe("item");
    expect(
      normalized.entities.find((entity) => entity.name === "Kandar Panthers")
        ?.itemSubtype,
    ).toBe("Animals");
    expect(
      normalized.entities.find((entity) => entity.name === "Kandar Vipers")
        ?.category,
    ).toBe("item");
    expect(
      normalized.entities.find((entity) => entity.name === "Kandar Vipers")
        ?.itemSubtype,
    ).toBe("Animals");
  });

  it("tracks only invented or fantastical flora and fauna kinds", () => {
    const normalized = normalizeScanResult(
      {
        entities: [
          {
            name: "Panthers",
            category: "item",
            itemSubtype: "Animals",
            summary: "Generic panthers.",
            isStub: true,
            aliases: [],
            links: [],
          },
          {
            name: "Daisies",
            category: "item",
            itemSubtype: "Plants",
            summary: "Generic daisies.",
            isStub: true,
            aliases: [],
            links: [],
          },
          {
            name: "Blue Daisies",
            category: "item",
            itemSubtype: "Plants",
            summary: "An invented flower variety.",
            isStub: true,
            aliases: [],
            links: [],
          },
          {
            name: "Kandar Panthers",
            category: "item",
            itemSubtype: "Animals",
            summary: "A setting-specific panther kind.",
            isStub: true,
            aliases: [],
            links: [],
          },
          {
            name: "Dragons",
            category: "item",
            itemSubtype: "Animals",
            summary: "Fantastical creatures.",
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
      "Panthers prowled in the dark. Daisies nodded in the wind. Blue Daisies bloomed beside the shrine. Kandar Panthers hunted near the ridge. Dragons circled above the valley.",
    );

    expect(
      normalized.entities.some((entity) => entity.name === "Panthers"),
    ).toBe(false);
    expect(
      normalized.entities.some((entity) => entity.name === "Daisies"),
    ).toBe(false);
    expect(
      normalized.entities.find((entity) => entity.name === "Blue Daisies")
        ?.itemSubtype,
    ).toBe("Plants");
    expect(
      normalized.entities.find((entity) => entity.name === "Kandar Panthers")
        ?.itemSubtype,
    ).toBe("Animals");
    expect(
      normalized.entities.find((entity) => entity.name === "Dragons")
        ?.itemSubtype,
    ).toBe("Animals");
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

  it("captures fake names from dialogue exchanges as character aliases", () => {
    const chapterText = [
      "There he was. Louis Porter marched in the door.",
      "Porter made eye contact with Marcus.",
      '"Haven\'t seen you here before, friend."',
      '"What\'s your name?"',
      '"John Burton. Yours?"',
      '"John also. John Letterer."',
    ].join(" ");
    const chapter = upsertChapter({
      number: 1,
      title: "One",
      text: chapterText,
    });

    const normalized = normalizeScanResult(
      {
        entities: [
          {
            name: "Marcus Day",
            category: "character",
            summary: "A bounty hunter tracking fugitives.",
            isStub: false,
            aliases: ["Marcus"],
            links: [],
          },
          {
            name: "Louis Porter",
            category: "character",
            summary: "A wanted criminal playing cards at the tavern.",
            isStub: false,
            aliases: ["Porter"],
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
      chapterText,
    );

    reconcileCanon(chapter.id, normalized);

    const db = getDatabase();
    const marcusAliases = db
      .prepare(
        `SELECT a.alias
           FROM entity_aliases a
           JOIN entities e ON e.id = a.entity_id
          WHERE e.name = ?
          ORDER BY a.alias`,
      )
      .all("Marcus Day") as Array<{ alias: string }>;
    const louisAliases = db
      .prepare(
        `SELECT a.alias
           FROM entity_aliases a
           JOIN entities e ON e.id = a.entity_id
          WHERE e.name = ?
          ORDER BY a.alias`,
      )
      .all("Louis Porter") as Array<{ alias: string }>;

    expect(marcusAliases.map((row) => row.alias)).toEqual(
      expect.arrayContaining(["John Burton"]),
    );
    expect(louisAliases.map((row) => row.alias)).toEqual(
      expect.arrayContaining(["John Letterer"]),
    );
  });

  it("does not let an alias-only character dossier overwrite the canonical character article body", () => {
    const chapter = upsertChapter({
      number: 1,
      title: "One",
      text: "Marcus Day used the name John Burton during a card game.",
    });

    reconcileCanon(chapter.id, {
      entities: [
        {
          name: "Marcus Day",
          category: "character",
          summary: [
            "## Core Status",
            "- Male bounty hunter",
            "",
            "## Identity",
            "- Bounty hunter looking for Louis Porter",
            "- Married to Claudia",
            "",
            "## Physical Description",
            "- Green eyes",
            "- Thinly bearded cheeks",
          ].join("\n"),
          isStub: false,
          aliases: ["Marcus", "John Burton"],
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
          name: "John Burton",
          category: "character",
          summary: [
            "## Core Status",
            "- Alias",
            "",
            "## Identity",
            "- Alias used by Marcus Day while in tavern",
            "",
            "## Sources",
            "- Used by Marcus Day during card game",
          ].join("\n"),
          isStub: false,
          aliases: [],
          links: [],
        },
      ],
      chronology: [],
      watchlist: [],
      summary: {
        articlesCreated: [],
        articlesUpdated: ["John Burton"],
        stubsCreated: [],
        chronologyUpdated: [],
        continuityUpdated: [],
        contradictionsFlagged: [],
      },
    });

    const marcus = listEntities().find(
      (entity) => entity.name === "Marcus Day",
    );
    const marcusAliases = getDatabase()
      .prepare(
        `SELECT a.alias
           FROM entity_aliases a
           JOIN entities e ON e.id = a.entity_id
          WHERE e.name = ?
          ORDER BY a.alias`,
      )
      .all("Marcus Day") as Array<{ alias: string }>;

    expect(marcus?.articleBody).toContain(
      "Bounty hunter looking for Louis Porter",
    );
    expect(marcus?.articleBody).toContain("Green eyes");
    expect(marcus?.articleBody).not.toContain(
      "Alias used by Marcus Day while in tavern",
    );
    expect(marcusAliases.map((row) => row.alias)).toEqual(
      expect.arrayContaining(["John Burton"]),
    );
  });

  it("merges The Watch and City Watchmen into The City Watch", () => {
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
    ).toHaveLength(0);
    expect(cityWatchAliases.map((row) => row.alias)).toEqual(
      expect.arrayContaining([
        "City Watch",
        "City Watchmen",
        "The Watch",
        "Watch",
      ]),
    );
  });

  it("prefers a full character name over a single-name canon duplicate", () => {
    const chapter = upsertChapter({
      number: 1,
      title: "One",
      text: "Austin Moon rode with Marcus. Austin laughed.",
    });

    reconcileCanon(chapter.id, {
      entities: [
        {
          name: "Austin Moon",
          category: "character",
          summary: "A bounty hunter.",
          isStub: false,
          aliases: [],
          links: [],
        },
      ],
      chronology: [],
      watchlist: [],
      summary: {
        articlesCreated: ["Austin Moon"],
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
          name: "Austin",
          category: "character",
          summary: "Mentioned briefly in the chapter.",
          isStub: true,
          aliases: [],
          links: [],
        },
      ],
      chronology: [],
      watchlist: [],
      summary: {
        articlesCreated: [],
        articlesUpdated: ["Austin"],
        stubsCreated: [],
        chronologyUpdated: [],
        continuityUpdated: [],
        contradictionsFlagged: [],
      },
    });

    const austinMoon = listEntities().find(
      (entity) => entity.name === "Austin Moon",
    );
    const austin = listEntities().find((entity) => entity.name === "Austin");
    const aliases = getDatabase()
      .prepare(
        `SELECT a.alias
           FROM entity_aliases a
           JOIN entities e ON e.id = a.entity_id
          WHERE e.name = ?
          ORDER BY a.alias`,
      )
      .all("Austin Moon") as Array<{ alias: string }>;

    expect(austinMoon).toBeDefined();
    expect(austin).toBeUndefined();
    expect(aliases.map((row) => row.alias)).toEqual(
      expect.arrayContaining(["Austin"]),
    );
  });

  it("merges honorific surname variants into fuller character records", () => {
    const chapter = upsertChapter({
      number: 1,
      title: "One",
      text: "Baron Salem Lighton was famous. Baron Lighton was expected. Gabrielle Kinborough arrived, and Baroness Kinborough was announced.",
    });

    reconcileCanon(chapter.id, {
      entities: [
        {
          name: "Salem Lighton",
          category: "character",
          summary: "A decorated war hero.",
          isStub: false,
          aliases: [],
          links: [],
        },
        {
          name: "Gabrielle Kinborough",
          category: "character",
          summary: "A noblewoman.",
          isStub: false,
          aliases: [],
          links: [],
        },
      ],
      chronology: [],
      watchlist: [],
      summary: {
        articlesCreated: ["Salem Lighton", "Gabrielle Kinborough"],
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
          name: "Baron Lighton",
          category: "character",
          summary: "A shorter title-only reference.",
          isStub: true,
          aliases: [],
          links: [],
        },
        {
          name: "Baroness Kinborough",
          category: "character",
          summary: "A title-only reference.",
          isStub: true,
          aliases: [],
          links: [],
        },
      ],
      chronology: [],
      watchlist: [],
      summary: {
        articlesCreated: [],
        articlesUpdated: ["Baron Lighton", "Baroness Kinborough"],
        stubsCreated: [],
        chronologyUpdated: [],
        continuityUpdated: [],
        contradictionsFlagged: [],
      },
    });

    expect(
      listEntities().find((entity) => entity.name === "Baron Lighton"),
    ).toBeUndefined();
    expect(
      listEntities().find((entity) => entity.name === "Baroness Kinborough"),
    ).toBeUndefined();
    expect(
      listEntities().find((entity) => entity.name === "Salem Lighton"),
    ).toBeDefined();
    expect(
      listEntities().find((entity) => entity.name === "Gabrielle Kinborough"),
    ).toBeDefined();
  });

  it("does not preserve Main on later stub-only character mentions", () => {
    const chapter = upsertChapter({
      number: 1,
      title: "One",
      text: "Marcus rode Fleck toward town.",
    });

    reconcileCanon(chapter.id, {
      entities: [
        {
          name: "Fleck",
          category: "character",
          summary: [
            "## Core Status",
            "- On-page character",
            "- Chapter role: Point-of-view character in current chapter snapshot",
          ].join("\n"),
          isStub: false,
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

    reconcileCanon(chapter.id, {
      entities: [
        {
          name: "Fleck",
          category: "character",
          summary: "Named in passing as Marcus's horse.",
          isStub: true,
          aliases: [],
          links: [],
        },
      ],
      chronology: [],
      watchlist: [],
      summary: {
        articlesCreated: [],
        articlesUpdated: ["Fleck"],
        stubsCreated: [],
        chronologyUpdated: [],
        continuityUpdated: [],
        contradictionsFlagged: [],
      },
    });

    const fleck = listEntities().find((entity) => entity.name === "Fleck");
    expect(fleck?.subtype).toBeNull();
  });

  it("merges appositive location aliases into one dossier", () => {
    const normalized = normalizeScanResult(
      {
        entities: [
          {
            name: "Calatha",
            category: "location",
            summary: "A manor house.",
            isStub: false,
            aliases: [],
            links: [],
          },
          {
            name: "Kinborough Manor",
            category: "location",
            summary: "Another name for the same manor.",
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
      "Small, aesthetically placed groves of fruit trees dotted the rolling hills, and, atop a tall slope with a shallow incline, stood Calatha itself, the Kinborough Manor.",
    );

    expect(
      normalized.entities.some((entity) => entity.name === "Calatha"),
    ).toBe(true);
    expect(
      normalized.entities.some((entity) => entity.name === "Kinborough Manor"),
    ).toBe(false);
    expect(
      normalized.entities.find((entity) => entity.name === "Calatha")?.aliases,
    ).toEqual(expect.arrayContaining(["Kinborough Manor"]));
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

  it("clears stale reverse location parent edges before applying scanned parents", () => {
    const chapter = upsertChapter({
      number: 1,
      title: "Location hierarchy repair",
      text: "Finch Street sits within Kinburgh.",
    });

    reconcileCanon(chapter.id, {
      entities: [
        {
          name: "Kinburgh",
          category: "location",
          summary: "A city.",
          isStub: false,
          aliases: [],
          links: [],
          parentLocationName: null,
        },
        {
          name: "Finch Street",
          category: "location",
          summary: "A street in Kinburgh.",
          isStub: false,
          aliases: [],
          links: [],
          parentLocationName: null,
        },
      ],
      chronology: [],
      watchlist: [],
      summary: {
        articlesCreated: ["Kinburgh", "Finch Street"],
        articlesUpdated: [],
        stubsCreated: [],
        chronologyUpdated: [],
        continuityUpdated: [],
        contradictionsFlagged: [],
      },
    });

    const db = getDatabase();
    const ids = db
      .prepare("SELECT name, id FROM entities WHERE name IN (?, ?)")
      .all("Kinburgh", "Finch Street") as Array<{ name: string; id: string }>;
    const kinburghId = ids.find((row) => row.name === "Kinburgh")?.id;
    const finchStreetId = ids.find((row) => row.name === "Finch Street")?.id;

    expect(kinburghId).toBeDefined();
    expect(finchStreetId).toBeDefined();

    // Seed a stale inverse edge from older reconciliation behavior.
    db.prepare("UPDATE entities SET parent_entity_id = ? WHERE id = ?").run(
      finchStreetId,
      kinburghId,
    );

    reconcileCanon(chapter.id, {
      entities: [
        {
          name: "Kinburgh",
          category: "location",
          summary: "A city.",
          isStub: false,
          aliases: [],
          links: [],
          parentLocationName: null,
        },
        {
          name: "Finch Street",
          category: "location",
          summary: "A street in Kinburgh.",
          isStub: false,
          aliases: [],
          links: [],
          parentLocationName: "Kinburgh",
        },
      ],
      chronology: [],
      watchlist: [],
      summary: {
        articlesCreated: [],
        articlesUpdated: ["Kinburgh", "Finch Street"],
        stubsCreated: [],
        chronologyUpdated: [],
        continuityUpdated: [],
        contradictionsFlagged: [],
      },
    });

    const updatedHierarchy = db
      .prepare(
        `SELECT e.name, p.name AS parent
           FROM entities e
           LEFT JOIN entities p ON p.id = e.parent_entity_id
          WHERE e.name IN (?, ?)
          ORDER BY e.name`,
      )
      .all("Finch Street", "Kinburgh") as Array<{
      name: string;
      parent: string | null;
    }>;

    expect(updatedHierarchy).toEqual([
      { name: "Finch Street", parent: "Kinburgh" },
      { name: "Kinburgh", parent: null },
    ]);
  });

  it("preserves inferred Main characters across later rescans", () => {
    const first = upsertChapter({
      number: 1,
      title: "Marcus POV",
      text: "Marcus hunts Louis.",
    });
    const second = upsertChapter({
      number: 2,
      title: "Isaiah POV",
      text: "Isaiah worries about Mina.",
    });

    reconcileCanon(first.id, {
      entities: [
        {
          name: "Marcus Day",
          category: "character",
          summary: "A bounty hunter and protagonist of chapter one.",
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

    reconcileCanon(second.id, {
      entities: [
        {
          name: "Isaiah Essex",
          category: "character",
          summary: "The point-of-view character for this chapter.",
          isStub: false,
          aliases: [],
          links: [],
        },
        {
          name: "Marcus Day",
          category: "character",
          summary: "Mentioned briefly in conversation.",
          isStub: false,
          aliases: [],
          links: [],
        },
      ],
      chronology: [],
      watchlist: [],
      summary: {
        articlesCreated: ["Isaiah Essex"],
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
    const isaiah = listEntities().find(
      (entity) => entity.name === "Isaiah Essex",
    );

    expect(marcus?.subtype).toBe("Main");
    expect(isaiah?.subtype).toBe("Main");
  });

  it("does not keep Main on thin unconfirmed POV-only summaries", () => {
    const chapter = upsertChapter({
      number: 1,
      title: "Rumor",
      text: "Porter said the Shadow King made him do it.",
    });

    reconcileCanon(chapter.id, {
      entities: [
        {
          name: "The Shadow King",
          category: "character",
          summary: [
            "## Core Status",
            "- Canon status: Unconfirmed",
            "- On-page status: Mentioned or on-page in the current chapter snapshot",
            "- Chapter role: Point-of-view character in current chapter snapshot",
            "",
            "## Identity",
            "- Occupation / function: Missing",
            "- Affiliation(s): Missing",
          ].join("\n"),
          isStub: false,
          aliases: [],
          links: [],
        },
      ],
      chronology: [],
      watchlist: [],
      summary: {
        articlesCreated: ["The Shadow King"],
        articlesUpdated: [],
        stubsCreated: [],
        chronologyUpdated: [],
        continuityUpdated: [],
        contradictionsFlagged: [],
      },
    });

    const shadowKing = listEntities().find(
      (entity) => entity.name === "The Shadow King",
    );

    expect(shadowKing?.subtype).toBeNull();
  });

  it("marks primary-character summaries as Main even without the word protagonist", () => {
    const chapter = upsertChapter({
      number: 1,
      title: "Marcus POV",
      text: "Marcus hunts Louis at The Warm Hearth.",
    });

    reconcileCanon(chapter.id, {
      entities: [
        {
          name: "Marcus Day",
          category: "character",
          summary: [
            "## Core Status",
            "- On-page primary character; bounty hunter",
            "",
            "## Identity",
            "- Male, bounty hunter",
            "",
            "## Physical Description",
            "- Green eyes",
          ].join("\n"),
          isStub: false,
          aliases: ["Marcus"],
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

    const marcus = listEntities().find(
      (entity) => entity.name === "Marcus Day",
    );

    expect(marcus?.subtype).toBe("Main");
  });

  it("marks likely provider POV characters as Main even when the provider omits primary wording", () => {
    const chapterText = [
      "Marcus Day took a last hard drag on his cigarette and the embers gleamed in his green eyes.",
      "He only smoked when he was stressed.",
      "He dropped the butt on the concrete next to his brown leather boot.",
      "Marcus knew all of it was a front, though.",
      "Marcus wanted another cigarette.",
      "He rubbed his thinly bearded cheeks and took a deep breath.",
      "The dark-brown Stetson brim was pulled low enough to obscure his face.",
      "Marcus removed his hat later inside the tavern.",
      "He knew Claudia would tell him he was being stubborn again.",
      "Marcus said nothing when Austin Moon took position by the bar.",
    ].join(" ");
    const chapter = upsertChapter({
      number: 1,
      title: "Marcus POV",
      text: chapterText,
    });

    const normalized = normalizeScanResult(
      {
        entities: [
          {
            name: "Marcus Day",
            category: "character",
            summary: [
              "## Core Status",
              "- On-page character",
              "- Bounty hunter",
              "",
              "## Identity",
              "- Male",
              "- Married to Claudia",
              "",
              "## Physical Description",
              "- Green eyes",
              "- Dark-brown Stetson hat",
            ].join("\n"),
            isStub: false,
            aliases: ["Marcus"],
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
      },
      chapterText,
    );

    const marcusNormalized = normalized.entities.find(
      (entity) => entity.name === "Marcus Day",
    );

    expect(marcusNormalized?.summary).toContain(
      "Point-of-view character in current chapter snapshot",
    );

    reconcileCanon(chapter.id, normalized);

    const marcus = listEntities().find(
      (entity) => entity.name === "Marcus Day",
    );

    expect(marcus?.subtype).toBe("Main");
  });

  it("marks opening focal characters as Main even when brief scene-setting comes first", () => {
    const cases = [
      {
        number: 101,
        title: "Iris POV",
        name: "Iris Smith",
        aliases: ["Iris"],
        text: [
          "It wasn't sunlight yet, but it was light from the sun.",
          "Lady Iris Smith's sky-blue eyes fluttered open.",
          "She yawned and stretched in the massive four-poster bed.",
          "She sat up and stretched again before she leaned backwards.",
          "She ran her hands along the fabric with appreciation.",
          "She put her chocolate-colored hair up with a black ribbon.",
          "Iris checked the list and smiled.",
        ].join(" "),
      },
      {
        number: 102,
        title: "Gabrielle POV",
        name: "Gabrielle Kinborough",
        aliases: ["Gabrielle"],
        text: [
          "Salt filled the air, and water lapped at the white stone piers.",
          "Gabrielle Kinborough stood like a pillar atop the stairs leading down to one of the smaller docks.",
          "Her shining copper hair was immaculately styled and her steel blue eyes scanned the bay.",
          "Gabrielle's head was locked and immovable, though.",
          "Her gaze was on a ship that put most others in the harbor to shame.",
          "Gabrielle took short, measured steps to present herself to her sister.",
          "She burst into laughter once the carriage door closed.",
        ].join(" "),
      },
      {
        number: 103,
        title: "Rob POV",
        name: "Rob Deacon",
        aliases: ["Rob"],
        text: [
          "THWACK! Another limb down.",
          "Rob Deacon squinted his brown eyes and peered as far into the gloom as he could.",
          "He ran his fingers through sweaty, brown hair down over the week of facial hair covering his face.",
          "He'd been hacking branches for hours.",
          "Rob wiped his machete on his denim pants and sheathed it for a moment.",
          "He hoped Olneralta's walls were still intact so he could have one safe night of sleep.",
          "Rob only had part of a map, but he wasn't dead yet.",
        ].join(" "),
      },
    ];

    for (const testCase of cases) {
      const chapter = upsertChapter({
        number: testCase.number,
        title: testCase.title,
        text: testCase.text,
      });

      const normalized = normalizeScanResult(
        {
          entities: [
            {
              name: testCase.name,
              category: "character",
              summary: [
                "## Core Status",
                "- On-page character",
                "",
                "## Identity",
                "- Established in current chapter",
                "",
                "## Physical Description",
                "- Present on the page",
              ].join("\n"),
              isStub: false,
              aliases: testCase.aliases,
              links: [],
            },
          ],
          chronology: [],
          watchlist: [],
          summary: {
            articlesCreated: [testCase.name],
            articlesUpdated: [],
            stubsCreated: [],
            chronologyUpdated: [],
            continuityUpdated: [],
            contradictionsFlagged: [],
          },
        },
        testCase.text,
      );

      const normalizedCharacter = normalized.entities.find(
        (entity) => entity.name === testCase.name,
      );

      expect(normalizedCharacter?.summary).toContain(
        "Point-of-view character in current chapter snapshot",
      );

      reconcileCanon(chapter.id, normalized);

      const storedCharacter = listEntities().find(
        (entity) => entity.name === testCase.name,
      );

      expect(storedCharacter?.subtype).toBe("Main");
    }
  });

  it("marks strong POV characters as Main even if the provider flagged the entry as a stub", () => {
    const chapter = upsertChapter({
      number: 104,
      title: "Iris Stub POV",
      text: [
        "It wasn't sunlight yet, but it was light from the sun.",
        "Lady Iris Smith's sky-blue eyes fluttered open.",
        "She yawned and stretched in the massive four-poster bed.",
        "She ran her hands along the fabric with appreciation.",
        "She put her chocolate-colored hair up with a black ribbon.",
        "Iris checked the list and smiled.",
      ].join(" "),
    });

    const normalized = normalizeScanResult(
      {
        entities: [
          {
            name: "Iris Smith",
            category: "character",
            summary: [
              "## Core Status",
              "- On-page status: On-page",
              "- Chapter role: Point-of-view character in current chapter snapshot",
              "",
              "## Identity",
              "- Noblewoman",
            ].join("\n"),
            isStub: true,
            aliases: ["Iris"],
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
      chapter.currentText,
    );

    reconcileCanon(chapter.id, normalized);

    const iris = listEntities().find((entity) => entity.name === "Iris Smith");
    expect(iris?.subtype).toBe("Main");
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
          category: "character",
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

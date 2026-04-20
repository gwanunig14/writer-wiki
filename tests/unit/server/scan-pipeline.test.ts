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

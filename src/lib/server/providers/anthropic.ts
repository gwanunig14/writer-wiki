import Anthropic from "@anthropic-ai/sdk";
import { scanResultSchema } from "$lib/types/scan-result";
import type { AIProvider } from "./provider";
import { extractDeterministicCanon, formatLogPreview } from "./provider";

const ANTHROPIC_SCAN_MODEL =
  process.env.ACK_ANTHROPIC_SCAN_MODEL ?? "latest-available";
const ANTHROPIC_CHAT_MODEL =
  process.env.ACK_ANTHROPIC_CHAT_MODEL ?? "latest-available";
const ANTHROPIC_SCAN_FALLBACK_MODELS = [
  "claude-sonnet-4-5",
  "claude-3-7-sonnet-latest",
  "claude-3-5-haiku-latest",
];
const ANTHROPIC_CHAT_FALLBACK_MODELS = [
  "claude-sonnet-4-5",
  "claude-3-7-sonnet-latest",
  "claude-3-5-haiku-latest",
];

let cachedLatestAnthropicModel: string | null = null;
let latestAnthropicModelResolved = false;

function supportsAnthropicModelFallback(error: unknown) {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? (error as { status?: unknown }).status
      : undefined;
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";

  return (
    (status === 400 || status === 404) &&
    /model|unsupported|not found|does not exist|unavailable|invalid/i.test(
      message,
    )
  );
}

function compareAnthropicModelIds(left: string, right: string) {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

async function resolveLatestAvailableAnthropicModel(client: Anthropic) {
  if (latestAnthropicModelResolved) {
    return cachedLatestAnthropicModel;
  }

  latestAnthropicModelResolved = true;
  try {
    const models = await client.models.list();
    const claudeModels = models.data
      .map((model) => model.id)
      .filter((id) => id.startsWith("claude-"));

    if (claudeModels.length === 0) {
      cachedLatestAnthropicModel = null;
      return null;
    }

    claudeModels.sort(compareAnthropicModelIds);
    cachedLatestAnthropicModel = claudeModels[claudeModels.length - 1] ?? null;
    return cachedLatestAnthropicModel;
  } catch (error) {
    console.warn(
      "[scan:anthropic] unable to list models for latest selection",
      {
        error: error instanceof Error ? error.message : String(error),
      },
    );
    cachedLatestAnthropicModel = null;
    return null;
  }
}

// JSON Schema representation of scanResultSchema, used as the Anthropic tool
// input_schema to force structured output via tool-use.
const SCAN_RESULT_INPUT_SCHEMA = {
  type: "object" as const,
  required: [
    "entities",
    "chronology",
    "watchlist",
    "newCanon",
    "updatedCanon",
    "seriesBibleImpact",
    "fileImpact",
    "changeLog",
  ],
  properties: {
    entities: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "category", "summary", "isStub", "aliases", "links"],
        properties: {
          name: { type: "string", minLength: 1 },
          category: {
            type: "string",
            enum: ["character", "location", "item", "organization"],
          },
          itemSubtype: {
            type: ["string", "null"],
            enum: [
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
              null,
            ],
          },
          parentLocationName: { type: ["string", "null"] },
          summary: { type: "string", minLength: 1 },
          isStub: { type: "boolean" },
          aliases: { type: "array", items: { type: "string" } },
          links: {
            type: "array",
            items: {
              type: "object",
              required: ["targetName", "relationType"],
              properties: {
                targetName: { type: "string" },
                relationType: { type: "string" },
              },
            },
          },
        },
      },
    },
    chronology: {
      type: "array",
      items: {
        type: "object",
        required: ["label", "body", "confidence"],
        properties: {
          label: { type: "string", minLength: 1 },
          body: { type: "string", minLength: 1 },
          confidence: {
            type: "string",
            enum: ["confirmed", "probable", "possible"],
          },
        },
      },
    },
    watchlist: {
      type: "array",
      items: {
        type: "object",
        required: ["type", "subject", "body"],
        properties: {
          type: {
            type: "string",
            enum: [
              "contradiction",
              "missing-description",
              "name-collision",
              "timeline-risk",
              "relationship-ambiguity",
              "item-clarification",
              "location-risk",
            ],
          },
          subject: { type: "string", minLength: 1 },
          body: { type: "string", minLength: 1 },
        },
      },
    },
    newCanon: {
      type: "array",
      items: { type: "string" },
    },
    updatedCanon: {
      type: "array",
      items: { type: "string" },
    },
    seriesBibleImpact: {
      type: "object",
      properties: {
        outcome: {
          type: "string",
          enum: [
            "no-series-bible-update-needed",
            "series-bible-update-required",
            "series-bible-review-required",
          ],
        },
        rationale: { type: "string" },
        impactedSections: {
          type: "array",
          items: { type: "string" },
        },
      },
    },
    fileImpact: {
      type: "array",
      items: {
        type: "object",
        required: ["targetPath", "action"],
        properties: {
          targetPath: { type: "string" },
          action: {
            type: "string",
            enum: ["create", "update", "move"],
          },
          reason: { type: "string" },
        },
      },
    },
    changeLog: {
      type: "array",
      items: { type: "string" },
    },
  },
};

export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic" as const;

  async testConnection(apiKey: string) {
    if (apiKey.startsWith("ack-demo")) {
      return {
        ok: true,
        message: "Using deterministic local demo provider response.",
      };
    }

    const client = new Anthropic({ apiKey });
    await client.models.list();
    return { ok: true, message: "Anthropic connection succeeded." };
  }

  async scanChapter(input: {
    systemPrompt: string;
    requestInput: Array<{
      role: "system" | "user";
      content: Array<{
        type: "input_text";
        text: string;
      }>;
    }>;
    requestPayload: {
      chapter: {
        number: number | null;
        title: string;
        text: string;
      };
      comparisonPacket: {
        entities: Array<{
          canonicalName: string;
          category: "character" | "location" | "item" | "organization";
          aliases: string[];
          stableFacts: string[];
          openRisks: string[];
        }>;
        chronologyComparisonFacts: string[];
        watchlistNotes: string[];
      };
    };
    chapterText: string;
    chapterLabel: string;
    apiKey: string;
    userBlocking?: boolean;
    onBatchLifecycleEvent?: (event: {
      phase: "submitted" | "polling" | "completed";
      batchId: string;
      batchCustomId: string;
      batchInputFileId?: string;
      batchStatus?: string;
    }) => void;
    escalationHints?: {
      contradictionCountExceededThreshold: boolean;
      unresolvedAmbiguityExceededThreshold: boolean;
      majorSeriesBibleImpact: boolean;
      lowReconciliationConfidence: boolean;
      validationRetryCount: number;
    };
  }) {
    if (input.apiKey.startsWith("ack-demo")) {
      return extractDeterministicCanon(input.chapterText, input.chapterLabel);
    }

    const client = new Anthropic({ apiKey: input.apiKey });
    const requestedLatest = ANTHROPIC_SCAN_MODEL === "latest-available";
    const latestAvailableModel = requestedLatest
      ? await resolveLatestAvailableAnthropicModel(client)
      : null;
    const preferredModel = latestAvailableModel ?? ANTHROPIC_SCAN_MODEL;
    const candidateModels = [preferredModel, ...ANTHROPIC_SCAN_FALLBACK_MODELS]
      .filter((model) => model !== "latest-available")
      .filter((model, index, all) => all.indexOf(model) === index);

    if (requestedLatest) {
      console.info("[scan:anthropic] latest model resolution", {
        requested: ANTHROPIC_SCAN_MODEL,
        resolved: latestAvailableModel,
        candidates: candidateModels,
      });
    }

    let response: Awaited<ReturnType<typeof client.messages.create>> | null =
      null;
    let selectedModel = ANTHROPIC_SCAN_MODEL;

    for (const model of candidateModels) {
      try {
        console.info("[scan:anthropic] sending scan request", {
          model,
          promptLength: JSON.stringify(input.requestPayload).length,
          chapterLength: input.chapterText.length,
        });

        const prompt = input.requestInput
          .flatMap((message) => message.content.map((entry) => entry.text))
          .join("\n\n");

        response = await client.messages.create({
          model,
          max_tokens: 8192,
          tools: [
            {
              name: "produce_scan_result",
              description:
                "Produce the complete structured scan result for the chapter.",
              input_schema: SCAN_RESULT_INPUT_SCHEMA,
            },
          ],
          tool_choice: { type: "tool", name: "produce_scan_result" },
          messages: [{ role: "user", content: prompt }],
        });
        selectedModel = model;
        break;
      } catch (error) {
        if (
          !supportsAnthropicModelFallback(error) ||
          model === candidateModels.at(-1)
        ) {
          throw error;
        }

        console.warn("[scan:anthropic] model unavailable, trying fallback", {
          attemptedModel: model,
        });
      }
    }

    if (!response) {
      throw new Error(
        "Anthropic scan request failed before producing a response.",
      );
    }

    const toolUseBlock = response.content.find(
      (block) => block.type === "tool_use",
    );
    if (!toolUseBlock || toolUseBlock.type !== "tool_use") {
      console.error("[scan:anthropic] missing tool_use block in response", {
        contentTypes: response.content.map((b) => b.type),
        stopReason: response.stop_reason,
      });
      throw new Error("Anthropic did not return a tool_use block.");
    }

    const rawJson = JSON.stringify(toolUseBlock.input);
    console.info("[scan:anthropic] received scan response", {
      model: selectedModel,
      outputLength: rawJson.length,
      preview: formatLogPreview(rawJson),
    });

    return scanResultSchema.parse(toolUseBlock.input);
  }

  async answerCanonQuestion(input: {
    question: string;
    evidence: string[];
    apiKey: string;
  }) {
    if (input.apiKey.startsWith("ack-demo")) {
      return {
        direct:
          input.evidence[0] ??
          "There is not enough source material yet to answer.",
        confirmedEvidence: input.evidence.slice(0, 3),
        inferred: [],
        unresolved: input.evidence.length
          ? []
          : ["No supporting canon evidence is available yet."],
      };
    }

    const client = new Anthropic({ apiKey: input.apiKey });
    const evidenceBlock =
      input.evidence.length > 0
        ? `Relevant canon evidence:\n${input.evidence.join("\n\n")}\n\n`
        : "";
    const requestedLatest = ANTHROPIC_CHAT_MODEL === "latest-available";
    const latestAvailableModel = requestedLatest
      ? await resolveLatestAvailableAnthropicModel(client)
      : null;
    const preferredModel = latestAvailableModel ?? ANTHROPIC_CHAT_MODEL;
    const candidateModels = [preferredModel, ...ANTHROPIC_CHAT_FALLBACK_MODELS]
      .filter((model) => model !== "latest-available")
      .filter((model, index, all) => all.indexOf(model) === index);

    if (requestedLatest) {
      console.info("[chat:anthropic] latest model resolution", {
        requested: ANTHROPIC_CHAT_MODEL,
        resolved: latestAvailableModel,
        candidates: candidateModels,
      });
    }

    let response: Awaited<ReturnType<typeof client.messages.create>> | null =
      null;
    for (const model of candidateModels) {
      try {
        response = await client.messages.create({
          model,
          max_tokens: 512,
          messages: [
            {
              role: "user",
              content: `${evidenceBlock}Question: ${input.question}`,
            },
          ],
        });
        break;
      } catch (error) {
        if (
          !supportsAnthropicModelFallback(error) ||
          model === candidateModels.at(-1)
        ) {
          throw error;
        }

        console.warn("[chat:anthropic] model unavailable, trying fallback", {
          attemptedModel: model,
        });
      }
    }

    if (!response) {
      throw new Error(
        "Anthropic chat request failed before producing a response.",
      );
    }

    const text =
      response.content.find((block) => block.type === "text")?.text ?? "";
    return {
      direct: text,
      confirmedEvidence: input.evidence.slice(0, 3),
      inferred: [],
      unresolved: [],
    };
  }
}

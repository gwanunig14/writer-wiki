import OpenAI from "openai";
import { scanResultSchema } from "$lib/types/scan-result";
import type { AIProvider } from "./provider";
import {
  extractDeterministicCanon,
  formatLogPreview,
  parseJsonResponseText,
} from "./provider";
import { createReadStream, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OPENAI_SCAN_MODEL = process.env.ACK_OPENAI_SCAN_MODEL ?? "gpt-5.4-mini";
const OPENAI_CHAT_MODEL =
  process.env.ACK_OPENAI_CHAT_MODEL ?? "latest-available";
const OPENAI_SCAN_ESCALATION_MODEL =
  process.env.ACK_OPENAI_SCAN_ESCALATION_MODEL ?? "gpt-5.4";
const OPENAI_SCAN_FALLBACK_MODELS = ["gpt-5.3", "gpt-4.1"];
const OPENAI_CHAT_FALLBACK_MODELS = ["gpt-5.3", "gpt-4.1-mini"];
const OPENAI_STABLE_SCAN_MODEL_PATTERN = /^gpt-(\d+)(?:\.(\d+))?(?:\.(\d+))?$/;
const OPENAI_BATCH_COMPLETION_WINDOW =
  process.env.ACK_OPENAI_BATCH_COMPLETION_WINDOW ?? "24h";
const OPENAI_BATCH_POLL_INTERVAL_MS = Number(
  process.env.ACK_OPENAI_BATCH_POLL_INTERVAL_MS ?? "5000",
);
const OPENAI_BATCH_MAX_WAIT_MS = Number(
  process.env.ACK_OPENAI_BATCH_MAX_WAIT_MS ?? "300000",
);

let cachedLatestScanModel: string | null = null;
let latestScanModelResolved = false;

function supportsModelFallback(error: unknown) {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? (error as { status?: unknown }).status
      : undefined;
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";

  return (
    status === 400 &&
    /model|unsupported|not found|does not exist|unavailable/i.test(message)
  );
}

function compareStableModelIds(left: string, right: string) {
  const leftMatch = OPENAI_STABLE_SCAN_MODEL_PATTERN.exec(left);
  const rightMatch = OPENAI_STABLE_SCAN_MODEL_PATTERN.exec(right);
  if (!leftMatch || !rightMatch) {
    return 0;
  }

  const leftMajor = Number(leftMatch[1] ?? 0);
  const leftMinor = Number(leftMatch[2] ?? 0);
  const leftPatch = Number(leftMatch[3] ?? 0);

  const rightMajor = Number(rightMatch[1] ?? 0);
  const rightMinor = Number(rightMatch[2] ?? 0);
  const rightPatch = Number(rightMatch[3] ?? 0);

  if (leftMajor !== rightMajor) return leftMajor - rightMajor;
  if (leftMinor !== rightMinor) return leftMinor - rightMinor;
  return leftPatch - rightPatch;
}

function shouldEscalateScanModel(
  hints:
    | {
        contradictionCountExceededThreshold: boolean;
        unresolvedAmbiguityExceededThreshold: boolean;
        majorSeriesBibleImpact: boolean;
        lowReconciliationConfidence: boolean;
        validationRetryCount: number;
      }
    | undefined,
) {
  if (!hints) {
    return false;
  }

  return (
    hints.contradictionCountExceededThreshold ||
    hints.unresolvedAmbiguityExceededThreshold ||
    hints.majorSeriesBibleImpact ||
    hints.lowReconciliationConfidence ||
    hints.validationRetryCount > 0
  );
}

function buildScanModelCandidates(input: {
  escalationHints?: {
    contradictionCountExceededThreshold: boolean;
    unresolvedAmbiguityExceededThreshold: boolean;
    majorSeriesBibleImpact: boolean;
    lowReconciliationConfidence: boolean;
    validationRetryCount: number;
  };
}) {
  const escalatedByHints = shouldEscalateScanModel(input.escalationHints);
  const preferredModels = escalatedByHints
    ? [OPENAI_SCAN_ESCALATION_MODEL, OPENAI_SCAN_MODEL]
    : [OPENAI_SCAN_MODEL];

  return [...preferredModels, ...OPENAI_SCAN_FALLBACK_MODELS].filter(
    (model, index, all) => all.indexOf(model) === index,
  );
}

function isSchemaValidationError(error: unknown) {
  return error instanceof Error && error.name === "ScanSchemaValidationError";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SCAN_RESPONSE_JSON_SCHEMA = {
  type: "object",
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
        required: [
          "name",
          "category",
          "itemSubtype",
          "parentLocationName",
          "summary",
          "isStub",
          "aliases",
          "links",
          "characterImportance",
          "roleTitleFacts",
          "physicalDescription",
          "relationshipFacts",
          "outfitByScene",
        ],
        properties: {
          name: {
            type: "string",
            minLength: 1,
          },
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
          parentLocationName: {
            type: ["string", "null"],
          },
          summary: {
            type: "string",
            minLength: 1,
          },
          isStub: {
            type: "boolean",
          },
          aliases: {
            type: "array",
            items: {
              type: "string",
            },
          },
          links: {
            type: "array",
            items: {
              type: "object",
              required: ["targetName", "relationType"],
              properties: {
                targetName: {
                  type: "string",
                },
                relationType: {
                  type: "string",
                },
              },
              additionalProperties: false,
            },
          },

          characterImportance: {
            type: ["string", "null"],
            enum: ["main", "major", "minor", null],
          },
          roleTitleFacts: {
            type: "array",
            items: {
              type: "string",
            },
          },
          physicalDescription: {
            type: "array",
            items: {
              type: "string",
            },
          },
          relationshipFacts: {
            type: "array",
            items: {
              type: "string",
            },
          },
          outfitByScene: {
            type: "array",
            items: {
              type: "string",
            },
          },
        },
        additionalProperties: false,
      },
    },

    chronology: {
      type: "array",
      items: {
        type: "object",
        required: ["label", "body", "confidence"],
        properties: {
          label: {
            type: "string",
            minLength: 1,
          },
          body: {
            type: "string",
            minLength: 1,
          },
          confidence: {
            type: "string",
            enum: ["confirmed", "probable", "possible"],
          },
        },
        additionalProperties: false,
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
          subject: {
            type: "string",
            minLength: 1,
          },
          body: {
            type: "string",
            minLength: 1,
          },
        },
        additionalProperties: false,
      },
    },

    newCanon: {
      type: "array",
      items: {
        type: "string",
      },
    },

    updatedCanon: {
      type: "array",
      items: {
        type: "string",
      },
    },

    seriesBibleImpact: {
      type: "object",
      required: ["outcome", "rationale", "impactedSections"],
      properties: {
        outcome: {
          type: "string",
          enum: [
            "no-series-bible-update-needed",
            "series-bible-update-required",
            "series-bible-review-required",
          ],
        },
        rationale: {
          type: "string",
        },
        impactedSections: {
          type: "array",
          items: {
            type: "string",
          },
        },
      },
      additionalProperties: false,
    },

    fileImpact: {
      type: "array",
      items: {
        type: "object",
        required: ["targetPath", "action", "reason"],
        properties: {
          targetPath: {
            type: "string",
            minLength: 1,
          },
          action: {
            type: "string",
            enum: ["create", "update", "move"],
          },
          reason: {
            type: "string",
            minLength: 1,
          },
        },
        additionalProperties: false,
      },
    },

    changeLog: {
      type: "array",
      items: {
        type: "string",
      },
    },
  },
  additionalProperties: false,
} as const;

class ScanSchemaValidationError extends Error {
  cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ScanSchemaValidationError";
    this.cause = cause;
  }
}

function parseScanResultFromOutputText(outputText: string) {
  try {
    const parsedJson = parseJsonResponseText(outputText);
    return scanResultSchema.parse(parsedJson);
  } catch (error) {
    throw new ScanSchemaValidationError(
      "OpenAI scan response failed schema validation.",
      error,
    );
  }
}

function buildScanResponseRequestBody(input: {
  model: string;
  requestInput: Array<{
    role: "system" | "user";
    content: Array<{
      type: "input_text";
      text: string;
    }>;
  }>;
}) {
  return {
    model: input.model,
    input: input.requestInput,
    text: {
      format: {
        type: "json_schema",
        name: "scan_result",
        strict: true,
        schema: SCAN_RESPONSE_JSON_SCHEMA,
      },
    },
  };
}

async function readFileContentAsText(fileContent: unknown) {
  if (typeof fileContent === "string") {
    return fileContent;
  }

  if (
    typeof fileContent === "object" &&
    fileContent !== null &&
    "text" in fileContent &&
    typeof (fileContent as { text?: unknown }).text === "function"
  ) {
    return await (fileContent as { text: () => Promise<string> }).text();
  }

  return JSON.stringify(fileContent);
}

async function runBatchScanRequest(input: {
  client: OpenAI;
  model: string;
  requestInput: Array<{
    role: "system" | "user";
    content: Array<{
      type: "input_text";
      text: string;
    }>;
  }>;
  chapterNumber: number | null;
  onBatchLifecycleEvent?: (event: {
    phase: "submitted" | "polling" | "completed";
    batchId: string;
    batchCustomId: string;
    batchInputFileId?: string;
    batchStatus?: string;
  }) => void;
}) {
  const submitted = await submitBatchScanRequest({
    client: input.client,
    model: input.model,
    requestInput: input.requestInput,
    chapterNumber: input.chapterNumber,
    onBatchLifecycleEvent: input.onBatchLifecycleEvent,
  });

  const outputFileId = await pollBatchScanCompletion({
    client: input.client,
    batchId: submitted.batchId,
    batchCustomId: submitted.batchCustomId,
    batchInputFileId: submitted.batchInputFileId,
    onBatchLifecycleEvent: input.onBatchLifecycleEvent,
  });

  return await ingestBatchScanResult({
    client: input.client,
    outputFileId,
    batchCustomId: submitted.batchCustomId,
  });
}

function buildBatchCustomId(chapterNumber: number | null) {
  const chapterSegment =
    chapterNumber === null ? "draft" : `ch${String(chapterNumber)}`;
  return `scan-${chapterSegment}-lean-${Date.now()}`;
}

async function submitBatchScanRequest(input: {
  client: OpenAI;
  model: string;
  requestInput: Array<{
    role: "system" | "user";
    content: Array<{
      type: "input_text";
      text: string;
    }>;
  }>;
  chapterNumber: number | null;
  onBatchLifecycleEvent?: (event: {
    phase: "submitted" | "polling" | "completed";
    batchId: string;
    batchCustomId: string;
    batchInputFileId?: string;
    batchStatus?: string;
  }) => void;
}) {
  const requestBody = buildScanResponseRequestBody({
    model: input.model,
    requestInput: input.requestInput,
  });

  const tempDir = mkdtempSync(join(tmpdir(), "ack-openai-batch-"));
  const batchInputPath = join(tempDir, "scan.jsonl");
  const customId = buildBatchCustomId(input.chapterNumber);
  const payloadLine = JSON.stringify({
    custom_id: customId,
    method: "POST",
    url: "/v1/responses",
    body: requestBody,
  });

  writeFileSync(batchInputPath, `${payloadLine}\n`, "utf8");

  try {
    const uploaded = await input.client.files.create({
      file: createReadStream(batchInputPath),
      purpose: "batch",
    });

    const batch = await input.client.batches.create({
      input_file_id: uploaded.id,
      endpoint: "/v1/responses",
      completion_window: OPENAI_BATCH_COMPLETION_WINDOW,
      metadata: {
        kind: "chapter-scan",
        chapterNumber:
          input.chapterNumber === null ? "draft" : String(input.chapterNumber),
        mode: "lean",
      },
    });

    input.onBatchLifecycleEvent?.({
      phase: "submitted",
      batchId: batch.id,
      batchCustomId: customId,
      batchInputFileId: uploaded.id,
    });

    return {
      batchId: batch.id,
      batchCustomId: customId,
      batchInputFileId: uploaded.id,
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function pollBatchScanCompletion(input: {
  client: OpenAI;
  batchId: string;
  batchCustomId: string;
  batchInputFileId: string;
  onBatchLifecycleEvent?: (event: {
    phase: "submitted" | "polling" | "completed";
    batchId: string;
    batchCustomId: string;
    batchInputFileId?: string;
    batchStatus?: string;
  }) => void;
}) {
  const start = Date.now();
  let latest = await input.client.batches.retrieve(input.batchId);
  input.onBatchLifecycleEvent?.({
    phase: "polling",
    batchId: input.batchId,
    batchCustomId: input.batchCustomId,
    batchInputFileId: input.batchInputFileId,
    batchStatus: latest.status,
  });

  while (
    latest.status !== "completed" &&
    latest.status !== "failed" &&
    latest.status !== "cancelled" &&
    latest.status !== "expired"
  ) {
    if (Date.now() - start > OPENAI_BATCH_MAX_WAIT_MS) {
      throw new Error(
        `OpenAI batch scan timed out after ${OPENAI_BATCH_MAX_WAIT_MS} ms with status ${latest.status}.`,
      );
    }

    await sleep(OPENAI_BATCH_POLL_INTERVAL_MS);
    latest = await input.client.batches.retrieve(input.batchId);
    input.onBatchLifecycleEvent?.({
      phase: "polling",
      batchId: input.batchId,
      batchCustomId: input.batchCustomId,
      batchInputFileId: input.batchInputFileId,
      batchStatus: latest.status,
    });
  }

  if (latest.status !== "completed") {
    throw new Error(`OpenAI batch scan ended with status: ${latest.status}`);
  }

  if (!latest.output_file_id) {
    throw new Error("OpenAI batch completed without an output file.");
  }

  input.onBatchLifecycleEvent?.({
    phase: "completed",
    batchId: input.batchId,
    batchCustomId: input.batchCustomId,
    batchInputFileId: input.batchInputFileId,
    batchStatus: latest.status,
  });

  return latest.output_file_id;
}

async function ingestBatchScanResult(input: {
  client: OpenAI;
  outputFileId: string;
  batchCustomId: string;
}) {
  const outputFile = await input.client.files.content(input.outputFileId);
  const jsonl = await readFileContentAsText(outputFile);
  const lines = jsonl
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    throw new Error("OpenAI batch output file was empty.");
  }

  const parsedLines = lines
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((line): line is Record<string, unknown> => line !== null);

  const resultLine =
    parsedLines.find(
      (line) => String(line.custom_id ?? "") === input.batchCustomId,
    ) ?? parsedLines[0];

  if (!resultLine) {
    throw new Error("OpenAI batch output did not contain valid JSON lines.");
  }

  const response =
    typeof resultLine.response === "object" && resultLine.response !== null
      ? (resultLine.response as Record<string, unknown>)
      : null;
  const body =
    response && typeof response.body === "object" && response.body !== null
      ? (response.body as Record<string, unknown>)
      : null;

  if (!body) {
    throw new Error(
      "OpenAI batch output line did not contain a response body.",
    );
  }

  const outputText =
    typeof body.output_text === "string" ? body.output_text : "";
  if (!outputText) {
    throw new ScanSchemaValidationError(
      "OpenAI batch response body did not include parsed data or output_text.",
    );
  }

  return parseScanResultFromOutputText(outputText);
}

async function resolveLatestAvailableScanModel(client: OpenAI) {
  if (latestScanModelResolved) {
    return cachedLatestScanModel;
  }

  latestScanModelResolved = true;
  try {
    const models = await client.models.list();
    const stableModelIds = models.data
      .map((model) => model.id)
      .filter((id) => OPENAI_STABLE_SCAN_MODEL_PATTERN.test(id));

    if (stableModelIds.length === 0) {
      cachedLatestScanModel = null;
      return null;
    }

    stableModelIds.sort(compareStableModelIds);
    cachedLatestScanModel = stableModelIds[stableModelIds.length - 1] ?? null;
    return cachedLatestScanModel;
  } catch (error) {
    console.warn("[scan:openai] unable to list models for latest selection", {
      error: error instanceof Error ? error.message : String(error),
    });
    cachedLatestScanModel = null;
    return null;
  }
}

export class OpenAIProvider implements AIProvider {
  readonly name = "openai" as const;

  async testConnection(apiKey: string) {
    if (apiKey.startsWith("ack-demo")) {
      return {
        ok: true,
        message: "Using deterministic local demo provider response.",
      };
    }

    const client = new OpenAI({ apiKey });
    await client.models.list();
    return { ok: true, message: "OpenAI connection succeeded." };
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

    const client = new OpenAI({ apiKey: input.apiKey });
    const candidateModels = buildScanModelCandidates({
      escalationHints: input.escalationHints,
    });
    const useBatchApi = input.userBlocking === false;

    if (useBatchApi) {
      console.info("[scan:openai] batch mode requested for background scan", {
        candidateModels,
      });
    }

    const modelQueue = [...candidateModels];
    let escalationInsertedFromValidation = false;
    let parsedResult: ReturnType<typeof scanResultSchema.parse> | null = null;
    let selectedModel = OPENAI_SCAN_MODEL;
    let rawApiResponse: unknown = null;

    while (modelQueue.length > 0) {
      const model = modelQueue.shift()!;
      try {
        const requestBody = buildScanResponseRequestBody({
          model,
          requestInput: input.requestInput,
        });

        console.info("[scan:openai] sending scan request", {
          model,
          systemPromptLength: input.systemPrompt.length,
          comparisonEntityCount:
            input.requestPayload.comparisonPacket.entities.length,
          chapterLength: input.chapterText.length,
          escalated: model === OPENAI_SCAN_ESCALATION_MODEL,
          useBatchApi,
        });

        if (useBatchApi) {
          const batchParsed = await runBatchScanRequest({
            client,
            model,
            requestInput: input.requestInput,
            chapterNumber: input.requestPayload.chapter.number,
            onBatchLifecycleEvent: input.onBatchLifecycleEvent,
          });
          return { parsedResult: batchParsed, rawApiResponse: null };
        }

        const response = await client.responses.create(requestBody);
        rawApiResponse = response;
        const outputText = response.output_text || "";

        if (!outputText.trim()) {
          throw new ScanSchemaValidationError(
            "OpenAI scan response was empty; expected JSON text.",
          );
        }

        parsedResult = parseScanResultFromOutputText(outputText);
        selectedModel = model;
        break;
      } catch (error) {
        if (
          isSchemaValidationError(error) &&
          model !== OPENAI_SCAN_ESCALATION_MODEL &&
          !escalationInsertedFromValidation
        ) {
          escalationInsertedFromValidation = true;
          modelQueue.unshift(OPENAI_SCAN_ESCALATION_MODEL);
          console.warn(
            "[scan:openai] schema validation failed, escalating scan model",
            {
              attemptedModel: model,
              escalationModel: OPENAI_SCAN_ESCALATION_MODEL,
            },
          );
          continue;
        }

        if (!supportsModelFallback(error) || modelQueue.length === 0) {
          throw error;
        }

        console.warn("[scan:openai] scan model unavailable, trying fallback", {
          attemptedModel: model,
        });
      }
    }

    if (!parsedResult) {
      throw new Error(
        "OpenAI scan request failed before producing a response.",
      );
    }

    console.info("[scan:openai] received scan response", {
      model: selectedModel,
      outputLength: JSON.stringify(parsedResult).length,
      preview: formatLogPreview(JSON.stringify(parsedResult)),
      parsed: true,
      rawApiResponsePreview: rawApiResponse
        ? formatLogPreview(JSON.stringify(rawApiResponse))
        : undefined,
    });

    return { parsedResult, rawApiResponse };
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

    const client = new OpenAI({ apiKey: input.apiKey });
    const requestedLatest = OPENAI_CHAT_MODEL === "latest-available";
    const latestAvailableModel = requestedLatest
      ? await resolveLatestAvailableScanModel(client)
      : null;
    const preferredModel = latestAvailableModel ?? OPENAI_CHAT_MODEL;
    const candidateModels = [preferredModel, ...OPENAI_CHAT_FALLBACK_MODELS]
      .filter((model) => model !== "latest-available")
      .filter((model, index, all) => all.indexOf(model) === index);

    if (requestedLatest) {
      console.info("[chat:openai] latest model resolution", {
        requested: OPENAI_CHAT_MODEL,
        resolved: latestAvailableModel,
        candidates: candidateModels,
      });
    }

    let response: Awaited<ReturnType<typeof client.responses.create>> | null =
      null;
    for (const model of candidateModels) {
      try {
        response = await client.responses.create({
          model,
          input: input.evidence.join("\n") + `\n\nQuestion: ${input.question}`,
        });
        break;
      } catch (error) {
        if (!supportsModelFallback(error) || model === candidateModels.at(-1)) {
          throw error;
        }

        console.warn("[chat:openai] chat model unavailable, trying fallback", {
          attemptedModel: model,
        });
      }
    }

    if (!response) {
      throw new Error(
        "OpenAI chat request failed before producing a response.",
      );
    }

    return {
      direct: response.output_text,
      confirmedEvidence: input.evidence.slice(0, 3),
      inferred: [],
      unresolved: [],
    };
  }
}

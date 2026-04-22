import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
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
const OPENAI_SCAN_FALLBACK_MODELS = ["gpt-5.4-mini", "gpt-5.3", "gpt-4.1"];
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
        highContradictionDensity: boolean;
        highEntityAmbiguity: boolean;
        majorSeriesBibleImpact: boolean;
        highReconciliationRisk: boolean;
        validationRetryCount: number;
      }
    | undefined,
) {
  if (!hints) {
    return false;
  }

  return (
    hints.highContradictionDensity ||
    hints.highEntityAmbiguity ||
    hints.majorSeriesBibleImpact ||
    hints.highReconciliationRisk ||
    hints.validationRetryCount > 0
  );
}

function buildScanModelCandidates(input: {
  escalationHints?: {
    highContradictionDensity: boolean;
    highEntityAmbiguity: boolean;
    majorSeriesBibleImpact: boolean;
    highReconciliationRisk: boolean;
    validationRetryCount: number;
  };
}) {
  const requestedModel = OPENAI_SCAN_MODEL;
  const escalated = shouldEscalateScanModel(input.escalationHints);

  const preferredModel = escalated
    ? OPENAI_SCAN_ESCALATION_MODEL
    : requestedModel;

  return [preferredModel, requestedModel, ...OPENAI_SCAN_FALLBACK_MODELS]
    .filter((model) => model !== "latest-available")
    .filter((model, index, all) => all.indexOf(model) === index);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  prompt: string;
}) {
  const requestBody = {
    model: input.model,
    input: input.prompt,
    text: {
      format: zodTextFormat(scanResultSchema, "scan_result"),
    },
  };

  const tempDir = mkdtempSync(join(tmpdir(), "ack-openai-batch-"));
  const batchInputPath = join(tempDir, "scan.jsonl");
  const customId = `scan-${Date.now()}`;
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
      metadata: { kind: "chapter-scan" },
    });

    const start = Date.now();
    let latest = await input.client.batches.retrieve(batch.id);
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
      latest = await input.client.batches.retrieve(batch.id);
    }

    if (latest.status !== "completed") {
      throw new Error(`OpenAI batch scan ended with status: ${latest.status}`);
    }

    if (!latest.output_file_id) {
      throw new Error("OpenAI batch completed without an output file.");
    }

    const outputFile = await input.client.files.content(latest.output_file_id);
    const jsonl = await readFileContentAsText(outputFile);
    const lines = jsonl
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      throw new Error("OpenAI batch output file was empty.");
    }

    const resultLine = lines
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .find((line): line is Record<string, unknown> => line !== null);

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

    if (body.output_parsed) {
      return scanResultSchema.parse(body.output_parsed);
    }

    const outputText =
      typeof body.output_text === "string" ? body.output_text : "";
    if (!outputText) {
      throw new Error(
        "OpenAI batch response body did not include parsed data or output_text.",
      );
    }

    return scanResultSchema.parse(parseJsonResponseText(outputText));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
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
    prompt: string;
    chapterText: string;
    chapterLabel: string;
    apiKey: string;
    userBlocking?: boolean;
    escalationHints?: {
      highContradictionDensity: boolean;
      highEntityAmbiguity: boolean;
      majorSeriesBibleImpact: boolean;
      highReconciliationRisk: boolean;
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
    const useBatchApi =
      input.userBlocking === false &&
      process.env.ACK_OPENAI_USE_BATCH_API === "1";

    if (useBatchApi) {
      console.info("[scan:openai] batch mode requested for background scan", {
        candidateModels,
      });
    }

    let response: Awaited<ReturnType<typeof client.responses.parse>> | null =
      null;
    let selectedModel = OPENAI_SCAN_MODEL;

    for (const model of candidateModels) {
      try {
        console.info("[scan:openai] sending scan request", {
          model,
          promptLength: input.prompt.length,
          chapterLength: input.chapterText.length,
          escalated: model === OPENAI_SCAN_ESCALATION_MODEL,
          useBatchApi,
        });

        if (useBatchApi) {
          const batchParsed = await runBatchScanRequest({
            client,
            model,
            prompt: input.prompt,
          });
          return scanResultSchema.parse(batchParsed);
        }

        response = await client.responses.parse({
          model,
          input: input.prompt,
          text: {
            format: zodTextFormat(scanResultSchema, "scan_result"),
          },
        });
        selectedModel = model;
        break;
      } catch (error) {
        if (!supportsModelFallback(error) || model === candidateModels.at(-1)) {
          throw error;
        }

        console.warn("[scan:openai] scan model unavailable, trying fallback", {
          attemptedModel: model,
        });
      }
    }

    if (!response) {
      throw new Error(
        "OpenAI scan request failed before producing a response.",
      );
    }

    const payload = response.output_text || "";
    const parsed = response.output_parsed;

    console.info("[scan:openai] received scan response", {
      model: selectedModel,
      outputLength: payload.length,
      preview: formatLogPreview(payload),
      parsed: parsed !== null,
    });

    if (!parsed) {
      console.error("[scan:openai] missing parsed structured output", {
        outputLength: payload.length,
        preview: formatLogPreview(payload),
      });
      throw new Error("OpenAI did not return parsed structured scan output.");
    }

    return scanResultSchema.parse(parsed);
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

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { scanResultSchema } from "$lib/types/scan-result";
import type { AIProvider } from "./provider";
import { extractDeterministicCanon, formatLogPreview } from "./provider";

const OPENAI_SCAN_MODEL =
  process.env.ACK_OPENAI_SCAN_MODEL ?? "latest-available";
const OPENAI_CHAT_MODEL =
  process.env.ACK_OPENAI_CHAT_MODEL ?? "latest-available";
const OPENAI_SCAN_FALLBACK_MODELS = ["gpt-5.3", "gpt-4.1"];
const OPENAI_CHAT_FALLBACK_MODELS = ["gpt-5.3", "gpt-4.1-mini"];
const OPENAI_STABLE_SCAN_MODEL_PATTERN = /^gpt-(\d+)(?:\.(\d+))?(?:\.(\d+))?$/;

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
  }) {
    if (input.apiKey.startsWith("ack-demo")) {
      return extractDeterministicCanon(input.chapterText, input.chapterLabel);
    }

    const client = new OpenAI({ apiKey: input.apiKey });
    const requestedLatest = OPENAI_SCAN_MODEL === "latest-available";
    const latestAvailableModel = requestedLatest
      ? await resolveLatestAvailableScanModel(client)
      : null;

    const preferredModel = latestAvailableModel ?? OPENAI_SCAN_MODEL;
    const candidateModels = [preferredModel, ...OPENAI_SCAN_FALLBACK_MODELS]
      .filter((model) => model !== "latest-available")
      .filter((model, index, all) => all.indexOf(model) === index);

    if (requestedLatest) {
      console.info("[scan:openai] latest model resolution", {
        requested: OPENAI_SCAN_MODEL,
        resolved: latestAvailableModel,
        candidates: candidateModels,
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
        });

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

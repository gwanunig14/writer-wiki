import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { scanResultSchema } from "$lib/types/scan-result";
import type { AIProvider } from "./provider";
import { extractDeterministicCanon, formatLogPreview } from "./provider";

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
    apiKey: string;
  }) {
    if (input.apiKey.startsWith("ack-demo")) {
      return extractDeterministicCanon(input.chapterText);
    }

    const client = new OpenAI({ apiKey: input.apiKey });
    console.info("[scan:openai] sending scan request", {
      model: "gpt-4.1-mini",
      promptLength: input.prompt.length,
      chapterLength: input.chapterText.length,
    });
    const response = await client.responses.parse({
      model: "gpt-4.1-mini",
      input: input.prompt,
      text: {
        format: zodTextFormat(scanResultSchema, "scan_result"),
      },
    });

    const payload = response.output_text || "";
    const parsed = response.output_parsed;

    console.info("[scan:openai] received scan response", {
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
    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: input.evidence.join("\n") + `\n\nQuestion: ${input.question}`,
    });

    return {
      direct: response.output_text,
      confirmedEvidence: input.evidence.slice(0, 3),
      inferred: [],
      unresolved: [],
    };
  }
}

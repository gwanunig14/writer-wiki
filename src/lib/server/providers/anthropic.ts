import Anthropic from "@anthropic-ai/sdk";
import type { AIProvider } from "./provider";
import { extractDeterministicCanon } from "./provider";

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
    prompt: string;
    chapterText: string;
    apiKey: string;
  }) {
    if (input.apiKey.startsWith("ack-demo")) {
      return extractDeterministicCanon(input.chapterText);
    }

    const client = new Anthropic({ apiKey: input.apiKey });
    const response = await client.messages.create({
      model: "claude-3-5-haiku-latest",
      max_tokens: 4096,
      messages: [{ role: "user", content: input.prompt }],
    });
    const text = response.content.find((item) => item.type === "text");
    return extractDeterministicCanon(text?.text ?? input.chapterText);
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
    const response = await client.messages.create({
      model: "claude-3-5-haiku-latest",
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: `${input.evidence.join("\n")}\n\nQuestion: ${input.question}`,
        },
      ],
    });

    const text =
      response.content.find((item) => item.type === "text")?.text ?? "";
    return {
      direct: text,
      confirmedEvidence: input.evidence.slice(0, 3),
      inferred: [],
      unresolved: [],
    };
  }
}

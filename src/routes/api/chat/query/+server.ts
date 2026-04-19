import { json } from "@sveltejs/kit";
import { z } from "zod";
import { answerCanonQuestion } from "$lib/server/chat/canon-chat-service";

const requestSchema = z.object({
  conversationId: z.string().uuid().nullable().optional(),
  question: z.string().min(1),
});

export async function POST({ request }) {
  const payload = requestSchema.parse(await request.json());
  const response = await answerCanonQuestion(payload);

  return json({
    conversationId: response.conversationId,
    answer: response.answer,
    evidence: response.evidence,
    messages: response.messages,
  });
}

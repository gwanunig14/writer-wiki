import { json } from "@sveltejs/kit";
import { z } from "zod";
import { getProvider } from "$lib/server/providers/provider";

const requestSchema = z.object({
  provider: z.enum(["openai", "anthropic"]),
  apiKey: z.string().min(1),
});

export async function POST({ request }) {
  const payload = requestSchema.parse(await request.json());
  const provider = getProvider(payload.provider);
  const result = await provider.testConnection(payload.apiKey);
  return json({ provider: payload.provider, ...result });
}

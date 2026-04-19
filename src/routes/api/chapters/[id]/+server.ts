import { error, json } from "@sveltejs/kit";
import { z } from "zod";
import {
  getChapter,
  upsertChapter,
} from "$lib/server/db/repositories/chapter-repository";

const writeSchema = z.object({
  number: z.number().int().nullable().optional().default(null),
  title: z.string().min(1),
  text: z.string().default(""),
});

export async function GET({ params }) {
  const chapter = getChapter(params.id);
  if (!chapter) {
    throw error(404, "Chapter not found.");
  }

  return json(chapter);
}

export async function PUT({ params, request }) {
  const payload = writeSchema.parse(await request.json());
  const chapter = upsertChapter({
    id: params.id,
    number: payload.number ?? null,
    title: payload.title,
    text: payload.text,
  });

  return json(chapter);
}

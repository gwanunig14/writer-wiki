import { json } from "@sveltejs/kit";
import { z } from "zod";
import {
  listChapters,
  upsertChapter,
} from "$lib/server/db/repositories/chapter-repository";

const writeSchema = z.object({
  number: z.number().int().nullable().optional().default(null),
  title: z.string().min(1),
  text: z.string().default(""),
});

export async function GET() {
  return json({ chapters: listChapters() });
}

export async function POST({ request }) {
  const payload = writeSchema.parse(await request.json());
  const chapter = upsertChapter({
    number: payload.number ?? null,
    title: payload.title,
    text: payload.text,
  });

  return json(chapter, { status: 201 });
}

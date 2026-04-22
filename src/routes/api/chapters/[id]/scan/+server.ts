import { error, json } from "@sveltejs/kit";
import { z } from "zod";
import {
  getChapter,
  upsertChapter,
} from "$lib/server/db/repositories/chapter-repository";
import {
  startChapterScan,
  startChapterScanWithMode,
} from "$lib/server/scan/scan-orchestrator";

const requestSchema = z.object({
  forceRescan: z.boolean().optional().default(false),
  userBlocking: z.boolean().optional().default(true),
  number: z.number().int().nullable().optional(),
  title: z.string().min(1).optional(),
  text: z.string().optional(),
});

export async function POST({ params, request }) {
  const existing = getChapter(params.id);
  if (!existing) {
    throw error(404, "Chapter not found.");
  }

  const payload = requestSchema.parse(await request.json());
  if (
    payload.title !== undefined ||
    payload.text !== undefined ||
    payload.number !== undefined
  ) {
    upsertChapter({
      id: params.id,
      number: payload.number ?? existing.number,
      title: payload.title ?? existing.title,
      text: payload.text ?? existing.currentText,
    });
  }

  let scanJob;
  try {
    scanJob = payload.userBlocking
      ? startChapterScan(params.id)
      : startChapterScanWithMode({
          chapterId: params.id,
          userBlocking: false,
        });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scan failed.";
    throw error(400, message);
  }
  return json(scanJob, { status: 202 });
}

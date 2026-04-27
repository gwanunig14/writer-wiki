import { json, error } from "@sveltejs/kit";
import { getChapter } from "$lib/server/db/repositories/chapter-repository";
import {
  buildChapterScanPayload,
  buildChapterScanInput,
} from "$lib/server/prompts/scan-prompt";
import { getScanContext } from "$lib/server/scan/scan-context";

export async function POST({ params }) {
  const chapter = getChapter(params.id);
  if (!chapter) throw error(404, "Chapter not found");

  const scanContext = getScanContext(chapter);
  const requestPayload = buildChapterScanPayload({
    chapterNumber: chapter.number,
    chapterTitle: chapter.title,
    chapterText: chapter.currentText,
    comparisonPacket: scanContext.comparisonPacket,
  });
  const requestInput = buildChapterScanInput(requestPayload);

  return json({
    requestPayload,
    requestInput,
    priorCanonCoverage: scanContext.priorCanonCoverage,
    comparisonPacket: scanContext.comparisonPacket,
  });
}

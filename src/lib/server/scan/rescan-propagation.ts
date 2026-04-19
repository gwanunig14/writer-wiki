import { getDatabase, makeId, nowIso } from "$lib/server/db/client";
import { markChapterStale } from "$lib/server/db/repositories/chapter-repository";
import { getLaterAffectedChapterIds } from "./dependency-graph";

export function replaceChapterDependencies(
  chapterId: string,
  dependencies: Array<{ targetType: string; targetId: string; reason: string }>,
) {
  const db = getDatabase();
  db.prepare(
    "DELETE FROM derived_dependencies WHERE source_chapter_id = ?",
  ).run(chapterId);

  for (const dependency of dependencies) {
    db.prepare(
      `INSERT INTO derived_dependencies (id, source_chapter_id, target_type, target_id, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      makeId(),
      chapterId,
      dependency.targetType,
      dependency.targetId,
      dependency.reason,
      nowIso(),
    );
  }
}

export function markLaterAffectedChaptersStale(chapterId: string) {
  const affectedChapterIds = getLaterAffectedChapterIds(chapterId);
  for (const affectedChapterId of affectedChapterIds) {
    markChapterStale(affectedChapterId);
  }

  return affectedChapterIds;
}

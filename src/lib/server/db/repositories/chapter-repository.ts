import { getDatabase, hashText, makeId, nowIso } from "$lib/server/db/client";
import type { ChapterRecord, ChapterVersionRecord } from "$lib/types/domain";

function mapChapter(row: Record<string, unknown>): ChapterRecord {
  return {
    id: String(row.id),
    number: row.number === null ? null : Number(row.number),
    title: String(row.title),
    currentText: String(row.current_text),
    status: row.status as ChapterRecord["status"],
    latestVersionId: (row.latest_version_id as string | null) ?? null,
    lastScannedVersionId:
      (row.last_scanned_version_id as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function listChapters() {
  return getDatabase()
    .prepare(
      "SELECT * FROM chapters ORDER BY COALESCE(number, 999999), created_at",
    )
    .all()
    .map((row) => mapChapter(row as Record<string, unknown>));
}

export function getChapter(id: string) {
  const row = getDatabase()
    .prepare("SELECT * FROM chapters WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  return row ? mapChapter(row) : null;
}

export function upsertChapter(input: {
  id?: string;
  number: number | null;
  title: string;
  text: string;
}) {
  const timestamp = nowIso();
  if (input.id) {
    const existing = getChapter(input.id);
    if (!existing) {
      throw new Error("Chapter not found.");
    }
    const status = existing.lastScannedVersionId ? "stale" : "saved";
    getDatabase()
      .prepare(
        "UPDATE chapters SET number = ?, title = ?, current_text = ?, status = ?, updated_at = ? WHERE id = ?",
      )
      .run(input.number, input.title, input.text, status, timestamp, input.id);
    return getChapter(input.id)!;
  }

  const id = makeId();
  getDatabase()
    .prepare(
      `INSERT INTO chapters (id, number, title, current_text, status, latest_version_id, last_scanned_version_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'saved', NULL, NULL, ?, ?)`,
    )
    .run(id, input.number, input.title, input.text, timestamp, timestamp);
  return getChapter(id)!;
}

export function createChapterSnapshot(chapterId: string): ChapterVersionRecord {
  const chapter = getChapter(chapterId);
  if (!chapter) {
    throw new Error("Chapter not found.");
  }

  const versionNumber =
    (
      getDatabase()
        .prepare(
          "SELECT COUNT(*) AS count FROM chapter_versions WHERE chapter_id = ?",
        )
        .get(chapterId) as { count: number }
    ).count + 1;
  const versionId = makeId();
  const timestamp = nowIso();

  getDatabase()
    .prepare(
      `INSERT INTO chapter_versions (id, chapter_id, version_number, text, text_hash, scan_status, created_at)
       VALUES (?, ?, ?, ?, ?, 'queued', ?)`,
    )
    .run(
      versionId,
      chapterId,
      versionNumber,
      chapter.currentText,
      hashText(chapter.currentText),
      timestamp,
    );
  getDatabase()
    .prepare(
      "UPDATE chapters SET latest_version_id = ?, updated_at = ? WHERE id = ?",
    )
    .run(versionId, timestamp, chapterId);

  return getChapterVersion(versionId)!;
}

export function getChapterVersion(id: string): ChapterVersionRecord | null {
  const row = getDatabase()
    .prepare("SELECT * FROM chapter_versions WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  if (!row) {
    return null;
  }

  return {
    id: String(row.id),
    chapterId: String(row.chapter_id),
    versionNumber: Number(row.version_number),
    text: String(row.text),
    textHash: String(row.text_hash),
    scanStatus: row.scan_status as ChapterVersionRecord["scanStatus"],
    createdAt: String(row.created_at),
  };
}

export function markChapterScanned(chapterId: string, versionId: string) {
  getDatabase()
    .prepare(
      "UPDATE chapters SET status = ?, last_scanned_version_id = ?, updated_at = ? WHERE id = ?",
    )
    .run("scanned", versionId, nowIso(), chapterId);
  getDatabase()
    .prepare("UPDATE chapter_versions SET scan_status = ? WHERE id = ?")
    .run("success", versionId);
}

export function markChapterStale(chapterId: string) {
  getDatabase()
    .prepare("UPDATE chapters SET status = ?, updated_at = ? WHERE id = ?")
    .run("stale", nowIso(), chapterId);
}

export function updateChapterVersionScanStatus(
  versionId: string,
  scanStatus: ChapterVersionRecord["scanStatus"],
) {
  getDatabase()
    .prepare("UPDATE chapter_versions SET scan_status = ? WHERE id = ?")
    .run(scanStatus, versionId);
}

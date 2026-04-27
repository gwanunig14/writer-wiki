import { getDatabase, makeId, nowIso } from "$lib/server/db/client";
import type { ScanJobStatus } from "$lib/types/domain";

function mapScanJob(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    chapterId: String(row.chapter_id),
    chapterVersionId: String(row.chapter_version_id),
    provider: String(row.provider),
    status: row.status as ScanJobStatus,
    startedAt: (row.started_at as string | null) ?? null,
    completedAt: (row.completed_at as string | null) ?? null,
    summaryJson: (row.summary_json as string | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
    batchId: (row.batch_id as string | null) ?? null,
    batchCustomId: (row.batch_custom_id as string | null) ?? null,
    batchInputFileId: (row.batch_input_file_id as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

export function getActiveScanJob() {
  const row = getDatabase()
    .prepare(
      "SELECT * FROM scan_jobs WHERE status NOT IN ('success', 'failed') ORDER BY created_at DESC LIMIT 1",
    )
    .get() as Record<string, unknown> | undefined;
  return row ? mapScanJob(row) : null;
}

export function createScanJob(input: {
  chapterId: string;
  chapterVersionId: string;
  provider: string;
}) {
  const id = makeId();
  const timestamp = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO scan_jobs (id, chapter_id, chapter_version_id, provider, status, started_at, created_at)
       VALUES (?, ?, ?, ?, 'queued', ?, ?)`,
    )
    .run(
      id,
      input.chapterId,
      input.chapterVersionId,
      input.provider,
      timestamp,
      timestamp,
    );
  return getScanJob(id)!;
}

export function updateScanJob(
  id: string,
  status: ScanJobStatus,
  summaryJson?: string | null,
  errorMessage?: string | null,
) {
  getDatabase()
    .prepare(
      "UPDATE scan_jobs SET status = ?, summary_json = COALESCE(?, summary_json), error_message = ?, completed_at = CASE WHEN ? IN ('success', 'failed') THEN ? ELSE completed_at END WHERE id = ?",
    )
    .run(
      status,
      summaryJson ?? null,
      errorMessage ?? null,
      status,
      nowIso(),
      id,
    );
  return getScanJob(id);
}

export function getScanJob(id: string) {
  const row = getDatabase()
    .prepare("SELECT * FROM scan_jobs WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  return row ? mapScanJob(row) : null;
}

export function addScanArtifact(
  scanJobId: string,
  artifactType: string,
  payload: unknown,
) {
  getDatabase()
    .prepare(
      "INSERT INTO scan_result_artifacts (id, scan_job_id, artifact_type, payload, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(makeId(), scanJobId, artifactType, JSON.stringify(payload), nowIso());
}

export function setScanJobBatchMetadata(input: {
  scanJobId: string;
  batchId: string;
  batchCustomId: string;
  batchInputFileId: string;
}) {
  getDatabase()
    .prepare(
      "UPDATE scan_jobs SET batch_id = ?, batch_custom_id = ?, batch_input_file_id = ? WHERE id = ?",
    )
    .run(
      input.batchId,
      input.batchCustomId,
      input.batchInputFileId,
      input.scanJobId,
    );

  return getScanJob(input.scanJobId);
}

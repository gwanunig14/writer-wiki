import {
  getScanRuntimeSystemPrompt,
  buildChapterScanInput,
  buildChapterScanPayload,
} from "$lib/server/prompts/scan-prompt";
import {
  addScanArtifact,
  createScanJob,
  getActiveScanJob,
  getScanJob,
  setScanJobBatchMetadata,
  updateScanJob,
} from "$lib/server/db/repositories/scan-repository";
import {
  createChapterSnapshot,
  getChapter,
  getChapterVersion,
  listChapters,
  markChapterScanned,
  updateChapterVersionScanStatus,
} from "$lib/server/db/repositories/chapter-repository";
import { getProject } from "$lib/server/db/repositories/project-repository";
import { getProvider } from "$lib/server/providers/provider";
import { getProviderKey } from "$lib/server/settings/secrets";
import { normalizeScanResult } from "./normalize-scan-result";
import { reconcileCanon } from "./reconcile-canon";
import { markLaterAffectedChaptersStale } from "./rescan-propagation";
import { getScanContext } from "./scan-context";
import { deriveScanSummary } from "./derive-scan-summary";

function formatChapterLabel(number: number | null, title: string) {
  if (number !== null && title.trim().toLowerCase() === `chapter ${number}`) {
    return `Chapter ${number}`;
  }
  return number === null ? `Draft: ${title}` : `Chapter ${number}: ${title}`;
}
import { regenerateProjectFiles } from "$lib/server/sync/projector";

const runningJobs = new Map<string, Promise<void>>();

function logScanEvent(message: string, details: Record<string, unknown>) {
  console.info(`[scan] ${message}`, details);
}

export function startChapterScan(chapterId: string) {
  const active = getActiveScanJob();
  if (active) {
    throw new Error("Another scan is already active.");
  }

  const project = getProject();
  if (!project) {
    throw new Error("Project setup is required before scanning.");
  }

  const snapshot = createChapterSnapshot(chapterId);
  const job = createScanJob({
    chapterId,
    chapterVersionId: snapshot.id,
    provider: project.provider,
  });

  logScanEvent("queued", {
    scanJobId: job.id,
    chapterId,
    chapterVersionId: snapshot.id,
    provider: project.provider,
  });

  const runPromise = runScanJob(job.id, { userBlocking: true }).finally(() => {
    runningJobs.delete(job.id);
  });

  runningJobs.set(job.id, runPromise);
  return job;
}

export function startChapterScanWithMode(input: {
  chapterId: string;
  userBlocking: boolean;
}) {
  const active = getActiveScanJob();
  if (active) {
    throw new Error("Another scan is already active.");
  }

  const project = getProject();
  if (!project) {
    throw new Error("Project setup is required before scanning.");
  }

  const snapshot = createChapterSnapshot(input.chapterId);
  const job = createScanJob({
    chapterId: input.chapterId,
    chapterVersionId: snapshot.id,
    provider: project.provider,
  });

  logScanEvent("queued", {
    scanJobId: job.id,
    chapterId: input.chapterId,
    chapterVersionId: snapshot.id,
    provider: project.provider,
    userBlocking: input.userBlocking,
  });

  const runPromise = runScanJob(job.id, {
    userBlocking: input.userBlocking,
  }).finally(() => {
    runningJobs.delete(job.id);
  });

  runningJobs.set(job.id, runPromise);
  return job;
}

export async function waitForScanJob(scanJobId: string) {
  await runningJobs.get(scanJobId);
  return getScanJob(scanJobId);
}

async function runScanJob(
  scanJobId: string,
  options: { userBlocking: boolean },
) {
  const job = getScanJob(scanJobId);
  if (!job) {
    throw new Error("Scan job not found.");
  }

  const chapter = getChapter(job.chapterId);
  const chapterVersion = getChapterVersion(job.chapterVersionId);
  const project = getProject();

  if (!chapter || !chapterVersion || !project) {
    updateScanJob(
      scanJobId,
      "failed",
      null,
      "Missing chapter or project state.",
    );
    return;
  }

  const apiKey = getProviderKey(project.provider);
  if (!apiKey) {
    updateScanJob(
      scanJobId,
      "failed",
      null,
      "No provider API key is configured.",
    );
    return;
  }

  const provider = getProvider(project.provider);

  try {
    logScanEvent("starting", {
      scanJobId,
      chapterId: chapter.id,
      chapterVersionId: chapterVersion.id,
      provider: project.provider,
      chapterTitle: chapter.title,
    });

    updateChapterVersionScanStatus(chapterVersion.id, "in-progress");
    updateScanJob(scanJobId, "gathering-context");

    const scanContext = getScanContext(chapter);
    logScanEvent("gathered context", {
      scanJobId,
      comparisonPacketEntities: scanContext.comparisonPacket.entities.length,
      touchedEntityCount: scanContext.stats.touchedEntityCount,
      chronologyContextCount: scanContext.stats.chronologyCount,
      watchlistContextCount: scanContext.stats.watchlistCount,
      seriesBibleContextCount: scanContext.stats.seriesBibleSectionCount,
    });
    const requestPayload = buildChapterScanPayload({
      chapterNumber: chapter.number,
      chapterTitle: chapter.title,
      chapterText: chapterVersion.text,
      comparisonPacket: scanContext.comparisonPacket,
    });
    const requestInput = buildChapterScanInput(requestPayload);

    updateScanJob(scanJobId, "running");
    logScanEvent("calling provider", {
      scanJobId,
      provider: provider.name,
      comparisonEntityCount: requestPayload.comparisonPacket.entities.length,
      chapterLength: requestPayload.chapter.text.length,
    });
    // Compute priorCanonCoverage for prompt
    const priorCanonCoverage = scanContext.priorCanonCoverage || "none";
    const systemPrompt = getScanRuntimeSystemPrompt(priorCanonCoverage);
    const { parsedResult, rawApiResponse } = await provider.scanChapter({
      systemPrompt,
      requestInput,
      requestPayload,
      chapterText: chapterVersion.text,
      chapterLabel: formatChapterLabel(chapter.number ?? null, chapter.title),
      apiKey,
      userBlocking: options.userBlocking,
      onBatchLifecycleEvent: (event) => {
        if (event.phase === "submitted" && event.batchInputFileId) {
          setScanJobBatchMetadata({
            scanJobId,
            batchId: event.batchId,
            batchCustomId: event.batchCustomId,
            batchInputFileId: event.batchInputFileId,
          });
          addScanArtifact(scanJobId, "batch-submitted", event);
          return;
        }

        if (event.phase === "polling") {
          addScanArtifact(scanJobId, "batch-poll", {
            batchId: event.batchId,
            batchCustomId: event.batchCustomId,
            status: event.batchStatus,
          });
          return;
        }

        if (event.phase === "completed") {
          addScanArtifact(scanJobId, "batch-completed", event);
        }
      },
      escalationHints: scanContext.escalationHints,
    });
    if (rawApiResponse) {
      addScanArtifact(scanJobId, "raw-api-response", rawApiResponse);
      logScanEvent("raw api response", {
        scanJobId,
        preview:
          typeof rawApiResponse === "object"
            ? JSON.stringify(rawApiResponse).slice(0, 500)
            : String(rawApiResponse).slice(0, 500),
      });
    }
    addScanArtifact(scanJobId, "raw-provider-response", parsedResult);
    logScanEvent("provider returned result", {
      scanJobId,
      entityCount: parsedResult.entities.length,
      chronologyCount: parsedResult.chronology.length,
      watchlistCount: parsedResult.watchlist.length,
    });

    const normalized = normalizeScanResult(parsedResult, chapterVersion.text);
    const derivedSummary = deriveScanSummary(normalized);
    addScanArtifact(scanJobId, "normalized-scan-result", normalized);
    logScanEvent("normalized result", {
      scanJobId,
      entityCount: normalized.entities.length,
      chronologyCount: normalized.chronology.length,
      watchlistCount: normalized.watchlist.length,
    });

    updateScanJob(scanJobId, "reconciling");
    const reconciliation = reconcileCanon(chapter.id, normalized);
    const laterAffectedChapterIds = markLaterAffectedChaptersStale(chapter.id);
    const summary = {
      ...derivedSummary,
      articlesUpdated: Array.from(
        new Set([
          ...derivedSummary.articlesUpdated,
          ...laterAffectedChapterIds,
        ]),
      ),
    };
    addScanArtifact(scanJobId, "reconciliation-report", {
      ...reconciliation,
      laterAffectedChapterIds,
      summary,
    });
    logScanEvent("reconciled canon", {
      scanJobId,
      createdOrUpdatedEntities: reconciliation.entityOutcomes.length,
      laterAffectedChapterIds,
    });

    updateScanJob(scanJobId, "regenerating");
    regenerateProjectFiles();
    markChapterScanned(chapter.id, chapterVersion.id);

    updateScanJob(scanJobId, "success", JSON.stringify(summary));
    logScanEvent("completed successfully", {
      scanJobId,
      chapterId: chapter.id,
      chapterVersionId: chapterVersion.id,
    });

    // --- Write normalized scan result to JSON file ---
    try {
      const { writeFileSync, mkdirSync, existsSync } = await import("node:fs");
      const { join } = await import("node:path");
      const tmpDir = join(process.cwd(), "tmp");
      if (!existsSync(tmpDir)) mkdirSync(tmpDir);
      const chapterNum = chapter.number ?? chapter.id;
      const fileName = `chapter-${chapterNum}-scan-response.json`;
      const filePath = join(tmpDir, fileName);
      writeFileSync(filePath, JSON.stringify(normalized, null, 2), "utf-8");
      logScanEvent("wrote scan response JSON", { filePath });
    } catch (err) {
      console.error("[scan] failed to write scan response JSON", err);
    }
  } catch (error) {
    console.error("[scan] failed", {
      scanJobId,
      chapterId: chapter.id,
      chapterVersionId: chapterVersion.id,
      provider: project.provider,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    updateChapterVersionScanStatus(chapterVersion.id, "failed");
    updateScanJob(
      scanJobId,
      "failed",
      null,
      error instanceof Error ? error.message : "Unknown scan error.",
    );
  }
}

export function listChapterWorkspaceSummary() {
  return listChapters().map((chapter) => ({
    id: chapter.id,
    number: chapter.number,
    title: chapter.title,
    status: chapter.status,
    updatedAt: chapter.updatedAt,
  }));
}

import { buildScanPrompt } from "$lib/server/prompts/scan-prompt";
import {
  addScanArtifact,
  createScanJob,
  getActiveScanJob,
  getScanJob,
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
      relatedCanonEntries: scanContext.relatedCanon.length,
      touchedEntityCount: scanContext.stats.touchedEntityCount,
      chronologyContextCount: scanContext.stats.chronologyCount,
      watchlistContextCount: scanContext.stats.watchlistCount,
      seriesBibleContextCount: scanContext.stats.seriesBibleSectionCount,
    });
    const prompt = buildScanPrompt(chapter, scanContext.relatedCanon);

    updateScanJob(scanJobId, "running");
    logScanEvent("calling provider", {
      scanJobId,
      provider: provider.name,
      promptLength: prompt.length,
    });
    const rawResult = await provider.scanChapter({
      prompt,
      chapterText: chapterVersion.text,
      chapterLabel: formatChapterLabel(chapter.number ?? null, chapter.title),
      apiKey,
      userBlocking: options.userBlocking,
      escalationHints: scanContext.escalationHints,
    });
    addScanArtifact(scanJobId, "raw-provider-response", rawResult);
    logScanEvent("provider returned result", {
      scanJobId,
      entityCount: rawResult.entities.length,
      chronologyCount: rawResult.chronology.length,
      watchlistCount: rawResult.watchlist.length,
    });

    const normalized = normalizeScanResult(rawResult, chapterVersion.text);
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
    addScanArtifact(scanJobId, "reconciliation-report", {
      ...reconciliation,
      laterAffectedChapterIds,
    });
    logScanEvent("reconciled canon", {
      scanJobId,
      createdOrUpdatedEntities: reconciliation.entityOutcomes.length,
      laterAffectedChapterIds,
    });

    updateScanJob(scanJobId, "regenerating");
    regenerateProjectFiles();
    markChapterScanned(chapter.id, chapterVersion.id);

    updateScanJob(
      scanJobId,
      "success",
      JSON.stringify({
        ...normalized.summary,
        articlesUpdated: Array.from(
          new Set([
            ...normalized.summary.articlesUpdated,
            ...laterAffectedChapterIds,
          ]),
        ),
      }),
    );
    logScanEvent("completed successfully", {
      scanJobId,
      chapterId: chapter.id,
      chapterVersionId: chapterVersion.id,
    });
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

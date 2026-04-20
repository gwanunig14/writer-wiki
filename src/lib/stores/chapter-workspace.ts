import type { ChapterRecord } from "$lib/types/domain";
import { browser } from "$app/environment";
import { get, writable } from "svelte/store";

type EditableChapter = {
  id: string | null;
  number: number | null;
  title: string;
  text: string;
  status: ChapterRecord["status"] | "draft";
};

type ScanJobState = {
  id: string;
  status: string;
  stageLabel?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt?: string | null;
  summary?: Record<string, unknown> | null;
  errorMessage?: string | null;
} | null;

function createDraft(): EditableChapter {
  return {
    id: null,
    number: null,
    title: "Untitled chapter",
    text: "",
    status: "draft",
  };
}

async function refreshShellData() {
  if (!browser) {
    return;
  }

  const { invalidate } = await import("$app/navigation");
  await invalidate("app:shell");
}

function createChapterWorkspaceStore() {
  const chapters = writable<ChapterRecord[]>([]);
  const activeChapter = writable<EditableChapter>(createDraft());
  const activeScanJob = writable<ScanJobState>(null);
  const loading = writable(false);
  const errorMessage = writable<string | null>(null);

  async function loadChapters() {
    const response = await fetch("/api/chapters");
    const payload = (await response.json()) as { chapters: ChapterRecord[] };
    chapters.set(payload.chapters);
    return payload.chapters;
  }

  async function loadChapter(id: string) {
    const response = await fetch(`/api/chapters/${id}`);
    if (!response.ok) {
      throw new Error("Unable to load chapter.");
    }

    const chapter = (await response.json()) as ChapterRecord;
    activeChapter.set({
      id: chapter.id,
      number: chapter.number,
      title: chapter.title,
      text: chapter.currentText,
      status: chapter.status,
    });
    return chapter;
  }

  function resetDraft() {
    activeChapter.set(createDraft());
    activeScanJob.set(null);
  }

  function patchChapter(values: Partial<EditableChapter>) {
    activeChapter.update((chapter) => ({ ...chapter, ...values }));
  }

  async function saveActiveChapter() {
    loading.set(true);
    errorMessage.set(null);

    try {
      const chapter = get(activeChapter);
      const response = await fetch(
        chapter.id ? `/api/chapters/${chapter.id}` : "/api/chapters",
        {
          method: chapter.id ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            number: chapter.number,
            title: chapter.title,
            text: chapter.text,
          }),
        },
      );

      if (!response.ok) {
        throw new Error("Unable to save chapter.");
      }

      const saved = (await response.json()) as ChapterRecord;
      activeChapter.set({
        id: saved.id,
        number: saved.number,
        title: saved.title,
        text: saved.currentText,
        status: saved.status,
      });
      await loadChapters();
      await refreshShellData();
      return saved;
    } catch (error) {
      errorMessage.set(
        error instanceof Error ? error.message : "Unable to save chapter.",
      );
      throw error;
    } finally {
      loading.set(false);
    }
  }

  async function pollScanJob(scanJobId: string) {
    const response = await fetch(`/api/scan-jobs/${scanJobId}`);
    if (!response.ok) {
      throw new Error("Unable to load scan status.");
    }

    const job = (await response.json()) as Exclude<ScanJobState, null>;
    activeScanJob.set(job);

    if (job.status === "success" || job.status === "failed") {
      await loadChapters();
      const chapter = get(activeChapter);
      if (chapter.id) {
        await loadChapter(chapter.id);
      }
      await refreshShellData();
      return job;
    }

    return new Promise<Exclude<ScanJobState, null>>((resolve, reject) => {
      const timer = window.setTimeout(async () => {
        try {
          resolve(await pollScanJob(scanJobId));
        } catch (error) {
          reject(error);
        } finally {
          window.clearTimeout(timer);
        }
      }, 800);
    });
  }

  async function scanActiveChapter() {
    const saved = await saveActiveChapter();
    const response = await fetch(`/api/chapters/${saved.id}/scan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        number: saved.number,
        title: saved.title,
        text: saved.currentText,
        forceRescan: true,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      throw new Error(payload?.message ?? "Unable to start scan.");
    }

    const scanJob = (await response.json()) as Exclude<ScanJobState, null>;
    activeScanJob.set(scanJob);
    return pollScanJob(scanJob.id);
  }

  return {
    chapters,
    activeChapter,
    activeScanJob,
    loading,
    errorMessage,
    loadChapters,
    loadChapter,
    patchChapter,
    resetDraft,
    saveActiveChapter,
    scanActiveChapter,
  };
}

export const chapterWorkspace = createChapterWorkspaceStore();

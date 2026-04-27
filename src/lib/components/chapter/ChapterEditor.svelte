<script lang="ts">
  import { onMount } from "svelte";
  import { chapterWorkspace } from "$lib/stores/chapter-workspace";
  import ScanProgress from "$lib/components/scan/ScanProgress.svelte";

  export let initialChapterId: string | null = null;

  const workspace = chapterWorkspace;
  const { chapters, activeChapter, activeScanJob, loading, errorMessage } =
    workspace;
  let chaptersLoaded = false;
  let lastRequestedChapterId: string | null | undefined = undefined;

  onMount(async () => {
    await workspace.loadChapters();
    chaptersLoaded = true;
  });

  $: if (chaptersLoaded) {
    void syncSelectedChapter(initialChapterId);
  }

  async function syncSelectedChapter(chapterId: string | null) {
    if (chapterId === lastRequestedChapterId) {
      return;
    }

    lastRequestedChapterId = chapterId;

    if (chapterId) {
      await workspace.loadChapter(chapterId);
      return;
    }

    workspace.resetDraft();
  }

  async function handleNewChapter() {
    workspace.resetDraft();
    const { goto } = await import("$app/navigation");
    await goto("/chapters");
  }

  async function handleSave() {
    const chapter = await workspace.saveActiveChapter();
    const { goto } = await import("$app/navigation");
    await goto(`/chapters/${chapter.id}`);
  }

  async function handleScan() {
    const job = await workspace.scanActiveChapter();
    if (job.status === "success") {
      const chapter = $activeChapter;
      if (chapter.id) {
        const { goto } = await import("$app/navigation");
        await goto(`/chapters/${chapter.id}`);
      }
    }
  }
  // TODO DELETE THIS LATER
  async function handleExportRequestPackage() {
    const chapter = $activeChapter;
    if (!chapter?.id) return;
    const response = await fetch(
      `/api/chapters/${chapter.id}/request-package`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
      },
    );
    if (!response.ok) {
      alert("Failed to build request package");
      return;
    }
    const data = await response.json();
    // Download as JSON file
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chapter-${chapter.number ?? chapter.id}-scan-request-package.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  $: scanInProgress =
    $activeScanJob !== null &&
    $activeScanJob.status !== "success" &&
    $activeScanJob.status !== "failed";
</script>

<div class="workspace-layout">
  <section class="chapter-list">
    <div class="list-header">
      <h2>Chapters</h2>
      <button type="button" on:click={handleNewChapter}>New</button>
    </div>
    {#if $chapters.length === 0}
      <p class="empty">No chapters yet. Start drafting or paste Chapter 1.</p>
    {:else}
      <ul>
        {#each $chapters as chapter}
          <li>
            <a href={`/chapters/${chapter.id}`}
              >{chapter.number ?? "Draft"} · {chapter.title}</a
            >
            <small>{chapter.status}</small>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="editor-card">
    <div class="editor-header">
      <div>
        <p class="eyebrow">
          {scanInProgress ? "Scan workspace" : "Chapter workspace"}
        </p>
        <h2>{$activeChapter.title || "Untitled chapter"}</h2>
      </div>
      <span class="status-chip">{$activeChapter.status}</span>
    </div>

    {#if scanInProgress}
      <div class="scan-view">
        <p class="scan-copy">
          The saved chapter snapshot is scanning now. Editing is temporarily
          hidden until this job finishes.
        </p>
        <ScanProgress scanJob={$activeScanJob} />
      </div>
    {:else}
      <div class="fields">
        <label>
          <span>Chapter number</span>
          <input
            type="number"
            value={$activeChapter.number ?? ""}
            on:input={(event) =>
              workspace.patchChapter({
                number:
                  event.currentTarget.value === ""
                    ? null
                    : Number(event.currentTarget.value),
              })}
          />
        </label>
        <label>
          <span>Title</span>
          <input
            value={$activeChapter.title}
            on:input={(event) =>
              workspace.patchChapter({ title: event.currentTarget.value })}
          />
        </label>
      </div>

      <label class="text-field">
        <span>Chapter text</span>
        <textarea
          value={$activeChapter.text}
          on:input={(event) =>
            workspace.patchChapter({ text: event.currentTarget.value })}
        ></textarea>
      </label>

      <div class="actions">
        <button type="button" on:click={handleSave} disabled={$loading}
          >Save</button
        >
        <button
          type="button"
          class="scan"
          on:click={handleScan}
          disabled={$loading}>Scan</button
        >
        <button
          type="button"
          class="export-request-package"
          on:click={handleExportRequestPackage}
          disabled={$loading}>Export Request Package</button
        >
      </div>

      {#if $errorMessage}
        <p class="error">{$errorMessage}</p>
      {/if}

      <ScanProgress scanJob={$activeScanJob} />
    {/if}
  </section>
</div>

<style>
  .workspace-layout {
    display: grid;
    grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
    gap: 1.25rem;
  }

  .chapter-list,
  .editor-card {
    background: rgba(255, 251, 247, 0.82);
    border-radius: 1.25rem;
    padding: 1.25rem;
    box-shadow: 0 20px 50px rgba(97, 70, 40, 0.08);
  }

  .list-header,
  .editor-header,
  .actions,
  .fields {
    display: flex;
    gap: 0.8rem;
  }

  .list-header,
  .editor-header {
    justify-content: space-between;
    align-items: flex-start;
  }

  .fields {
    margin-top: 1rem;
  }

  .fields label,
  .text-field {
    display: grid;
    gap: 0.4rem;
    width: 100%;
  }

  .text-field {
    margin-top: 1rem;
  }

  textarea,
  input,
  button {
    font: inherit;
  }

  textarea,
  input {
    width: 100%;
    box-sizing: border-box;
    padding: 0.8rem 0.95rem;
    border-radius: 0.9rem;
    border: 1px solid rgba(97, 70, 40, 0.2);
    background: rgba(255, 255, 255, 0.78);
  }

  textarea {
    min-height: 24rem;
    resize: vertical;
  }

  .actions {
    margin-top: 1rem;
  }

  .scan-view {
    margin-top: 1rem;
    display: grid;
    gap: 1rem;
    align-content: start;
    min-height: 28rem;
  }

  .scan-copy {
    color: #5c4835;
    line-height: 1.55;
  }

  button {
    padding: 0.8rem 1rem;
    border: 0;
    border-radius: 999px;
    background: #7a5531;
    color: #fff8ef;
    cursor: pointer;
  }

  button.scan {
    background: #4f6b48;
  }

  .status-chip {
    padding: 0.45rem 0.7rem;
    border-radius: 999px;
    background: rgba(122, 85, 49, 0.12);
    color: #7a5531;
    text-transform: uppercase;
    font-size: 0.72rem;
    letter-spacing: 0.08em;
  }

  .eyebrow,
  .empty,
  .error {
    margin: 0;
  }

  .eyebrow {
    text-transform: uppercase;
    letter-spacing: 0.14em;
    font-size: 0.74rem;
    color: #8d6844;
  }

  ul {
    list-style: none;
    padding: 0;
    margin: 1rem 0 0;
    display: grid;
    gap: 0.6rem;
  }

  li {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  a {
    color: #3e2f22;
    text-decoration: none;
  }

  .error {
    margin: 0.8rem 0;
    color: #9e2a2b;
  }

  @media (max-width: 960px) {
    .workspace-layout {
      grid-template-columns: 1fr;
    }
  }
</style>

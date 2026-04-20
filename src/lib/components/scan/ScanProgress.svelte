<script lang="ts">
  import { onMount } from "svelte";

  const stageOrder = [
    "queued",
    "gathering-context",
    "running",
    "reconciling",
    "regenerating",
    "success",
  ] as const;

  const stageMetadata: Record<
    string,
    { title: string; detail: string; waitingDetail?: string }
  > = {
    queued: {
      title: "Queued",
      detail:
        "Your latest chapter text was saved. The scan job is preparing a snapshot.",
      waitingDetail:
        "Still working. The scan is waiting for the active job slot to clear.",
    },
    "gathering-context": {
      title: "Gathering context",
      detail:
        "Collecting related canon, chronology, and continuity context for this chapter.",
      waitingDetail:
        "Still working. The app is assembling prior canon before the provider call.",
    },
    running: {
      title: "Analyzing chapter",
      detail:
        "The provider is extracting structured canon from the saved chapter snapshot.",
      waitingDetail:
        "Still working. Large chapters or heavier canon context can keep this step busy for a while.",
    },
    reconciling: {
      title: "Reconciling canon",
      detail:
        "Validating the structured result and merging confirmed changes into local canon.",
      waitingDetail:
        "Still working. The app is checking entities, chronology, and watchlist updates before writing them.",
    },
    regenerating: {
      title: "Refreshing wiki",
      detail:
        "Rebuilding wiki pages, chronology, continuity, and other generated local files.",
      waitingDetail:
        "Still working. Regenerating local outputs can take longer after a larger scan or rescan.",
    },
    success: {
      title: "Scan complete",
      detail:
        "The chapter scan finished and local canon outputs were refreshed.",
    },
    failed: {
      title: "Scan failed",
      detail: "The scan stopped before canon changes were finalized.",
    },
  };

  export let scanJob: {
    id: string;
    status: string;
    stageLabel?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
    createdAt?: string | null;
    summary?: Record<string, unknown> | null;
    errorMessage?: string | null;
  } | null = null;

  let now = Date.now();
  let pulseFrame = 0;

  onMount(() => {
    const timer = window.setInterval(() => {
      now = Date.now();
      pulseFrame = (pulseFrame + 1) % 4;
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  });

  function getStageIndex(status: string) {
    const index = stageOrder.indexOf(status as (typeof stageOrder)[number]);
    if (index === -1) {
      return 0;
    }

    return index;
  }

  function formatElapsed(milliseconds: number) {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  }

  $: metadata = scanJob
    ? (stageMetadata[scanJob.status] ?? stageMetadata.queued)
    : null;
  $: startedAtMs = scanJob
    ? Date.parse(scanJob.startedAt ?? scanJob.createdAt ?? "") || Date.now()
    : 0;
  $: completedAtMs = scanJob?.completedAt
    ? Date.parse(scanJob.completedAt)
    : null;
  $: elapsedMs = scanJob
    ? Math.max(0, (completedAtMs ?? now) - startedAtMs)
    : 0;
  $: elapsedLabel = scanJob ? formatElapsed(elapsedMs) : "";
  $: completedStages = scanJob
    ? Math.min(
        stageOrder.length,
        getStageIndex(scanJob.status) + (scanJob.status === "failed" ? 0 : 1),
      )
    : 0;
  $: progressPercent = scanJob
    ? scanJob.status === "failed"
      ? 100
      : Math.max(12, Math.round((completedStages / stageOrder.length) * 100))
    : 0;
  $: pulseDots = ".".repeat((pulseFrame % 3) + 1);
  $: showWorkingNote =
    scanJob !== null &&
    scanJob.status !== "success" &&
    scanJob.status !== "failed" &&
    elapsedMs >= 8000;
</script>

{#if scanJob}
  <section class="scan-progress">
    <div class="status-header">
      <div>
        <p class="eyebrow">Scan status</p>
        <h3>
          {metadata?.title ?? scanJob.status}{scanJob.status === "success" ||
          scanJob.status === "failed"
            ? ""
            : pulseDots}
        </h3>
      </div>
      <p class="elapsed">Elapsed {elapsedLabel}</p>
    </div>

    <div class="progress-track" aria-hidden="true">
      <div class="progress-fill" style={`width: ${progressPercent}%`}></div>
    </div>

    <ol class="stage-list" aria-label="Scan stages">
      {#each stageOrder as stage, index}
        <li
          class:done={index < completedStages}
          class:active={scanJob.status === stage}
        >
          {stageMetadata[stage].title}
        </li>
      {/each}
    </ol>

    {#if scanJob.errorMessage}
      <p class="error">{scanJob.errorMessage}</p>
    {:else if scanJob.summary}
      <p class="detail">{metadata?.detail}</p>
      <ul>
        {#each Object.entries(scanJob.summary) as [key, value]}
          <li>
            <strong>{key}</strong>: {Array.isArray(value)
              ? value.length
              : String(value)}
          </li>
        {/each}
      </ul>
    {:else}
      <p class="detail">{metadata?.detail}</p>
      {#if showWorkingNote}
        <p class="working-note">
          {metadata?.waitingDetail ??
            "Still working. The scan is active and has not frozen."}
        </p>
      {/if}
    {/if}
  </section>
{/if}

<style>
  .scan-progress {
    border: 1px solid rgba(97, 70, 40, 0.14);
    border-radius: 1rem;
    padding: 1rem;
    background: rgba(255, 251, 247, 0.8);
    display: grid;
    gap: 0.75rem;
  }

  .status-header {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: end;
  }

  .elapsed {
    color: #6d5a48;
    font-size: 0.9rem;
  }

  .progress-track {
    height: 0.55rem;
    border-radius: 999px;
    background: rgba(97, 70, 40, 0.1);
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, #9b744b 0%, #4f6b48 100%);
    transition: width 240ms ease;
  }

  .stage-list {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 0.45rem;
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .stage-list li {
    border-radius: 999px;
    padding: 0.45rem 0.7rem;
    font-size: 0.83rem;
    background: rgba(97, 70, 40, 0.08);
    color: #6d5a48;
  }

  .stage-list li.done {
    background: rgba(79, 107, 72, 0.14);
    color: #345436;
  }

  .stage-list li.active {
    background: rgba(155, 116, 75, 0.18);
    color: #5d4227;
    font-weight: 600;
  }

  .eyebrow {
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    font-size: 0.74rem;
    color: #8d6844;
  }

  h3,
  p,
  ul {
    margin: 0;
  }

  .detail {
    line-height: 1.5;
    color: #463729;
  }

  .working-note {
    padding: 0.7rem 0.85rem;
    border-radius: 0.85rem;
    background: rgba(79, 107, 72, 0.08);
    color: #345436;
  }

  h3 {
    margin-top: 0.35rem;
  }

  .error {
    color: #9e2a2b;
  }

  ul {
    padding-left: 1rem;
    margin-top: 0.15rem;
  }

  @media (max-width: 720px) {
    .status-header {
      flex-direction: column;
      align-items: flex-start;
    }
  }
</style>

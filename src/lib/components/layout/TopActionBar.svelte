<script lang="ts">
  import type { ProjectState } from "$lib/types/domain";

  export let projectState: ProjectState;
</script>

<header class="top-bar">
  <div>
    <p class="eyebrow">Author Canon Keeper</p>
    <h1>{projectState.projectName ?? "Local-first canon workspace"}</h1>
  </div>
  <div class="meta">
    <span>Sync {projectState.syncStatus}</span>
    <a href="/chapters">Chapters</a>
    <a href="/chronology">Chronology</a>
    <a href="/continuity">Continuity</a>
    <a href="/settings">Settings</a>
  </div>
</header>

<style>
  .top-bar {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
    padding: 1.25rem 1.75rem 0;
  }

  .eyebrow {
    margin: 0;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: #7f6243;
  }

  h1 {
    margin: 0.15rem 0 0;
    font-size: clamp(1.6rem, 2vw, 2.2rem);
  }

  .meta {
    display: flex;
    gap: 1rem;
    align-items: center;
    font-size: 0.95rem;
  }

  a {
    color: #593f2a;
  }
</style>

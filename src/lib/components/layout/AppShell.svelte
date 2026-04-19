<script lang="ts">
  import TopActionBar from "$lib/components/layout/TopActionBar.svelte";
  import ChatDrawer from "$lib/components/chat/ChatDrawer.svelte";
  import WikiSidebar from "$lib/components/wiki/WikiSidebar.svelte";
  import type { ProjectState, WikiNode } from "$lib/types/domain";

  export let projectState: ProjectState;
  export let navigation: WikiNode[] = [];
</script>

<div class="app-shell">
  <aside class="sidebar">
    <WikiSidebar {navigation} ready={projectState.ready} />
  </aside>
  <div class="main-column">
    <TopActionBar {projectState} />
    <main class="content">
      <slot />
    </main>
  </div>
  <ChatDrawer disabled={!projectState.ready} />
</div>

<style>
  :global(html) {
    height: 100%;
    overflow: hidden;
  }

  :global(body) {
    height: 100%;
    margin: 0;
    overflow: hidden;
    font-family: "Iowan Old Style", "Palatino Linotype", serif;
    background: radial-gradient(
        circle at top left,
        rgba(197, 155, 104, 0.24),
        transparent 28%
      ),
      linear-gradient(180deg, #f4efe7 0%, #efe4d4 100%);
    color: #2d251c;
  }

  .app-shell {
    display: grid;
    grid-template-columns: 300px minmax(0, 1fr);
    height: 100vh;
    position: relative;
    overflow: hidden;
  }

  .sidebar {
    border-right: 1px solid rgba(77, 60, 42, 0.14);
    background: rgba(255, 251, 246, 0.88);
    backdrop-filter: blur(18px);
    min-height: 0;
    overflow-y: auto;
  }

  .main-column {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  .content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 1.5rem 1.75rem 3rem;
  }

  @media (max-width: 960px) {
    .app-shell {
      grid-template-columns: 1fr;
      grid-template-rows: auto minmax(0, 1fr);
    }

    .sidebar {
      border-right: none;
      border-bottom: 1px solid rgba(77, 60, 42, 0.14);
      max-height: 16rem;
    }
  }
</style>

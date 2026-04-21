<script lang="ts">
  import type { WikiNode } from "$lib/types/domain";
  import WikiSidebarNode from "$lib/components/wiki/WikiSidebarNode.svelte";

  export let navigation: WikiNode[] = [];
  export let ready = false;
</script>

<section class="sidebar-panel">
  <h2>Canon</h2>
  {#if !ready}
    <p class="empty">Complete setup to seed the chapter workspace and wiki.</p>
  {:else if navigation.length === 0}
    <p class="empty">
      No canon entries exist yet. Save and scan a chapter to begin.
    </p>
  {:else}
    <ul>
      {#each navigation as item}
        <WikiSidebarNode node={item} />
      {/each}
    </ul>
  {/if}
</section>

<style>
  .sidebar-panel {
    padding: 1.5rem;
    box-sizing: border-box;
    min-height: 100%;
  }

  h2 {
    margin-top: 0;
  }

  ul {
    padding-left: 0;
    margin: 0;
  }

  .empty {
    color: #6d5a48;
    line-height: 1.5;
  }
</style>

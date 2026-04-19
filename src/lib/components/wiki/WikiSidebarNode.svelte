<script lang="ts">
  import type { WikiNode } from "$lib/types/domain";

  export let node: WikiNode;
</script>

<li>
  {#if node.href}
    <a href={node.href}>{node.label}{node.isStub ? " (stub)" : ""}</a>
  {:else}
    <span class="folder-label">{node.label}</span>
  {/if}

  {#if node.children?.length}
    <ul class="nested">
      {#each node.children as child}
        <svelte:self node={child} />
      {/each}
    </ul>
  {/if}
</li>

<style>
  .nested {
    margin-top: 0.45rem;
    padding-left: 1rem;
  }

  a {
    color: #3e2f22;
    text-decoration: none;
  }

  .folder-label {
    color: #5b4633;
    font-weight: 600;
  }
</style>

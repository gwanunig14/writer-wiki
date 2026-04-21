<script lang="ts">
  import type { WikiNode } from "$lib/types/domain";

  export let node: WikiNode;

  $: hasChildren = Boolean(node.children?.length);
  let expanded = true;
</script>

<li class:has-children={hasChildren}>
  <div class="node-row">
    {#if hasChildren}
      <button
        type="button"
        class="toggle"
        aria-expanded={expanded}
        aria-label={`Toggle ${node.label}`}
        on:click={() => (expanded = !expanded)}
      >
        {expanded ? "▾" : "▸"}
      </button>
    {:else}
      <span class="toggle-spacer"></span>
    {/if}

    {#if node.href}
      <a class="node-link" href={node.href}
        >{node.label}{node.isStub ? " (stub)" : ""}</a
      >
    {:else}
      <span class="folder-label">{node.label}</span>
    {/if}
  </div>

  {#if hasChildren && expanded}
    <ul class="nested">
      {#each node.children as child}
        <svelte:self node={child} />
      {/each}
    </ul>
  {/if}
</li>

<style>
  li {
    list-style: none;
  }

  .node-row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    min-height: 1.8rem;
  }

  .toggle,
  .toggle-spacer {
    width: 1.15rem;
    flex: 0 0 1.15rem;
  }

  .toggle {
    border: 0;
    background: transparent;
    color: #7a5531;
    padding: 0;
    cursor: pointer;
    font: inherit;
    line-height: 1;
  }

  .toggle-spacer {
    display: inline-block;
  }

  .nested {
    margin-top: 0.2rem;
    padding-left: 0.85rem;
  }

  a,
  .node-link {
    color: #3e2f22;
    text-decoration: none;
  }

  .node-link:hover {
    text-decoration: underline;
  }

  .folder-label {
    color: #5b4633;
    font-weight: 600;
  }
</style>

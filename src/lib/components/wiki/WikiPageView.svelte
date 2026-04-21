<script lang="ts">
  import { goto, invalidateAll } from "$app/navigation";
  import MarkdownIt from "markdown-it";
  import type { WikiPage } from "$lib/types/domain";

  export let page: WikiPage;

  const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });

  let editing = false;
  let saving = false;
  let saveError: string | null = null;
  let draftName = "";
  let draftCategory: "character" | "location" | "item" | "organization" =
    "character";
  let draftBody = "";
  let draftFolderPath = "";
  let draftParentLocationName = "";
  let suppress = false;
  let mergeIntoName = "";
  let dismissingWatchlistId: string | null = null;
  let continuityError: string | null = null;

  const characterFolderOptions = ["Main", "Major", "Minor"];

  $: renderedBody = markdown.render(page.body || "_No canon content yet._");
  $: if (page.editableEntity) {
    draftName = page.editableEntity.name;
    draftCategory = page.editableEntity.category;
    draftBody = page.editableEntity.articleBody;
    draftFolderPath = page.editableEntity.folderPath;
    draftParentLocationName = page.editableEntity.parentLocationName ?? "";
    suppress = false;
    mergeIntoName = "";
    saveError = null;
    editing = false;
  }

  $: if (
    draftCategory === "character" &&
    !characterFolderOptions.includes(draftFolderPath)
  ) {
    draftFolderPath = "Minor";
  }

  async function saveDossier() {
    if (!page.editableEntity || saving) {
      return;
    }

    saving = true;
    saveError = null;

    try {
      const response = await fetch(
        `/api/wiki/${page.editableEntity.category}/${page.editableEntity.slug}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: draftName,
            category: draftCategory,
            articleBody: draftBody,
            folderPath: draftFolderPath,
            parentLocationName: draftParentLocationName,
            suppress,
            mergeIntoName,
          }),
        },
      );

      if (!response.ok) {
        throw new Error("Unable to save dossier changes.");
      }

      const payload = (await response.json()) as { redirectHref: string };
      await goto(payload.redirectHref);
      await invalidateAll();
    } catch (error) {
      saveError =
        error instanceof Error
          ? error.message
          : "Unable to save dossier changes.";
    } finally {
      saving = false;
    }
  }

  async function dismissContinuityItem(watchlistItemId: string) {
    if (dismissingWatchlistId) {
      return;
    }

    dismissingWatchlistId = watchlistItemId;
    continuityError = null;

    try {
      const response = await fetch(
        `/api/continuity/watchlist/${watchlistItemId}/dismiss`,
        {
          method: "POST",
        },
      );

      if (!response.ok) {
        throw new Error("Unable to dismiss continuity item.");
      }

      await invalidateAll();
    } catch (error) {
      continuityError =
        error instanceof Error
          ? error.message
          : "Unable to dismiss continuity item.";
    } finally {
      dismissingWatchlistId = null;
    }
  }
</script>

<article class="wiki-page">
  <header>
    <p class="eyebrow">{page.kind}</p>
    <div class="title-row">
      <h2>{page.title}</h2>
      {#if page.isStub}
        <span class="stub-badge">Stub</span>
      {/if}
      {#if page.editableEntity}
        <button
          type="button"
          class="edit-button"
          on:click={() => (editing = !editing)}
        >
          {editing ? "Close editor" : "Edit dossier"}
        </button>
      {/if}
    </div>
  </header>

  {#if page.aliases && page.aliases.length > 0}
    <section class="aliases">
      <div class="section-heading">
        <h3>Aliases</h3>
        {#if page.aliases.some((alias) => alias.sourceType === "user-managed")}
          <span class="alias-note">Includes manual merge or edit aliases</span>
        {/if}
      </div>
      <ul>
        {#each page.aliases as alias}
          <li>
            <span class="alias-name">{alias.name}</span>
            <span class={`alias-badge ${alias.sourceType}`}
              >{alias.sourceType === "user-managed" ? "Manual" : "Scan"}</span
            >
            {#if alias.sourceLabel}
              <span class="alias-source">{alias.sourceLabel}</span>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if editing && page.editableEntity}
    <form class="editor" on:submit|preventDefault={saveDossier}>
      <label>
        <span>Name</span>
        <input bind:value={draftName} disabled={saving} />
      </label>
      <label>
        <span>Category</span>
        <select bind:value={draftCategory} disabled={saving || suppress}>
          <option value="character">Character</option>
          <option value="location">Location</option>
          <option value="item">Item</option>
          <option value="organization">Organization</option>
        </select>
      </label>
      <label class="checkbox">
        <input type="checkbox" bind:checked={suppress} disabled={saving} />
        <span>This entry does not need a dossier</span>
      </label>
      <label>
        <span>Folder Path Override</span>
        {#if draftCategory === "character"}
          <select bind:value={draftFolderPath} disabled={saving || suppress}>
            {#each characterFolderOptions as option}
              <option value={option}>{option}</option>
            {/each}
          </select>
          <small class="field-hint">
            Main is reserved for POV and lead characters. Major requires
            appearances in two or more chapters. Minor is everyone else unless
            you override it.
          </small>
        {:else}
          <input
            bind:value={draftFolderPath}
            disabled={saving || suppress}
            placeholder="Main / Major / Vistana / Artifacts"
          />
        {/if}
      </label>
      {#if draftCategory === "location"}
        <label>
          <span>Parent Location</span>
          <input
            bind:value={draftParentLocationName}
            disabled={saving || suppress}
            list="location-parent-options"
            placeholder="Optional parent dossier"
          />
          <datalist id="location-parent-options">
            {#each page.editableEntity.availableLocationNames as locationName}
              <option value={locationName}></option>
            {/each}
          </datalist>
        </label>
      {/if}
      <label>
        <span>Merge Into Existing Dossier</span>
        <input
          bind:value={mergeIntoName}
          disabled={saving || suppress}
          placeholder="Exact dossier name"
        />
      </label>
      <label>
        <span>Article Body</span>
        <textarea
          bind:value={draftBody}
          rows="12"
          disabled={saving || suppress || Boolean(mergeIntoName.trim())}
        ></textarea>
      </label>
      {#if saveError}
        <p class="error">{saveError}</p>
      {/if}
      <div class="editor-actions">
        <button type="submit" class="save-button" disabled={saving}>
          {saving
            ? "Saving..."
            : suppress
              ? "Suppress dossier"
              : mergeIntoName.trim()
                ? "Merge dossier"
                : "Save changes"}
        </button>
      </div>
    </form>
  {/if}

  {#if page.kind === "continuity" && page.continuityItems}
    <section class="continuity-items">
      <div class="section-heading">
        <h3>Active Watchlist Items</h3>
        <span class="alias-note">Dismiss items once you have handled them</span>
      </div>
      {#if page.continuityItems.length === 0}
        <p class="continuity-empty">No active watchlist items.</p>
      {:else}
        <ul>
          {#each page.continuityItems as item}
            <li>
              <div class="continuity-item-header">
                <div>
                  <p class="continuity-type">{item.type}</p>
                  <h4>{item.subject}</h4>
                </div>
                <button
                  type="button"
                  class="dismiss-button"
                  disabled={dismissingWatchlistId !== null}
                  on:click={() => dismissContinuityItem(item.id)}
                >
                  {dismissingWatchlistId === item.id
                    ? "Dismissing..."
                    : "Dismiss"}
                </button>
              </div>
              <div class="continuity-body">
                {@html markdown.render(item.body)}
              </div>
              {#if item.sourceLabels.length > 0}
                <p class="continuity-sources">
                  Sources: {item.sourceLabels.join("; ")}
                </p>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
      {#if continuityError}
        <p class="error">{continuityError}</p>
      {/if}
    </section>
  {/if}

  {#if page.kind === "continuity" && page.resolvedContinuityItems}
    <section class="continuity-items resolved-items">
      <div class="section-heading">
        <h3>Resolved Items</h3>
        <span class="alias-note">Previously dismissed continuity notes</span>
      </div>
      {#if page.resolvedContinuityItems.length === 0}
        <p class="continuity-empty">No resolved continuity items yet.</p>
      {:else}
        <ul>
          {#each page.resolvedContinuityItems as item}
            <li>
              <div class="continuity-item-header">
                <div>
                  <p class="continuity-type">{item.type}</p>
                  <h4>{item.subject}</h4>
                </div>
                <span class="resolved-badge">Resolved</span>
              </div>
              <div class="continuity-body">
                {@html markdown.render(item.body)}
              </div>
              {#if item.sourceLabels.length > 0}
                <p class="continuity-sources">
                  Sources: {item.sourceLabels.join("; ")}
                </p>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}

  <div class="body">{@html renderedBody}</div>

  {#if page.backlinks && page.backlinks.length > 0}
    <section class="backlinks">
      <h3>Backlinks</h3>
      <ul>
        {#each page.backlinks as backlink}
          <li>{backlink}</li>
        {/each}
      </ul>
    </section>
  {/if}
</article>

<style>
  .wiki-page {
    max-width: 54rem;
    background: rgba(255, 251, 247, 0.82);
    border-radius: 1.25rem;
    padding: 1.5rem;
    box-shadow: 0 20px 50px rgba(97, 70, 40, 0.08);
  }

  .eyebrow {
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    font-size: 0.74rem;
    color: #8d6844;
  }

  .title-row {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    flex-wrap: wrap;
  }

  h2,
  h3 {
    margin: 0.4rem 0 0;
  }

  .stub-badge {
    padding: 0.35rem 0.65rem;
    border-radius: 999px;
    background: rgba(122, 85, 49, 0.12);
    color: #7a5531;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .edit-button,
  .save-button {
    border: 0;
    border-radius: 999px;
    background: #6f4d2d;
    color: #fff8f1;
    padding: 0.55rem 0.9rem;
    cursor: pointer;
    font: inherit;
  }

  .editor {
    margin: 1rem 0 1.25rem;
    padding: 1rem;
    border-radius: 1rem;
    background: rgba(122, 85, 49, 0.08);
    display: grid;
    gap: 0.85rem;
  }

  .editor label {
    display: grid;
    gap: 0.35rem;
    font-size: 0.95rem;
  }

  .editor input,
  .editor select,
  .editor textarea {
    font: inherit;
    border: 1px solid rgba(97, 70, 40, 0.18);
    border-radius: 0.75rem;
    padding: 0.75rem 0.85rem;
    background: rgba(255, 255, 255, 0.76);
  }

  .checkbox {
    grid-auto-flow: column;
    justify-content: start;
    align-items: center;
    gap: 0.65rem;
  }

  .editor-actions {
    display: flex;
    justify-content: flex-start;
  }

  .error {
    margin: 0;
    color: #a13d2d;
  }

  .field-hint {
    display: block;
    margin-top: 0.2rem;
    color: #6b614f;
    font-size: 0.85rem;
    line-height: 1.35;
  }

  .aliases {
    margin: 1rem 0 1.25rem;
    padding: 1rem;
    border-radius: 1rem;
    background: rgba(111, 77, 45, 0.06);
  }

  .section-heading {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    flex-wrap: wrap;
    margin-bottom: 0.75rem;
  }

  .alias-note {
    font-size: 0.8rem;
    color: #8d6844;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .aliases ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 0.65rem;
  }

  .aliases li {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    flex-wrap: wrap;
    line-height: 1.4;
  }

  .alias-name {
    font-weight: 600;
    color: #4f3923;
  }

  .alias-badge {
    border-radius: 999px;
    padding: 0.2rem 0.5rem;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .alias-badge.user-managed {
    background: rgba(111, 77, 45, 0.14);
    color: #6f4d2d;
  }

  .alias-badge.chapter-scan {
    background: rgba(141, 104, 68, 0.14);
    color: #8d6844;
  }

  .alias-source {
    color: rgba(79, 57, 35, 0.74);
    font-size: 0.9rem;
  }

  .continuity-items {
    background: rgba(111, 77, 45, 0.06);
  }

  .resolved-items {
    background: rgba(97, 70, 40, 0.04);
  }

  .continuity-items ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 0.85rem;
  }

  .continuity-items li {
    padding: 0.9rem;
    border-radius: 0.9rem;
    background: rgba(255, 255, 255, 0.68);
    border: 1px solid rgba(97, 70, 40, 0.12);
  }

  .continuity-item-header {
    display: flex;
    justify-content: space-between;
    gap: 0.8rem;
    align-items: start;
    flex-wrap: wrap;
  }

  .continuity-item-header h4,
  .continuity-type,
  .continuity-sources,
  .continuity-empty {
    margin: 0;
  }

  .continuity-type {
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.72rem;
    color: #8d6844;
    margin-bottom: 0.25rem;
  }

  .dismiss-button {
    border: 0;
    border-radius: 999px;
    background: rgba(111, 77, 45, 0.14);
    color: #6f4d2d;
    padding: 0.45rem 0.8rem;
    cursor: pointer;
    font: inherit;
  }

  .resolved-badge {
    border-radius: 999px;
    padding: 0.25rem 0.55rem;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    background: rgba(79, 107, 72, 0.14);
    color: #345436;
  }

  .continuity-body {
    margin-top: 0.75rem;
  }

  .continuity-body :global(p),
  .continuity-body :global(li) {
    line-height: 1.55;
  }

  .continuity-sources {
    margin-top: 0.75rem;
    color: rgba(79, 57, 35, 0.74);
    font-size: 0.9rem;
  }

  .body :global(a) {
    color: #6f4d2d;
  }

  .body :global(p),
  .body :global(li) {
    line-height: 1.65;
  }

  .backlinks {
    margin-top: 1.5rem;
    padding-top: 1rem;
    border-top: 1px solid rgba(97, 70, 40, 0.14);
  }

  .backlinks ul {
    padding-left: 1rem;
  }
</style>

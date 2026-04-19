<script lang="ts">
  import type { PageData } from "./$types";

  export let data: PageData;

  let statusMessage = "";
  let errorMessage = "";
  let busy = false;

  async function exportZip(includeSecrets = false) {
    busy = true;
    statusMessage = "";
    errorMessage = "";

    try {
      const response = await fetch("/api/export/zip", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ includeSecrets }),
      });
      const payload = (await response.json()) as {
        fileName: string;
        downloadPath: string;
      };
      if (!response.ok) {
        throw new Error("Unable to export the project.");
      }

      statusMessage = `Export created: ${payload.fileName} at ${payload.downloadPath}`;
    } catch (error) {
      errorMessage =
        error instanceof Error
          ? error.message
          : "Unable to export the project.";
    } finally {
      busy = false;
    }
  }

  async function repairSync() {
    busy = true;
    statusMessage = "";
    errorMessage = "";

    try {
      const response = await fetch("/api/settings/repair", { method: "POST" });
      const payload = (await response.json()) as {
        ok: boolean;
        syncStatus: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error("Unable to repair the project sync state.");
      }

      statusMessage = `Sync repair completed. Current status: ${payload.syncStatus}.`;
    } catch (error) {
      errorMessage =
        error instanceof Error
          ? error.message
          : "Unable to repair the project sync state.";
    } finally {
      busy = false;
    }
  }
</script>

<section class="settings-card">
  <p class="eyebrow">Settings</p>
  <h2>{data.projectState.projectName ?? "Author Canon Keeper"}</h2>
  <p>Current sync state: <strong>{data.projectState.syncStatus}</strong></p>

  <div class="actions">
    <button type="button" on:click={() => exportZip(false)} disabled={busy}
      >Export zip</button
    >
    <button type="button" on:click={() => exportZip(true)} disabled={busy}
      >Export with secrets</button
    >
    <button type="button" on:click={repairSync} disabled={busy}
      >Repair sync</button
    >
  </div>

  {#if statusMessage}
    <p class="status">{statusMessage}</p>
  {/if}

  {#if errorMessage}
    <p class="error">{errorMessage}</p>
  {/if}
</section>

<style>
  .settings-card {
    max-width: 48rem;
    display: grid;
    gap: 1rem;
    padding: 1.75rem;
    border-radius: 1.25rem;
    background: rgba(255, 251, 247, 0.82);
    box-shadow: 0 20px 50px rgba(97, 70, 40, 0.08);
  }

  .eyebrow {
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    font-size: 0.74rem;
    color: #8d6844;
  }

  h2,
  p {
    margin: 0;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  button {
    font: inherit;
    padding: 0.8rem 1rem;
    border: 0;
    border-radius: 999px;
    background: #7a5531;
    color: #fff8ef;
    cursor: pointer;
  }

  .status {
    color: #2d6a4f;
  }

  .error {
    color: #9e2a2b;
  }
</style>

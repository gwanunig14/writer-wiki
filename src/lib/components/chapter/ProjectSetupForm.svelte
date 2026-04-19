<script lang="ts">
  import { goto } from "$app/navigation";

  let projectName = "My Book Project";
  let provider: "openai" | "anthropic" = "openai";
  let apiKey = "ack-demo-local";
  let model = "";
  let statusMessage = "";
  let errorMessage = "";
  let busy = false;

  async function testConnection() {
    busy = true;
    errorMessage = "";
    statusMessage = "";

    try {
      const response = await fetch("/api/setup/provider/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, apiKey }),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        message: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(
          payload.message || "Unable to test provider connection.",
        );
      }
      statusMessage = payload.message;
    } catch (error) {
      errorMessage =
        error instanceof Error
          ? error.message
          : "Unable to test provider connection.";
    } finally {
      busy = false;
    }
  }

  async function createProject() {
    busy = true;
    errorMessage = "";
    statusMessage = "";

    try {
      const response = await fetch("/api/setup/project", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: projectName,
          provider,
          apiKey,
          model: model || null,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(payload?.message ?? "Unable to create the project.");
      }

      await goto("/chapters");
    } catch (error) {
      errorMessage =
        error instanceof Error
          ? error.message
          : "Unable to create the project.";
    } finally {
      busy = false;
    }
  }
</script>

<section class="setup-card">
  <p class="eyebrow">First-run setup</p>
  <h2>Create the local canon workspace</h2>
  <label>
    <span>Project name</span>
    <input bind:value={projectName} />
  </label>
  <label>
    <span>Provider</span>
    <select bind:value={provider}>
      <option value="openai">OpenAI</option>
      <option value="anthropic">Anthropic</option>
    </select>
  </label>
  <label>
    <span>API key</span>
    <input bind:value={apiKey} type="password" />
  </label>
  <label>
    <span>Model override</span>
    <input bind:value={model} placeholder="Optional" />
  </label>
  <div class="actions">
    <button type="button" on:click={testConnection} disabled={busy}
      >Test connection</button
    >
    <button type="button" on:click={createProject} disabled={busy}
      >Create project</button
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
  .setup-card {
    max-width: 42rem;
    display: grid;
    gap: 1rem;
    padding: 2rem;
    border-radius: 1.5rem;
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

  label {
    display: grid;
    gap: 0.4rem;
  }

  input,
  select,
  button {
    font: inherit;
  }

  input,
  select {
    padding: 0.8rem 0.95rem;
    border-radius: 0.9rem;
    border: 1px solid rgba(97, 70, 40, 0.2);
    background: rgba(255, 255, 255, 0.78);
  }

  .actions {
    display: flex;
    gap: 0.75rem;
  }

  button {
    padding: 0.8rem 1rem;
    border: 0;
    border-radius: 999px;
    background: #7a5531;
    color: #fff8ef;
    cursor: pointer;
  }

  button:last-child {
    background: #4f6b48;
  }

  .status {
    color: #2d6a4f;
  }

  .error {
    color: #9e2a2b;
  }
</style>

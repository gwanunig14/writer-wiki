<script lang="ts">
  import { chatStore } from "$lib/stores/chat";

  export let disabled = false;

  let question = "";

  const { open, loading, errorMessage, messages } = chatStore;

  async function submitQuestion() {
    const trimmed = question.trim();
    if (!trimmed) {
      return;
    }

    question = "";
    await chatStore.askQuestion(trimmed);
  }
</script>

<aside class:disabled class:open={$open}>
  <button type="button" class="toggle" on:click={() => chatStore.toggle()}>
    {$open ? "Close canon chat" : "Open canon chat"}
  </button>

  {#if $open}
    <header>
      <h2>Canon Chat</h2>
      <p>Answers from your saved chapters and generated canon only.</p>
    </header>
    <div class="messages">
      {#if $messages.length === 0}
        <p>
          {disabled
            ? "Finish setup to enable canon questions."
            : "Ask factual continuity questions once chapters are scanned."}
        </p>
      {:else}
        {#each $messages as item}
          <article class={`message ${item.role}`}>
            <strong>{item.role === "user" ? "You" : "Canon"}</strong>
            <p>{item.message}</p>
            {#if item.evidence && item.evidence.length > 0}
              <ul>
                {#each item.evidence as evidence}
                  <li>{evidence.label}</li>
                {/each}
              </ul>
            {/if}
          </article>
        {/each}
      {/if}
    </div>

    {#if $errorMessage}
      <p class="error">{$errorMessage}</p>
    {/if}

    <form class="composer" on:submit|preventDefault={submitQuestion}>
      <textarea
        bind:value={question}
        rows="3"
        disabled={disabled || $loading}
        placeholder="Ask a canon question, or request a dossier change..."
      ></textarea>
      <button type="submit" disabled={disabled || $loading}
        >{$loading ? "Answering…" : "Ask"}</button
      >
    </form>
  {/if}
</aside>

<style>
  aside {
    position: fixed;
    right: 1rem;
    bottom: 1rem;
    width: min(360px, calc(100vw - 2rem));
    border-radius: 1.25rem;
    background: rgba(56, 39, 26, 0.94);
    color: #f9f2e8;
    box-shadow: 0 24px 60px rgba(26, 17, 10, 0.2);
    padding: 1rem;
  }

  aside:not(.open) {
    width: auto;
  }

  aside.disabled {
    opacity: 0.72;
  }

  .toggle,
  textarea,
  button {
    font: inherit;
  }

  .toggle,
  .composer button {
    border: 0;
    border-radius: 999px;
    background: #d7b48e;
    color: #2a1b10;
    padding: 0.7rem 0.95rem;
    cursor: pointer;
  }

  h2,
  p {
    margin: 0;
  }

  header p,
  .messages p {
    margin-top: 0.35rem;
    color: rgba(249, 242, 232, 0.76);
    line-height: 1.45;
  }

  .messages {
    margin-top: 1rem;
    display: grid;
    gap: 0.7rem;
    max-height: 22rem;
    overflow: auto;
  }

  .message {
    padding: 0.8rem;
    border-radius: 0.9rem;
    background: rgba(255, 255, 255, 0.08);
  }

  .message.user {
    background: rgba(215, 180, 142, 0.18);
  }

  .message ul {
    margin: 0.45rem 0 0;
    padding-left: 1rem;
    color: rgba(249, 242, 232, 0.76);
  }

  .composer {
    margin-top: 1rem;
    display: grid;
    gap: 0.65rem;
  }

  textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 0.8rem 0.9rem;
    border-radius: 0.9rem;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(255, 255, 255, 0.08);
    color: inherit;
    resize: vertical;
  }

  .error {
    margin-top: 0.75rem;
    color: #ffb3a7;
  }
</style>

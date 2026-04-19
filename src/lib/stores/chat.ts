import { writable } from "svelte/store";

interface ChatUiMessage {
  role: "user" | "assistant" | "system";
  message: string;
  evidence?: Array<{ label: string; snippet: string }>;
}

function createChatStore() {
  const open = writable(false);
  const loading = writable(false);
  const errorMessage = writable<string | null>(null);
  const conversationId = writable<string | null>(null);
  const messages = writable<ChatUiMessage[]>([]);

  async function askQuestion(question: string) {
    loading.set(true);
    errorMessage.set(null);

    messages.update((items) => [...items, { role: "user", message: question }]);

    try {
      const response = await fetch("/api/chat/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId: getCurrentConversationId(),
          question,
        }),
      });

      if (!response.ok) {
        throw new Error("Unable to answer the canon question.");
      }

      const payload = (await response.json()) as {
        conversationId: string;
        answer: { direct: string };
        evidence: Array<{ label: string; snippet: string }>;
        messages?: ChatUiMessage[];
      };

      conversationId.set(payload.conversationId);
      messages.set(
        payload.messages?.filter((item) => item.role !== "system") ?? [
          { role: "user", message: question },
          {
            role: "assistant",
            message: payload.answer.direct,
            evidence: payload.evidence,
          },
        ],
      );
    } catch (error) {
      errorMessage.set(
        error instanceof Error
          ? error.message
          : "Unable to answer the canon question.",
      );
    } finally {
      loading.set(false);
    }
  }

  let currentConversationId: string | null = null;
  conversationId.subscribe((value) => {
    currentConversationId = value;
  });

  function getCurrentConversationId() {
    return currentConversationId;
  }

  return {
    open,
    loading,
    errorMessage,
    messages,
    askQuestion,
    toggle() {
      open.update((value) => !value);
    },
  };
}

export const chatStore = createChatStore();

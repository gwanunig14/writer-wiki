import { applyChatCanonAction } from "$lib/server/canon/dossier-manager";
import { getProject } from "$lib/server/db/repositories/project-repository";
import {
  ensureConversation,
  appendChatMessage,
  getPendingCanonAction,
  listConversationMessages,
  setPendingCanonAction,
} from "$lib/server/db/repositories/chat-repository";
import { getProvider } from "$lib/server/providers/provider";
import { getProviderKey } from "$lib/server/settings/secrets";
import { retrieveCanonContext } from "$lib/server/retrieval/retrieve-canon-context";
import type { EntityCategory } from "$lib/types/domain";

const refusalPattern =
  /brainstorm|invent|plot|idea|scene|outline|write for me|creative/i;
const confirmationPattern = /^(confirm|yes|apply|do it|proceed)$/i;
const cancelPattern = /^(cancel|no|stop|never mind)$/i;

export interface PendingCanonAction {
  type: "suppress-dossier" | "reclassify-dossier" | "merge-dossier";
  name: string;
  category?: EntityCategory;
  targetName?: string;
  notes?: string;
}

function parseCanonAction(question: string): PendingCanonAction | null {
  const mergeMatch = question.match(/^merge\s+(.+?)\s+(?:into|with)\s+(.+)$/i);
  if (mergeMatch) {
    return {
      type: "merge-dossier",
      name: mergeMatch[1].trim(),
      targetName: mergeMatch[2].trim(),
      notes: question.trim(),
    };
  }

  const mergeAltMatch = question.match(
    /^(.+?)\s+(?:should be\s+)?merged\s+(?:into|with)\s+(.+)$/i,
  );
  if (mergeAltMatch) {
    return {
      type: "merge-dossier",
      name: mergeAltMatch[1].trim(),
      targetName: mergeAltMatch[2].trim(),
      notes: question.trim(),
    };
  }

  const exclamationMatch = question.match(/^(.+?)\s+is\s+an?\s+exclamation\b/i);
  if (exclamationMatch) {
    return {
      type: "suppress-dossier",
      name: exclamationMatch[1].trim(),
      notes: question.trim(),
    };
  }

  const noDossierMatch = question.match(
    /^(.+?)\s+(?:doesn't|does not)\s+need\s+a\s+dossier$/i,
  );
  if (noDossierMatch) {
    return {
      type: "suppress-dossier",
      name: noDossierMatch[1].trim(),
      notes: question.trim(),
    };
  }

  const suppressMatch = question.match(
    /^(?:mark|set|suppress)\s+(.+?)\s+(?:as\s+)?(?:no\s+dossier|without\s+a\s+dossier)$/i,
  );
  if (suppressMatch) {
    return {
      type: "suppress-dossier",
      name: suppressMatch[1].trim(),
      notes: question.trim(),
    };
  }

  const reclassifyMatch = question.match(
    /^(?:reclassify|classify|mark|set)\s+(.+?)\s+as\s+(character|location|item|organization)$/i,
  );
  if (reclassifyMatch) {
    return {
      type: "reclassify-dossier",
      name: reclassifyMatch[1].trim(),
      category: reclassifyMatch[2].toLowerCase() as EntityCategory,
      notes: question.trim(),
    };
  }

  return null;
}

function describeCanonAction(action: PendingCanonAction) {
  return action.type === "suppress-dossier"
    ? `suppress the dossier for ${action.name}`
    : action.type === "merge-dossier"
      ? `merge ${action.name} into ${action.targetName}`
      : `reclassify ${action.name} as ${action.category}`;
}

export async function answerCanonQuestion(input: {
  question: string;
  conversationId?: string | null;
}) {
  const conversationId = ensureConversation(input.conversationId);
  const trimmedQuestion = input.question.trim();

  appendChatMessage({
    conversationId,
    role: "user",
    message: trimmedQuestion,
  });

  const pendingAction = getPendingCanonAction(
    conversationId,
  ) as PendingCanonAction | null;

  if (pendingAction && confirmationPattern.test(trimmedQuestion)) {
    const direct = applyChatCanonAction(pendingAction);
    setPendingCanonAction(conversationId, null);
    appendChatMessage({
      conversationId,
      role: "assistant",
      message: direct,
      evidenceJson: JSON.stringify([]),
    });
    return {
      conversationId,
      answer: {
        direct,
        confirmedEvidence: [],
        inferred: [],
        unresolved: [],
      },
      evidence: [],
      messages: listConversationMessages(conversationId),
    };
  }

  if (pendingAction && cancelPattern.test(trimmedQuestion)) {
    const direct = `Canceled the pending request to ${describeCanonAction(pendingAction)}.`;
    setPendingCanonAction(conversationId, null);
    appendChatMessage({
      conversationId,
      role: "assistant",
      message: direct,
      evidenceJson: JSON.stringify([]),
    });
    return {
      conversationId,
      answer: {
        direct,
        confirmedEvidence: [],
        inferred: [],
        unresolved: [],
      },
      evidence: [],
      messages: listConversationMessages(conversationId),
    };
  }

  const requestedAction = parseCanonAction(trimmedQuestion);
  if (requestedAction) {
    setPendingCanonAction(conversationId, requestedAction);
    const direct = `I can ${describeCanonAction(requestedAction)}. Reply with confirm to apply it locally, or cancel to leave canon unchanged.`;
    appendChatMessage({
      conversationId,
      role: "assistant",
      message: direct,
      evidenceJson: JSON.stringify([]),
    });
    return {
      conversationId,
      answer: {
        direct,
        confirmedEvidence: [],
        inferred: [],
        unresolved: [],
      },
      evidence: [],
      messages: listConversationMessages(conversationId),
    };
  }

  if (refusalPattern.test(trimmedQuestion)) {
    const refusal = {
      direct:
        "I can only answer canon-grounded questions from your saved chapters and generated canon. I cannot help with brainstorming or creative writing.",
      confirmedEvidence: [],
      inferred: [],
      unresolved: [
        "This request asks for invention rather than canon retrieval.",
      ],
    };

    appendChatMessage({
      conversationId,
      role: "assistant",
      message: refusal.direct,
      evidenceJson: JSON.stringify([]),
    });
    setPendingCanonAction(conversationId, null);

    return {
      conversationId,
      answer: refusal,
      evidence: [],
      messages: listConversationMessages(conversationId),
    };
  }

  const project = getProject();
  if (!project) {
    throw new Error(
      "Project setup is required before canon chat can answer questions.",
    );
  }

  const apiKey = getProviderKey(project.provider);
  if (!apiKey) {
    throw new Error(
      "A provider API key is required before canon chat can answer questions.",
    );
  }

  const context = retrieveCanonContext(trimmedQuestion);
  if (context.evidence.length === 0) {
    const insufficient = {
      direct:
        "There is not enough saved canon evidence yet to answer that question.",
      confirmedEvidence: [],
      inferred: [],
      unresolved: [
        "Save and scan relevant chapters first so I have source material to cite.",
      ],
    };

    appendChatMessage({
      conversationId,
      role: "assistant",
      message: insufficient.direct,
      evidenceJson: JSON.stringify([]),
    });
    setPendingCanonAction(conversationId, null);

    return {
      conversationId,
      answer: insufficient,
      evidence: [],
      messages: listConversationMessages(conversationId),
    };
  }

  const provider = getProvider(project.provider);

  const evidenceStrings = context.evidence.map((item) => {
    const label = item.label.trim();
    const snippet = item.snippet.trim();
    return `${label}: ${snippet}`;
  });

  const answer = await provider.answerCanonQuestion({
    question: trimmedQuestion,
    evidence: evidenceStrings,
    apiKey,
  });

  appendChatMessage({
    conversationId,
    role: "assistant",
    message: answer.direct,
    evidenceJson: JSON.stringify(context.evidence),
  });
  setPendingCanonAction(conversationId, null);

  return {
    conversationId,
    answer,
    evidence: context.evidence,
    messages: listConversationMessages(conversationId),
  };
}

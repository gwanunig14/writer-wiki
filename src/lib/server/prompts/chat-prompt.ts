export function buildChatPrompt(question: string, evidence: string[]) {
  return [
    "Answer the question using only the provided canon evidence.",
    "If evidence is missing or the question asks for brainstorming, refuse.",
    `Question: ${question}`,
    `Evidence:\n${evidence.join("\n")}`,
  ].join("\n\n");
}

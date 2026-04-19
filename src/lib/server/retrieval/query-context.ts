export interface RetrievalEvidence {
  type: "chapter" | "article" | "chronology" | "watchlist";
  refId: string;
  label: string;
  snippet: string;
}

export interface RetrievedCanonContext {
  evidence: RetrievalEvidence[];
}

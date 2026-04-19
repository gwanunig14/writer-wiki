export type ProviderName = "openai" | "anthropic";
export type SyncStatus = "healthy" | "degraded" | "repairing";
export type ChapterStatus = "draft" | "saved" | "scanned" | "stale";
export type EvidenceStatus = "mentioned-only" | "partial" | "established";
export type EntityCategory = "character" | "location" | "item" | "organization";
export type ScanJobStatus =
  | "queued"
  | "gathering-context"
  | "running"
  | "reconciling"
  | "regenerating"
  | "success"
  | "failed";

export interface ProjectState {
  ready: boolean;
  projectId: string | null;
  projectName: string | null;
  syncStatus: SyncStatus;
  provider: ProviderName | null;
}

export interface ProjectRecord {
  id: string;
  name: string;
  rootPath: string;
  provider: ProviderName;
  defaultModel: string | null;
  defaultFontSize: number;
  syncStatus: SyncStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ChapterRecord {
  id: string;
  number: number | null;
  title: string;
  currentText: string;
  status: ChapterStatus;
  latestVersionId: string | null;
  lastScannedVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChapterVersionRecord {
  id: string;
  chapterId: string;
  versionNumber: number;
  text: string;
  textHash: string;
  scanStatus: "never-scanned" | "queued" | "in-progress" | "success" | "failed";
  createdAt: string;
}

export interface WikiNode {
  id: string;
  label: string;
  kind: "chapter" | "category" | "article" | "generated-page" | "folder";
  href?: string;
  isStub?: boolean;
  children?: WikiNode[];
}

export interface WikiPage {
  title: string;
  kind:
    | "article"
    | "category-all"
    | "chronology"
    | "continuity"
    | "contradiction-audit";
  category?: string;
  isStub?: boolean;
  body: string;
  updatedAt?: string;
  backlinks?: string[];
  aliases?: Array<{
    name: string;
    sourceType: "chapter-scan" | "user-managed";
    sourceLabel?: string;
    createdAt?: string;
  }>;
  continuityItems?: Array<{
    id: string;
    type: string;
    subject: string;
    body: string;
    status: "active" | "resolved";
    sourceLabels: string[];
    updatedAt: string;
  }>;
  resolvedContinuityItems?: Array<{
    id: string;
    type: string;
    subject: string;
    body: string;
    status: "active" | "resolved";
    sourceLabels: string[];
    updatedAt: string;
  }>;
  editableEntity?: {
    id: string;
    name: string;
    slug: string;
    category: EntityCategory;
    articleBody: string;
    folderPath: string;
    parentLocationName?: string;
    availableLocationNames: string[];
  };
}

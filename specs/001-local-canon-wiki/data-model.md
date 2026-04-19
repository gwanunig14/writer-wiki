# Data Model: Author Canon Keeper

## Overview

The operational model is SQLite-first. Readable markdown and text files are deterministic projections generated from SQLite state. Chapter text remains the primary evidence layer; entity articles, chronology, continuity, and Q&A history are derived layers.

## Core Entities

### Project

- Purpose: Represents the single active book project.
- Fields:
  - `id` UUID
  - `name` string
  - `rootPath` string
  - `provider` enum: `openai | anthropic`
  - `defaultModel` string nullable
  - `defaultFontSize` integer
  - `syncStatus` enum: `healthy | degraded | repairing`
  - `createdAt` timestamp
  - `updatedAt` timestamp
- Rules:
  - Exactly one active row in v1.
  - `rootPath` points to the generated local project-data folder.

### ProviderCredentialMetadata

- Purpose: Tracks provider configuration without embedding secrets into exported artifacts.
- Fields:
  - `provider` enum: `openai | anthropic`
  - `keyAlias` string
  - `lastTestedAt` timestamp nullable
  - `lastTestStatus` enum: `unknown | success | failed`
  - `lastError` string nullable
- Rules:
  - Secret value is stored separately in a local secrets store.
  - Export excludes secret material by default.

### Chapter

- Purpose: Represents the editable chapter workspace record.
- Fields:
  - `id` UUID
  - `number` integer nullable
  - `title` string
  - `currentText` text
  - `status` enum: `draft | saved | scanned | stale`
  - `latestVersionId` UUID nullable
  - `lastScannedVersionId` UUID nullable
  - `createdAt` timestamp
  - `updatedAt` timestamp
- Rules:
  - `status=stale` means text changed after the last successful scan or a dependency invalidation occurred.
  - Chapter ordering is derived from `number` with fallback to creation order.

### ChapterVersion

- Purpose: Immutable snapshot of a chapter state used for scans and audit history.
- Fields:
  - `id` UUID
  - `chapterId` UUID
  - `versionNumber` integer
  - `text` text
  - `textHash` string
  - `createdAt` timestamp
  - `scanStatus` enum: `never-scanned | queued | in-progress | success | failed`
- Rules:
  - Every scan uses a persisted `ChapterVersion`, never editor memory state.
  - Version numbers increase monotonically within a chapter.

### ScanJob

- Purpose: Tracks each provider-backed scan request and its lifecycle.
- Fields:
  - `id` UUID
  - `chapterId` UUID
  - `chapterVersionId` UUID
  - `provider` enum: `openai | anthropic`
  - `status` enum: `queued | gathering-context | running | reconciling | regenerating | success | failed`
  - `startedAt` timestamp nullable
  - `completedAt` timestamp nullable
  - `summaryJson` text nullable
  - `errorMessage` text nullable
  - `createdAt` timestamp
- Rules:
  - Only one active scan job is allowed at a time in v1.
  - Failed jobs do not mutate the prior successful canon state.

### ScanResultArtifact

- Purpose: Stores normalized structured extraction and derived deltas from a scan.
- Fields:
  - `id` UUID
  - `scanJobId` UUID
  - `artifactType` enum: `raw-provider-response | normalized-scan-result | reconciliation-report | change-log`
  - `payload` text
  - `createdAt` timestamp
- Rules:
  - `normalized-scan-result` must conform to the canonical internal schema.

### Entity

- Purpose: Canonical article-bearing record for characters, locations, items, and organizations.
- Fields:
  - `id` UUID
  - `name` string
  - `slug` string
  - `category` enum: `character | location | item | organization`
  - `subtype` string nullable
  - `isStub` boolean
  - `descriptor` string nullable
  - `articleBody` text
  - `evidenceStatus` enum: `mentioned-only | partial | established`
  - `createdFromChapterId` UUID nullable
  - `lastUpdatedFromChapterId` UUID nullable
  - `createdAt` timestamp
  - `updatedAt` timestamp
- Rules:
  - `slug` remains stable after creation.
  - Stub promotion updates `isStub`, `articleBody`, and `evidenceStatus` in place.

### EntityAlias

- Purpose: Preserves alternate names and prior labels for matching and search.
- Fields:
  - `id` UUID
  - `entityId` UUID
  - `alias` string
  - `sourceChapterId` UUID nullable
  - `createdAt` timestamp
- Rules:
  - Used during reconciliation and search, not as primary routing keys.

### EntityLink

- Purpose: Represents article-to-article references and backlinks.
- Fields:
  - `id` UUID
  - `fromEntityId` UUID
  - `toEntityId` UUID
  - `relationType` enum: `mentioned-in | located-at | member-of | owns | related-to`
  - `sourceChapterId` UUID nullable
  - `createdAt` timestamp
- Rules:
  - Links are regenerated deterministically from normalized scan outputs.

### ChronologyEntry

- Purpose: Stores generated timeline facts.
- Fields:
  - `id` UUID
  - `label` string
  - `body` text
  - `relativeOrder` integer
  - `confidence` enum: `confirmed | probable | possible`
  - `sourceChapterIds` JSON array
  - `createdAt` timestamp
  - `updatedAt` timestamp
- Rules:
  - Exact dates are optional; relative ordering is mandatory when chronology exists.

### WatchlistEntry

- Purpose: Tracks contradictions, missing facts, ambiguities, and continuity risks.
- Fields:
  - `id` UUID
  - `type` enum: `contradiction | missing-description | name-collision | timeline-risk | relationship-ambiguity | item-clarification | location-risk`
  - `subject` string
  - `body` text
  - `sourceChapterIds` JSON array
  - `status` enum: `active | resolved`
  - `createdAt` timestamp
  - `updatedAt` timestamp
- Rules:
  - Later scans append evidence or mark entries resolved; they do not silently delete active issues.

### GeneratedPage

- Purpose: Tracks non-entity readable outputs such as All pages, chronology, continuity, contradiction audit, and question logs.
- Fields:
  - `id` UUID
  - `pageType` enum: `category-all | chronology | continuity-watchlist | contradiction-audit | question-log`
  - `category` string nullable
  - `slug` string
  - `body` text
  - `updatedAt` timestamp
- Rules:
  - Regenerated deterministically from underlying records.

### DerivedDependency

- Purpose: Supports later-affected regeneration after rescans.
- Fields:
  - `id` UUID
  - `sourceChapterId` UUID
  - `targetType` enum: `entity | chronology | watchlist | generated-page | link`
  - `targetId` UUID
  - `reason` string
  - `createdAt` timestamp
- Rules:
  - Rebuilt after successful scans for affected chapters.
  - Used to mark downstream outputs stale.

### FileProjection

- Purpose: Tracks the synchronization state of mirrored markdown and text outputs.
- Fields:
  - `id` UUID
  - `targetType` enum: `chapter | entity | generated-page | system-asset`
  - `targetId` UUID
  - `relativePath` string
  - `contentHash` string
  - `syncStatus` enum: `pending | written | failed`
  - `retryCount` integer
  - `lastError` text nullable
  - `updatedAt` timestamp
- Rules:
  - File projection entries are updated only after DB state is committed.

### ChatConversation

- Purpose: Stores local canon-only chat history.
- Fields:
  - `id` UUID
  - `title` string
  - `createdAt` timestamp
  - `updatedAt` timestamp

### ChatMessage

- Purpose: Stores user questions, retrieved evidence, and assistant responses.
- Fields:
  - `id` UUID
  - `conversationId` UUID
  - `role` enum: `user | assistant | system`
  - `message` text
  - `evidenceJson` text nullable
  - `createdAt` timestamp
- Rules:
  - Assistant responses should record retrieval evidence references for auditability.

## Relationships

- `Project` has many `Chapter` records.
- `Chapter` has many `ChapterVersion` snapshots.
- `ChapterVersion` has many `ScanJob` records but usually one latest relevant job.
- `ScanJob` has many `ScanResultArtifact` records.
- `Entity` has many `EntityAlias` records and participates in many `EntityLink` records.
- `Chapter` contributes to many `Entity`, `ChronologyEntry`, `WatchlistEntry`, `GeneratedPage`, and `EntityLink` rows through `DerivedDependency`.
- `GeneratedPage` and `Entity` each map to one or more `FileProjection` rows.
- `ChatConversation` has many `ChatMessage` rows.

## State Transitions

### Chapter Status

```text
draft -> saved -> scanned
saved -> stale
scanned -> stale
stale -> saved
saved -> scanned
```

Rules:

- Any content edit after a successful scan moves the chapter to `stale`.
- Successful rescan returns the chapter to `scanned`.

### ChapterVersion Scan Status

```text
never-scanned -> queued -> in-progress -> success
never-scanned -> queued -> in-progress -> failed
```

### ScanJob Status

```text
queued -> gathering-context -> running -> reconciling -> regenerating -> success
queued -> gathering-context -> running -> failed
queued -> gathering-context -> failed
reconciling -> failed
regenerating -> failed
```

### Entity Evidence State

```text
mentioned-only -> partial -> established
partial -> established
established -> established
```

Rules:

- Promotion from stub occurs when cumulative evidence crosses configured thresholds.
- Entity identity does not change during promotion.

### FileProjection Sync State

```text
pending -> written
pending -> failed
failed -> pending
```

Rules:

- Any `failed` projection sets project `syncStatus=degraded` until repaired.

## Validation Rules

- Chapter scans must reference an existing `ChapterVersion` created before the provider call.
- Entity slugs must be unique and immutable.
- Watchlist entries must keep at least one supporting source chapter while active.
- Generated pages must be reproducible from DB state; no page is edited manually in place.
- Chat answers must store enough evidence metadata to identify which chapters or canon outputs supported the reply.

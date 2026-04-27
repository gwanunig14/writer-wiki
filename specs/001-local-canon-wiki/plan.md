# Implementation Plan: Author Canon Keeper

**Branch**: `[001-build-canon-organizer]` | **Date**: 2026-04-19 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-local-canon-wiki/spec.md`

## Summary

Build a single-project, local-first SvelteKit + TypeScript application that runs on a local Node server started with `npm run start`, stores operational canon state in SQLite, mirrors readable chapter and wiki outputs to a local project-data folder, and uses a provider abstraction for explicit OpenAI or Anthropic API calls for scans and canon-only Q&A. The implementation centers on a save-then-scan snapshot workflow, deterministic article regeneration, dependency-aware downstream invalidation for rescans, and a desktop-oriented UI with chapter editing, wiki browsing, scan results, continuity and chronology views, and a collapsible chatbot drawer.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 20 LTS  
**Primary Dependencies**: SvelteKit 2.x, `@sveltejs/adapter-node`, Svelte 5, `better-sqlite3`, Drizzle ORM + Drizzle Kit, Zod, OpenAI SDK, Anthropic SDK, `markdown-it`, `archiver`, Vitest, Playwright  
**Storage**: SQLite as operational source of truth plus synchronized local text and markdown outputs under a project-data folder; provider secrets stored locally outside exported artifacts  
**Testing**: Vitest for unit and integration coverage, Playwright for end-to-end flows, schema validation tests for structured scan payloads  
**Target Platform**: Local desktop use on macOS, Windows, and Linux through a localhost Node server in a desktop browser  
**Project Type**: Local-first web application with integrated server endpoints  
**Performance Goals**: Local save completes in under 200 ms for typical chapter edits, scan progress feedback appears within 500 ms of scan start, wiki navigation remains responsive with 100 chapters and 2,000 articles, export completes in under 30 seconds for a 100-chapter project  
**Constraints**: Single project only, offline-capable except explicit provider calls, no telemetry by default, no cloud sync, scan must always operate on a saved versioned snapshot, database and file mirror must never silently drift, accuracy prioritized over token efficiency  
**Scale/Scope**: Single writer, one active book project, 100 chapters, 10 chapter versions per chapter retained by default, 2,000 canon entities, 10,000 article links, one active scan job at a time

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

Constitution reference: `.specify/memory/constitution.md` version `1.0.0`.

Pre-design gate review:

- Pass: Principle I `Local-First And Private By Default` is satisfied by local SQLite storage, local project-data outputs, explicit provider-triggered network boundaries, and default secret exclusion from export.
- Pass: Principle II `Chapter Text Is The Primary Authority` is satisfied by chapter-first retrieval, chapter snapshot scanning, and the requirement that derived canon defer to source text.
- Pass: Principle III `Explicit AI Boundaries And Non-Creative Behavior` is satisfied by the provider abstraction, API-key-based setup, structured scan outputs, and canon-only refusal behavior.
- Pass: Principle IV `Deterministic Derived State And Auditability` is satisfied by DB-first persistence, deterministic file regeneration, stable entity identities, and explicit sync-degraded handling.
- Pass: Principle V `Workflow Integrity Through Verifiable Quality Gates` is satisfied by the planned test stack and dedicated coverage for onboarding, save, scan, rescan, wiki navigation, and chat behavior.

Post-design re-check:

- Pass: The data model includes immutable chapter versions, scan job artifacts, file projection tracking, derived dependencies, and local chat evidence references needed by Principles II and IV.
- Pass: The quickstart and API contract preserve save-before-scan behavior, export-without-secrets default behavior, and canon-only chat constraints required by Principles I, III, and V.
- Pass: No constitutional violations or exceptions require complexity tracking.

## Project Structure

### Documentation (this feature)

```text
specs/001-local-canon-wiki/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── app-api.openapi.yaml
└── tasks.md
```

### Source Code (repository root)

```text
src/
├── app.html
├── hooks.server.ts
├── lib/
│   ├── components/
│   │   ├── layout/
│   │   ├── chapter/
│   │   ├── wiki/
│   │   ├── scan/
│   │   └── chat/
│   ├── stores/
│   ├── types/
│   ├── utils/
│   └── server/
│       ├── db/
│       │   ├── schema/
│       │   ├── migrations/
│       │   └── repositories/
│       ├── filesystem/
│       ├── prompts/
│       ├── providers/
│       ├── scan/
│       ├── sync/
│       ├── retrieval/
│       ├── export/
│       └── settings/
└── routes/
    ├── +layout.svelte
    ├── +page.svelte
    ├── setup/
    ├── chapters/
    │   ├── +page.svelte
    │   └── [id]/
    ├── wiki/
    │   └── [category]/
    │       └── [slug]/
    ├── chronology/
    ├── continuity/
    ├── settings/
    └── api/
        ├── setup/
        ├── chapters/
        ├── scan-jobs/
        ├── wiki/
        ├── chat/
        └── export/

static/
project-data/
├── chapters/
├── wiki/
└── system/

tests/
├── unit/
├── integration/
└── e2e/
```

**Structure Decision**: Use a single SvelteKit application at the repository root with server-side modules under `src/lib/server` and route-driven UI surfaces under `src/routes`. This keeps the local app shell, API endpoints, filesystem integration, and provider orchestration in one deployable Node target while still separating DB, sync, scan, retrieval, and UI concerns.

## Phase 0 Research Summary

Research findings are captured in [research.md](./research.md). The main implementation decisions are:

- Use `@sveltejs/adapter-node` so `npm run start` launches a local Node server with first-class filesystem access.
- Keep SQLite as operational truth and drive markdown regeneration through a DB-first sync queue with explicit degraded-sync state and repairability.
- Implement staged scan orchestration with structured JSON validation and normalization before any write is applied.
- Use stable entity IDs with stable slugs and a dependency map to support rescans that invalidate later derived outputs.
- Keep canon-only Q&A retrieval grounded in chapters first, then canon articles, chronology, and continuity records.

## Phase 1 Design Outputs

- Data model: [data-model.md](./data-model.md)
- Quickstart: [quickstart.md](./quickstart.md)
- App contract: [contracts/app-api.openapi.yaml](./contracts/app-api.openapi.yaml)

## Implementation Strategy

### App Shell And Local Runtime

- Initialize a SvelteKit project configured with `@sveltejs/adapter-node` and `npm run start` wired to the built Node server.
- Build a desktop-oriented shell with four permanent regions: left wiki sidebar, top action bar, main content pane, and collapsible bottom-right chat drawer.
- Route first launch to `/setup` and all subsequent launches to the last-opened chapter or wiki view.

### Persistence And Sync

- Model all operational entities in SQLite using Drizzle-managed schema and migrations.
- Create a `project-data/` workspace with deterministic markdown and text outputs mirroring chapters, wiki categories, chronology, continuity, questions, and system assets.
- Apply changes in DB first, enqueue file regeneration work second, and mark the project sync state degraded if file generation fails after DB success.
- Add a repair path that retries failed file writes and can fully regenerate mirrored outputs from the database.

### Save And Scan Workflow

- Chapter editor writes drafts locally without provider calls.
- Scan action performs `save -> snapshot version -> create scan job -> gather context -> provider call -> validate -> reconcile -> persist -> regenerate outputs`.
- Scan cannot proceed if save or version snapshot creation fails.
- Editing a scanned chapter marks it stale immediately and records downstream derived outputs for invalidation.

### Provider Abstraction And AI Workflows

- Expose a common `AIProvider` interface with operations for `testConnection`, `scanChapter`, and `answerCanonQuestion`.
- Support OpenAI and Anthropic implementations behind the same normalized result schema.
- Keep prompt assets in the local project system folder and assemble prompts on the server from constitution, templates, current chapter snapshot, related canon, watchlist, chronology, and dependency context. Context assembly must enforce a token budget per tier: chapter snapshot delta first, then a ranked cap of related canon articles, then chronology and watchlist entries only if directly relevant.
- Treat malformed or partially valid structured output as recoverable through normalization and explicit scan failure states rather than partial silent writes.

### Canon Generation And Rescan Propagation

- Reconcile extracted entities against existing canonical entities using deterministic matching rules with watchlist escalation for uncertain merges.
- Create or update stubs for mentioned-only entities, then promote stubs in place when later evidence crosses promotion thresholds.
- Regenerate touched article pages, affected category All pages, chronology, continuity watchlist, contradiction audit, and backlinks after each successful scan.
- Track derived dependencies from chapters to entities, chronology entries, watchlist entries, and links to support later-affected regeneration after rescans.

### Canon-Only Chat

- Retrieve relevant chapter excerpts first, then derived canon articles, chronology entries, continuity watchlist items, and contradiction records.
- Render answers in a structured pattern: direct answer, confirmed evidence, inferred or probable, unresolved or conflicting.
- Refuse brainstorming, scene writing, lore invention, or unsupported claims.

## Risks And Mitigations

- Risk: Prompt payloads grow unbounded as project scales. Mitigation: Context assembly must select only the current chapter snapshot delta, directly referenced canon entities (not all entities), and a capped excerpt budget per retrieval tier. Full-corpus stuffing is explicitly disallowed.
- Risk: File mirror drift after partial failures. Mitigation: Persist sync state, log file-write jobs, and provide deterministic regeneration.
- Risk: Entity over-merging or incorrect stub promotion. Mitigation: Use conservative matching thresholds and watchlist escalation for ambiguous identity merges.
- Risk: Local secrets leakage in export bundles. Mitigation: Exclude provider credentials from export by default and keep secret storage separate from exported project data.

## Complexity Tracking

No constitution violations or extra complexity exemptions are required for this plan.

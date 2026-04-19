# Tasks: Author Canon Keeper

**Input**: Design documents from `/specs/001-local-canon-wiki/`
**Prerequisites**: `plan.md` (required), `spec.md` (required), `research.md`, `data-model.md`, `contracts/app-api.openapi.yaml`, `quickstart.md`

**Tests**: Automated tests are included because the specification, constitution, and quickstart require verifiable coverage for save/scan, wiki browsing, canon-only chat, export, and sync integrity.

**Organization**: Tasks are grouped by user story so each story can be implemented, tested, and validated independently.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Initialize the SvelteKit application, runtime configuration, and test harness.

- [x] T001 Initialize the project manifest, scripts, and dependencies in `package.json`
- [x] T002 Configure the SvelteKit Node adapter and TypeScript build in `svelte.config.js`, `vite.config.ts`, and `tsconfig.json`
- [x] T003 [P] Configure Vitest and Playwright test runners in `vitest.config.ts`, `playwright.config.ts`, and `tests/setup.ts`
- [x] T004 [P] Scaffold the base app shell and root routes in `src/app.html`, `src/routes/+layout.svelte`, `src/routes/+page.svelte`, and `src/lib/components/layout/AppShell.svelte`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build the shared persistence, provider, sync, and startup infrastructure required by every story.

**⚠️ CRITICAL**: No user story work should begin until this phase is complete.

- [x] T005 Create the core Drizzle schema modules in `src/lib/server/db/schema/project.ts`, `src/lib/server/db/schema/chapter.ts`, `src/lib/server/db/schema/scan.ts`, `src/lib/server/db/schema/canon.ts`, and `src/lib/server/db/schema/chat.ts`
- [x] T006 Create the database client and migration entrypoints in `drizzle.config.ts`, `src/lib/server/db/client.ts`, and `src/lib/server/db/migrate.ts`
- [x] T007 [P] Implement environment configuration and local secret storage in `src/lib/server/settings/config.ts` and `src/lib/server/settings/secrets.ts`
- [x] T008 [P] Implement project-data workspace seeding and projection queue primitives in `src/lib/server/filesystem/workspace.ts` and `src/lib/server/sync/projection-queue.ts`
- [x] T009 [P] Create the provider abstraction and concrete adapters in `src/lib/server/providers/provider.ts`, `src/lib/server/providers/openai.ts`, and `src/lib/server/providers/anthropic.ts`
- [x] T010 [P] Add prompt builders and structured scan types in `src/lib/server/prompts/scan-prompt.ts`, `src/lib/server/prompts/chat-prompt.ts`, and `src/lib/types/scan-result.ts`
- [x] T011 Implement shared repositories and transaction helpers in `src/lib/server/db/repositories/project-repository.ts`, `src/lib/server/db/repositories/chapter-repository.ts`, and `src/lib/server/db/repositories/scan-repository.ts`
- [x] T012 Implement application bootstrap and setup gating in `src/hooks.server.ts` and `src/routes/+layout.server.ts`
- [x] T013 [P] Add foundational unit coverage for schema validation and provider contract behavior in `tests/unit/server/foundation.test.ts`

**Checkpoint**: Foundation ready. Chapter flows, wiki browsing, and chat can now be built against stable persistence and provider interfaces.

---

## Phase 3: User Story 1 - Maintain Chapter Canon (Priority: P1) 🎯 MVP

**Goal**: Let the user create a local project, edit chapters, save locally, scan from a saved snapshot, and propagate canon changes through rescans.

**Independent Test**: Complete onboarding, save a chapter locally, scan it, then edit an earlier chapter and rescan to verify downstream canon outputs refresh correctly without sending data except during the explicit provider call.

### Tests for User Story 1

- [x] T014 [P] [US1] Add integration coverage for setup, chapter, and scan APIs in `tests/integration/setup-and-chapter-api.test.ts`
- [x] T015 [P] [US1] Add end-to-end coverage for onboarding, save, scan, and rescan behavior in `tests/e2e/chapter-canon.spec.ts`
- [x] T016 [P] [US1] Add unit coverage for scan normalization and dependency invalidation in `tests/unit/server/scan-pipeline.test.ts`

### Implementation for User Story 1

- [x] T017 [P] [US1] Implement provider test and project creation endpoints in `src/routes/api/setup/provider/test/+server.ts` and `src/routes/api/setup/project/+server.ts`
- [x] T018 [P] [US1] Implement chapter list, create, and save endpoints in `src/routes/api/chapters/+server.ts` and `src/routes/api/chapters/[id]/+server.ts`
- [x] T019 [US1] Implement the setup page and onboarding form in `src/routes/setup/+page.svelte` and `src/lib/components/chapter/ProjectSetupForm.svelte`
- [x] T020 [US1] Implement chapter workspace state and editing persistence in `src/lib/stores/chapter-workspace.ts` and `src/lib/components/chapter/ChapterEditor.svelte`
- [x] T021 [US1] Implement save-to-snapshot scan orchestration in `src/lib/server/scan/scan-orchestrator.ts` and `src/lib/server/scan/scan-context.ts`
- [x] T022 [US1] Implement scan result normalization and canon reconciliation in `src/lib/server/scan/normalize-scan-result.ts` and `src/lib/server/scan/reconcile-canon.ts`
- [x] T023 [US1] Implement rescan dependency invalidation and stale tracking in `src/lib/server/scan/dependency-graph.ts` and `src/lib/server/scan/rescan-propagation.ts`
- [x] T024 [US1] Implement scan start, scan status polling, and progress feedback in `src/routes/api/chapters/[id]/scan/+server.ts`, `src/routes/api/scan-jobs/[scanJobId]/+server.ts`, and `src/lib/components/scan/ScanProgress.svelte`
- [x] T025 [US1] Implement deterministic chapter and scan artifact projection writes in `src/lib/server/sync/projector.ts` and `src/lib/server/filesystem/seed-project-data.ts`
- [x] T026 [US1] Complete the chapter workspace routes and stale-status presentation in `src/routes/chapters/+page.svelte` and `src/routes/chapters/[id]/+page.svelte`

**Checkpoint**: User Story 1 should now support private local editing, save-before-scan enforcement, scan progress, and later-affected rescan propagation.

---

## Phase 4: User Story 2 - Browse A Private Book Wiki (Priority: P2)

**Goal**: Let the user navigate canon articles, All pages, chronology, continuity outputs, stubs, and hyperlinks through the left sidebar and main reading pane.

**Independent Test**: After scanning chapters that introduce multiple entities, verify the sidebar tree loads, article links open correctly, category All pages list the expected records, and stub entries remain navigable.

### Tests for User Story 2

- [x] T027 [P] [US2] Add integration coverage for wiki tree and wiki page APIs in `tests/integration/wiki-api.test.ts`
- [x] T028 [P] [US2] Add end-to-end coverage for sidebar navigation, All pages, and stub promotion links in `tests/e2e/wiki-browsing.spec.ts`

### Implementation for User Story 2

- [x] T029 [P] [US2] Implement entity and wiki repositories in `src/lib/server/db/repositories/entity-repository.ts` and `src/lib/server/db/repositories/wiki-repository.ts`
- [x] T030 [US2] Implement wiki generation services for articles, backlinks, All pages, chronology, and continuity outputs in `src/lib/server/sync/wiki-generator.ts` and `src/lib/server/sync/backlink-index.ts`
- [x] T031 [US2] Implement wiki tree and wiki page endpoints in `src/routes/api/wiki/tree/+server.ts` and `src/routes/api/wiki/[category]/[slug]/+server.ts`
- [x] T032 [US2] Implement the wiki sidebar and reader components in `src/lib/components/wiki/WikiSidebar.svelte` and `src/lib/components/wiki/WikiPageView.svelte`
- [x] T033 [US2] Implement article page routing in `src/routes/wiki/[category]/[slug]/+page.svelte`
- [x] T034 [US2] Implement chronology and continuity views with empty states in `src/routes/chronology/+page.svelte` and `src/routes/continuity/+page.svelte`

**Checkpoint**: User Story 2 should now provide a navigable private wiki with consistent category pages, stub handling, backlinks, and main-pane reading views.

---

## Phase 5: User Story 3 - Ask Canon-Only Questions (Priority: P3)

**Goal**: Let the user ask canon-grounded questions through a bottom-right chat drawer while refusing brainstorming and invention requests.

**Independent Test**: With saved chapters and generated canon present, ask factual questions and unsupported creative prompts to confirm answers cite project evidence and refusals stay within canon-only boundaries.

### Tests for User Story 3

- [x] T035 [P] [US3] Add integration coverage for canon chat answers and refusal behavior in `tests/integration/chat-api.test.ts`
- [x] T036 [P] [US3] Add end-to-end coverage for supported canon questions and unsupported brainstorming prompts in `tests/e2e/canon-chat.spec.ts`

### Implementation for User Story 3

- [x] T037 [P] [US3] Implement retrieval over chapters, articles, chronology, and watchlist records in `src/lib/server/retrieval/query-context.ts` and `src/lib/server/retrieval/retrieve-canon-context.ts`
- [x] T038 [US3] Implement the canon-only chat service and conversation persistence in `src/lib/server/chat/canon-chat-service.ts` and `src/lib/server/db/repositories/chat-repository.ts`
- [x] T039 [US3] Implement the chat query endpoint in `src/routes/api/chat/query/+server.ts`
- [x] T040 [US3] Implement the chatbot drawer UI and client store in `src/lib/components/chat/ChatDrawer.svelte` and `src/lib/stores/chat.ts`

**Checkpoint**: User Story 3 should now answer canon-only questions from local project context, persist conversations locally, and refuse creative-writing requests.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Finish features that cut across multiple stories, especially export, repair, settings, and final validation.

- [x] T041 [P] Implement export archive generation with secret exclusion in `src/lib/server/export/export-project.ts` and `src/routes/api/export/zip/+server.ts`
- [x] T042 [P] Add integration and end-to-end coverage for export and degraded-sync repair in `tests/integration/export-sync.test.ts` and `tests/e2e/export-and-repair.spec.ts`
- [x] T043 Implement settings and repair controls for provider management, export, and sync recovery in `src/routes/settings/+page.svelte` and `src/lib/components/layout/TopActionBar.svelte`
- [x] T044 Document the final validation flow and smoke-test expectations in `specs/001-local-canon-wiki/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies. Start immediately.
- **Foundational (Phase 2)**: Depends on Setup. Blocks all user-story work.
- **User Story 1 (Phase 3)**: Depends on Foundational completion.
- **User Story 2 (Phase 4)**: Depends on User Story 1 producing canonical entities and generated wiki outputs.
- **User Story 3 (Phase 5)**: Depends on User Story 1 producing saved chapters, canon records, and provider-backed scan outputs.
- **Polish (Phase 6)**: Depends on the stories you want in the release being complete.

### User Story Dependencies

- **US1 (P1)**: First deliverable and MVP foundation. No dependency on later stories.
- **US2 (P2)**: Requires the canon records and projections created by US1.
- **US3 (P3)**: Requires the chapter and canon evidence created by US1, but does not depend on US2 UI work.

### Within Each User Story

- Write automated tests before the main implementation tasks for that story.
- Build repositories and service logic before route handlers.
- Build route handlers before UI integration.
- Validate each checkpoint before starting the next story.

---

## Parallel Execution Examples

### User Story 1

```bash
# Launch the US1 automated coverage together:
Task: T014 tests/integration/setup-and-chapter-api.test.ts
Task: T015 tests/e2e/chapter-canon.spec.ts
Task: T016 tests/unit/server/scan-pipeline.test.ts

# Build independent US1 endpoint surfaces in parallel:
Task: T017 src/routes/api/setup/provider/test/+server.ts and src/routes/api/setup/project/+server.ts
Task: T018 src/routes/api/chapters/+server.ts and src/routes/api/chapters/[id]/+server.ts
```

### User Story 2

```bash
# Launch the US2 coverage together:
Task: T027 tests/integration/wiki-api.test.ts
Task: T028 tests/e2e/wiki-browsing.spec.ts

# Build data and UI layers independently before wiring routes:
Task: T029 src/lib/server/db/repositories/entity-repository.ts and src/lib/server/db/repositories/wiki-repository.ts
Task: T032 src/lib/components/wiki/WikiSidebar.svelte and src/lib/components/wiki/WikiPageView.svelte
```

### User Story 3

```bash
# Launch the US3 coverage together:
Task: T035 tests/integration/chat-api.test.ts
Task: T036 tests/e2e/canon-chat.spec.ts

# Build retrieval and drawer state in parallel before endpoint wiring:
Task: T037 src/lib/server/retrieval/query-context.ts and src/lib/server/retrieval/retrieve-canon-context.ts
Task: T040 src/lib/components/chat/ChatDrawer.svelte and src/lib/stores/chat.ts
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational prerequisites.
3. Complete Phase 3: User Story 1.
4. Validate save, scan, and rescan behavior before expanding scope.

### Incremental Delivery

1. Deliver US1 to establish trustworthy canon capture.
2. Add US2 to expose the canon through the private wiki UI.
3. Add US3 to answer canon-only questions from stored evidence.
4. Finish with export, repair, and settings polish.

### Parallel Team Strategy

1. One developer completes Setup and Foundational work.
2. After US1 stabilizes canonical data generation, another developer can take US2 while a third takes US3.
3. Rejoin for Phase 6 export, repair, and settings work.

---

## Notes

- `[P]` tasks touch separate files and can run in parallel.
- User story labels appear only on user-story tasks for traceability.
- Every task references concrete file paths so the work is immediately executable.
- Stop at each story checkpoint and validate independently before continuing.

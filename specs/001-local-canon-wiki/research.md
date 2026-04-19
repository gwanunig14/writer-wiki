# Research: Author Canon Keeper

## Decision 1: Run the app as a local SvelteKit Node server

- Decision: Use SvelteKit 2 with TypeScript and `@sveltejs/adapter-node`, with `npm run start` launching the local Node server.
- Rationale: The app needs server-side filesystem access, local SQLite access, explicit provider calls, and a desktop-oriented browser UI without public deployment. Adapter Node fits those requirements directly.
- Alternatives considered:
  - `adapter-static`: Rejected because it cannot support server-side filesystem and scan orchestration.
  - `adapter-auto`: Rejected because the target runtime should be explicit and local.

## Decision 2: Keep SQLite as operational truth and mirror readable outputs after DB writes

- Decision: Use SQLite as the authoritative store for project state and regenerate markdown and text outputs into `project-data/` after successful DB application.
- Rationale: SQLite supports transactional updates for chapter versions, scan jobs, entity reconciliation, dependency tracking, and file sync status. Human-readable files remain transparent and portable without becoming the write authority.
- Alternatives considered:
  - File-first authoring with DB sync: Rejected because it makes reconciliation, rescans, and silent drift prevention harder.
  - Pure DB storage with no mirror: Rejected because the brief explicitly requires readable markdown and text outputs for transparency and portability.

## Decision 3: Use a DB-first sync queue with degraded-sync tracking

- Decision: After any successful scan write, enqueue deterministic file regeneration jobs and track per-output sync status so file failures can be surfaced and retried.
- Rationale: This preserves a reliable operational state even if filesystem writes fail while avoiding silent divergence between DB and generated files.
- Alternatives considered:
  - Synchronous DB plus file writes in one blocking request: Rejected because it increases scan latency and creates poor UX on large regeneration bursts.
  - Best-effort file writes with no tracking: Rejected because it allows invisible drift.

## Decision 4: Store provider metadata in SQLite and provider secrets locally but separately from export artifacts

- Decision: Store selected provider, model preferences, and connection metadata in SQLite while keeping API keys in a local secrets store excluded from project export by default.
- Rationale: The app needs local-only credentials while the export feature must omit secrets unless explicitly requested. Separating secrets from exported project state reduces accidental leakage.
- Alternatives considered:
  - Store API keys directly in exported SQLite DB: Rejected because export defaults should exclude secrets.
  - Require environment variables only: Rejected because the product brief requires an onboarding flow with local saved keys.

## Decision 5: Implement a staged scan pipeline with strict normalization before persistence

- Decision: Split scan processing into dependency gathering, provider extraction, normalization and validation, reconciliation, regeneration, and downstream invalidation handling.
- Rationale: The brief prioritizes accuracy over efficiency and requires structured, non-freeform canon extraction. A staged pipeline allows conservative matching, confidence handling, and safe failure boundaries.
- Alternatives considered:
  - One-shot prompt with direct article generation: Rejected because it is too brittle for rescans, stub promotion, and contradiction tracking.
  - Freeform model prose parsing only: Rejected because the brief requires structured output.

## Decision 6: Use stable entity IDs and stable slugs with in-place stub promotion

- Decision: Give every entity an immutable internal ID and a stable slug path, and promote stubs into full dossiers without changing identity or path.
- Rationale: Hyperlinks, backlinks, All pages, and downstream references must survive rescans and promotions.
- Alternatives considered:
  - Recreate full entities from scratch when promoted: Rejected because it would break links and audit continuity.
  - Use display names as canonical keys: Rejected because names can evolve or collide.

## Decision 7: Track derived dependencies explicitly for rescan propagation

- Decision: Record chapter-to-derived-output dependencies for entities, chronology entries, watchlist entries, contradictions, and article links.
- Rationale: The product requires editing an earlier chapter to mark later affected canon stale and regenerate impacted outputs. Explicit dependencies are the simplest reliable way to do that in v1.
- Alternatives considered:
  - Rebuild the entire project on every rescan: Rejected because it increases latency and obscures what changed.
  - Pure heuristic stale detection with no stored dependency graph: Rejected because it is too hard to audit and debug.

## Decision 8: Retrieval for canon chat prioritizes chapter excerpts over derived summaries

- Decision: For Q&A, retrieve local chapter excerpts first, then entity articles, chronology, continuity watchlist, and contradiction audit entries.
- Rationale: Chapter text is the primary authority. Derived canon helps organization, but answers must defer to source text when sources disagree.
- Alternatives considered:
  - Article-only retrieval: Rejected because it over-trusts derived summaries.
  - Full-project prompt stuffing for every question: Rejected because it is inefficient and unnecessary once retrieval exists.

## Decision 9: Use Vitest plus Playwright as the testing baseline

- Decision: Use Vitest for unit and integration testing and Playwright for end-to-end workflow coverage.
- Rationale: This matches the SvelteKit toolchain, supports fast feedback on parsing and persistence logic, and covers the critical user paths from setup through save, scan, rescan, chat, and export.
- Alternatives considered:
  - Unit tests only: Rejected because the product’s highest-risk behaviors are cross-layer workflows.
  - Browser smoke tests only: Rejected because structured output normalization and sync behavior need lower-level validation.

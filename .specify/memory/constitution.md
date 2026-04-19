# Author Canon Keeper Constitution

## Core Principles

### I. Local-First And Private By Default

All project data, including chapters, scan results, canon records, continuity data, chronology, prompts, and readable file outputs, must remain on the user's machine by default. The application must never make network calls for manuscript or canon content unless the user explicitly initiates a scan or canon-question request. Telemetry, cloud sync, and account-based storage are out of scope unless a future amendment explicitly authorizes them.

### II. Chapter Text Is The Primary Authority

Original chapter text is the canonical source of truth for book facts. Generated dossiers, wiki pages, chronology, continuity outputs, and chatbot answers are derived reference layers and must defer to chapter text whenever evidence conflicts. The system must preserve ambiguity and contradiction instead of inventing harmonized answers.

### III. Explicit AI Boundaries And Non-Creative Behavior

AI integrations exist only for structured canon extraction and canon-only Q&A through user-provided OpenAI or Anthropic API keys. The product must not present itself as connected to consumer ChatGPT or Claude accounts, must not offer brainstorming or creative-writing assistance, and must refuse unsupported invention. All provider interactions must use explicit provider abstractions, prompt assets stored locally, and validated structured outputs before persistence.

### IV. Deterministic Derived State And Auditability

SQLite is the operational source of truth for application logic. Human-readable markdown and text files are deterministic projections regenerated from stored state. Every scan must use a saved chapter snapshot, every downstream change must be attributable to a scan or reconciliation action, and database-to-file sync failures must be surfaced explicitly rather than hidden. Stub promotion, hyperlink stability, contradiction tracking, and rescan propagation must preserve stable identities and audit history.

### V. Workflow Integrity Through Verifiable Quality Gates

The application must preserve the user workflow of save without scan, save-then-scan, revision-aware rescanning, navigable wiki browsing, and canon-only chat. Changes that affect save behavior, scan orchestration, provider boundaries, sync behavior, or retrieval quality require automated verification at the unit, integration, or end-to-end level appropriate to the risk. Simpler implementations are preferred unless additional complexity is necessary to preserve privacy, determinism, or correctness.

## Product Constraints

### Required Scope

- The product is single-project only in version one.
- The application must run locally with SvelteKit and TypeScript and launch through `npm run start`.
- The storage model must use SQLite plus mirrored readable markdown and text outputs.
- The application must support OpenAI and Anthropic through API keys stored locally.
- The UI must provide a chapter workspace, left wiki navigation, main reading pane, top action bar, and bottom-right chatbot drawer.

### Non-Negotiable Behavioral Constraints

- Scan must always perform save plus versioned snapshot creation before any provider call.
- If save fails, scan must not proceed.
- Editing a scanned chapter must mark affected derived outputs stale and allow later-affected regeneration on rescan.
- Category All pages, chronology, continuity watchlist, contradiction audit, and hyperlinks must regenerate from stored state after successful scans.
- Export must exclude API keys by default.

### Explicit Non-Goals For Version One

- Multi-project support
- Collaborative editing
- Rich text or markdown editing
- Public deployment
- User authentication accounts
- Cloud database or device sync
- Brainstorming or creative-writing assistance

## Development And Review Gates

### Planning Gates

- Every implementation plan must explicitly state how it satisfies local-first privacy, chapter-first authority, explicit AI boundaries, deterministic projections, and workflow verification.
- Any intentional deviation from the required tech stack or hybrid storage model must be justified in the plan's complexity tracking.

### Implementation Gates

- Provider-facing code must be isolated behind shared interfaces and must not leak provider-specific assumptions into UI workflows.
- Persistence changes must preserve DB-first authority and explicit sync-status reporting.
- Routing and UI changes must preserve the four-surface layout model unless the constitution is amended.

### Test Gates

- Unit tests are required for schema validation, normalization, dependency tracking utilities, and provider abstraction logic.
- Integration tests are required for save, snapshot creation, scan job lifecycle, DB-to-file synchronization, and export behavior.
- End-to-end tests are required for onboarding, save without scan, save-then-scan, stub promotion, rescan propagation, wiki navigation, and canon-only chat refusal behavior.

## Governance

This constitution supersedes ad hoc implementation preferences for the Author Canon Keeper project. Plans, tasks, and implementation changes must reference and comply with these principles and constraints. Amendments require updating this document, adjusting impacted planning artifacts, and documenting why the prior rule is no longer sufficient. The active implementation plan referenced in `.github/copilot-instructions.md` is the operational companion to this constitution, but it may not weaken these rules without a formal amendment here.

**Version**: 1.0.0 | **Ratified**: 2026-04-19 | **Last Amended**: 2026-04-19

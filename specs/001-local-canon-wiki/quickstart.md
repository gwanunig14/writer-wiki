# Quickstart: Author Canon Keeper

## Goal

Set up the local development environment, run the app locally with `npm run start`, initialize a single book project, and verify the core flows for save, scan, wiki generation, rescan propagation, and canon-only chat.

## Prerequisites

- Node.js 20 LTS
- npm 10+
- A local desktop browser
- An OpenAI API key or an Anthropic API key for provider-backed scans and canon chat

## Initial Setup

1. Install dependencies.

```bash
npm install
npx playwright install
```

2. Apply database migrations.

```bash
npm run db:migrate
```

3. Start the local app server.

```bash
npm run start
```

4. Open the local URL printed by the app, expected to be `http://localhost:3000` unless configured otherwise.

## First-Run Onboarding

1. Choose `OpenAI` or `Anthropic` on the setup screen.
2. Enter the API key and use `Test connection`.
3. Create the single project name and accept the generated local project-data folder.
4. Confirm the app seeds:
   - `project-data/chapters/`
   - `project-data/wiki/Characters`, `Locations`, `Items`, `Organizations`
   - `project-data/wiki/Chronology/Chronology.md`
   - `project-data/wiki/Continuity/Watchlist.md`
   - `project-data/system/constitution.txt`
   - `project-data/system/prompts/`
5. Verify routing lands on the chapter workspace with instructional copy for Chapter 1.

## Smoke Test Workflow

### Save Without Scan

1. Paste chapter text into the plain-text editor.
2. Enter a chapter number and title.
3. Click `Save`.
4. Verify:
   - Chapter status becomes `Saved`.
   - A chapter text file is written under `project-data/chapters/`.
   - No provider call occurs.

### Save-Then-Scan Snapshot

1. Edit the saved chapter without clicking `Save` again.
2. Click `Scan`.
3. Verify:
   - The latest editor state is saved first.
   - A new `ChapterVersion` snapshot is created.
   - Scan progress UI appears with staged status updates.
   - The chapter only reaches `Scanned` if the scan succeeds.
   - Wiki articles, All pages, chronology, and continuity outputs are regenerated.

### Stub Creation And Promotion

1. Scan a chapter that briefly mentions a new named entity without detail.
2. Verify a stub appears in the sidebar and category All page.
3. Scan a later chapter with richer information about that entity.
4. Verify the stub is promoted in place to a full article and all links continue to work.

### Rescan Propagation

1. Save and scan chapters 1 through 3.
2. Edit chapter 1 to alter a canon fact.
3. Click `Scan` on chapter 1.
4. Verify:
   - Chapter 1 is saved again before the provider call.
   - Downstream outputs for later affected chapters become stale.
   - Regenerated articles, chronology, continuity, and result summary reflect the revised canon.
   - Change log artifacts are recorded.

### Canon-Only Chat

1. Open the bottom-right chatbot drawer.
2. Ask a factual question about scanned canon.
3. Verify the answer includes confirmed evidence and flags uncertainty when needed.
4. Ask for brainstorming help.
5. Verify the assistant refuses and stays in canon-only mode.

### Export

1. Open `Settings`.
2. Trigger `Export zip`.
3. Verify the archive includes SQLite data and mirrored files but excludes API keys by default.

## Suggested Development Commands

```bash
npm run dev
npm run build
npm run start
npm run test
npm run test:e2e
```

## Acceptance Verification Checklist

- Local launch works from `npm run start`.
- Provider setup and API key test succeed.
- Save works without scanning.
- Scan uses the latest saved snapshot even when the editor has unsaved changes.
- Save failure blocks scan start.
- Scan progress is visible.
- Wiki, links, All pages, chronology, continuity, and chat all use local project data.
- Rescans update later affected outputs.
- Export produces a portable local project archive without secrets by default.

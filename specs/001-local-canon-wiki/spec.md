# Feature Specification: Local Canon Wiki

**Feature Branch**: `[001-build-canon-organizer]`  
**Created**: 2026-04-19  
**Status**: Draft  
**Input**: User description: "Build a local-first application for novelists to organize the canon of a single book project. The user should be able to paste chapters into the app, save and edit those chapters locally, and click Scan when a chapter is ready. Scanning should analyze the chapter against previously stored canon and generate or update a private wiki of the book, including articles for characters, locations, items, organizations, chronology, and continuity tracking. The wiki should appear in a left sidebar, and selecting an entry should show the generated article in the main view. References to other entities inside articles should be hyperlinked.

The app should also create stub entries for named entities that are mentioned before enough information exists for a full article, and later scans should upgrade those stubs into full dossiers while preserving links. Each category should also have an All page that lists every article in that category.

There should be a chapter workspace where the user can paste new chapters, edit older chapters, or use the text area as their plain-text writing workspace. The workspace must have Save and Scan actions. Scan should always save first automatically, so the user does not have to click Save before Scan. If an earlier chapter is edited and rescanned, the app should update that chapter and all later affected canon outputs.

The app should also include a bottom-right chatbot that answers canon-only questions about the book using the saved chapters and generated canon data as source material. The tool is for organization and continuity, not brainstorming or creative writing help.

The product must be private to the user, run locally on their machine, and keep the project data local except when the user explicitly asks the app to scan a chapter or answer a canon question using their chosen AI provider.

For things that need clarification, use best guess. Update acceptance checklist after."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Maintain Chapter Canon (Priority: P1)

As a novelist, I can paste or edit chapter text in a chapter workspace, save it locally, and scan it so the app updates the project's canon from that chapter and any later affected chapters.

**Why this priority**: The core value of the product is turning chapter text into a current, internally consistent canon record that remains private and local by default.

**Independent Test**: Can be fully tested by creating a project with multiple chapters, saving a chapter, scanning it, then editing an earlier chapter and rescanning to confirm the canon and downstream affected outputs refresh correctly.

**Acceptance Scenarios**:

1. **Given** a user has entered chapter text in the workspace, **When** they click Save, **Then** the chapter is stored locally and remains available for later editing.
2. **Given** a user has unsaved chapter edits, **When** they click Scan, **Then** the app saves the latest chapter content before beginning the scan.
3. **Given** a user rescans an edited earlier chapter, **When** the scan completes, **Then** the canon derived from that chapter and all later affected canon outputs are updated to reflect the revised text.
4. **Given** a user works entirely offline except for a scan request, **When** they save or edit chapter content, **Then** the chapter data remains on the local machine and is not sent anywhere.

---

### User Story 2 - Browse A Private Book Wiki (Priority: P2)

As a novelist, I can browse a generated wiki in a left sidebar, open articles in the main view, follow links between related entries, and review category-wide All pages to understand the current canon of the book.

**Why this priority**: The canon is only useful if the user can inspect it quickly, navigate relationships, and review organized summaries across people, places, objects, groups, timeline facts, and continuity notes.

**Independent Test**: Can be fully tested by scanning chapters that introduce multiple entity types, then confirming the sidebar shows categories and entries, each category has an All page, and linked references open the related article in the main view.

**Acceptance Scenarios**:

1. **Given** canon entries exist after a scan, **When** the user selects an entry in the left sidebar, **Then** the corresponding article appears in the main view.
2. **Given** an article mentions another canon entity, **When** the user selects that linked reference, **Then** the related article opens without breaking the original relationship.
3. **Given** a category contains multiple entries, **When** the user opens that category's All page, **Then** the app lists every article currently stored in that category.
4. **Given** a named entity is mentioned before enough detail exists for a full article, **When** the scan completes, **Then** the wiki contains a stub entry that can still be opened and linked.

---

### User Story 3 - Ask Canon-Only Questions (Priority: P3)

As a novelist, I can ask a chatbot canon-only questions in the app and receive answers grounded in the saved chapters and generated canon data, without the tool drifting into brainstorming or creative-writing assistance.

**Why this priority**: Question answering is valuable after the canon exists, but it depends on the chapter and wiki workflows being trustworthy first.

**Independent Test**: Can be fully tested by scanning chapters, asking factual questions about established canon, and confirming the answers stay within stored source material while refusing brainstorming or invention requests.

**Acceptance Scenarios**:

1. **Given** the project has saved chapters and generated canon, **When** the user asks a factual question about the book, **Then** the chatbot answers using only the project chapters and canon as source material.
2. **Given** the user asks for brainstorming, plot invention, or other creative-writing help, **When** the chatbot responds, **Then** it declines that request and keeps the interaction focused on canon organization and continuity.
3. **Given** the user has not chosen to send a canon question to their AI provider, **When** they are working elsewhere in the app, **Then** no project data is transmitted externally.

### Edge Cases

- What happens when a scan finds a named entity that matches an existing stub but still lacks enough information for a full dossier? The system keeps the stub, updates whatever verified details are available, and preserves all existing inbound and outbound links.
- What happens when a scan changes or removes previously inferred canon facts from a rescanned earlier chapter? The system updates downstream wiki articles, chronology, and continuity records so outdated facts no longer appear as current canon.
- What happens when the user opens an All page or article before any entries exist in that category? The system shows an empty-state view that makes clear no canon has been generated there yet.
- What happens when the user scans a chapter that introduces no new canon entities but changes wording? The system still refreshes affected outputs so continuity and chronology remain aligned with the saved text.
- What happens when the user asks a canon question before any chapter has been saved or scanned? The system explains that there is not enough source material yet to answer.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST let the user create, store, reopen, and edit chapter text for a single book project on the local machine.
- **FR-002**: The system MUST provide a chapter workspace where the user can paste new chapter text, revise existing chapter text, and use the same text area as a plain-text writing workspace.
- **FR-003**: The system MUST provide explicit Save and Scan actions within the chapter workspace.
- **FR-004**: The system MUST save the current chapter content automatically before starting any scan initiated from that chapter.
- **FR-005**: The system MUST preserve locally saved chapter content between sessions unless the user explicitly changes or removes it.
- **FR-006**: The system MUST analyze a scanned chapter against previously stored project canon and update the book wiki accordingly.
- **FR-007**: The system MUST generate and maintain wiki entries for, at minimum, characters, locations, items, organizations, chronology, and continuity tracking.
- **FR-008**: The system MUST display the wiki structure in a left sidebar and show the selected article or category page in the main view.
- **FR-009**: The system MUST provide an All page for each canon category that lists every article currently available in that category.
- **FR-010**: The system MUST render references to other canon entities inside wiki articles as selectable links that open the referenced entry.
- **FR-011**: The system MUST create a stub entry when a named entity is mentioned but there is not yet enough verified information for a full article.
- **FR-012**: The system MUST upgrade a stub entry into a full dossier when later scans provide enough information, while preserving the same canonical identity and existing links.
- **FR-013**: The system MUST update canon outputs for a rescanned earlier chapter and every later chapter output affected by that change.
- **FR-014**: The system MUST keep project chapters, generated canon, and wiki content private to the user and stored locally by default.
- **FR-015**: The system MUST only send project data outside the local machine when the user explicitly asks to scan a chapter or ask a canon question through the user's chosen AI provider.
- **FR-016**: The system MUST provide a chatbot anchored to the saved chapters and generated canon data for answering canon-only questions about the current book project.
- **FR-017**: The chatbot MUST refuse requests for brainstorming, creative-writing assistance, or answers that require inventing information not supported by the saved chapters or canon records.
- **FR-018**: The system MUST make it clear when a chatbot answer cannot be supported because the project lacks sufficient source material.
- **FR-019**: The system MUST support continued local viewing and editing of project content even when the user is not actively invoking scan or question-answer operations.
- **FR-020**: The system MUST keep category membership, article links, and All pages consistent after any scan, rescan, stub upgrade, or canon revision.

### Key Entities _(include if feature involves data)_

- **Book Project**: The single locally stored novel workspace, including its chapter collection, generated canon, sidebar structure, and chat context.
- **Chapter**: A saved unit of plain-text manuscript content with an editable body, ordering within the book, and a scan-derived canon impact.
- **Wiki Entry**: A canon article displayed in the sidebar and main view, belonging to a category such as character, location, item, organization, chronology, or continuity.
- **Stub Entry**: A partial wiki entry for a named entity that has been detected but does not yet have enough verified information for a full dossier.
- **Category All Page**: A generated category-level page that lists every wiki entry currently assigned to that category.
- **Canon Link**: A relationship from one wiki entry to another that appears as a selectable in-article reference.
- **Scan Result**: The updated set of canon changes produced when the user scans a saved chapter, including newly created entries, revised articles, stub promotions, chronology updates, and continuity updates.
- **Canon Question**: A user-submitted factual query about the book that must be answered only from saved chapters and generated canon data.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A user can paste, save, and scan a chapter from the workspace in under 2 minutes on first use without needing outside instructions.
- **SC-002**: In validation tests where an earlier chapter is edited and rescanned, 100% of later affected canon views show the revised canon rather than stale information.
- **SC-003**: In a representative project containing at least 20 chapters, a user can open any sidebar entry or category All page in 3 interactions or fewer.
- **SC-004**: At least 95% of in-article entity references generated by the system open the intended related canon entry during acceptance testing.
- **SC-005**: In acceptance testing, 100% of named entities first introduced with insufficient detail appear as stub entries and remain linkable until enough information exists for a full dossier.
- **SC-006**: In scripted evaluation of canon questions grounded in the saved manuscript, at least 90% of responses are judged fully supported by project source material and none include brainstorming or invented canon.
- **SC-007**: During normal local editing, browsing, and reopening of the project, no project content leaves the local machine unless the user explicitly triggers a scan or canon question through their chosen provider.

## Assumptions

- The initial release supports one book project per local workspace rather than multi-book portfolio management.
- The primary user is a single novelist or writing team member working on a private manuscript on their own machine.
- Chapters are treated as plain text supplied by paste or direct editing; rich-text formatting, comments, and track-changes behavior are out of scope.
- The user chooses and manages any external provider needed for scan or question-answer requests, and those requests happen only when the user intentionally starts them.
- Chronology and continuity pages are user-facing canon outputs in the same wiki system, not separate planning tools.
- The product is expected to function for local editing and browsing without constant network access, except when the user explicitly invokes provider-backed analysis or question answering.

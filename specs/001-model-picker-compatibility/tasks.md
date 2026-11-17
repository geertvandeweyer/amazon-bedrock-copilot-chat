# Tasks: Model Picker Compatibility

**Input**: Design documents from `specs/001-model-picker-compatibility/`

**Prerequisites**: plan.md and spec.md; research.md, data-model.md, contracts/, and quickstart.md are available.

**Organization**: Tasks are grouped by user story. Automated focused test coverage is included because this repository constitution requires behavior changes to have tests; no tests are being added only to restate implementation details.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can be completed in parallel with other tasks marked [P] in a different file, with no incomplete-task dependency.
- **[Story]**: User-story association for story-phase tasks.
- Every task names the exact file or files to change.

## Phase 1: Setup

**Purpose**: Align extension support metadata and test runtime with the VS Code 1.146 minimum.

- [x] T001 Set `engines.vscode` to `^1.146.0` in `package.json` and set `version: "1.146.0"` in `.vscode-test.mjs` so the manifest and automated test runtime agree on the new minimum.

## Phase 2: Foundational

**Purpose**: Establish one verified 1.146 contract for model metadata surfaces before making story-specific provider changes.

- [x] T002 [P] Inspect the installed VS Code 1.146 model-picker and Manage Models/Add Models consumers, then record the exact metadata fields, type/units, Markdown/text handling, and visibility conditions required by each surface in `docs/VSCODE_INTEGRATION.md`.
- [x] T003 [P] Ran `bun run download-api` and verified it cannot provide the 1.146 proposed `chatProvider` declarations because `package.json` declares no `enabledApiProposals`; the hook downloaded current stable main declarations instead, so that out-of-scope result was reverted. Required proposal fields remain locally typed: `maxContextWindowTokens`, `statusIcon`, and `warningText`.

**Checkpoint**: The target engine/test runtime and source-audited 1.146 field/rendering contract are established; API declaration verification and source-level consumer audit are complete.

---

## Phase 3: User Story 1 - Configure and use a model context limit (Priority: P1) 🎯 MVP

**Goal**: Users can view and change a supported context-size control in the chat picker and per-model settings, and each setting is enforced as the selected model's effective maximum input context during a request.

**Independent Test**: In VS Code 1.146, change context size through both controls for a configurable model, issue a request, and verify the provider's effective input budget reserves the model's output allowance, the corresponding extended-context flag matches the selected choice, and another model's behavior is unchanged.

### Tests and implementation for User Story 1

- [x] T004 [US1] Add focused tests in `src/test/provider.test.ts` proving `buildConfigurationSchema` provides the supported context-size options and defaults for a regular model and an optional-1M model, including omission when no configurable context applies.
- [x] T005 [US1] Add focused tests in `src/test/provider.test.ts` proving model-specific `modelConfiguration.contextSize` determines effective input tokens, reserves `maxOutputTokens`, enables the required 1M request option only for the 1M choice, safely falls back for invalid/missing selections, does not mutate other model limits, and compacts oversized history while preserving the current turn and matching tool interactions.
- [ ] T006 [US1] Add context-size selection for the Copilot CLI/agent-host BYOK copy of Bedrock models. Direct provider discovery emits valid `contextSize` values, but the actual Chat panel remembers/selects `agent-host-copilotcli:bedrock/global.openai.gpt-6-luna`; VS Code 1.146 drops the direct schema when projecting that copy and does not carry context selection through the BYOK request DTO. A UI-only schema cannot work because selection would be dropped or have no request effect. Identify or propose the minimal upstream model-info/request bridge extension, including a request-boundary regression test, and keep this acceptance item open until that support exists and the live card renders selectable choices.
- [ ] T007 [US1] After end-to-end bridge support exists, verify the context selector in the actual Copilot CLI Chat panel with a Bedrock model; select standard and maximum choices and verify both selections reach the extension's request budget. Do not close based only on provider schema tests or a direct-provider model card if the selected session model is the agent-host mirror.

**Checkpoint**: User Story 1's provider configuration and request-budget behavior are verified with tests against the VS Code 1.146 test runtime; live picker/request UI verification remains pending accessible Bedrock models.

---

## Phase 4: User Story 2 - Review model information while choosing a model (Priority: P1)

**Goal**: The expanded chat picker shows available owner, cost, data-retention warning, and other relevant model metadata clearly in VS Code 1.146.

**Independent Test**: Compare models with complete, partial, and absent metadata in the 1.146 chat picker; verify each visible value belongs to its model and missing fields do not suppress available information. For Add Models, verify existing formatted AWS USD cost strings remain unchanged in table cells; picker Details may show Unknown for these strings and must not label them as Copilot credits.

### Tests and implementation for User Story 2

- [x] T008 [US2] Add focused metadata tests in `src/test/provider.test.ts` for complete, partial, and absent owner/cost/retention metadata and the selected 1.146 picker rendering fields; assert formatted AWS USD strings are preserved for Add Models and are not mislabeled as Copilot credits.
- [x] T009 [US2] Update metadata construction and formatting in `src/provider.ts` to supply owner, cost, retention warnings, and feature details through the exact 1.146 chat-picker fields confirmed in T002, omitting only unavailable values and avoiding reliance on fields not consumed by the picker.
- [x] T010 [US2] Update `docs/VSCODE_INTEGRATION.md` with the source-audited 1.146 chat-picker metadata mapping, including which fields render in the details card versus compact picker row and the correct interpretation of displayed prices.
- [x] T011 [US2] Verify metadata contract and cost behavior against installed VS Code 1.146 source and focused provider tests; document expected Unknown display for preserved formatted AWS USD strings in picker Details at `docs/VSCODE_INTEGRATION.md` (live UI verification remains blocked).

**Checkpoint**: User Story 2 displays available owner, warnings, and other details in the 1.146 picker; numeric credit-based cost rendering remains limited because formatted AWS USD strings are preserved for the Add Models table.

---

## Phase 5: User Story 3 - Read model details in Add Models (Priority: P2)

**Goal**: Add Models/Manage Models model-hover details are concise, ordered, readable, and free of literal Markdown and encoded spacing artifacts.

**Independent Test**: In VS Code 1.146, inspect model-name hovers for models with full and partial metadata; check stable field order, missing-field handling, and absence of raw markup/entities. The extension cannot control line collapsing in VS Code's hover.

### Tests and implementation for User Story 3

- [x] T012 [US3] Add focused formatter/provider tests in `src/test/provider.test.ts` covering Add Models text ordering, plain-text safety, partial/missing metadata, and correct USD labels without raw `**` or `&nbsp;` artifacts.
- [x] T013 [US3] Update `formatDetail`, `formatTooltip`, and/or Add Models metadata in `src/provider.ts` so the verified 1.146 model-name hover receives concise ordered content without relying on Markdown rendering. VS Code collapses line breaks in this name-hover surface.
- [x] T014 [US3] Update the Add Models/Manage Models portion of `docs/VSCODE_INTEGRATION.md` to document the tested 1.146 metadata surface, field precedence, ordering, and formatting limitations.
- [x] T015 [US3] Verify the Add Models name-hover field contract and cost behavior against installed VS Code 1.146 source and focused provider tests; document that line breaks collapse in this upstream hover. Live UI confirmation remains blocked until an accessible Bedrock model is available.

**Checkpoint**: User Story 3's provider content is ordered, concise, and plain text per tests and source audit; visual UI confirmation remains pending accessible Bedrock models.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Validate the combined feature, compatibility declaration, and documentation.

- [x] T016 Run `bun run check-types`, scoped lint, changed-file Prettier checks, focused/full provider tests, and `bun run vsce:package`; fix feature-caused issues and verify `.vscodeignore` keeps unrelated workspace artifacts out of the VSIX. Confirmed the package contains 10 expected files and excludes `.specify/`, `scripts/`, `specs/`, and workspace artifacts.
- [x] T017 Update `docs/EXTENSION_GUIDE.md`, `docs/VSCODE_INTEGRATION.md`, and `docs/TOKEN_LIMITS.md` to state that VS Code 1.146 is the minimum supported version in the directly relevant integration and token-limit documentation; align documentation with the new compaction behavior and retained USD cost strings.
- [x] T018 Run the full `bun run test` suite against the configured VS Code 1.146 runtime. Result: 165 passing, 13 pending in the latest full suite. Live chat-picker validation exposed a context selector regression, so T006/T007 are reopened; they must pass a real 1.146 picker check before completion.

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Starts immediately; complete T001 before the API/UI audit and story work.
- **Foundational (Phase 2)**: T002 and T003 follow T001 and establish the source-audited v1.146 API/UI contract; both must complete before user-story implementation.
- **User Stories (Phases 3–5)**: All require T001–T003. US1 is the MVP; US2 and US3 can proceed independently once the foundation is complete, with US2 and US3 both depending on the verified surface mapping from T002.
- **Polish (Phase 6)**: T016–T018 follow implementation of all desired stories. T017 follows the story-specific documentation updates T010 and T014 so the shared docs are not edited concurrently; T016 validates the completed code/docs/package changes, and T018 follows T016 and uses the target test runtime from T001. The packaging ignore rules in `.vscodeignore` exclude unrelated untracked workspace artifacts.

### User Story Dependencies

- **User Story 1 (P1)**: Begins after Foundation. T004/T005 cover current schema and request helpers; T006/T007 remain open because the user reproduced a missing context selector in the VS Code 1.146 card. Trace emitted model metadata and its picker consumer before closing.
- **User Story 2 (P1)**: Begins after Foundation. T008 can run in parallel with US1 work; T009 follows T002 and T008; T010 follows T009; T011 follows T009/T010 and uses source audit plus tests if interactive model access is unavailable.
- **User Story 3 (P2)**: Begins after Foundation. T012 can run in parallel with US1/US2; T013 follows T002 and T012; T014 follows T013; T015 follows T013/T014 and uses source audit plus tests if interactive model access is unavailable.

### Parallel Opportunities

- T002 and T003 can run in parallel after T001: the consumer audit updates `docs/VSCODE_INTEGRATION.md`, while the declaration check uses the API-generation workflow and `src/vscode.d.ts`.
- T004 and T005 can be implemented in separate test blocks, but because they share `src/test/provider.test.ts`, serialize edits to that file if there is a single implementer.
- T008 and T012 target separate test concerns but the same file; serialize commits/edits if one implementer is used.
- Across stories, independent implementation work can be split by file after T002: US1 (`src/provider.ts` context logic/tests) must be separated from metadata work to avoid simultaneous edits in `src/provider.ts`; documentation updates in `docs/` can proceed in parallel with source/test work after field mapping is settled.
- T017 documentation updates were completed alongside feature implementation; final validation covers those changed docs.

## Parallel Example: Independent Test and Documentation Work

```text
Task: T004 — Add context-schema tests in src/test/provider.test.ts
Task: T002 — Verify and document VS Code 1.146 metadata consumers in docs/VSCODE_INTEGRATION.md
```

Do not edit the same source/test file concurrently; tests and implementation should be integrated in a controlled sequence.

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete T001–T003 to align the VS Code target and verify the metadata/configuration API surface.
2. Complete T004–T007 to expose and honor per-model context size in VS Code 1.146.
3. Stop and validate the independent User Story 1 scenarios before starting the separate metadata presentation stories.

### Incremental Delivery

1. Deliver US1 as the MVP: reliable context-size controls and request-level enforcement.
2. Deliver US2: model metadata in the expanded picker surfaces.
3. Deliver US3: concise Add Models/Manage Models metadata presentation.
4. Complete cross-cutting tests, documentation, package validation, and manual 1.146 verification.

## Notes

- Type check, scoped ESLint, Prettier, focused provider tests, full VS Code 1.146 suite (164 passing, 13 pending), VSIX packaging, and package-content inspection passed. Interactive UI and real Bedrock request validation remain unverified because no accessible Bedrock model/profile is available in this environment. The generated declaration check confirmed the proposed 1.146 fields are not in `src/vscode.d.ts`; the package workflow cannot fetch the proposal for this production extension, so the metadata extension remains locally typed.
- Every executable task uses the required checkbox, sequential task ID, required story label where applicable, and at least one concrete file path.
- `[P]` marks tasks that do not depend on incomplete tasks and can be assigned without overlapping files; serialize changes to shared provider/test files.
- Automated tests must mock AWS operations. No feature task introduces an unguarded real AWS call.

## Follow-up: Local harness context-setting notice

**User request**: Explain that Bedrock context-size settings are supported only in the local
Copilot harness, including Add Models hover text and (where the API permits) chat model details.

- [x] T019 Add focused provider tests in `src/test/provider.test.ts` confirming the local-harness
      context-settings notice is present in model metadata and descriptive hover text.
- [x] T020 Add the informational notice to Bedrock model details and hover metadata in
      `src/provider.ts`. Harness mode is not exposed to the extension provider API, so this is an
      always-visible compatibility note rather than conditional detection.
- [x] T021 Document harness detection and agent-host BYOK metadata-projection limitations in
      `docs/VSCODE_INTEGRATION.md`.
- [x] T022 Verify and update required ignore patterns in `.gitignore`, `.prettierignore`, and
      `eslint.config.mjs` for the existing project setup.

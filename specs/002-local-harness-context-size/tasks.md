---
description: "Task list for honoring selected context size in local provider requests"
---

# Tasks: Honor the Picked Context Size in the Local Harness

**Input**: Design documents from `specs/002-local-harness-context-size/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `quickstart.md`

**Tests**: Included because the feature specification requires callback acceptance coverage and the constitution requires focused tests for behavior changes. Use mocked Bedrock operations; no real AWS calls.

**Organization**: Tasks are grouped by the two user stories in `spec.md`. “Local harness” describes the request-forwarding precondition only; tests verify the direct provider callback contract and do not assert caller-harness identity.

## Phase 1: Setup

**Purpose**: Review the feature contract and test constraints before implementation.

- [x] T001 Review `specs/002-local-harness-context-size/spec.md`, `plan.md`, and `quickstart.md`; confirm supported selection, derived input allowance, fallback, and callback-only test scope
- [x] T002 Inspect existing selection/fallback and mocked callback patterns in `src/test/provider.test.ts`; confirm the configured test command does not invoke AWS for the tests being added

---

## Phase 2: User Story 1 - Honor the selected context size in the local harness (Priority: P1) 🎯 MVP

**Goal**: A supported non-maximum selected total context window yields one output-reserved, model-capped input allowance used consistently for estimate-based compaction and request construction.

**Independent Test**: Invoke `provideLanguageModelChatResponse` with supported non-maximum model configuration. Verify the derived allowance reaches request construction and compaction behavior, including no summarization when the estimate fits. This verifies provider option handling only, not which harness invoked the callback.

### Tests and implementation for User Story 1

- [x] T003 [US1] Add cohesive mocked callback regression coverage in `src/test/provider.test.ts` for two distinct supported `modelConfiguration.contextSize` selections, including a non-maximum option: assert each derives its corresponding allowance, the allowance is reused for the request-local model and compaction, shared model metadata is unchanged, a fitting estimate makes zero summarization calls, and an over-limit estimate is compacted against the same allowance or rejected safely without sending an over-budget request
- [x] T004 [US1] Run the focused provider regression tests; only if they expose a production mismatch, make the narrowest correction in `src/provider.ts` so the selected-derived allowance governs estimate-based compaction, compactor budget, and request-local input limit
- [x] T005 [US1] Review `docs/TOKEN_LIMITS.md` against the verified behavior; update only if it misstates selected total context, output reservation, estimated input budgeting, or compaction semantics

**Checkpoint**: User Story 1 passes independently. The callback contract is verified without asserting harness identity or making claims about agent/Copilot behavior.

---

## Phase 3: User Story 2 - Preserve safe behavior when selection is absent (Priority: P2)

**Goal**: Omitted, malformed, and unsupported values do not enter the exact-selection path and use the established no-selection fallback.

**Independent Test**: Invoke the provider callback for omitted, malformed, and unsupported `contextSize` configurations. Verify each uses the existing fallback, and none is represented as an honored selection.

### Tests and implementation for User Story 2

- [x] T006 [US2] Add or adapt one table-driven mocked callback test in `src/test/provider.test.ts` for omitted, malformed, and unsupported context-size values; assert the existing no-selection fallback is used and no invalid value is represented as selected, retaining existing helper tests for enum validation and fallback arithmetic
- [x] T007 [US2] Run the focused fallback callback test; only if it demonstrates a defect, make the narrowest correction in `src/provider.ts` while preserving established fallback behavior

**Checkpoint**: User Story 2 passes independently; invalid values are not treated as selections and do not fail a request solely by being invalid.

---

## Phase 4: Cross-Cutting Validation

**Purpose**: Run the smallest applicable checks, with the configured test runner as the available test command.

- [x] T008 Review the new callback tests and feature artifacts for unrelated edits, sensitive logging, or real AWS calls; confirm scope remains the provider callback contract. Existing dirty changes in `src/provider.ts` and `docs/TOKEN_LIMITS.md` predate this implementation and were not modified here
- [x] T009 Run `bun run check-types`, `bun run lint -- src/test/provider.test.ts`, and `bunx prettier --check src/test/provider.test.ts docs/TOKEN_LIMITS.md` for the files changed by this implementation
- [x] T010 Run `bun run test -- --grep "per-model context size selection"` and confirm the mocked callback tests pass without real AWS access
- [x] T011 Run `git diff --check` and verify no agent/Copilot harness behavior or upstream source change is claimed or included

## Dependencies & Execution Order

- T001–T002 precede story work.
- User Story 1 tasks T003–T005 form the P1 MVP and precede its checkpoint.
- User Story 2 tasks T006–T007 can follow the shared review and may proceed after the MVP; because both stories edit the same test file, coordinate edits rather than parallelizing them.
- Cross-cutting validation T008–T011 follows implementation and documentation review.

## Implementation Strategy

1. Review the provider/test contract (T001–T002).
2. Add and run the cohesive selected-value callback regression (T003–T004); change production code only if the test demonstrates a mismatch.
3. Review existing documentation and update only for an identified inconsistency (T005).
4. Add and run one table-driven callback regression for omitted and invalid values (T006–T007), retaining helper tests for lower-level validation and arithmetic.
5. Run the applicable static checks, configured test suite, and final diff/scope checks (T008–T011).

## Notes

- Each task has a sequential ID and concrete file path or command.
- No task is marked `[P]`: story tests touch the same file, and validation depends on implementation completion.
- No new API contract, persistence model, production module, compactor change, or harness-detection logic is planned absent test evidence.

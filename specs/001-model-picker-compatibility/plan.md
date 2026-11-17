# Implementation Plan: Model Picker Compatibility

**Branch**: `001-model-picker-compatibility` | **Date**: 2026-11-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification at `specs/001-model-picker-compatibility/spec.md`

## Summary

Restore the context-size controls and model metadata presentation in the VS Code 1.146 chat
picker, ensure the selected per-model input-context limit is applied to requests from either
configuration surface, and make Add Models model-hover metadata concise and readable. Keep the existing
provider architecture; verify the API contract and each UI surface against the installed 1.146
runtime, correct any metadata-format/type mismatch, and cover request behavior with focused tests.

## Technical Context

**Language/Version**: TypeScript, ES2024; Bun-managed project

**Primary Dependencies**: VS Code Language Model Chat Provider API and proposed `chatProvider`
metadata; AWS SDK for JavaScript Bedrock clients (existing discovery/invocation only)

**Storage**: No new persistence; per-request context-size selection comes from VS Code model
configuration, while existing extension settings remain unchanged

**Testing**: Existing Mocha/vscode-test suite, focused provider tests, TypeScript check, and manual
UI checks in VS Code 1.146

**Target Platform**: VS Code 1.146 desktop extension host; the minimum supported version is
`^1.146.0`.

**Project Type**: TypeScript VS Code extension

**Performance Goals**: Picker metadata formatting remains local. Requests whose estimated history
fits the effective input budget incur no additional network calls; oversized histories are summarized
with a separate Bedrock Converse request before the final inference request.

**Constraints**: VS Code/Copilot owns the UI rendering and only consumes supported metadata fields;
Bedrock model context and output limits vary by model; AWS prices are estimates and must not be
misrepresented as Copilot credits; preserve existing formatted USD `*Cost` strings for the Add Models
table even though picker Details may show Unknown; update checked-in proposed API declarations through
the project workflow if API declarations change. History compaction uses an additional Bedrock
request only when the estimated input exceeds the effective budget.

**Scale/Scope**: Existing catalog of available foundation models and inference profiles; no new
model catalog, persistence layer, or upstream VS Code modification. Oversized history adds a
conditional Converse request through the existing Bedrock runtime client.

## Constitution Check

_Gate: must pass before Phase 0 research and be rechecked after Phase 1 design._

| Principle / constraint                   | Gate | Evidence and plan                                                                                                                                                           |
| ---------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Surgical, behavior-preserving changes | PASS | Limit changes to picker metadata, model-specific context configuration/request use, focused tests, and directly related documentation.                                      |
| II. Architecture and API contracts       | PASS | Adapt the existing provider → request flow; validate metadata against the declared and observed VS Code 1.146 contract rather than hiding incompatible fields behind casts. |
| III. Focused, risk-based validation      | PASS | Add/update focused provider tests with mocked AWS operations; use existing type, lint, format, and test commands appropriate to changed files.                              |
| IV. Documentation and compatibility      | PASS | Update the manifest minimum, living compatibility documentation, and automated target to VS Code 1.146.                                                                     |
| V. Secure, observable AWS integration    | PASS | Conditional summary inference uses the existing credential/client path; automated tests mock AWS behavior, and transcripts/summaries are not logged or persisted.           |

No constitution violations identified; no complexity exception is required.

### Post-design re-check

- **I. Surgical changes**: PASS — phase-1 artifacts introduce no new runtime architecture or unrelated scope.
- **II. API contracts**: PASS — contract identifies the actual extension/VS Code boundary and calls out target-runtime verification before implementation choices are finalized.
- **III. Focused validation**: PASS — quickstart specifies mocked provider tests and a version-targeted manual check.
- **IV. Documentation and compatibility**: PASS — update `package.json`, living docs, and test target to 1.146. Generated declarations are updated only through the repository API workflow if needed.
- **V. Secure AWS integration**: PASS — oversized histories use the existing credential path for a conditional summary request; tests remain mocked, and transcripts/summaries are not logged or persisted.

No post-design gate failures.

## Project Structure

### Documentation (this feature)

```text
specs/001-model-picker-compatibility/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── vscode-language-model-provider.md
└── tasks.md                 # Produced by /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── provider.ts                  # Model information, context configuration, and request handling
├── context-compactor.ts         # Request-local history estimation and summarization
├── bedrock-client.ts            # Converse-based summary request
├── profiles.ts                  # Model capabilities and context limits
├── vscode.d.ts                  # Generated proposed VS Code API declarations
└── test/
    └── provider.test.ts         # Focused provider behavior tests

docs/
└── VSCODE_INTEGRATION.md        # UI/API behavior and compatibility notes
```

**Structure Decision**: Keep the existing single extension project. Provider metadata and request
configuration remain in `src/provider.ts`, capability/limit facts remain with the existing profile
logic, tests stay in `src/test/provider.test.ts`, and UI compatibility guidance is updated in
`docs/VSCODE_INTEGRATION.md`.

## Complexity Tracking

No violations.

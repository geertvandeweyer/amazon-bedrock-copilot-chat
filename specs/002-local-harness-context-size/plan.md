# Implementation Plan: Honor the Picked Context Size in the Local Harness

**Feature branch**: `002-local-harness-context-size` | **Date**: 2026-11-17 | **Spec**: [spec.md](./spec.md)

**Checkout note**: The current working tree is on `main`; the setup script resolved this feature directory and branch identifier without switching Git branches.

## Summary

Ensure a supported per-model `contextSize` forwarded in provider request options is treated as the selected total context window. Derive one effective input allowance by reserving the model's advertised output allowance and respecting its supported input limit; use that allowance consistently for estimated preflight, compaction, and request construction. A valid selection must not be replaced with the model maximum or a different fallback. Omitted, malformed, and unsupported values follow the established no-selection fallback and are not represented as honored selections. Acceptance tests target the direct provider callback contract and do not claim to identify its caller's harness.

The extension provider already has request-level context-size resolution, supported-enum validation, request budget calculation, and compaction. VS Code 1.146’s language-model API declares an optional `modelConfiguration` on provider response options, and its direct chat request path carries the selected model configuration to the provider. Existing extension tests exercise the budget helpers and compactor separately, but do not establish the full callback invariant that a non-maximum selection controls both the compaction decision and the outgoing request's effective input allowance. The implementation should close that end-to-end regression-coverage gap and correct the provider path only if that test exposes a discrepancy—not redesign model discovery or context compaction.

## Technical Context

**Language/Version**: TypeScript, strict mode; VS Code API baseline `^1.146.0`
**Primary Dependencies**: VS Code Language Model Chat Provider API, AWS SDK Bedrock Runtime, Bun
**Storage**: None; selected context size is per-request configuration
**Testing**: Mocha through `vscode-test`; provider unit tests in `src/test/provider.test.ts`
**Target Platform**: VS Code desktop provider callback requests, Bedrock provider requests
**Project Type**: Single VS Code extension
**Performance Goals**: No added network calls; retain current token estimation and compaction path
**Constraints**: Preserve selection exactly for supported values; validate against the selected model schema; retain omission fallback; do not send unsupported context limits to Bedrock; no agent/Copilot or upstream source modifications
**Scope**: Provider request options, effective input budget/compaction integration, focused tests, and context-limit documentation only

### Verified upstream request path (VS Code 1.146.0)

- `vscode_source/src/vscode-dts/vscode.proposed.chatProvider.d.ts` defines optional `ProvideLanguageModelChatResponseOptions.modelConfiguration` as per-request model-specific configuration.
- `vscode_source/src/vs/workbench/contrib/chat/browser/widget/chatWidget.ts` defines `getSelectedModelRequestOptions()` (around lines 4424–4438), returning the selected model ID and `this.input.getModelConfiguration(modelId)` together. The normal submit path spreads these options into `chatService.sendRequest` (around line 4151); resend also preserves the same selection.
- `vscode_source/src/vs/workbench/contrib/chat/common/chatService/chatServiceImpl.ts` stores `options.userSelectedModelConfiguration` on the request and later supplies it to the model request as `modelConfiguration` (around lines 1531–1540). When options are omitted, the direct chat path resolves the model's stored configuration (around lines 2088–2090).
- `vscode_source/src/vs/workbench/api/common/extHostLanguageModels.ts` invokes the registered provider and maps the request configuration to the provider option `modelConfiguration: options.configuration` (around line 369). The proposed `chatProvider` declaration describes this as per-model configuration validated against `configurationSchema` (around lines 19–26).
- The picker value is stored per model by VS Code's model-configuration store, then read into the request selection. The extension receives the resolved value, not a separate UI event. The direct provider callback is the test seam for this feature; do not add harness detection or infer local-vs-agent identity inside the extension.
- This establishes the direct workbench-to-provider configuration route, but does not prove which internal model identity a particular UI session selected. Agent-host/Copilot CLI uses separate pathways and is expressly excluded by this feature.
- The checked-out `vscode_source` is a development snapshot (`1.134.0-8249-g776b518e720`); the upstream observations above were verified at the available `1.146.0` tag, matching the extension’s minimum supported VS Code line. Treat this checkout as read-only research material.

### Current extension behavior to preserve / verify

- `src/provider.ts` reads request `modelConfiguration`, validates a selected `contextSize` against the model's numeric schema enum, and calculates a per-request input limit with output tokens reserved and the model's supported input limit applied.
- The same `effectiveMaxInputTokens` is passed to `compactMessageHistory` and placed on the request-local model object used to build/account for the Bedrock request. The preflight is based on the extension's token estimate; it is not a Bedrock tokenizer guarantee.
- If no valid selection is supplied, provider fallback logic derives the existing model/workspace limit. Do not change that fallback absent a failing regression test.
- `src/test/provider.test.ts` covers helper-level accepted/rejected context-size values, omitted-configuration fallback, optional 1M behavior, and `compactMessageHistory` behavior independently. Add cohesive callback-level coverage proving the selected total context produces one input allowance used by compaction and outgoing request construction, that a fitting estimate invokes no summarization, and that omitted/invalid values use the established no-selection fallback. Callback tests must not claim to identify the originating harness.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

- **Narrow, behavior-preserving changes**: PASS — use existing provider configuration and compaction abstractions; avoid unrelated model metadata changes.
- **VS Code API contracts and minimum version**: PASS — use the declared `modelConfiguration` request option available at the supported 1.146 API baseline; do not modify upstream sources.
- **Focused automated tests**: PASS — add callback coverage that would fail if selection propagation regressed; retain helper tests for validation and fallback; avoid AWS network access and spend.
- **Documentation alignment**: PASS — update `docs/TOKEN_LIMITS.md` only if the behavior or wording is not already accurate.
- **Security/logging**: PASS — add no credentials, prompts, response data, or summaries to logs; no extra persistence or network call.
- **Style/validation**: PASS — follow strict TypeScript and existing formatting; run targeted type/lint/format checks and use the VS Code test runner's Mocha `--grep` option for the focused provider tests.

No justified constitution violations identified.

## Research and Design Decisions

1. **Use the selected value only when it is valid for that model.** The provider schema enum is the authoritative list of choices. Unsupported, non-finite, string, or otherwise malformed values must not be accepted as the exact requested limit.
2. **Do not replace a valid selected value with model maximum.** Derive the input budget from selected total context minus the normal output reservation and apply the existing model/provider safety caps as required by the provider contract.
3. **Share one effective input limit across decision and compaction.** The over-limit check and compactor must use the same computed value; otherwise the request can be compacted against a different budget than the picker selection.
4. **Keep absent and invalid configuration on established no-selection fallback.** A value qualifies as selected only if it is finite, numeric, and present in that model's schema enum. Omitted, malformed, and unsupported values resolve to no valid selection and follow the existing provider/model fallback; they are not rejected solely for being invalid and are never represented as honored selections.
5. **No external API contract artifact is needed.** The feature changes consumption of an existing VS Code provider option, not the shape of the extension’s external interface. Record the request contract in research/data-model documentation instead of inventing a new public API.
6. **Harness boundary is a test precondition, not an extension heuristic.** The provider API callback has no reliable local-vs-agent harness discriminator. Tests invoke the direct provider callback with request options representative of local-harness forwarding and verify provider behavior only; they do not establish caller identity. Do not claim or implement harness detection, and do not alter other harnesses.

7. **Test the full invariant, not VS Code internals.** Use cohesive mocked callback coverage to observe selected-derived budget consistency, no summarization when the estimate fits, safe over-limit handling, and no-selection fallback for omitted/invalid values. Retain helper tests for enum validation and arithmetic. Upstream source validates the expected configuration-forwarding contract; do not duplicate VS Code picker/store tests in this repository.

## Project Structure

### Feature artifacts

```text
specs/002-local-harness-context-size/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/                 # Omitted: no new or changed external interface
└── tasks.md                   # Created by /speckit-tasks
```

### Expected source touchpoints

```text
src/
├── provider.ts                 # Resolve request selection and effective budget
└── test/
    └── provider.test.ts        # Supported/omitted/invalid selection regressions

docs/
└── TOKEN_LIMITS.md             # Clarify the local selection / estimated-budget semantics if needed
```

`src/context-compactor.ts` is an existing downstream consumer; change it only if tests demonstrate it independently violates the supplied budget. `docs/TOKEN_LIMITS.md` already documents selected-context-derived input budgets and compaction; touch it only if a specific wording gap remains after review. Do not duplicate context-size selection in the compactor.

**Structure Decision**: Keep configuration resolution in `provider.ts`, where model schema and request options are both available. Pass the resulting numeric input budget into the existing compactor. Keep focused callback regression coverage in the provider suite and compaction-policy coverage in the existing compactor tests; no new production module or external contract is anticipated. Run callback tests against the current implementation before making any production correction; edits are conditional on a demonstrated mismatch. `docs/TOKEN_LIMITS.md` already documents total-context selection, output reservation, approximate budgeting, and compaction; update it only if review identifies a specific inconsistency with this contract.

## Complexity Tracking

No constitution violations or additional architecture are proposed.

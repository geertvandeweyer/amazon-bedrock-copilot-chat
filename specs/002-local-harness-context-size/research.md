# Research: Local Harness Context Size

**Feature**: [spec.md](./spec.md)
**Target**: VS Code 1.146.0, the extension's declared minimum API line

## Decision 1: Consume the request's model-specific configuration

- **Decision**: Treat the direct provider callback's `modelConfiguration.contextSize` as the user's per-model, per-request selection. Validate it against that model's `configurationSchema.properties.contextSize.enum` before using it.
- **Rationale**: The VS Code 1.146 proposed provider API defines optional `modelConfiguration` as user-provided per-model configuration validated against the provider schema. The 1.146 workbench chat widget reads the currently selected model configuration and submits it with the request; the chat service retains it; the extension host forwards it to `provideLanguageModelChatResponse` as `options.modelConfiguration`.
- **Alternatives considered**: A global/workspace context setting (does not represent the model-specific selection); inferring selection from display metadata (not the request choice); modifying VS Code or adding a harness heuristic (out of scope and not supported by the provider contract).
- **Evidence**: VS Code tag `1.146.0`, commit `69047191fc427f2f92828279aae1d90d8eeda7ab`: `chatWidget.ts` (`getSelectedModelRequestOptions`, submit/resend paths), `chatServiceImpl.ts` (stores/sends `userSelectedModelConfiguration`), `extHostLanguageModels.ts` (forwards `options.configuration`), and `vscode.proposed.chatProvider.d.ts` (`modelConfiguration` contract). These are upstream research artifacts only; no upstream files are changed.

## Decision 2: Use one effective input budget from selection through request construction

- **Decision**: For a valid selected total context size, calculate the effective input allowance by reserving the model's output allowance and respecting the selected model's supported Bedrock input limits. Use that same effective allowance for the preflight estimate, history-compaction decision and compactor, and request-local model input limit.
- **Rationale**: A single budget avoids checking the transcript with one limit and building the Bedrock request with another. The existing provider path already centralizes this in `effectiveMaxInputTokens` and passes it into both `compactMessageHistory` and the request model.
- **Alternatives considered**: Comparing against the selected total context without output reservation (can exceed the total window once output is generated); using model maximum for compaction (ignores the user's lower selection); separately recomputing limits at each stage (risks drift).
- **Evidence**: `src/provider.ts` computes selected context and `effectiveMaxInputTokens`, calls `compactMessageHistory` with it, and builds the request-local model with that same input limit. `src/context-compactor.ts` skips summarization when its estimated system-plus-message tokens fit `maxInputTokens`.

## Decision 3: Preserve omission fallback and reject unsupported values as selections

- **Decision**: Keep the current fallback path for requests without a supported selection. Only finite numeric values present in the per-model schema enum qualify as selected values. Do not broaden or redesign fallback behavior in this feature.
- **Rationale**: The specification explicitly preserves compatibility for omitted configuration. The provider already checks numeric type, finiteness, and enum membership. Unsupported values must not flow through the exact-selection path; absent selection continues to use the established provider/model metadata fallback.
- **Alternatives considered**: Treat an invalid value as the model's maximum (misrepresents it as a valid user choice); fail every request omitting the value (breaks compatibility); use schema maximum for all requests regardless of whether the configuration is present (substitutes a different value).
- **Evidence**: `src/provider.ts` `getSelectedContextSize` and `getRequestMaxInputTokens`; helper tests in `src/test/provider.test.ts` for rejected values, omitted metadata, schema maximum, and 1M model limits.

## Decision 4: Test the direct provider callback boundary with mocks

- **Decision**: Add focused callback-level tests in `src/test/provider.test.ts` using a fake Bedrock client. Assert that a non-maximum selection controls the effective budget passed to compaction and request construction, that a fitting history does not summarize, and that an over-limit conversation invokes compaction with the selected input allowance. Preserve focused helper/compactor tests for validation and safe failure.
- **Rationale**: Existing tests cover schema validation, budget helper arithmetic, and compactor behavior as separate units, but their combination through `provideLanguageModelChatResponse` is the acceptance contract. Mocking avoids AWS access and tests extension behavior without depending on VS Code implementation internals.
- **Alternatives considered**: Upstream VS Code UI tests (cannot be changed from this repository); real AWS integration tests (unnecessary spend and nondeterminism); test-only changes to the compactor (would not prove provider propagation).
- **Evidence**: `src/test/provider.test.ts` suites `per-model context size selection`, `modelConfiguration overrides in provideLanguageModelChatResponse`, and `compactMessageHistory`.

## Decision 5: Keep the harness boundary outside provider logic

- **Decision**: Define “local harness” as the acceptance-test precondition: invoke and validate the extension's direct `provideLanguageModelChatResponse` callback path. Do not add detection, branching, metadata, or claims about agent/Copilot harnesses.
- **Rationale**: The direct VS Code provider callback includes model configuration but no stable field identifying the local or agent-host harness. Different internal model identity/bridges may exist upstream; guessing from model IDs or initiator values would risk affecting out-of-scope requests.
- **Alternatives considered**: Detecting a harness from model ID, `requestInitiator`, or other transient fields (not established as a stable provider contract); changing model metadata to influence agent-host models (out of scope).
- **Evidence**: The extension's provider implementation receives model, request messages, request options, progress, and cancellation token. Upstream 1.146 contains distinct agent-host/Copilot paths; the direct provider API forwarding does not establish a universal harness marker.

## Decision 6: Document estimated-budget semantics, not exact tokenizer guarantees

- **Decision**: Keep user documentation focused on the request-selected total context size, output reservation, approximate local token estimation, compaction only when the estimate exceeds the effective input allowance, and the limits of that estimate. Add or adjust wording in `docs/TOKEN_LIMITS.md` only if current text does not accurately state these behaviors.
- **Rationale**: The feature's effective budget is enforced by local estimates; Bedrock remains authoritative and may reject a request despite preflight. Existing documentation already covers estimation and compaction and should not overpromise exact token accounting.
- **Alternatives considered**: Claiming exact tokenizer-limit enforcement (false); duplicating implementation details throughout the extension guide and integration guide (unnecessary).
- **Evidence**: `docs/TOKEN_LIMITS.md`, `src/provider.ts`, and `src/context-compactor.ts`.

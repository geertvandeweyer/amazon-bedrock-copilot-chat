# Feature Specification: Local Harness Context Size

**Feature Branch**: `002-local-harness-context-size`

**Created**: 2026-11-16

**Status**: Draft

**Input**: User description: "Based on the investigation above, implement use of the exact picked context size in the local harness. Other harnesses (agent/Copilot) are not relevant in this spec."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Honor the selected context size in the local harness (Priority: P1)

A user selects a context-size option for a model and starts or continues a conversation through the local harness. The extension treats that option as the selected total context window, then derives the request's effective input allowance by reserving the model's advertised output allowance and respecting its supported input limit. It does not substitute the model maximum or another default for a supported selection.

**Why this priority**: If the chosen limit is ignored, users cannot reliably control how much conversation context is retained or sent.

**Independent Test**: Configure a supported, non-maximum context-size option in the local harness and verify at the extension's `provideLanguageModelChatResponse` callback that its derived effective input allowance governs request budgeting and any history compaction. The callback test verifies request-option handling; it does not establish caller-harness identity.

**Acceptance Scenarios**:

1. **Given** a model has multiple supported context-size options and the user selects one below its maximum, **When** the local harness forwards the request configuration to the provider, **Then** the provider derives an effective input allowance from the selected total context by reserving output allowance and applying the supported input cap.
2. **Given** a supported selection has been forwarded, **When** the estimated conversation exceeds its derived input allowance, **Then** history compaction uses that same allowance rather than a larger fallback.
3. **Given** the estimated conversation fits within the derived input allowance, **When** the provider processes the request, **Then** it does not invoke summarization.

### User Story 2 - Preserve safe behavior when selection is absent (Priority: P2)

If the provider request does not contain a valid selected context-size value, the user can still chat using the existing no-selection fallback behavior. An invalid or unsupported value is not treated as an exact selection and does not silently become a different valid selection.

**Why this priority**: Compatibility with requests that omit model configuration should not prevent users from chatting, while invalid values must not masquerade as the user's selection.

**Independent Test**: Invoke the provider callback with omitted, unsupported, and malformed values; verify they do not enter the exact-selection path and use the established no-selection fallback, without claiming the supplied value was honored.

**Acceptance Scenarios**:

1. **Given** a provider request omits context-size configuration, **When** a chat request is processed, **Then** the extension uses its established no-selection fallback behavior.
2. **Given** a provider request contains a context-size value that is malformed or unsupported for the selected model, **When** the request is processed, **Then** the value is treated as no valid selection and the established fallback is used; the value is not reported or treated as an exact supported selection.

### Edge Cases

- The selected context size is the model's smallest or largest offered value.
- The selected value is present but malformed, zero, or outside the model's supported choices.
- The request omits configuration, requiring compatibility fallback behavior.
- A conversation is already within the selected limit, so compaction is unnecessary.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: For a provider request that includes a supported selected context-size value, the extension MUST treat it as the selected total context window and derive an effective input allowance by reserving the model's advertised output allowance and respecting its supported input limit.
- **FR-002**: The extension MUST use the same derived effective input allowance for the estimate-based decision to compact history, the compactor budget, and the request-local input limit.
- **FR-003**: The extension MUST NOT replace a present, supported selected value with the model's maximum or another default value.
- **FR-004**: When the estimated conversation fits within the derived effective input allowance, the extension MUST NOT invoke history summarization solely because a different default allowance would have been exceeded.
- **FR-005**: When the provider request omits a valid selected context-size value, the extension MUST retain its established no-selection fallback behavior.
- **FR-006**: The extension MUST accept a supplied value as a selection only when it is finite, numeric, and present in the selected model's supported context-size options. An omitted, malformed, or unsupported value MUST follow the established no-selection fallback and MUST NOT be represented as an honored selection.
- **FR-007**: The requirements concern context-size options forwarded by the local harness to the extension's provider callback. Acceptance tests MUST verify the callback contract without claiming to identify the caller's harness. The extension MUST NOT add harness-identity heuristics or change upstream sources; behavior of other harness paths is not specified here.

### Key Entities _(include if data involved)_

- **Model context-size selection**: The context limit chosen by the user for one model and supplied with a local harness request.
- **Selected total context window**: A supported per-model option supplied as `modelConfiguration.contextSize`.
- **Effective input-context allowance**: The request-local allowance derived from the selected total context after output reservation and supported input-limit constraints; it is used for estimation, compaction, and request construction.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: In every tested provider callback request with a supported selected value, the effective input allowance corresponds to that selected total context after output reservation and supported input-limit constraints.
- **SC-002**: Requests with different supported selections produce context budgets corresponding to their respective selections, with no substitution to the model maximum.
- **SC-003**: Requests whose estimated input fits the derived allowance trigger zero summarization calls; requests exceeding it evaluate compaction against that same allowance.
- **SC-004**: Requests omitting or supplying an invalid context-size value continue using the existing no-selection fallback behavior.
- **SC-005**: Automated acceptance coverage invokes the direct provider callback with request options representative of local-harness forwarding and makes no claim to identify the caller or characterize other harness paths.

## Assumptions

- The local harness can forward the selected per-model context-size value as provider request configuration when available. The callback itself does not identify the originating harness.
- Existing fallback behavior remains appropriate for requests that omit the selection; this feature does not change how a fallback is chosen.
- Context-size choices are model-specific; only finite numeric values supported by the selected model count as valid selections.
- The investigation of VS Code/Copilot source establishes the expected direct provider request forwarding path, but callback-level tests do not prove caller identity; no upstream implementation changes are in scope.

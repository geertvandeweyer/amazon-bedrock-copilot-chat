# Feature Specification: Model Picker Compatibility

**Feature Branch**: `001-model-picker-compatibility`

**Created**: 2026-11-15

**Status**: Draft

**Input**: User description: ": we need to update the extension to match vscode v146. Items not working anymore: the model picker does not show context size setting anymore; model metadata (cost, owner, warnings on data retention, etc.) are not shown anymore; Add Models → model list popup contains unformatted markdown and needs ordered, concise information, preferably with newlines between logical units; the per-model gear icon shows the context size setting, but it is not honored."

## Clarifications

### Session 2026-11-15

- Q: When a user changes a model’s context-size setting, what should that setting control during chat? → A: The selected value is the effective per-model maximum input context used for chat.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Configure and use a model context limit (Priority: P1)

A user chooses a Bedrock model in the chat model picker, sets its maximum context size, and starts a conversation. The selected limit is available in the picker and is respected when the model is used. If the conversation exceeds that limit, older turns are summarized while the current request and recent tool interactions are retained. The context-size control in the model-management list must also apply its setting to that model.

**Why this priority**: A missing or ignored context limit makes model configuration unreliable and can prevent users from using the intended amount of conversation context.

**Independent Test**: Set a context limit using each available model configuration control, start a conversation with that model, and verify the selected limit is displayed and honored.

**Acceptance Scenarios**:

1. **Given** a model that supports context-size configuration, **When** the user opens that model in the chat picker, **Then** the context-size setting is visible and can be changed.
2. **Given** the user changes the model's context size in the model-management list, **When** they use that model in chat, **Then** the selected context size is honored.
3. **Given** the user changes the context size in the chat picker, **When** they use that model in chat, **Then** the selected context size is honored.
4. **Given** a model does not support a configurable context size, **When** the user views its settings, **Then** no misleading editable context-size option is offered.

---

### User Story 2 - Review model information while choosing a model (Priority: P1)

A user compares available models and needs the model picker to show the model's relevant information, including cost, owner, and data-retention warnings when those details are available.

**Why this priority**: Users need accurate model information, especially cost and data handling, to make an informed choice before sending prompts.

**Independent Test**: Open the chat model picker for models with known metadata and confirm the relevant details are visible and associated with the correct model.

**Acceptance Scenarios**:

1. **Given** a model has cost, owner, or data-retention information, **When** the user views it in the chat model picker, **Then** available details are shown clearly and belong to that model.
2. **Given** one or more metadata values are unavailable, **When** the user views the model, **Then** missing values are omitted or described as unavailable without hiding the other available details.

---

### User Story 3 - Read model details in Add Models (Priority: P2)

A user opens Add Models and inspects a model's information. The model hover presents concise, readable details in a consistent order without raw markdown formatting.

**Why this priority**: Readable model information lets users compare and select models without interpreting formatting artifacts or an unstructured block of text.

**Independent Test**: Open model hovers for models with full and partial metadata; check stable ordering, absent-field handling, and absence of raw markup/entities. Newline layout is owned by VS Code.

**Acceptance Scenarios**:

1. **Given** a model has several details, **When** the user opens its Add Models model hover, **Then** available details appear in consistent field order without raw markdown syntax or encoded spacing entities. VS Code 1.146's name hover collapses line breaks to spaces; logical multi-line separation is not an extension-controlled acceptance condition.
2. **Given** some model details are unavailable, **When** the hover is shown, **Then** it omits those details and keeps the remaining information concise and readable.

---

### Edge Cases

- A model has only some of the expected metadata; the information that is available remains visible and correctly formatted.
- A model has no optional metadata; the picker and popup remain usable and do not show empty labels or malformed formatting.
- A model's configured context size is at its minimum, maximum, or another boundary supported by that model; the chosen value is applied without being silently replaced.
- A model's available context size differs from another model's; changing one model does not alter another model's setting.
- The chat model picker and model-management list show different controls; changes made through either supported control have a consistent effect when the model is used.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The extension MUST expose a context-size setting in the chat model picker for each model that supports context-size configuration.
- **FR-002**: The extension MUST use the selected value as that model's effective maximum input context during chat, regardless of whether the setting was changed in the chat model picker or the model-management list.
- **FR-003**: A change to one model's context size MUST NOT change the context-size setting of another model.
- **FR-004**: When a conversation exceeds the selected context size, the extension MUST summarize older complete turns, preserve the current user turn and most recent tool interaction, and stay within the selected input budget.
- **FR-005**: The extension MUST perform history summarization only when the estimated input exceeds the selected limit, use the selected Bedrock model for summaries, and avoid logging conversation text or summaries.
- **FR-006**: The chat model picker MUST show available model metadata, including cost, owner, and data-retention information, when supplied for the model.
- **FR-007**: The Add Models model hover MUST present available information in a consistent, concise order without requiring Markdown rendering.
- **FR-008**: The Add Models model hover MUST render information as readable text rather than displaying raw Markdown syntax or encoded spacing entities, while preserving the existing AWS USD cost strings in the full model table. Newlines in the provider tooltip are collapsed by the VS Code 1.146 name-hover implementation.
- **FR-009**: When information or a configurable context size is unavailable for a model, the extension MUST omit the unavailable detail or control without suppressing other available information.
- **FR-010**: The model picker and model information presentation MUST work in the targeted VS Code v1.146 experience without losing the described settings or metadata.
- **FR-011**: The extension MUST declare VS Code 1.146 as its minimum supported version.

### Key Entities _(include if data involved)_

- **Model**: A model available to the user, with its identity, supported capabilities, and optional descriptive metadata.
- **Model metadata**: Optional display information for a model, such as owner, cost, and data-retention warnings.
- **Context-size preference**: The user-selected maximum context size for an individual model, used when that model handles a conversation.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: In the targeted VS Code v1.146 experience, users can locate and change the context-size setting for every model that supports it in the chat model picker.
- **SC-002**: In all acceptance checks, the selected context-size value from either supported settings location is used as that model's effective maximum input context during chat, with no cross-model changes.
- **SC-007**: When conversation history exceeds the selected context size, a compacted request preserves the current user turn and latest tool interaction, and its estimated input stays within the selected limit; if compaction cannot preserve these, the request is rejected with actionable guidance.
- **SC-008**: When the conversation already fits the selected limit, no extra summarization request is made.
- **SC-003**: For models with available metadata, users can see the owner, cost, and data-retention information that is provided in the chat model picker.
- **SC-004**: In checks covering models with complete, partial, and absent metadata, the Add Models model hover displays no raw Markdown or encoded spacing artifacts and presents available details in the agreed consistent order. VS Code 1.146 determines line wrapping and collapses explicit newlines in the model-name hover.
- **SC-005**: Users can identify the key available metadata and context-size setting without interpreting malformed text or consulting a separate source.
- **SC-006**: The extension manifest and automated test setup both declare/use VS Code 1.146 as the minimum target, and validation completes without relying on a pre-1.146 runtime.

## Assumptions

- The selected model is also used for on-demand history summarization, which adds Bedrock inference only when history exceeds the selected input limit.
- When the selected context is exceeded, the extension summarizes older complete conversation turns, preserves the current request and the most recent tool interaction, and fails with a clear message if they still do not fit.
- The compatibility target and minimum supported VS Code version for this feature are 1.146.
- The extension remains responsible for presenting the model information and settings it receives; it is not expected to invent metadata that is unavailable from its existing sources.
- Context-size choices remain model-specific and should follow the model's supported range and existing user preference behavior.
- The Add Models model hover should favor concise information, grouping identity and ownership, data-retention warnings, pricing, and capabilities into readable units when those details are available. Line breaks are subject to VS Code's name-hover text handling.

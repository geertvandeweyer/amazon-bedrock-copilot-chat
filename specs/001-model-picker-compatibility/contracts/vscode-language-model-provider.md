# VS Code Language Model Provider Contract (Feature Scope)

This documents the extension-facing contract relevant to model metadata and per-request configuration. VS Code and Copilot Chat own the rendered UI; the extension supplies metadata and consumes request options.

## Model information provided to VS Code

For each selectable model, the provider supplies the existing `LanguageModelChatInformation` identity, capability, token-limit, and configuration fields. The feature may attach additional provider metadata only where supported by the targeted VS Code 1.146 consumer.

- `configurationSchema` describes optional per-model settings. Each property provides a valid default, supported values and labels, and an appropriate display group. It is preserved for models rendered directly from this provider. If a conversation uses the Copilot CLI/agent-host session target, VS Code 1.146 does not copy that schema into its BYOK model-info DTO, and its request DTO does not relay `contextSize`; that session target requires an upstream bridge change.
- `detail` supplies concise secondary text for the model row.
- `maxContextWindowTokens` supplies the full maximum context, including output tokens, to the VS Code 1.146 Details card.
- `statusIcon` is required for the Manage Models model-name hover to include provider `tooltip` text. Supply it for normal informational details as well as warnings.
- `tooltip` supplies a concise model description only for surfaces that render it as intended; the Manage Models name hover escapes it as plain text and replaces newlines with spaces. Logical line breaks there are controlled by VS Code, not this provider.
- Warning, information, owner, and cost values must use the metadata fields and types consumed by the corresponding 1.146 surface. Missing optional values are omitted.
- Any price shown as USD must be labeled as indicative AWS pricing, not Copilot credits or an AWS quote.
- Preserve the existing formatted AWS USD strings in `*Cost` metadata because the Add Models table renders them correctly. VS Code picker Details expects numeric Copilot credits and may display these values as Unknown; the extension must not relabel or convert them.

## Request configuration consumed by the provider

For a chat response, VS Code can supply resolved per-model configuration in `modelConfiguration`. For this feature:

- `contextSize` is an optional positive numeric selected total-context value from the model's offered choices.
- The provider uses the selected value as that model request's maximum context, reserving its maximum output-token allowance when deriving the available input budget.
- If estimated input exceeds the selected budget, the provider summarizes older turns through a separate Bedrock request using the selected model, preserves the current user turn and latest tool interaction, and stops with a clear error if the retained portion cannot fit. It does not log the transcript or persist the generated summary.
- A selected 1M value enables the model's required extended-context request option; a lower selection must not accidentally retain an enabled state for that request.
- If no valid selection is supplied, preserve the existing model/workspace default behavior.
- Values for a model request must not mutate another model's configuration.

## Compatibility and failure behavior

- The acceptance target and minimum supported version for this feature are VS Code 1.146; any use of proposed API fields must be verified against the generated declarations and actual target runtime.
- UI presentation is external to this provider contract: verify separately the chat picker card, compact picker row, and Add Models / Manage Models list.
- Missing metadata must not fail model discovery or prevent request use.
- Unsupported or invalid context configuration falls back to the existing safe model default rather than producing an out-of-range Bedrock request.

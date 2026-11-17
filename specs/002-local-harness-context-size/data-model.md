# Data Model: Local Harness Context Size

This feature introduces no persisted records or new external API fields. It defines how an existing VS Code provider request field is interpreted and used for one chat request.

## Per-model context-size selection

A user-selected configuration value associated with the selected provider model and chat request.

| Field                                             | Type                                                    | Meaning                                                   | Validation / behavior                                                                                                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `modelConfiguration.contextSize`                  | Unknown at API boundary; accepted form is finite number | Selected total context window for this request            | Considered a selection only if it appears in this model's advertised `configurationSchema.properties.contextSize.enum`. Unsupported or malformed values are not treated as the exact selection. |
| `configurationSchema.properties.contextSize.enum` | Numeric choices                                         | Supported context-window options advertised for the model | Per-model source of allowed selections. The selected value must equal one enumerated choice.                                                                                                    |

**Scope/lifecycle**: The selection is associated with one model and one request configuration. It does not mutate another model's selection, persisted workspace settings, or the provider's shared model metadata.

## Effective input-context limit

The request-local input allowance derived by the provider and passed consistently through preflight, compaction, and request construction.

| Field                     | Type                             | Meaning                                                               | Validation / behavior                                                                                                                                                                                                                  |
| ------------------------- | -------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `effectiveMaxInputTokens` | Non-negative integer token count | Maximum estimated input the provider will retain/send for the request | For a valid selected total context, reserve the model's output allowance and apply the model's supported Bedrock input limit. Reuse this exact value for the preflight decision, `compactMessageHistory`, and the request-local model. |
| `model.maxOutputTokens`   | Non-negative integer token count | Reserved response capacity for the selected model                     | Remains model-specific; selected total context is not itself the input allowance.                                                                                                                                                      |
| `estimatedInputTokens`    | Approximate integer token count  | Local estimate of converted system/messages                           | If at or below `effectiveMaxInputTokens`, do not invoke history compaction. If greater, attempt safe history compaction against the same budget; reject when safe compaction cannot fit.                                               |

### Relationships and request lifecycle

1. VS Code 1.146 direct chat obtains the selected model's current configuration and carries it with the chat request to the language-model provider callback.
2. The extension validates `contextSize` against the selected model's own schema.
3. A supported selection yields one effective input allowance after output reservation and model-limit constraints.
4. The provider uses the same allowance to decide whether compaction is needed and to budget compaction.
5. The provider sets that allowance on the request-local model used to construct/account for the Bedrock request. Shared model information remains unchanged.
6. Without a supported selection, the existing fallback applies; the request must not be described as honoring a selection that was absent or invalid.
7. This data flow documents the direct provider/local-harness acceptance path only; no agent/Copilot harness behavior is modeled or changed.

## Validation and safety rules

- A selection is supported only when it is numeric, finite, and exactly listed in that model's context-size enum.
- Output allowance is reserved when deriving the effective input allowance from a total context selection.
- Effective input allowance must not exceed the supported input allowance for the model/Bedrock route.
- Compaction is not called when the local estimate already fits.
- If the newest turn/tool interaction or resulting summary cannot fit safely, return an actionable error rather than silently dropping it or sending an over-budget request.
- Token estimates are approximations, not a guarantee of Bedrock's internal tokenizer or hidden prompt accounting.

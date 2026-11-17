# Data Model: Model Picker Compatibility

## Model

Represents one available Bedrock foundation model or inference profile surfaced to VS Code.

| Field             | Meaning                                                                        | Validation / behavior                                                                                                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`              | Stable identifier used to select and route a request                           | Unique within this provider; application profile identifiers remain distinct from base model identifiers.                                                                                                                                         |
| `name`            | Human-readable model name                                                      | Used in picker and management lists.                                                                                                                                                                                                              |
| `owner`           | Provider/owner label                                                           | Optional display metadata; omit when unavailable.                                                                                                                                                                                                 |
| `maxInputTokens`  | Advertised maximum input budget                                                | Non-negative model-specific value consistent with the selected context and reserved output.                                                                                                                                                       |
| `maxOutputTokens` | Maximum response-token budget                                                  | Model-specific; must remain within Bedrock model limits.                                                                                                                                                                                          |
| `capabilities`    | Supported features such as tools and image input                               | Optional capability details must not be presented as supported if unavailable.                                                                                                                                                                    |
| `metadata`        | Optional cost, retention warnings, features, route, or explanatory information | Display only information available for this model; use appropriate provider metadata fields per the VS Code 1.146 surface. Preserve formatted AWS USD cost strings in the Add Models table fields even though picker Details may display Unknown. |

## Model configuration

Represents a user's picker selection for one model and one request.

| Field             | Meaning                                           | Validation / behavior                                                                                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contextSize`     | Selected maximum total input-context window       | Positive supported choice from the model's configuration options; effective input budget must reserve that model's maximum output tokens. If the model requires a special extended-context opt-in, the corresponding request flag must agree with the selected choice. |
| `thinkingEffort`  | Optional model-specific reasoning/thinking effort | Existing model-defined enum; outside this feature except to preserve existing configuration behavior.                                                                                                                                                                  |
| `reasoningEffort` | Optional model-specific reasoning effort          | Existing model-defined enum; outside this feature except to preserve existing configuration behavior.                                                                                                                                                                  |

## Conversation summary

A temporary, request-local summary of older complete turns created only when the estimated input exceeds the selected context limit. It is included before retained recent turns, is not persisted, and is not logged.

### Relationships and lifecycle

- Each model has its own configuration schema and context choices.
- VS Code presents a schema-derived selection and supplies resolved per-model configuration with a chat request.
- A context choice overrides the extension's fallback context setting for that request; it does not mutate other models' settings or persist a new global choice through this feature.
- If a model lacks optional metadata, omit that item while retaining the rest of the model's usable information.

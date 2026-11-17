# VS Code and Copilot Chat Integration

This document describes how the Bedrock extension uses the VS Code language-model provider API and
how the advertised metadata is consumed by Copilot/VS Code UI. Upstream code is a read-only
integration dependency; this project changes its own provider metadata and request implementation,
not VS Code or Copilot Chat source.

## Version scope and evidence

- **Minimum supported VS Code version for the model-picker compatibility feature:** VS Code 1.146.0.
- **Installed local source checkout for UI investigation:** VS Code 1.146.0 at commit
  `69047191fc42` (tag `1.146.0`).

The VS Code 1.146.0 tag is the implementation and validation target for this feature. The local
source checkout's HEAD is 1.147.0, so source claims use `git show 1.146.0:<path>` rather than HEAD.
UI and cost-rendering details should be validated against the actual 1.146 runtime rather than
inferred from older bundled workbench source.

## Provider registration and data flow

```text
src/extension.ts
  vscode.lm.registerLanguageModelChatProvider("bedrock", provider)
       ↓
BedrockChatModelProvider.provideLanguageModelChatInformation()
  → prepareLanguageModelChatInformation()
      → foundation models selected from ListFoundationModels
      → regional/global inference-profile route chosen when available
      → active application profiles added
      → manually entered ID used as fallback after listing/access errors
       ↓
VS Code extension host
  → asks provider for LanguageModelChatInformation[]
  → maps supported model fields into the internal model metadata object
       ↓
VS Code / Copilot consumers
  → model rows, Details UI, context and cost displays
  → provideLanguageModelChatResponse() for each request
  → provideTokenCount() for token estimates
```

The extension's `PickerLanguageModelChatInformation` locally describes additional metadata not
present in the generated stable `vscode.d.ts` interface. Proposed/chat metadata is not a free-form
UI contract: only fields recognized and forwarded by the installed VS Code version reach its
consumer, and each UI surface decides how to parse or render them. For the model-picker
compatibility work targeting VS Code 1.146, see the [feature contract](../specs/001-model-picker-compatibility/contracts/vscode-language-model-provider.md)
and [validation guide](../specs/001-model-picker-compatibility/quickstart.md).

## Metadata fields and purpose

| Provider field                                           | Type/contract                                                  | Intended meaning                                                                                                                                                                                                                                                          |
| -------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `name`, `family`, `version`                        | strings                                                        | Provider-local model identity and display label. Direct models use the Bedrock model/profile ID; application profiles use their ARN.                                                                                                                                      |
| `maxInputTokens`, `maxOutputTokens`                      | numbers                                                        | Effective input budget and maximum output. The visible context total is generally input plus output.                                                                                                                                                                      |
| `capabilities`                                           | object of booleans                                             | Advertises tool calling and image input; the provider also adds `agentMode` in its picker-specific type. Request-time tool support is still gated separately.                                                                                                             |
| `configurationSchema`                                    | model configuration schema                                     | Adds per-model context, thinking-effort, or reasoning-effort controls when the model profile supports them. Values return to the provider as per-request model configuration.                                                                                             |
| `detail`                                                 | string                                                         | Short secondary model-row description. The provider currently combines context size, output size, indicative input/output rates, thinking mode, and vision where those values are available.                                                                              |
| `tooltip`                                                | string                                                         | The expanded Model Details card renders this as Markdown. Manage Models/Add Models includes escaped tooltip text in the model-name hover only when `statusIcon` is also supplied, so section syntax appears literally there.                                              |
| `warningText`                                            | `Record<string, string>`                                       | Category-keyed warning text rendered as Markdown warning banners in the expanded card and compact hover. The provider uses it for temperature deprecation and the Claude Fable 5 data-retention warning.                                                                  |
| `infoText`                                               | `Record<string, string>`                                       | Category-keyed informational Markdown banners rendered by the expanded card and compact hover. The provider uses it to explain that model context-size controls are supported only in the local Copilot harness.                                                          |
| `statusIcon`                                             | `vscode.ThemeIcon`                                             | Status icon shown with the model name in Manage Models. It gates inclusion of `tooltip` in that surface's name hover. The provider supplies `info` for regular models and `warning` for models with provider warnings, so tooltip details are available consistently.     |
| `pricing`                                                | string                                                         | Plain pricing fallback used by cost hovers when numeric `*Cost` values are absent. Newlines separate table rows; the 1.146 Add Models table places the text in the first cost cell and shows its full value in that cell's hover when numeric `*Cost` metadata is absent. |
| `inputCost`, `outputCost`, `cacheCost`, `cacheWriteCost` | Formatted AWS USD strings currently supplied by this extension | The 1.146 Add Models table renders these strings correctly. Picker Details expects numeric Copilot-credit values and may show the strings as Unknown. Preserve the strings for the table; do not convert or label them as Copilot credits.                                |

Prices are sourced from the bundled models.dev cache and formatted as USD. Full catalogue context
and caveats are in [MODELS.md](./MODELS.md). The AWS USD strings in `*Cost` are intentionally
preserved for the Add Models table; picker Details may display Unknown because that surface expects
numeric Copilot credits. This extension does not represent AWS USD as Copilot credits.

## UI surfaces are distinct

### Manage Models / Add Models table — VS Code 1.146 source observation

In the inspected 1.146 implementation (`chatModelsWidget.ts`), verified against the local source checkout (not an interactive model-provider session):

- The model-name column displays a status icon if supplied. Its name hover includes the provider
  `tooltip` only when both `statusIcon` and `tooltip` exist. The extension now supplies a status icon
  for regular as well as warned models, so both classes receive details. Provider text is escaped
  before being appended to the hover's Markdown string, so Markdown syntax is shown literally there.
  VS Code replaces newlines in escaped model text with spaces, so line boundaries are not preserved
  in this particular name hover. The provider formats detail sections compactly and in a stable order;
  preserving separate lines here would require an upstream VS Code change.
- The Context Size and Capabilities columns are structured by VS Code from the token-limit and
  capability fields; the provider's tooltip does not control their contents. `maxContextWindowTokens`
  gives the expanded model card the maximum supported context (including output). For optional
  extended context, this represents the extended maximum even when the active workspace default
  is standard. The per-model `Context Size` control is emitted only when more than one supported
  choice exists; choices are ascending, scoped per model, and enforced against the request input budget.
- The combined cost column displays supplied `*Cost` values directly in input/output/cache cells,
  and the Details/hover/ARIA labels interpret these values as Copilot credits. The extension
  intentionally preserves its existing formatted AWS USD strings in these fields because the Add
  Models table displays them correctly; picker Details may show them as Unknown. Do not relabel them
  as Copilot credits. `pricing` is the separate plain-text fallback when no `*Cost` fields are set.
- Context and capabilities are rendered by their own columns; they do not come from `tooltip`.

In 1.146, numeric `*Cost` metadata is interpreted as Copilot credits per million tokens throughout
the model details and hovers. The extension intentionally preserves formatted USD strings in these
fields for the Add Models table; picker Details may render those non-numeric strings as Unknown. When
`*Cost` fields are absent, `pricing` is rendered as plain text in the first cost cell and in the hover.

### New model picker row and Details page — 1.146 source observation

In the inspected 1.146 source and the user's live VS Code session:

- The model row's `detail` is the secondary row text. `createModelAction()` starts from metadata
  `detail` and can add promo or multiplier-pricing descriptions. The row's action tooltip is
  separately composed from the row label, configuration summary, default-model information, and
  routing descriptions. It is not the provider metadata `tooltip`.
- For models supplied directly by this extension, the expanded `ModelCard` uses the provider's
  `configurationSchema`. Copilot CLI agent-host sessions can instead select a separate copy of the
  same Bedrock model. In VS Code 1.146 the renderer BYOK bridge's `IByokLmModelInfo` projection
  carries context maxima and reasoning values, but not the provider's `configurationSchema` or
  context-size options. The Copilot agent host builds a replacement schema from those reduced fields
  (currently only reasoning effort), and its BYOK request DTO does not carry a selected context size
  back to the Bedrock provider. The Details card for that selected copy therefore receives no context schema and falls back to
  static Max context even though the direct `bedrock` provider metadata contains a valid selector
  schema. The installed renderer log confirms the actual selected model identity is
  `agent-host-copilotcli:bedrock/global.openai.gpt-6-luna`; the `bedrock/...` model remains in the
  general model list but is not the selected model for that Copilot CLI-backed conversation. This
  is a VS Code/Copilot-owned bridge limitation, not an extension schema problem.
- The expanded `ModelCard` renders the metadata `tooltip` via a Markdown renderer, then warning and
  info banners, configuration controls, context, and cost UI.
- `warningText` and `infoText` values are rendered through a Markdown message-banner helper.
- Harness selection is owned by the active Copilot session, not exposed to this extension through
  the language-model provider request or discovery API. The extension cannot reliably detect
  whether a given chat is using the local harness. It therefore shows an informational context
  compatibility notice on all Bedrock models rather than incorrectly claiming to detect non-local
  sessions. In VS Code 1.146, the agent-host BYOK projection does not forward provider `infoText`,
  so the notice is available on the direct model card and Add Models hover, but cannot be guaranteed
  on the agent-host mirror's picker hover without an upstream bridge change.
- The compact `getModelHoverContent()` has different behavior: cost may take precedence and
  suppress its `tooltip` description. In the inspected 1.146 source it is reused by chat-session
  picker options; do not conflate it with the expanded model Details card. Picker Details formats
  numeric cost values as Copilot credits and renders missing/non-numeric string values as Unknown.

### VS Code 1.146 model Details and configuration behavior

- The expanded model Details card uses `maxContextWindowTokens` for its Max context display. The
  provider advertises the maximum supported window; when a workspace preference currently selects a
  lower optional-context setting, the Details page still reports the maximum window.
- The expanded model Details card renders `tooltip`, `warningText`, and `infoText` as Markdown. Keep
  these fields concise and use blank lines to separate sections.
- The card exposes configuration controls only for schema properties with at least two enum values
  and a recognized group (`navigation` or `tokens`). A `contextSize` schema property in the `tokens`
  group is presented as the context control and model configuration selections are retained by
  model identifier. The provider supplies choices in ascending context order, including the standard
  and maximum windows and applicable local caps. The schema default matches the context limit
  advertised by the model information for that discovery pass.
- Defaults in the configuration schema populate the control before a user override exists. The
  current provider consumes the resulting `modelConfiguration` on each request.
- The compact model hover renders warning and information values as Markdown banners. It may show
  cost instead of `tooltip`, so the expanded Details card is the surface for the full description.
- In the Copilot CLI session, the selected model identity may be
  `agent-host-copilotcli:bedrock/<model-id>` rather than `bedrock/<model-id>`. The VS Code 1.146
  agent-host BYOK model projection currently omits the direct model's context-size choices, so its
  Details card shows static Max context. This requires an upstream bridge enhancement to expose and
  route context choices; changing the extension's direct provider schema alone cannot change that
  agent-host-owned model copy.

## Compatibility notes

- The generated VS Code declaration file includes `configurationSchema` and request
  `modelConfiguration`; the context picker does not depend on additional undeclared fields.
- `src/vscode.d.ts` contains the stable provider shape; this extension's proposed picker metadata is
  locally typed and must match the fields forwarded by VS Code 1.146.
- The extension emits `LanguageModelThinkingPart` and usage `LanguageModelDataPart` dynamically.
  Retain runtime guards around these constructors when changing related behavior.
- The manifest's `engines.vscode` range is the supported-version declaration. Keep automated and
  manual validation aligned with the declared minimum.

## Scope boundary

The extension can change the values it returns (`detail`, `tooltip`, `warningText`, `infoText`,
`pricing`, numeric cost values, capabilities, and configuration schema) and the request/response
logic. It cannot change the layout, Markdown escaping, row subtitle rules, cost labels, or metadata
propagation in upstream VS Code/Copilot. If a surface does not render the desired metadata, use a
field that the 1.146 consumer handles, adjust extension-owned text, or document the limitation; do
not assume an upstream UI modification.

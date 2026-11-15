# VS Code and Copilot Chat Integration

This document describes how the Bedrock extension uses the VS Code language-model provider API and
how the advertised metadata is consumed by Copilot/VS Code UI. Upstream code is a read-only
integration dependency; this project changes its own provider metadata and request implementation,
not VS Code or Copilot Chat source.

## Version scope and evidence

- **User-confirmed functional baseline:** VS Code 1.142.0.
- **Extension manifest range:** `engines.vscode` is currently `^1.134.0`.
- **Installed local source checkout for UI investigation:** VS Code 1.146.0 at commit
  `776b518e720`.

The 1.146 source checkout and installed 1.142 runtime are not interchangeable evidence. Notes
about new model cards, metadata or hover behavior found only in 1.146 must not be treated as
available in 1.142 without checking the runtime/source for that version. In VS Code 1.142's bundled
workbench source, targeted searches confirm `warningText`, `infoText`, and tooltip/model metadata
consumers exist. Detailed comparisons of exact card layout and cost-rendering behavior remain
intentionally shallow and need a version-specific review if they become implementation-critical.

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
consumer, and each UI surface decides how to parse or render them.

## Metadata fields and purpose

| Provider field                                           | Type/contract                                                       | Intended meaning                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`, `name`, `family`, `version`                        | strings                                                             | Provider-local model identity and display label. Direct models use the Bedrock model/profile ID; application profiles use their ARN.                                                                                                                                                                   |
| `maxInputTokens`, `maxOutputTokens`                      | numbers                                                             | Effective input budget and maximum output. The visible context total is generally input plus output.                                                                                                                                                                                                   |
| `capabilities`                                           | object of booleans                                                  | Advertises tool calling and image input; the provider also adds `agentMode` in its picker-specific type. Request-time tool support is still gated separately.                                                                                                                                          |
| `configurationSchema`                                    | model configuration schema                                          | Adds per-model context, thinking-effort, or reasoning-effort controls when the model profile supports them. Values return to the provider as per-request model configuration.                                                                                                                          |
| `detail`                                                 | string                                                              | Short secondary model-row description. The provider currently combines context size, output size, indicative input/output rates, thinking mode, and vision where those values are available.                                                                                                           |
| `tooltip`                                                | string                                                              | Model description. Its rendering depends on the VS Code surface/version. The current provider formats multiple sections in Markdown; in the Manage Models name hover, a status icon gates the extra status line and VS Code 1.146 escapes provider text rather than rendering its Markdown.            |
| `warningText`                                            | `Record<string, string>`                                            | Category-keyed warning text. Newer model picker surfaces render values as warning Markdown banners. Current extension uses it for temperature deprecation and Claude Fable 5 retention notice.                                                                                                         |
| `infoText`                                               | `Record<string, string>`                                            | Category-keyed informational Markdown text. This metadata is present in the inspected 1.146 UI, but **the current provider does not set `infoText`**, and it has not been established as a usable 1.142 Details-card field.                                                                            |
| `statusIcon`                                             | `vscode.ThemeIcon`                                                  | Warning icon for the retention-warning model-list entries. Current extension only returns this for matching Claude Fable 5 IDs.                                                                                                                                                                        |
| `pricing`                                                | string                                                              | Formatted pricing description used by cost displays as a fallback. Current provider sets it when bundled input and output prices are both known.                                                                                                                                                       |
| `inputCost`, `outputCost`, `cacheCost`, `cacheWriteCost` | Internal VS Code contract: numbers in Copilot credits per 1M tokens | Current provider widens these fields to strings containing USD prices. Some tables insert those strings into cell text, but cost hovers/cards may still label or format them as credits. This is a known semantic/type mismatch. Do not represent these values as actual AWS bills or Copilot credits. |

Prices are sourced from the bundled models.dev cache and formatted as USD. Full catalogue context
and caveats are in [MODELS.md](./MODELS.md).

## UI surfaces are distinct

### Manage Models / Add Models table — VS Code 1.146 source observation

In the inspected 1.146 implementation (`chatModelsWidget.ts`):

- The model-name column displays a status icon if supplied. Its name hover includes the provider
  `tooltip` only when both `statusIcon` and `tooltip` exist. Provider text is escaped before being
  appended to the hover's Markdown string, so Markdown in `tooltip` is shown literally there.
- The combined cost column uses numeric `*Cost` fields when any are present, puts them into
  separate input/output/cache cells, and describes them as credits in the cell hover. If no numeric
  cost is supplied, it places the `pricing` string in the first cell and shows its full string in
  that cell's hover.
- Context and capabilities are rendered by their own columns; they do not come from `tooltip`.

This behavior is from the 1.146 source snapshot. It has not been verified line-by-line against
1.142, so consider its exact formatting an unchecked compatibility detail for that baseline.

### New model picker row and Details page — 1.146 source observation

In the inspected 1.146 source:

- The model row's `detail` is the secondary row text. `createModelAction()` starts from metadata
  `detail` and can add promo or multiplier-pricing descriptions. The row's action tooltip is
  separately composed from the row label, configuration summary, default-model information, and
  routing descriptions. It is not the provider metadata `tooltip`.
- The expanded `ModelCard` renders the metadata `tooltip` via a Markdown renderer, then warning and
  info banners, configuration controls, context, and cost UI.
- `warningText` and `infoText` values are rendered through a Markdown message-banner helper.
- The compact `getModelHoverContent()` has different behavior: cost may take precedence and
  suppress its `tooltip` description. In the inspected 1.146 source it is reused by chat-session
  picker options; do not conflate it with the expanded model Details card.

A 1.142 UI comparison was not completed. Before relying on 1.146-specific metadata fields or card
behavior in the 1.142 functional baseline, inspect the 1.142 bundle or test the actual UI.

## Compatibility notes: possible 1.142 / 1.146 differences

These are verification flags, not claims that the extension is broken in 1.142:

1. The generated project `vscode.d.ts` contains the stable `LanguageModelChatInformation` fields,
   while the provider locally widens its type for picker metadata. Runtime support can differ from
   TypeScript declarations; verify which proposed `chatProvider` fields are forwarded by VS Code
   1.142 before relying on them.
2. `infoText` and `warningText` have consumers in the inspected 1.146 source and are also visible in
   targeted searches of the 1.142 bundled workbench. Exact rendering, provider-to-internal mapping,
   and position in the Details UI have not been compared between releases.
3. The 1.146 source escapes provider tooltip text in the Manage Models name hover. The 1.142 bundle
   inspection confirms a name hover that includes `tooltip` when `statusIcon` exists, but its exact
   escaping behavior was not fully audited.
4. The extension emits `LanguageModelThinkingPart` and usage `LanguageModelDataPart` dynamically and
   fails/falls back when those constructors are unavailable. Confirm runtime support when changing
   the minimum VS Code version or the thinking/usage UX.
5. The extension manifest currently permits VS Code 1.134 despite the user-confirmed functional
   baseline being 1.142. The declared minimum and tested minimum are therefore inconsistent.

For behavior-critical changes, prefer a small, version-targeted manual test in VS Code 1.142 and
1.146 over inferring support from current upstream source alone.

## Scope boundary

The extension can change the values it returns (`detail`, `tooltip`, `warningText`, `infoText`,
`pricing`, costs, capabilities, and configuration schema) and the request/response logic. It cannot
change the layout, Markdown escaping, row subtitle rules, cost labels, or metadata propagation in
upstream VS Code/Copilot. If a surface doesn't render the desired metadata, use a field that the
supported version consumes, adjust extension-owned text, or document the limitation; do not assume
an upstream UI modification.

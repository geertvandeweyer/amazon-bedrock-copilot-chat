# Model picker pricing path (VS Code 1.146)

## Summary

VS Code labels the numeric cost fields (`inputCost`, `outputCost`, `cacheCost`, `cacheWriteCost`) as **credits per 1M tokens**. There is no currency field. This extension therefore sends **no numeric cost fields** and shows AWS USD prices through string fields only:

| Field                                       | Value                                                                   | Where it appears                                                        |
| ------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `pricing`                                   | `In: $X / Out: $Y\nPricing may vary based on AWS Region`                | Manage Models cost column (first cell only, cropped) and its cell hover |
| `detail`                                    | `$X in / $Y out`                                                        | Model picker row                                                        |
| `tooltip`                                   | Route, model ID, context, USD price lines, region note, thinking/vision | Model picker hover                                                      |
| `isBYOK`                                    | `true`                                                                  | Classification only                                                     |
| `statusIcon` + `warningText.data_retention` | Claude Fable 5.x only                                                   | Warning icon and banner                                                 |

Source: `getPickerPricingMetadata()`, `formatDetail()`, `formatTooltip()` and `getModelDataRetentionWarning()` in `src/provider.ts`. Prices come from `src/models-dev-cache.json` (USD per 1M tokens, indicative).

## Data flow

```text
src/extension.ts: registerLanguageModelChatProvider("bedrock", provider)
  → provideLanguageModelChatInformation() builds entries (foundation, app profile, manual)
  → ExtHostLanguageModels copies the fields into ILanguageModelChatMetadata (no validation)
  → Manage Models widget (chatModelsWidget.ts) and model picker (modelPicker*.ts) render them
```

The proposed/undocumented fields (`pricing`, `isBYOK`, `warningText`, `statusIcon`, the cost fields) are not in the public `vscode.d.ts`. Our `PickerLanguageModelChatInformation` adds them locally; the runtime object carries them through unchanged.

## Manage Models cost column (verified in the VS Code 1.146 bundle and `main`)

The column is the `combinedCost` renderer.

- Markup: `.model-cost-grid` with four `span.model-cost-cell` children (In / Out / Cache Read / Cache Write).
- CSS: `grid-template-columns: 1fr 1fr 1fr 1fr; overflow: hidden`. Each cell is `white-space: nowrap; text-overflow: ellipsis`.
- `renderModelElement`:
  - If any numeric cost field is defined, each value goes into its own cell through a localized `"In: {0}"`-style format, and the hover lists them as "credits per 1M tokens".
  - Otherwise `metadata.pricing` is written into the **first cell only** (`inputCell.textContent = pricing`). The other three cells stay empty. The cell hover shows the full string.
- The header is "Cost (Credits per 1M Tokens)" or "Pricing" depending on the `isUBB` entitlement.

Conclusions:

- No API exists to render custom strings into the Out / Cache cells, to span or merge cells, or to widen the column. The `pricing` string occupies one quarter of the column, so it is cropped; the full text is in the cell hover.
- Because it is set via `textContent` in a `nowrap` cell, the second line (region note) is visible only in the hover.

## Hover behaviour

- Manage Models name hover: when a model has `statusIcon`, VS Code prints the entire `tooltip`. Fable entries therefore use a tooltip containing only the short retention warning. Full wording lives in `docs/MODELS.md`.
- Model picker hover: shows `pricing` when present (gated by `isUBB` and `isBYOK`), otherwise `tooltip`.
- `warningText.data_retention` renders as a banner; keep it short.

## Option not implemented: strings in numeric fields

Passing preformatted strings (for example `"$10"`) in the four numeric fields would make the Manage Models grid show `In: $10`, `Out: $50`, `Cache Read: $1`, `Cache Write: $12.5`, because the renderer only interpolates the value into the label. Downsides:

- The cell hover still says "credits per 1M tokens".
- The new model picker formats these as numbers and would show "Unknown" or `NaN`.
- It violates the `number` type contract; any VS Code version that does arithmetic or number formatting on them would break.

## Formatting rules in our code

- `formatUsdRate()` already includes the `$`; callers must not prepend another one (tests assert no `$$`).
- `getPickerPricingMetadata()` returns `{}` unless both `cost.input` and `cost.output` exist.

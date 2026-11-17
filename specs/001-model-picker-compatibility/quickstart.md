# Quickstart: Validate Model Picker Compatibility

## Prerequisites

- Bun dependencies are installed (`bun install`).
- VS Code 1.146 is the new minimum supported version and is available in the local test setup.
- For UI checks, the extension is installed/launched in a profile with at least one accessible Bedrock model. No real AWS operation is required for the automated unit tests.

## Focused automated checks

1. Run focused provider tests, including context-schema construction, request context override, metadata formatting, and optional/missing metadata cases:

   ```sh
   bun run test -- --grep "contextSize|context size|picker|metadata|tooltip|retention"
   ```

2. Check types and formatting/lint for implementation changes:

   ```sh
   bun run check-types
   bun run lint -- src/provider.ts src/context-compactor.ts src/bedrock-client.ts src/test/provider.test.ts
   bunx prettier --check src/provider.ts src/context-compactor.ts src/bedrock-client.ts src/test/provider.test.ts
   ```

   Use the repository-supported scripts and selectors available in the current package manager version; run `bun run test` if the VS Code test CLI does not accept the focused grep argument.

## VS Code 1.146 manual checks

1. Launch the extension in a clean VS Code 1.146 profile and open the chat model picker.
2. Identify the exact model identity shown in logs. A direct provider model is registered as `bedrock/<model-id>`; a Copilot CLI mirror appears as `agent-host-copilotcli:bedrock/<model-id>`.
3. For a direct provider model, select a model exposing a configurable context size. Confirm the control appears, change it, submit a chat request, and verify the provider uses the selected input budget while reserving the model output limit.
4. If the Chat conversation uses the Copilot CLI/agent-host session target, its model may have the identity `agent-host-copilotcli:bedrock/<model-id>`. VS Code 1.146 does not project the direct model's context schema into that copy or relay a selection through its BYOK request DTO. A UI-only selector would not affect requests. Record this as an upstream blocker; do not treat the static Max context label as a working selector. This is separate from testing a regular local Chat session's direct `bedrock/<model-id>` entry.
5. Repeat using the per-model gear/settings control in Add Models / Manage Models. Confirm the selected value affects requests for that model and leaves other models unchanged.
6. With a history larger than the selected input budget, verify a compact summary request is made, the latest user turn/tool interaction are kept, and the resulting request fits the selected budget. With history under the limit, verify there is no extra summary request.
7. Verify that requests which cannot be compacted safely fail with actionable guidance and do not send an oversized request.
8. Inspect model details for models with available owner, cost, and retention metadata. Confirm the chat picker presents available information clearly; test both models with and without a status warning.
9. If context choices are missing from a direct `bedrock/<model-id>` card, set the Amazon Bedrock Models log channel to Trace, reopen the picker to trigger model discovery, and inspect the `[Bedrock Model Provider] Returning context-size configuration schemas` records. Verify the target model includes `contextSize` with `group: "tokens"` and at least two numeric enum choices. If it does, the remaining fault is downstream of the provider callback and must be diagnosed at the running VS Code model metadata/card boundary.
10. Inspect the Add Models model-name hover. Confirm ordered, concise text with no literal Markdown or encoded spacing entities, and confirm unavailable details are omitted without hiding other details. VS Code 1.146 collapses provider tooltip line breaks in this hover; check field ordering, not separate rendered lines.
11. Verify the full Add Models table continues to display existing formatted AWS dollar cost strings. Picker Details may show Unknown because it expects numeric Copilot-credit values; do not present the USD strings as Copilot credits.

## Expected outcome

The model picker exposes supported per-model context settings and relevant metadata; both supported configuration controls produce the same effective model-specific request context. Model metadata in the Add Models/Manage Models surface is concise and readable, and missing fields do not break model discovery or request use. Visual confirmation requires accessible Bedrock models. Existing formatted USD strings remain in Add Models table cells; the picker Details view may show Unknown for these non-numeric values.

Refer to [the provider contract](./contracts/vscode-language-model-provider.md) and [the data model](./data-model.md) for validation semantics.

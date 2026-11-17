# Quickstart: Validate Local Harness Context Size

## Prerequisites

- Bun dependencies are installed (`bun install`).
- Run the checks from the extension repository root.
- Automated tests use mocks; no AWS credentials or real Bedrock call is required.
- For optional manual verification, use VS Code 1.146 or newer and a model whose provider schema offers multiple `contextSize` choices. Callback-level tests verify the provider's handling of forwarded request options; they do not establish which harness invoked it.

## Focused automated validation

1. Run the focused provider callback tests using the VS Code test runner's Mocha grep option:

   ```sh
   bun run test -- --grep "per-model context size selection"
   ```

2. Run static checks for TypeScript changes:

   ```sh
   bun run check-types
   bun run lint -- src/provider.ts src/test/provider.test.ts
   bunx prettier --check src/provider.ts src/test/provider.test.ts docs/TOKEN_LIMITS.md
   ```

3. Verify the callback-level tests demonstrate all of the following:
   - A valid non-maximum selected total context option reaches the provider as `modelConfiguration.contextSize`; after output reservation and supported input-limit constraints, its derived effective input allowance is reused for compaction and the outgoing request.
   - Different valid selections produce different effective input limits after output reservation, without mutating the shared model metadata.
   - A request whose estimated content fits the selected input allowance triggers no summarization call, even if it would exceed another larger/default comparison limit in the test fixture.
   - An over-limit request attempts compaction with the selected input allowance and preserves the latest user/tool interaction or fails safely.
   - Omitted, malformed, or unsupported configuration does not enter the exact-selection path and follows the established no-selection fallback without being represented as honored.

## Optional local UI / manual smoke test

1. Open the extension in VS Code and select a direct Amazon Bedrock provider model with more than one context-size option.
2. Select a non-maximum option in the per-model context configuration.
3. Send a short request that is expected to fit. Inspect the Amazon Bedrock provider trace/debug logs to confirm the selected configuration and effective input limit; confirm no compaction/summarization event is emitted.
4. Continue with enough earlier conversation to exceed the selected input budget. Confirm compaction or safe rejection follows that selected limit, and that the latest turn/tool interaction is retained when compaction succeeds.
5. Change the selected value and repeat; confirm the per-request limit changes accordingly and the model's shared advertised information does not.
6. Do not use callback tests or this smoke check to infer caller identity or behavior in agent/Copilot harnesses. Those harness paths are outside the feature's requirements.

## Expected outcome

The direct provider callback treats a supported selection as a total context window, then consistently uses the derived output-reserved, model-capped input allowance for the local estimate, compaction, and outgoing request. Omitted or invalid configuration retains the existing no-selection fallback and is not represented as an honored selection. Automated tests use mocks and make no claim about caller-harness identity; no real AWS call is needed.

See [the data model](./data-model.md) for selection validation, budget derivation, lifecycle, and safety rules; see [the research record](./research.md) for the upstream request-path evidence and decisions.

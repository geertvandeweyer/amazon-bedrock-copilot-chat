# Token Limits and Context Management

This document describes the current extension behavior, not automatic context management supplied by
Copilot. The model-picker compatibility feature targets VS Code 1.146.0 and updates the extension's
minimum supported version to `^1.146.0`.

## What the provider advertises

For each model entry, the provider supplies `maxInputTokens` and `maxOutputTokens`. These values come
from the bundled models.dev registry where valid data exists, with hardcoded model-profile limits as
a fallback. The advertised total context is the input allowance plus the output allowance; the input
allowance is calculated as context window minus maximum output, reserving output space.

For models where 1M context is optional and requires a Bedrock beta header, the workspace setting
`bedrock.context1M.enabled` controls whether the provider advertises the extended window or caps it at
200K. Models whose 1M limit is the default use their live/registry limit directly. The model picker
can expose a per-request Context Size selection. It also exposes local prompt-budget choices of 256K
and 750K when those are smaller than the model's total context and larger than its output allowance.

When a per-request context size is selected, the provider passes the choice as model configuration.
For each supported choice, it computes the effective input budget from the selected total context,
reserves that model's output limit, and does not exceed the model's supported Bedrock input limit.
Selecting a context above the standard window enables the model's required extended-context header;
a lower selection disables that opt-in for the request. A per-request choice takes precedence over
the workspace 1M setting.

## Token counting in VS Code / Copilot Chat

The provider implements `provideTokenCount`, which Copilot may call while constructing a request.
The current implementation returns a local estimate; it does not issue the Bedrock `CountTokens`
API call. At request time, the provider estimates converted Bedrock messages and system content
against the selected model input budget. If the estimate exceeds that budget, older turns are
summarized in a separate Bedrock request; the current turn and most recent complete tool interaction
are retained where they fit. Summarization is skipped when history is already within the limit.

- Text and serialized tool-call/tool-result content use a character-count estimate of roughly
  characters divided by four, adjusted by a model multiplier.
- The implementation currently applies approximate multipliers for Sonnet (1.3), Opus (1.1),
  GPT-5 (0.95), and Haiku/unknown models (1.0).
- PNG, JPEG, GIF, and WebP image data is estimated separately. For Claude, pixel dimensions are
  used when available; otherwise encoded size is used as a fallback. Other models use the encoded
  size estimate.
- Unsupported/metadata parts are not necessarily counted as visible text. The estimates are
  approximations and can differ from model tokenization, hidden prompt content, image processing,
  and Bedrock's accounting.

This estimate is a response to Copilot's token-count request. It is **not** an exact preflight check:
model tokenization, hidden prompts, and Bedrock accounting can differ, and Bedrock may still reject a
request that exceeds the selected model's effective limits.

## Context pruning and retries

The extension cannot ask Copilot Chat to modify its history, but it can compact the converted request
before sending it to Bedrock. If the estimate exceeds the selected budget, the provider summarizes
older turns; it does not silently truncate them. The current turn and latest tool interaction are
preserved where possible. If the latest turn/tool exchange cannot fit or the summary cannot be
reduced safely, the provider returns actionable guidance without sending an oversized request.

A separate one-time retry exists for a recognized **unknown/unsupported request parameter**. It
removes the named request field and retries the Bedrock stream once, with a warning part. It does not
retry token/context overflow.

## Output tokens and reasoning budget

`maxTokens` in the Bedrock request is bounded by the smaller of the request's `max_tokens` model
option and the model's advertised `maxOutputTokens`. When Copilot omits `max_tokens`, the provider
uses the model's advertised output limit.

The provider calculates an internal thinking budget for supported models: a base target of 16,000
tokens, capped at 25% of the model output limit and constrained by the request's output-token budget.
It reserves at least 25% of request `max_tokens` (minimum 100 tokens) for visible output. Thinking is
enabled only where the model profile supports it and the computed budget reaches 1,024 tokens.

Although `bedrock.thinking.budgetTokens` and Copilot's
`github.copilot.chat.anthropic.thinking.maxTokens` are read into settings, the current
`calculateThinkingConfig` implementation does not use either value in its calculation. The setting
and its manifest description therefore do not currently control the actual budget. This is a known
configuration mismatch.

Reasoning/thinking tokens consume Bedrock output limits even when not emitted as visible text. If a
stream ends with `max_tokens` before any visible answer is produced, the extension reports an error
explaining that internal reasoning may have consumed the output budget. Where the installed VS Code
API accepts thinking parts, reasoning is emitted as a thinking part; otherwise, a visible fallback
message is emitted for a normal end-of-turn thinking-only response.

## User troubleshooting

When requests exceed context or output limits:

1. Start a new chat or shorten the latest conversation turn if it cannot fit in the selected context.
2. Remove unnecessary tool output or reduce the number/size of tool results.
3. Choose a larger Context Size if the picker offers one; smaller choices enforce a tighter request
   budget and may require more history compaction.
4. Reduce the request output limit if Copilot exposes a `max_tokens` control.
5. For reasoning-heavy tasks, select a model/effort appropriate to the task and available output
   budget.
6. If the error persists, check the **Amazon Bedrock Models** output channel and verify the model's
   current AWS context and output limits.

The provider summarizes older conversation turns when the estimated history exceeds the selected model input limit. It does not retry oversized requests after Bedrock rejects them.

# Token Limits and Context Management

This document describes the current extension behavior, not automatic context management supplied by
Copilot. The user-confirmed functional baseline is VS Code 1.142.0; the extension manifest currently
allows VS Code 1.134 and newer.

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
For non-1M context selections, the provider reduces the local `maxInputTokens` budget for that
request. When a 1M option is selected for a model requiring an opt-in header, it enables or disables
the relevant beta header for that turn. A per-request choice takes precedence over the workspace
1M setting.

## Token counting in VS Code / Copilot Chat

The provider implements `provideTokenCount`, which Copilot may call while constructing a request.
The current implementation returns a local estimate; it does not issue the Bedrock `CountTokens`
API call.

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

This estimate is a response to Copilot's token-count request. It is **not** a complete preflight
check that blocks every oversized request. Bedrock may still reject a request that exceeds the
selected model's effective limits.

## Context pruning and retries

The VS Code language-model provider API does not give this extension a hook to ask Copilot Chat to
prune or summarize the conversation history. The extension receives the messages Copilot provides;
it does not currently summarize, truncate, or retry with reduced chat history. When Bedrock reports
a recognized context-window overflow, the provider returns guidance to reduce conversation history,
remove tool results, or adjust model options.

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

1. Start a new chat or shorten the existing conversation.
2. Remove unnecessary tool output or reduce the number/size of tool results.
3. Choose a lower local Context Size if the picker offers one.
4. Reduce the request output limit if Copilot exposes a `max_tokens` control.
5. For reasoning-heavy tasks, select a model/effort appropriate to the task and available output
   budget.
6. If the error persists, check the **Amazon Bedrock Models** output channel and verify the model's
   current AWS context and output limits.

Automatic history pruning and automatic retry with shorter context are not currently implemented.

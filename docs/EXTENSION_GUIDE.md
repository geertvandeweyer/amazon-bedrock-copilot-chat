# Amazon Bedrock Provider: Functionality and Configuration

This is the living guide to the extension's current behavior. It documents the repository's
current implementation and known baseline: the user reports the extension is functional with
VS Code **1.142.0**. The project has a separately inspected VS Code source checkout at **1.146.0**;
observations from that newer source are labeled as such and are not assumed to describe 1.142 in
every detail. See [VS Code and Copilot integration](./VSCODE_INTEGRATION.md) for known UI metadata
compatibility differences and verification notes. The package manifest currently declares `engines.vscode: ^1.134.0`, which has not
been reconciled with the 1.142 functional baseline.

The upstream VS Code and GitHub Copilot Chat implementations are external dependencies. This
extension integrates through VS Code's `LanguageModelChatProvider` API; it does not patch Copilot
Chat or VS Code. See [VS Code and Copilot integration](./VSCODE_INTEGRATION.md) for API flow,
metadata surfaces, and compatibility notes. See also [Token limits and context management](./TOKEN_LIMITS.md)
for token estimation, context limits, and related API constraints.

## What the extension provides

- Registers a language-model provider under vendor ID `bedrock`, displayed as **Amazon Bedrock**.
- Discovers active, streaming, text-output foundation models, cross-region inference profiles,
  and active application inference profiles available to the configured AWS identity.
- Invokes the selected foundation model or inference profile with Bedrock's streaming Converse API.
- Converts Copilot Chat messages, images, tool calls, and tool results into Bedrock Converse
  request structures, then emits text, tool-call, and supported thinking/usage parts back through
  the VS Code provider callback.
- Uses model metadata and provider profiles to configure capabilities, limits, cache points,
  tool behavior, thinking/reasoning fields, and picker controls.
- Includes a **Manage Amazon Bedrock Provider** command for authentication, profile, and region
  management.

Model names, model IDs, metadata-derived limits, and indicative prices are catalogued in
[MODELS.md](./MODELS.md). Registry prices are not AWS quotes; verify current regional pricing with
AWS before relying on them.

## Startup and model discovery

1. VS Code activates the extension at startup and registers the `bedrock` language-model provider
   and `bedrock.manage` command.
2. On model discovery, the provider resolves AWS settings and credentials. On a first interactive
   run it offers to open settings or continue with the default AWS credential chain.
3. The AWS client requests text-output foundation models, inference-profile IDs, and active
   application profiles. It also loads the bundled `src/models-dev-cache.json` registry snapshot
   locally; registry loading does not require a network request.
4. Legacy/deprecated models, non-streaming models, and models without text output are excluded.
   Candidate foundation models use an available cross-region inference profile where possible;
   accessibility checks remove inaccessible candidates or try an accessible alternative.
5. Accessible application inference profiles are included when they can be matched with an
   underlying model that supports text output and streaming. Their limits and capabilities are
   inherited from the base model when known.
6. Entries are sorted with dated profiles first, newest first. If AWS denies model listing or no
   accessible model is found, an interactive request can ask for a model/profile ID and build a
   manual entry instead.

The provider's progress notification appears during interactive discovery. Silent discovery does
not show that progress UI or interactive authentication prompts. Cancelled discovery returns no
models without presenting a fetch error.

### Inference-profile selection

Foundation-model candidates can use a global or regional profile when AWS reports it available.
The default preference is global first, then a region-compatible profile, then direct foundation
model access. `bedrock.inferenceProfiles.preferRegional` reverses regional/global preference; when
regional-only preference is enabled, a denied regional profile does not fall back to a global one.
Both selection and fallback behavior are constrained by AWS partition and source region. Application
inference profiles are separate user-created profiles, not regional/global alternatives.

## Configuration reference

All contributed `bedrock.*` settings have resource scope and can be set at user or workspace scope.
The VS Code Settings UI descriptions in `package.json` remain the authoritative schema text. The
following table describes how the current provider reads or applies each setting.

| Setting                                    | Default                     | Current behavior                                                                                                                                                                                                                                                               |
| ------------------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bedrock.region`                           | `eu-west-1` in the manifest | Selects the Bedrock API region. The settings helper resolves configured value, legacy stored region, selected AWS profile region, AWS region environment variables, then `us-east-1` as code fallback.                                                                         |
| `bedrock.profile`                          | `null`                      | Uses a named AWS profile. `null`/unset means the default AWS credential chain. Profile selection is also available in Manage Provider.                                                                                                                                         |
| `bedrock.preferredModel`                   | `null`                      | Declared/read as a setting and triggers model metadata refresh when changed. The current provider code does not apply it to model ordering or request selection; do not rely on it as an automatic default selector.                                                           |
| `bedrock.thinking.enabled`                 | `true`                      | Enables extended thinking where the model profile supports it and the request history allows it. Copilot's `github.copilot.chat.anthropic.thinking.enabled` takes precedence when configured.                                                                                  |
| `bedrock.thinking.budgetTokens`            | `10000` (minimum `1024`)    | Declared and read with a minimum clamp. The current thinking-budget calculation is based on output limits, request `max_tokens`, and a 16K internal base budget; it does not consume this setting value. Treat this setting as currently ineffective until that path is wired. |
| `bedrock.thinking.effort`                  | `high`                      | Fallback effort for supported Claude models. Per-model picker `thinkingEffort` overrides it for a request. Actual accepted levels come from the model profile.                                                                                                                 |
| `bedrock.reasoningEffort`                  | `null`                      | Optional OpenAI-style reasoning effort for supported non-Anthropic models. Unset omits the request field; per-model `reasoningEffort` selection takes precedence. Unsupported combinations are not advertised.                                                                 |
| `bedrock.context1M.enabled`                | `true`                      | Controls optional 1M Claude context where an opt-in beta header is required. Per-model context selection overrides the setting for that request. Models whose 1M context is always on use their published limits directly.                                                     |
| `bedrock.promptCaching.enabled`            | `true`                      | Enables Bedrock cache points only for models and request locations allowed by their model profile. Cache points may follow system prompts, eligible user messages/tool results, and supported tool definitions.                                                                |
| `bedrock.inferenceProfiles.preferRegional` | `false`                     | Prefer regional profiles over global profiles for foundation model routing. This is a routing preference, not a guarantee of data residency; check AWS profile routing documentation and policy.                                                                               |
| `bedrock.temperature.override`             | `null`                      | `null` uses automatic profile/models.dev detection; `true` treats temperature as unsupported; `false` forces the provider to treat it as supported. Applies to model-specific request construction.                                                                            |

**Configuration accuracy note:** the manifest contains settings that are historical or not fully wired
in the current request path. In particular, `preferredModel` and `thinking.budgetTokens` are not
currently applied as their descriptions might suggest. Do not promise behavior based solely on the
manifest; update this guide when implementation changes.

## Authentication and Manage Provider

Run **Manage Amazon Bedrock Provider** from the Command Palette, or let the first-run prompt open
it. The command offers:

- **Set Authentication Method** — AWS Profile, Bedrock API key (bearer token), or access keys.
- **Set AWS Profile** — choose a detected profile or the default credential chain. Profile name is
  stored in VS Code settings; keys and tokens remain in SecretStorage.
- **Set Region** — choose an AWS region obtained from AWS Systems Manager Parameter Store, or enter
  a region manually if discovery fails.
- **Clear Settings** — remove the options and credentials enumerated in the current implementation.
  This command does not currently clear every setting (for example inference-profile preference,
  reasoning effort, thinking effort, or temperature override); clear those separately in VS Code
  Settings if needed.

Named profiles use AWS shared config/credentials and the AWS SDK's profile provider. API keys,
access key ID, secret access key, and optional session token are stored in VS Code SecretStorage.
When profile auth is selected with no named profile, the SDK uses its default credential provider
chain (which may include environment credentials, IAM roles, or SSO).

## Copilot Chat interaction

VS Code/Copilot Chat calls the provider's `provideLanguageModelChatInformation` to populate model
metadata, `provideTokenCount` for local token estimates, and `provideLanguageModelChatResponse` for
chat turns. The extension receives the selected model, messages, tools, model options, and picker
configuration; it does not choose Copilot's prompt policy or alter Copilot's UI code.

- **Tool calling:** tools are translated to Bedrock tool specs and schemas. The extension caps a
  request at 128 tools. Tool choice is only sent when supported by the model and compatible with
  the current thinking mode. Models marked as not supporting tool calls receive no tool config.
- **Request options:** supported Copilot model options include `max_tokens`, `top_p`, `stop`
  sequences, and temperature when accepted by the selected model. Output tokens are capped by the
  provider-advertised model limit. Extended thinking can force temperature to 1 on models that
  accept it; models known to reject temperature omit it.
- **Images:** supported image blocks are passed through for capable models. The converter accepts
  PNG, JPEG, GIF, and WebP image formats; token estimates use dimensions for Claude when possible
  and an encoded-size fallback otherwise.
- **Thinking and reasoning:** Claude thinking fields, beta headers, effort settings, and
  non-Anthropic `reasoning_effort` fields are model-profile driven. The provider stores a signed
  thinking block for the next request where available; it disables incompatible thinking when
  history contains assistant turns whose signed thinking blocks cannot be reconstructed.
- **Prompt caching:** when enabled and supported, the converter inserts Bedrock cache points at
  profile-approved system, message, and tool-definition boundaries.
- **Streaming:** text and tool calls are reported incrementally. Where the installed VS Code API
  supports it, thinking and usage metadata are also emitted. If a requested optional parameter is
  rejected as unknown, the provider can remove that parameter and retry once, with a user-visible
  warning.
- **No implicit pruning:** the provider does not summarize or prune conversation history. VS Code
  supplies the messages; Bedrock remains the final authority on whether the request fits a model's
  context window.

The provider validates that converted Bedrock messages are non-empty, begin with a user message,
and alternate user/assistant roles. It does **not** currently perform a complete pre-request token
limit rejection based on the token-count estimate. `provideTokenCount` is an estimate used to answer
Copilot's token-count request; it does not call Bedrock's `CountTokens` operation in the current
provider flow. Context overflow from Bedrock is translated into actionable user-facing guidance.

## Model metadata and pricing presentation

The provider attaches standard model identity, limits, capabilities, configuration schema, and
additional picker metadata. The model-specific UI rendering is owned by VS Code/Copilot and differs
by surface; see [VS Code and Copilot integration](./VSCODE_INTEGRATION.md).

Indicative USD rates come from the bundled models.dev cache. The current implementation passes
preformatted USD strings into `inputCost`, `outputCost`, and cache-cost metadata via a local type
widening. VS Code's internal metadata contract treats these fields as numeric Copilot credits per
million tokens. As a result, a table cell may visually show a dollar string while a related hover
or details view still labels/interprets it as credits or cannot format it numerically. This is a
known compatibility/semantics issue, not an AWS billing quote. Do not interpret the display as
actual Copilot credits or actual AWS charges.

Claude Fable 5-family entries receive a retention warning icon and warning text. AWS's account
retention requirements are controlled by AWS and are not changed by the extension. If Bedrock
rejects a request because the account retention mode is incompatible, the provider builds a command
using the active region/profile and asks the account administrator to enable the required AWS mode.

## Operational diagnostics and common failures

Open the **Amazon Bedrock Models** output channel. The channel uses VS Code's structured log levels:
`trace` for detailed conversion/stream diagnostics, `debug` for decisions and model conversion,
`info` for request lifecycle, `warn` for recoverable issues, and `error` for failures. Trace logging
can include request structure; review logs before sharing them.

| Symptom                                 | Likely cause and next step                                                                                                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No models appear                        | Check credentials, configured region, Bedrock model access, streaming/text output eligibility, and the output log. If listing is denied, enter a known model/profile ID when prompted. |
| Profile is denied                       | Check IAM permissions and profile availability. Try the regional/global preference appropriate to policy or confirm direct model access.                                               |
| Data retention error for Fable          | Follow the AWS account-level retention guidance in the error. Ask an AWS administrator if you cannot change that account setting.                                                      |
| Context window exceeded                 | Start a new chat, reduce history/tool results, reduce local context selection, or choose a model with a larger window. There is no automatic pruning.                                  |
| No visible response / max tokens        | Reduce conversation history or output-token settings. Reasoning tokens consume output budget even though they are not visible text.                                                    |
| Tool call rejected                      | Check whether the selected model supports tools and whether the rejected request field is model-specific. The provider may retry once without an unsupported optional parameter.       |
| Region listing fails in Manage Provider | Enter the AWS region manually and verify the selected identity can access Bedrock there.                                                                                               |

## Documentation map

- [Model catalogue](./MODELS.md) — bundled model metadata and price caveats.
- [Copilot adoption notes](./copilot-adoption.md) — background research, not extension behavior documentation.
- [VS Code and Copilot integration](./VSCODE_INTEGRATION.md) — provider lifecycle, metadata/UI destinations, API boundaries, and 1.142/1.146 compatibility notes.
- [Token limits and context management](./TOKEN_LIMITS.md) — detailed token counting, limits, and known VS Code API constraints.

## Related guide links

- [VS Code and Copilot integration](./VSCODE_INTEGRATION.md) explains how the extension metadata reaches the different VS Code and Copilot Chat UI surfaces, and highlights compatibility notes for the confirmed VS Code 1.142 baseline versus the inspected 1.146 source.
- [Token limits and context management](./TOKEN_LIMITS.md) documents token estimates, model context limits, reasoning output budgets, and the current lack of automatic history pruning.

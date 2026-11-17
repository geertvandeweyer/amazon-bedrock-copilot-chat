<!--
Sync Impact Report
- Version: 2.0.0 → 2.1.0 (adds explicit maintainability and commit-quality requirements)
- Modified sections: Development Workflow and Quality Gates (requires pre-commit validation and review of hook fixes)
- Added principle: VI. Maintainable Control Flow and Lint Compliance
- Removed sections: None
- Follow-up TODO: Confirm the original ratification date; it remains unknown.
-->

# Amazon Bedrock Copilot Chat Constitution

## Core Principles

### I. Surgical, Behavior-Preserving Changes

Changes MUST be narrowly scoped to the user request, complete enough to solve it, and avoid unrelated cleanup. Existing behavior MUST be preserved except where the requested change intentionally changes it. Bugs directly caused by a change or tightly coupled to it MUST be fixed. This keeps reviews focused and reduces regression risk.

### II. Architecture and API Contracts

Implementations MUST follow the existing TypeScript architecture and VS Code `LanguageModelChatProvider` / AWS Bedrock contracts. New code MUST use the established flow between the provider, Bedrock client, converters, stream processor, settings, and logger rather than adding parallel mechanisms without justification. Public, proposed, and provider-specific metadata MUST be treated according to the declared runtime contract and verified consumers; casts MUST NOT conceal incompatible data types or semantics. This prevents UI, API, and model behavior from drifting apart.

### III. Focused, Risk-Based Validation

Behavior changes MUST receive focused tests that would fail without the change, including relevant edge cases. Tests MUST use mocks for AWS operations wherever practical; tests that can incur AWS cost MUST be explicitly guarded. Validation MUST use the smallest existing test, lint, type-check, or build command that covers the change, escalating to broader checks when targeted results require it. Test suites MUST NOT be expanded with cases that merely restate implementation details or verify framework behavior. This provides evidence for changes without unnecessary test or CI cost.

### IV. Documentation and Compatibility

User-visible behavior, configuration, API, or operational changes MUST update directly related documentation. For every feature specification, implementers MUST maintain the relevant living documentation under `docs/` so it describes the extension's functionality, options, configuration, and interactions with upstream VS Code and Copilot Chat. Documentation MUST reflect the implemented behavior and supported version, not assumptions about mutable upstream code. Implementations MUST honor the minimum VS Code version declared by the extension and use the matching supported API surface; upgrades to proposed VS Code APIs MUST update the checked-in generated declarations using the repository workflow. The declared minimum is the authoritative support boundary, so raising it itself records the compatibility change. Documentation and specifications MUST NOT add redundant statements that earlier versions are unsupported or that a compatibility change required specific user approval. Compatibility decisions and intentional behavior changes MUST be covered by validation. This keeps documentation and runtime expectations aligned.

### V. Secure, Observable AWS Integration

Credentials and other secrets MUST be stored using VS Code SecretStorage or the AWS credential provider chain, never committed or emitted to logs. AWS requests and failures MUST use the centralized structured logger rather than `console` output. Diagnostics MUST provide useful operational context while avoiding sensitive credential, prompt, or response data. Real AWS calls in automated tests MUST be avoided or guarded to prevent unintended access and spend. This supports safe operation and actionable troubleshooting.

### VI. Maintainable Control Flow and Lint Compliance

TypeScript changes MUST pass the configured ESLint rules without suppressing or weakening a rule merely to make a check pass. Functions MUST remain within the configured SonarJS cognitive-complexity limit (currently 20); when a function exceeds it, contributors MUST simplify its control flow or extract cohesive behavior into focused helpers. Nested-loop and switch logic MUST follow the configured Unicorn rules; in particular, code MUST extract the relevant processing into a helper rather than use `continue` from a nested loop or switch. Any necessary lint suppression MUST be narrowly scoped, explain the specific reason inline, and preserve the rule for surrounding code. These constraints keep control flow reviewable and make lint failures actionable rather than routinely deferred to commits.

## Project Constraints

- The product is a VS Code extension that exposes Amazon Bedrock foundation models and inference profiles through GitHub Copilot Chat's language-model provider API.
- TypeScript is the implementation language; Bun is the repository's package manager and command runner. AWS integration uses the AWS SDK for JavaScript.
- Extension behavior depends on model-specific capabilities, including tool calling, images, context limits, and reasoning/thinking modes. Changes to those capabilities MUST account for the relevant model profiles and request conversion/streaming behavior.
- Upstream VS Code and Copilot sources are reference-only for this project. The extension MUST adapt through its own provider implementation and MUST NOT require modifications to upstream source.

## Development Workflow and Quality Gates

- Follow the existing style: two-space indentation, LF endings, Prettier formatting, strict TypeScript, type-only imports where appropriate, and `readonly` fields where they express immutability. Use centralized logging; do not add `console` calls.
- Tests belong in `src/test/*.test.ts`. Prefer focused unit tests with mocks; document manual end-to-end steps for behavior that cannot be covered automatically.
- The primary validation commands are `bun run check-types`, `bun run lint`, `bun run format:check`, and `bun run test`. Run the smallest relevant command set for a change; run the full suite when required by risk or when targeted validation points to broader effects. Contributors MUST run the relevant checks before committing rather than relying on commit hooks as their first validation. Applicable pre-commit type-check, lint, and formatting checks and commit-message checks MUST pass; contributors MUST review any hook-applied fixes and ensure the intended changes are staged.
- CI validates types, lint, formatting, and VSIX packaging. Changes affecting package metadata, dependencies, API declarations, or packaging MUST validate the corresponding workflow step.
- Pull requests MUST explain what changed and why, report validation performed and AWS resources touched, and include screenshots or clips for UI changes. Commit headers MUST use a repository-approved type (`build`, `chore`, `ci`, `ai`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, or `test`), be no longer than 150 characters, and omit a terminal period. Commit bodies and footers, when present, MUST be separated by blank lines.

## Governance

This constitution governs project development alongside the user's task-specific requirements; when instructions conflict, the user's explicit current request controls the scope of that task, while this constitution controls how the approved work is carried out. Project-specific instruction files may provide architecture or command references but MUST NOT contradict these principles. Any deprecated instruction file MUST be reviewed and removed or replaced in a separate, explicit change; this constitution update does not remove instruction files.

Amendments MUST update this document, explain the reason for the change, and increment the version using semantic versioning: MAJOR for incompatible governance changes, MINOR for new or materially expanded principles/sections, and PATCH for clarifications or non-semantic refinements. Reviewers and implementers MUST check proposed changes against the principles and confirm required validation before merge. Unjustified complexity and unrelated scope MUST be challenged during review. The repository's instruction files and CI configuration are supporting guidance; this constitution is the single source of project-wide development and testing principles.

**Version**: 2.1.0 | **Ratified**: TODO(RATIFICATION_DATE): original adoption date unknown | **Last Amended**: 2026-11-17

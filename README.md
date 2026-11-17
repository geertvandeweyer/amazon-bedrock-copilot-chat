# Amazon Bedrock Provider for GitHub Copilot Chat

**This plugin is a forked from the original extension of [tinovyatkin](https://github.com/tinovyatkin/amazon-bedrock-copilot-chat). It was extended to enhance performance and support newer models and versions of VSCode.**

This extension links AWS Bedrock models to the copilot chat in VSCode. It uses the VSCode's official [Language Model Chat Provider API](https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider) and the AWS SDK. Currently it has selection of reasoning effort and context size for models supporting it.

## Features

- **Native Amazon Bedrock Integration**: Discover and use Amazon Bedrock models and inference profiles available to your AWS identity and region
- **Flexible Authentication**: Use AWS profiles, Bedrock API keys (bearer tokens), or access keys
- **Streaming Support**: Real-time streaming responses for faster feedback
- **Tool Calling**: Available for models that support tool/function calling
- **Cross-Region Inference**: Automatic support for cross-region inference profiles
- **Thinking and Reasoning Controls**: Model-specific extended thinking and reasoning options where supported
- **Selectable Context Size**: Choose from context-size options supported by the selected model, including extended windows (up to 1M where available) and local prompt budgets where applicable
- **Prompt Caching**: Bedrock prompt caching where supported by the selected model
- **Image Input**: Work with models that support image inputs

**Harness compatibility:** Context-size selections are currently supported only in the local Copilot harness. VS Code/Copilot's BYOK agent-host integration does not yet forward the selected context size to this extension; broader support is waiting on upstream integration. The extension cannot reliably detect which harness is making a request, so this is a compatibility limitation rather than an automatic harness-specific fallback.

Detailed behavior, configuration, and current limitations are documented in the [extension guide](./docs/EXTENSION_GUIDE.md). See the [VS Code and Copilot integration notes](./docs/VSCODE_INTEGRATION.md) and [token-limit guide](./docs/TOKEN_LIMITS.md) for API/UI interactions and context handling.

## Prerequisites

- VS Code **1.146.0 or newer** (`engines.vscode: ^1.146.0` in the package manifest).
- GitHub Copilot extension
- AWS credentials (AWS Profile, API Key, or Access Keys)
- Access to Amazon Bedrock in your AWS account

## Installation

1. Install the extension from the VSCode marketplace
2. Configure your AWS credentials if you haven't already:
   - See [AWS CLI Configuration](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-files.html) for details
3. Run the "Manage Amazon Bedrock Provider" command to select your AWS profile and region

Alternatively, install from the VSIX attached to the [latest GitHub release](https://github.com/geertvandeweyer/amazon-bedrock-copilot-chat/releases/latest). The VSIX asset will be available there once it has been uploaded.

1. Download the `.vsix` asset from the release.
2. In VS Code, open the Extensions view, select the `...` menu, and choose **Install from VSIX...**

## Configuration

### Authentication Methods

This extension supports three authentication methods:

1. **AWS Profile** (recommended) - Uses named profiles from `~/.aws/credentials` and `~/.aws/config`
2. **API Key** - Uses [Amazon Bedrock API key](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys.html) (stored securely in VSCode SecretStorage)
3. **Access Keys** - Uses AWS access key ID and secret (stored securely in VSCode SecretStorage)

To configure:

1. Open the Command Palette (`Cmd+Shift+P` or `Ctrl+Shift+P`)
2. Run "Manage Amazon Bedrock Provider"
3. Choose "Set Authentication Method" to select your preferred method
4. Follow the prompts to enter credentials
5. Choose "Set Region" to select your preferred AWS region

### Available Regions

The extension supports all AWS partitions including:

- **Commercial AWS** - All standard regions (us-east-1, eu-west-1, ap-southeast-2, etc.)
- **AWS GovCloud (US)** - us-gov-west-1, us-gov-east-1
- **AWS China** - cn-north-1, cn-northwest-1

See [Model support by AWS Region in Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/models-regions.html) for the latest list of supported regions and [GOVCLOUD-COMPATIBILITY.md](./GOVCLOUD-COMPATIBILITY.md) for partition-specific details.

## Usage

Once configured, Bedrock models will appear in GitHub Copilot Chat's model selector. Simply:

1. Open GitHub Copilot Chat
2. Click on the model selector
3. Choose a Bedrock model (they will be labeled with "Amazon Bedrock")
4. Configure context size and reasoning options when offered by the selected model (context-size selections currently require the local Copilot harness)
5. Start chatting!

## Supported Models

Available models depend on your AWS identity, region, permissions, and model access. The extension lists accessible models and inference profiles that support streaming text responses. Tool calling and image input are model-specific capabilities; not every listed model supports them.

Context-size choices are also model-specific and appear only when the selected model has multiple supported choices. Depending on the model, choices can include its standard and extended context windows (including 1M where available) and local 256K or 750K prompt budgets. The chosen total context reserves space for model output. The `bedrock.context1M.enabled` setting controls optional extended context where Bedrock requires an opt-in; a per-request context-size selection takes precedence over that setting. See the [token-limit guide](./docs/TOKEN_LIMITS.md) for details.

The context-size selection is currently honored only through the local Copilot harness. The upstream BYOK agent-host path does not yet pass this selection through to the provider; support depends on an upstream integration change. The extension cannot identify the active harness.

### Models Automatically Excluded

The extension excludes models that are inaccessible, deprecated/legacy, non-streaming, or do not produce text. This excludes categories such as:

- Embedding models
- Image generation models
- Models marked with a legacy lifecycle status

Image-input support is separate: models that accept images can still be listed when they otherwise meet the discovery requirements. AWS account policies, including data-retention requirements, can still prevent a request; the extension cannot change those policies.

Models are sorted with newest inference profiles first (by creation/update date), making it easier to find recently released models.

## Troubleshooting

### Models not showing up

1. Verify your AWS credentials are correctly configured
2. Check that you've selected the correct AWS profile and region
3. **Enable models in the Amazon Bedrock console**: Go to the [Bedrock Model Access page](https://console.aws.amazon.com/bedrock/home#/modelaccess) and request access to the models you want to use
4. Ensure your AWS account has access to Bedrock in the selected region
5. Check the "Amazon Bedrock Models" output channel for error messages

### Authentication errors

1. Verify your AWS credentials are valid and not expired
2. Check that your IAM user/role has the necessary Bedrock permissions:

   **Option 1: Use AWS Managed Policy (Recommended)**

   Attach the [`AmazonBedrockLimitedAccess`](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AmazonBedrockLimitedAccess.html) managed policy to your IAM user or role. This policy includes all required permissions for using this extension.

   **Option 2: Custom Policy with Specific Permissions**

   If you prefer granular control, ensure your policy includes:
   - `bedrock:ListFoundationModels` - List available models (_optional but recommended - extension will fallback to check Anthropic models only_)
   - `bedrock:GetFoundationModelAvailability` - Check model access status (_optional but recommended_)
   - `bedrock:ListInferenceProfiles` - List cross-region inference profiles
   - `bedrock:InvokeModel` - Invoke models
   - `bedrock:InvokeModelWithResponseStream` - Stream model responses

## License

MIT

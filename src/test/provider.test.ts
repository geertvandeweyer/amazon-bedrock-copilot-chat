import { ModelModality } from "@aws-sdk/client-bedrock";
import type {
  ConverseStreamCommandInput,
  ConverseStreamOutput,
  Message,
} from "@aws-sdk/client-bedrock-runtime";
import * as assert from "node:assert";
import * as vscode from "vscode";
import { compactMessageHistory } from "../context-compactor";
import { convertMessages, stripThinkingContent } from "../converters/messages";
import { convertTools } from "../converters/tools";
import { logger } from "../logger";
import { filterDeprecatedFoundationModels, isDeprecatedModel } from "../model-lifecycle";
import { loadModelsDevelopmentData } from "../models-development";
import { getModelProfile, getModelTokenLimits, normalizeModelId } from "../profiles";
import {
  BedrockChatModelProvider,
  getAccountDataRetentionGuidance,
  getModelDataRetentionWarning,
  getModelDisplayMetadata,
} from "../provider";
import { StreamProcessor } from "../stream-processor";
import type { BedrockModelSummary, ModelsDevelopmentMap } from "../types";
import { reconcileBedrockToolResults } from "../validation";
interface ProviderInternals {
  applyReasoningEffort: (
    requestInput: { additionalModelRequestFields?: Record<string, unknown> },
    modelId: string,
    baseModelId: string,
    reasoningEffort: "high" | "low" | "medium" | "minimal",
  ) => void;
  buildBetaHeaders: (
    modelProfile: ReturnType<typeof getModelProfile>,
    modelId: string,
    isExtendedThinkingEnabled: boolean,
    isContext1MEnabled: boolean,
    isThinkingEffortEnabled: boolean,
  ) => string[];
  buildConfigurationSchema: (
    modelId: string,
    modelProfile: ReturnType<typeof getModelProfile>,
    modelsDevelopmentMap?: ModelsDevelopmentMap,
    limits?: { maxInputTokens: number; maxOutputTokens: number },
    standardLimits?: { maxInputTokens: number; maxOutputTokens: number },
  ) => undefined | { properties?: Record<string, Record<string, unknown>> };
  buildRequestInput: (
    model: vscode.LanguageModelChatInformation,
    baseModelId: string,
    converted: {
      messages: ConverseStreamCommandInput["messages"];
      system: NonNullable<ConverseStreamCommandInput["system"]>;
    },
    options: vscode.LanguageModelChatRequestOptions,
    toolConfig: undefined,
    isExtendedThinkingEnabled: boolean,
    budgetTokens: number,
    betaHeaders: string[],
    thinkingEffort?: "high" | "low" | "max" | "medium" | "xhigh",
    isTemperatureDeprecated?: boolean,
    requiresAdaptiveThinking?: boolean,
    reasoningEffort?: "high" | "low" | "medium" | "minimal",
    disabledThinkingType?: "adaptive" | "between_tools" | "disabled",
  ) => ConverseStreamCommandInput;
  formatDetail: (
    modelId: string,
    maxInput: number,
    maxOutput: number,
    isVision: boolean,
    cost?: { cache_read?: number; cache_write?: number; input?: number; output?: number },
  ) => string;
  formatModelDescription: (arguments_: {
    cost?: { cache_read?: number; cache_write?: number; input?: number; output?: number };
    maxInput: number;
    maxOutput: number;
    modelId: string;
    providerName?: string;
    route?: string;
    vision: boolean;
    warningText?: Record<string, string>;
  }) => string;
  formatTooltip: (arguments_: {
    cost?: { cache_read?: number; cache_write?: number; input?: number; output?: number };
    maxInput: number;
    maxOutput: number;
    modelId: string;
    providerName: string;
    route: string;
    vision: boolean;
    warningText?: Record<string, string>;
  }) => string;
  getPickerPricingMetadata: (
    isBYOK: boolean,
    cost?: {
      cache_read?: number;
      cache_write?: number;
      context_over_200k?: {
        cache_read?: number;
        cache_write?: number;
        input?: number;
        output?: number;
      };
      input?: number;
      output?: number;
    },
  ) => Record<string, boolean | number | string | undefined>;
  getRequestMaxInputTokens: (
    model: vscode.LanguageModelChatInformation,
    modelId: string,
    selectedContextSize: number | undefined,
    isContext1MEnabled: boolean,
    modelsDevelopmentMap: ModelsDevelopmentMap,
  ) => number;
  getSelectedContextSize: (
    model: vscode.LanguageModelChatInformation,
    requestedContextSize: unknown,
  ) => number | undefined;
  resolveModelLimits: (
    modelId: string,
    isContext1MEnabled: boolean,
    modelsDevelopmentMap: ModelsDevelopmentMap,
  ) => { maxInputTokens: number; maxOutputTokens: number };
}

async function callProviderWithContextSize(
  modelConfig: Record<string, unknown> | undefined,
  messages: vscode.LanguageModelChatMessage[],
) {
  const model: vscode.LanguageModelChatInformation = {
    capabilities: {},
    configurationSchema: {
      properties: { contextSize: { enum: [50_000, 100_000], type: "number" } },
    },
    family: "bedrock",
    id: "amazon.nova-lite-v1:0",
    maxInputTokens: 291_808,
    maxOutputTokens: 8192,
    name: "Amazon Nova Lite",
    version: "1.0.0",
  };
  let requestMaxInputTokens: number | undefined;
  let summarizeCalls = 0;
  const mockClient = {
    resolveModelId: async (modelId: string) => modelId,
    setAuthConfig: () => {},
    summarizeConversationHistory: async () => {
      summarizeCalls += 1;
      return "Earlier conversation summary";
    },
  };
  const provider = new BedrockChatModelProvider(mockSecretStorage, mockGlobalState);
  const internals = provider as unknown as ProviderInternals & {
    client: typeof mockClient;
    getAuthConfig: () => Promise<{ method: "profile" }>;
    processResponseStreamWithFallback: () => Promise<void>;
  };
  internals.client = mockClient;
  internals.getAuthConfig = async () => ({ method: "profile" });
  const originalBuildRequestInput = internals.buildRequestInput.bind(provider);
  internals.buildRequestInput = (...arguments_) => {
    requestMaxInputTokens = arguments_[0].maxInputTokens;
    return originalBuildRequestInput(...arguments_);
  };
  internals.processResponseStreamWithFallback = async () => {};

  await provider.provideLanguageModelChatResponse(
    model,
    messages,
    {
      ...(modelConfig !== undefined && { modelConfiguration: modelConfig }),
      tools: [],
    },
    { report: () => {} },
    new vscode.CancellationTokenSource().token,
  );

  return { model, requestMaxInputTokens, summarizeCalls };
}

function pngFixture(width: number, height: number, payloadLength: number): Uint8Array {
  const data = new Uint8Array(24 + payloadLength);
  data.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  data.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  data.set(
    [
      (width >>> 24) & 0xff,
      (width >>> 16) & 0xff,
      (width >>> 8) & 0xff,
      width & 0xff,
      (height >>> 24) & 0xff,
      (height >>> 16) & 0xff,
      (height >>> 8) & 0xff,
      height & 0xff,
    ],
    16,
  );
  return data;
}

function providerInternals(provider: BedrockChatModelProvider): ProviderInternals {
  return provider as unknown as ProviderInternals;
}

function recordLog(
  logs: { args: unknown[]; level: string }[],
  level: string,
  message: string,
  arguments_: unknown[],
): void {
  logs.push({ args: [message, ...arguments_], level });
}

// Mock implementations extracted to avoid function nesting depth issues
const mockSecretStorage = {
  delete: async () => {},
  get: async () => undefined as string | undefined,
  keys: async () => [],
  onDidChange: () => ({ dispose: () => {} }),
  store: async () => {},
} as vscode.SecretStorage;

const mockGlobalState: vscode.Memento = {
  get: async () => {},
  keys: () => [],
  update: async () => {},
};

// Helper to cast non-standard content blocks that may appear from models with extended thinking
const nonStandardBlock = (b: unknown) => b as any;

// Helper to create a test model for buildModelCandidates and findAlternativeProfile tests
const createTestModel = (modelId: string): BedrockModelSummary => ({
  inputModalities: [ModelModality.TEXT],
  modelArn: `arn:aws:bedrock:us-west-2::foundation-model/${modelId}`,
  modelId,
  modelName: modelId,
  outputModalities: [ModelModality.TEXT],
  providerName: "Anthropic",
  responseStreamingSupported: true,
});

// Helper to create a mock provider with controlled base model accessibility
const createMockClientProvider = (isBaseModelAccessible: boolean) => {
  const mockClient = {
    isModelAccessible: async () => isBaseModelAccessible,
  };
  const provider = new BedrockChatModelProvider(mockSecretStorage, mockGlobalState);

  (provider as any).client = mockClient;
  return provider;
};

// Helper to call the private calculateThinkingConfig method
const callCalcThinkingConfig = (
  modelProfile: { supportsThinking: boolean },
  maxOutputTokens: number,
  maxTokensForRequest: number,
  isThinkingEnabled: boolean,
) => {
  const provider = new BedrockChatModelProvider(mockSecretStorage, mockGlobalState);
  return (provider as any).calculateThinkingConfig(
    modelProfile,
    maxOutputTokens,
    maxTokensForRequest,
    isThinkingEnabled,
  ) as { budgetTokens: number; extendedThinkingEnabled: boolean };
};

const callBuildRequestInput = (
  modelId: string,
  options: vscode.LanguageModelChatRequestOptions = {},
  isExtendedThinkingEnabled = false,
) => {
  const provider = new BedrockChatModelProvider(mockSecretStorage, mockGlobalState);
  const modelProfile = getModelProfile(modelId);
  return (provider as any).buildRequestInput(
    {
      capabilities: {},
      family: "bedrock",
      id: modelId,
      maxInputTokens: 200_000,
      maxOutputTokens: 64_000,
      name: modelId,
      version: "1.0.0",
    },
    modelId,
    { messages: [], system: [] },
    options,
    undefined,
    isExtendedThinkingEnabled,
    4096,
    [],
    undefined,
    modelProfile.temperatureDeprecated,
    modelProfile.requiresAdaptiveThinking,
    undefined,
    modelProfile.disabledThinkingType,
  ) as ConverseStreamCommandInput;
};

const callBuildConfigSchema = (
  modelId: string,
  modelsDevelopmentMap: ModelsDevelopmentMap = new Map(),
  limits?: { maxInputTokens: number; maxOutputTokens: number },
  standardLimits = limits,
) => {
  const provider = providerInternals(
    new BedrockChatModelProvider(mockSecretStorage, mockGlobalState),
  );
  return provider.buildConfigurationSchema(
    modelId,
    getModelProfile(modelId),
    modelsDevelopmentMap,
    limits,
    standardLimits,
  );
};

const callResolveModelLimits = (
  modelId: string,
  isContext1MEnabled: boolean,
  modelsDevelopmentMap: ModelsDevelopmentMap,
) =>
  providerInternals(
    new BedrockChatModelProvider(mockSecretStorage, mockGlobalState),
  ).resolveModelLimits(modelId, isContext1MEnabled, modelsDevelopmentMap);

const makeDevelopmentMapEntry = (
  modelId: string,
  context: number,
  output: number,
): ModelsDevelopmentMap => new Map([[modelId, { limit: { context, output } }]]);

suite("Amazon Bedrock Chat Provider Extension", () => {
  suite("account data-retention error guidance", () => {
    test("explains how to enable AWS review when default retention blocks a model", () => {
      const guidance = getAccountDataRetentionGuidance(
        new Error(
          "ValidationException: data retention mode 'default' is not available for this model",
        ),
        "global.anthropic.claude-fable-5",
        "us-east-1",
        "bedrock",
      );

      assert.ok(guidance);
      assert.match(guidance, /global\.anthropic\.claude-fable-5/);
      assert.match(guidance, /aws bedrock put-account-data-retention --mode aws_review/);
      assert.match(guidance, /--region "us-east-1" --profile "bedrock"/);
    });

    test("omits --profile when default AWS credentials are configured", () => {
      const guidance = getAccountDataRetentionGuidance(
        new Error("data retention mode 'default' is not available for this model"),
        "global.anthropic.claude-fable-5",
        "us-east-1",
      );

      assert.ok(guidance);
      assert.doesNotMatch(guidance, /--profile/);
    });

    test("does not rewrite other AWS errors", () => {
      assert.equal(
        getAccountDataRetentionGuidance(
          new Error("AccessDeniedException: not authorized"),
          "global.anthropic.claude-fable-5",
          "us-east-1",
          "bedrock",
        ),
        undefined,
      );
    });
  });

  suite("provider", () => {
    test("public provider callback emits a selectable context schema for direct GPT-6 Luna", async () => {
      const modelId = "openai.gpt-6-luna";
      const profileId = `global.${modelId}`;
      const modelsDevelopmentMap = loadModelsDevelopmentData();
      const mockClient = {
        fetchApplicationInferenceProfiles: async () => [],
        fetchInferenceProfiles: async () => new Set([profileId]),
        fetchModels: async () => [createTestModel(modelId)],
        fetchModelsDevData: async () => modelsDevelopmentMap,
        getFallbackInferenceProfileIds: () => new Set<string>(),
        setAuthConfig: () => {},
        setProfile: () => {},
        setRegion: () => {},
      };
      const provider = new BedrockChatModelProvider(mockSecretStorage, mockGlobalState);
      const internals = provider as unknown as {
        client: typeof mockClient;
        getAuthConfig: () => Promise<{ method: "profile" }>;
      };
      internals.client = mockClient;
      internals.getAuthConfig = async () => ({ method: "profile" });

      const infos = await provider.provideLanguageModelChatInformation(
        { silent: true },
        new vscode.CancellationTokenSource().token,
      );
      const information = infos.find(
        (model) => model.id === profileId,
      ) as vscode.LanguageModelChatInformation & {
        maxContextWindowTokens?: number;
      };

      assert.ok(information, `expected provider to emit ${profileId}`);
      assert.equal(information.maxContextWindowTokens, 1_050_000);
      assert.deepEqual(
        information.configurationSchema?.properties?.contextSize?.enum,
        [256_000, 750_000, 1_050_000],
      );
      assert.equal(information.configurationSchema?.properties?.contextSize?.group, "tokens");
    });

    test("prepareLanguageModelChatInformation returns array (no key -> empty)", async () => {
      const provider = new BedrockChatModelProvider(mockSecretStorage, mockGlobalState);

      const infos = await provider.prepareLanguageModelChatInformation(
        { silent: true },
        new vscode.CancellationTokenSource().token,
      );
      assert.ok(Array.isArray(infos));
    });

    test("identifies deprecated models from models.dev metadata, including regional IDs", () => {
      const modelsDevelopmentMap: ModelsDevelopmentMap = new Map([
        ["nvidia.nemotron-nano-3-30b", { limit: { context: 262_144, output: 8192 } }],
        [
          "nvidia.nemotron-nano-9b-v2",
          {
            limit: { context: 131_072, output: 8192 },
            status: "deprecated",
          },
        ],
      ]);

      assert.equal(isDeprecatedModel("nvidia.nemotron-nano-9b-v2", modelsDevelopmentMap), true);
      assert.equal(
        isDeprecatedModel("global.nvidia.nemotron-nano-9b-v2", modelsDevelopmentMap),
        true,
      );
      assert.equal(isDeprecatedModel("nvidia.nemotron-nano-3-30b", modelsDevelopmentMap), false);
      const models = [
        createTestModel("nvidia.nemotron-nano-3-30b"),
        createTestModel("nvidia.nemotron-nano-9b-v2"),
      ];
      assert.deepEqual(
        filterDeprecatedFoundationModels(models, modelsDevelopmentMap).map(
          (model) => model.modelId,
        ),
        ["nvidia.nemotron-nano-3-30b"],
      );
    });

    test("provideTokenCount counts simple string", async () => {
      const provider = new BedrockChatModelProvider(mockSecretStorage, mockGlobalState);

      const est = await provider.provideTokenCount(
        {
          capabilities: {},
          family: "bedrock",
          id: "m",
          maxInputTokens: 1000,
          maxOutputTokens: 1000,
          name: "m",
          version: "1.0.0",
        },
        "hello world",
        new vscode.CancellationTokenSource().token,
      );
      assert.equal(typeof est, "number");
      assert.ok(est > 0);
    });

    test("provideTokenCount applies the Sonnet local estimation multiplier", async () => {
      const provider = new BedrockChatModelProvider(mockSecretStorage, mockGlobalState);

      const est = await provider.provideTokenCount(
        {
          capabilities: {},
          family: "bedrock",
          id: "global.anthropic.claude-sonnet-5-20251001-v1:0",
          maxInputTokens: 1_000_000,
          maxOutputTokens: 64_000,
          name: "Claude Sonnet",
          version: "1.0.0",
        },
        "a".repeat(100),
        new vscode.CancellationTokenSource().token,
      );

      assert.equal(est, 33);
    });

    test("provideTokenCount keeps the baseline estimate for Haiku", async () => {
      const provider = new BedrockChatModelProvider(mockSecretStorage, mockGlobalState);

      const est = await provider.provideTokenCount(
        {
          capabilities: {},
          family: "bedrock",
          id: "global.anthropic.claude-haiku-4-5-20251001-v1:0",
          maxInputTokens: 200_000,
          maxOutputTokens: 64_000,
          name: "Claude Haiku",
          version: "1.0.0",
        },
        "a".repeat(100),
        new vscode.CancellationTokenSource().token,
      );

      assert.equal(est, 25);
    });

    test("Claude image estimates use dimensions rather than encoded payload size", async () => {
      const provider = new BedrockChatModelProvider(mockSecretStorage, mockGlobalState);
      const model = {
        capabilities: {},
        family: "bedrock",
        id: "global.anthropic.claude-sonnet-5-5",
        maxInputTokens: 872_000,
        maxOutputTokens: 128_000,
        name: "Claude Sonnet 5.5",
        version: "1.0.0",
      };

      const createMessage = (payloadLength: number): vscode.LanguageModelChatMessage => ({
        content: [
          new vscode.LanguageModelDataPart(
            pngFixture(1200, 900, payloadLength),
            "image/png",
          ) as unknown as vscode.LanguageModelTextPart,
        ],
        name: undefined,
        role: vscode.LanguageModelChatMessageRole.User,
      });
      const token = new vscode.CancellationTokenSource().token;
      const lowCompressionTokens = await provider.provideTokenCount(
        model,
        createMessage(128),
        token,
      );
      const highCompressionTokens = await provider.provideTokenCount(
        model,
        createMessage(8192),
        token,
      );

      assert.equal(lowCompressionTokens, 1440);
      assert.equal(highCompressionTokens, lowCompressionTokens);
    });

    test("non-Claude image estimates use model-aware encoded-size fallback", async () => {
      const provider = new BedrockChatModelProvider(mockSecretStorage, mockGlobalState);
      const image = new vscode.LanguageModelDataPart(
        pngFixture(1200, 900, 1000),
        "image/png",
      ) as unknown as vscode.LanguageModelTextPart;
      const estimate = await provider.provideTokenCount(
        {
          capabilities: {},
          family: "bedrock",
          id: "amazon.nova-pro-v1:0",
          maxInputTokens: 300_000,
          maxOutputTokens: 10_000,
          name: "Nova Pro",
          version: "1.0.0",
        },
        {
          content: [image],
          name: undefined,
          role: vscode.LanguageModelChatMessageRole.User,
        },
        new vscode.CancellationTokenSource().token,
      );

      assert.equal(estimate, 1);
    });

    test("does not add legacy opt-in beta headers for Opus 4.7", () => {
      const provider = providerInternals(
        new BedrockChatModelProvider(mockSecretStorage, mockGlobalState),
      );
      const modelId = "anthropic.claude-opus-4-7-20260420-v1:0";

      const betaHeaders = provider.buildBetaHeaders(
        getModelProfile(modelId),
        modelId,
        true,
        true,
        true,
      );

      assert.equal(betaHeaders.includes("context-1m-2025-08-07"), false);
      assert.equal(betaHeaders.includes("interleaved-thinking-2025-05-14"), false);
      assert.equal(betaHeaders.includes("effort-2025-11-24"), true);
    });

    test("uses between_tools when Sonnet 5.5 thinking is disabled", () => {
      const requestInput = callBuildRequestInput("global.anthropic.claude-sonnet-5-5", {});
      const additionalFields = requestInput.additionalModelRequestFields as
        | undefined
        | { output_config?: { effort?: string }; thinking?: { type?: string } };

      assert.equal(additionalFields?.thinking?.type, "between_tools");
      assert.equal(additionalFields?.output_config?.effort, undefined);
    });

    test("preserves Sonnet 5.5 thinking mode when an effort is selected", () => {
      const provider = providerInternals(
        new BedrockChatModelProvider(mockSecretStorage, mockGlobalState),
      );
      const requestInput = provider.buildRequestInput(
        {
          capabilities: {},
          family: "bedrock",
          id: "global.anthropic.claude-sonnet-5-5",
          maxInputTokens: 872_000,
          maxOutputTokens: 128_000,
          name: "Claude Sonnet 5.5",
          version: "1.0.0",
        },
        "anthropic.claude-sonnet-5-5",
        { messages: [], system: [] },
        {},
        undefined,
        false,
        16_000,
        [],
        "high",
        true,
        true,
        undefined,
        "between_tools",
      );
      const additionalFields = requestInput.additionalModelRequestFields as
        | undefined
        | { output_config?: { effort?: string }; thinking?: { type?: string } };

      assert.equal(additionalFields?.thinking?.type, "between_tools");
      assert.equal(additionalFields?.output_config?.effort, "high");
    });

    test("preserves Opus 5.5 adaptive mode and low effort when thinking is disabled", () => {
      const provider = providerInternals(
        new BedrockChatModelProvider(mockSecretStorage, mockGlobalState),
      );
      const requestInput = provider.buildRequestInput(
        {
          capabilities: {},
          family: "bedrock",
          id: "global.anthropic.claude-opus-5-5",
          maxInputTokens: 872_000,
          maxOutputTokens: 128_000,
          name: "Claude Opus 5.5",
          version: "1.0.0",
        },
        "anthropic.claude-opus-5-5",
        { messages: [], system: [] },
        {},
        undefined,
        false,
        16_000,
        [],
        "high",
        true,
        true,
        undefined,
        "adaptive",
      );
      const additionalFields = requestInput.additionalModelRequestFields as
        | undefined
        | { output_config?: { effort?: string }; thinking?: { type?: string } };

      assert.equal(additionalFields?.thinking?.type, "adaptive");
      assert.equal(additionalFields?.output_config?.effort, "low");
    });

    test("keeps disabled thinking mode for Sonnet 5", () => {
      const requestInput = callBuildRequestInput("global.anthropic.claude-sonnet-5", {});
      const additionalFields = requestInput.additionalModelRequestFields as
        | undefined
        | { thinking?: { type?: string } };

      assert.equal(additionalFields?.thinking?.type, "disabled");
    });

    test("uses adaptive low effort when Opus 5.5 thinking is disabled", () => {
      const requestInput = callBuildRequestInput("global.anthropic.claude-opus-5-5", {});
      const additionalFields = requestInput.additionalModelRequestFields as
        | undefined
        | { output_config?: { effort?: string }; thinking?: { type?: string } };

      assert.equal(additionalFields?.thinking?.type, "adaptive");
      assert.equal(additionalFields?.output_config?.effort, "low");
    });

    test("adds interleaved thinking beta header for Opus 4.6", () => {
      const provider = providerInternals(
        new BedrockChatModelProvider(mockSecretStorage, mockGlobalState),
      );
      const modelId = "anthropic.claude-opus-4-6-v1";

      const betaHeaders = provider.buildBetaHeaders(
        getModelProfile(modelId),
        modelId,
        true,
        false,
        false,
      );

      assert.equal(betaHeaders.includes("interleaved-thinking-2025-05-14"), true);
    });

    test("adds 1M context beta header for models that require opt-in", () => {
      const provider = providerInternals(
        new BedrockChatModelProvider(mockSecretStorage, mockGlobalState),
      );
      const modelId = "global.anthropic.claude-opus-4-6-v1";

      const betaHeaders = provider.buildBetaHeaders(
        getModelProfile(modelId),
        modelId,
        false,
        true,
        false,
      );

      assert.deepStrictEqual(betaHeaders, ["context-1m-2025-08-07"]);
    });

    test("keeps minimal reasoning effort for routed OpenAI models", () => {
      const provider = providerInternals(
        new BedrockChatModelProvider(mockSecretStorage, mockGlobalState),
      );
      const requestInput: { additionalModelRequestFields?: Record<string, unknown> } = {};

      provider.applyReasoningEffort(
        requestInput,
        "global.openai.gpt-oss-120b-1:0",
        "openai.gpt-oss-120b-1:0",
        "minimal",
      );

      assert.equal(requestInput.additionalModelRequestFields?.reasoning_effort, "minimal");
    });

    test("downgrades minimal reasoning effort for non-OpenAI models", () => {
      const provider = providerInternals(
        new BedrockChatModelProvider(mockSecretStorage, mockGlobalState),
      );
      const requestInput: { additionalModelRequestFields?: Record<string, unknown> } = {};

      provider.applyReasoningEffort(
        requestInput,
        "global.qwen.qwen3-coder-480b-a35b-v1:0",
        "qwen.qwen3-coder-480b-a35b-v1:0",
        "minimal",
      );

      assert.equal(requestInput.additionalModelRequestFields?.reasoning_effort, "low");
    });

    test("uses nested reasoning effort for GPT-6 Astra and Luna", () => {
      const provider = providerInternals(
        new BedrockChatModelProvider(mockSecretStorage, mockGlobalState),
      );
      for (const modelId of [
        "global.openai.gpt-6-astra",
        "global.openai.gpt-6-luna",
        "global.openai.gpt-6-sol",
        "global.openai.gpt-6.1-sol",
      ]) {
        const requestInput: { additionalModelRequestFields?: Record<string, unknown> } = {};
        provider.applyReasoningEffort(requestInput, modelId, modelId.replace("global.", ""), "low");

        assert.deepEqual(requestInput.additionalModelRequestFields?.reasoning, { effort: "low" });
        assert.equal(requestInput.additionalModelRequestFields?.reasoning_effort, undefined);
      }
    });

    test("labels non-adaptive effort-capable Claude models as budget thinking", () => {
      const provider = providerInternals(
        new BedrockChatModelProvider(mockSecretStorage, mockGlobalState),
      );
      const modelId = "anthropic.claude-opus-4-6-v1";

      const detail = provider.formatDetail(modelId, 872_000, 128_000, false);
      const tooltip = provider.formatTooltip({
        maxInput: 872_000,
        maxOutput: 128_000,
        modelId,
        providerName: "Anthropic",
        route: "Direct foundation model",
        vision: false,
      });

      assert.match(detail, /budget thinking/);
      assert.doesNotMatch(detail, /adaptive/);
      assert.match(tooltip, /Extended thinking; effort control available/);
      assert.doesNotMatch(tooltip, /Adaptive thinking/);
    });

    test("formats context display from maxInput+maxOutput total", () => {
      const provider = providerInternals(
        new BedrockChatModelProvider(mockSecretStorage, mockGlobalState),
      );
      const modelId = "minimax.minimax-m2.5";
      // maxInput = 196608 - 98304 = 98304 (input budget), maxOutput = 98304
      // total context = 98304 + 98304 = 196608 ≈ 197K
      const inputBudget = 196_608 - 98_304; // 98304

      const detail = provider.formatDetail(modelId, inputBudget, 98_304, false);
      const tooltip = provider.formatTooltip({
        maxInput: inputBudget,
        maxOutput: 98_304,
        modelId,
        providerName: "MiniMax",
        route: "Direct foundation model",
        vision: false,
      });

      // detail should show total context (197K) and output (98K)
      assert.match(detail, /^197K ctx · 98K out/);
      // tooltip should show total context 197K, not the inflated 295K
      assert.match(tooltip, /Context: Window: 197K tokens, Input: 98K tokens, Output: 98K tokens/);
      assert.match(tooltip, /Output: 98K tokens/);
      assert.doesNotMatch(tooltip, /295K tokens/);
    });

    test("shows indicative dollar prices and clarifies they are not Copilot credits", () => {
      const providerInstance = new BedrockChatModelProvider(mockSecretStorage, mockGlobalState);
      const provider = providerInternals(providerInstance);
      const cost = { cache_read: 0.0825, cache_write: 0.33, input: 0.33, output: 2.75 };
      const modelId = "amazon.nova-2-lite-v1:0";

      const detail = provider.formatDetail(modelId, 934_465, 65_535, false, cost);
      const pickerPricing = provider.getPickerPricingMetadata(true, cost);
      const tooltip = provider.formatTooltip({
        cost,
        maxInput: 934_465,
        maxOutput: 65_535,
        modelId,
        providerName: "Amazon",
        route: "Direct foundation model",
        vision: false,
      });

      assert.match(detail, /\$0\.33 in \/ \$2\.75 out/);
      assert.equal(pickerPricing.inputCost, "$0.33");
      assert.equal(pickerPricing.outputCost, "$2.75");
      assert.equal(pickerPricing.cacheCost, "$0.0825");
      assert.equal(pickerPricing.cacheWriteCost, "$0.33");
      assert.equal(pickerPricing.isBYOK, true);
      assert.equal(
        pickerPricing.pricing,
        "AWS pricing (USD / 1M tokens):\nInput: $0.33\nOutput: $2.75\nCache read: $0.0825\nCache write: $0.33\nAWS pricing varies by Region",
      );
      assert.equal(pickerPricing.longContextInputCost, undefined);
      const longContextPricing = provider.getPickerPricingMetadata(true, {
        context_over_200k: { cache_read: 0.02, cache_write: 0.25, input: 0.2, output: 0.75 },
        input: 0.1,
        output: 0.5,
      });
      assert.equal(longContextPricing.longContextInputCost, "$0.2");
      assert.equal(longContextPricing.longContextOutputCost, "$0.75");
      assert.equal(longContextPricing.longContextCacheCost, "$0.02");
      assert.equal(longContextPricing.longContextCacheWriteCost, "$0.25");
      assert.deepEqual(provider.getPickerPricingMetadata(true, { input: 1 }), {
        inputCost: "$1",
        isBYOK: true,
        pricing: "AWS pricing (USD / 1M tokens):\nInput: $1\nAWS pricing varies by Region",
      });
      assert.match(tooltip, /Owner: Amazon/);
      assert.match(tooltip, /AWS pricing \(USD \/ 1M tokens\):/);
      assert.match(tooltip, /In: \$0\.33/);
      assert.match(tooltip, /Out: \$2\.75/);
      assert.match(tooltip, /Invocation route: Direct foundation model/);
      assert.doesNotMatch(tooltip, /ID:|nova-2-lite/);
      assert.doesNotMatch(tooltip, /\$\$/);
      assert.match(tooltip, /Cache read: \$0\.0825/);
      assert.match(tooltip, /Cache write: \$0\.33/);
      assert.match(tooltip, /Window: 1M tokens/);
      assert.match(tooltip, /Pricing note:/);
      assert.match(tooltip, /AWS pricing varies by Region/);
      assert.doesNotMatch(tooltip, /GitHub Copilot credits/);
    });

    test("formats provider cost metadata as ordered AWS USD text", () => {
      const provider = providerInternals(
        new BedrockChatModelProvider(mockSecretStorage, mockGlobalState),
      );
      const modelId = "anthropic.claude-sonnet-5";
      const cost = { cache_read: 0.2, cache_write: 2.5, input: 2, output: 10 };
      const detail = provider.formatDetail(modelId, 936_000, 64_000, false, cost);
      const tooltip = provider.formatTooltip({
        cost,
        maxInput: 936_000,
        maxOutput: 64_000,
        modelId,
        providerName: "Anthropic",
        route: "Direct foundation model",
        vision: false,
      });

      assert.match(detail, /\$2\.00 in \/ \$10\.00 out/);
      assert.doesNotMatch(detail, /\$\$/);
      assert.match(tooltip, /AWS pricing \(USD \/ 1M tokens\): In: \$2\.00, Out: \$10\.00/);
      assert.doesNotMatch(tooltip, /\*\*|&nbsp;/);
      assert.match(
        provider.formatModelDescription({
          cost,
          maxInput: 936_000,
          maxOutput: 64_000,
          modelId,
          providerName: "Anthropic",
          route: "Direct foundation model",
          vision: false,
        }),
        /Owner: Anthropic \| AWS pricing \(USD \/ 1M tokens\):/,
      );
      assert.equal(getModelProfile(modelId).temperatureDeprecated, true);
    });

    test("shows maximum context and a Manage Models hover status for regular models", () => {
      const provider = providerInternals(
        new BedrockChatModelProvider(mockSecretStorage, mockGlobalState),
      );
      const developmentEntry = loadModelsDevelopmentData().get("global.openai.gpt-6-luna");
      assert.ok(developmentEntry);

      const information = provider.getPickerPricingMetadata(true, developmentEntry.cost);
      const display = getModelDisplayMetadata(
        "global.openai.gpt-6-luna",
        developmentEntry.limit.context,
      );

      assert.equal(display.statusIcon?.id, "info");
      assert.match(
        display.infoText?.local_harness_context ?? "",
        /context-size settings are available only in the local Copilot harness/,
      );
      assert.equal(display.maxContextWindowTokens, developmentEntry.limit.context);
      assert.equal(information.inputCost, "$0.1");
      assert.equal(information.longContextInputCost, "$0.2");

      const detail = provider.formatModelDescription({
        cost: developmentEntry.cost,
        maxInput: developmentEntry.limit.context - developmentEntry.limit.output,
        maxOutput: developmentEntry.limit.output,
        modelId: "global.openai.gpt-6-luna",
        providerName: "OpenAI",
        vision: true,
      });
      assert.match(detail, /Owner: OpenAI/);
      assert.match(detail, /Context: Window: 1M tokens, Input: 922K tokens, Output: 128K tokens/);
      assert.match(detail, / \| AWS pricing/);
    });

    test("puts model details in the Manage Models name hover for warned and un-warned models", () => {
      const warning = getModelDataRetentionWarning("global.anthropic.claude-fable-5-1").warningText
        ?.data_retention;
      const regularMetadata = getModelDisplayMetadata("anthropic.claude-haiku-4-5", 200_000);
      const fableMetadata = getModelDisplayMetadata("anthropic.claude-fable-5", 964_000);

      assert.ok(warning);
      assert.match(warning, /retained for 30 days/);
      assert.match(warning, /manually reviewed/);
      assert.match(warning, /aws_review/);
      assert.ok(fableMetadata.statusIcon);
      assert.ok(regularMetadata.statusIcon);
      assert.equal(regularMetadata.maxContextWindowTokens, 200_000);
      assert.equal(fableMetadata.maxContextWindowTokens, 964_000);
      assert.equal(fableMetadata.statusIcon?.id, "warning");
      assert.equal(regularMetadata.statusIcon?.id, "info");
      assert.equal(regularMetadata.warningText, undefined);
      assert.deepEqual(
        getModelDisplayMetadata("anthropic.claude-haiku-4-5", undefined, {
          temperature: "Temperature setting is ignored.",
        }).warningText,
        { temperature: "Temperature setting is ignored." },
      );

      const provider = providerInternals(
        new BedrockChatModelProvider(mockSecretStorage, mockGlobalState),
      );
      const regularTooltip = provider.formatModelDescription({
        cost: { input: 0.1, output: 0.5 },
        maxInput: 136_000,
        maxOutput: 64_000,
        modelId: "anthropic.claude-haiku-4-5",
        providerName: "Anthropic",
        vision: true,
        warningText: regularMetadata.warningText,
      });
      const fableTooltip = provider.formatModelDescription({
        maxInput: 900_000,
        maxOutput: 64_000,
        modelId: "anthropic.claude-fable-5",
        providerName: "Anthropic",
        vision: false,
        warningText: { temperature: "Temperature setting is ignored." },
      });

      assert.match(regularTooltip, /Owner: Anthropic/);
      assert.match(
        regularTooltip,
        /Per-model Bedrock context-size settings are available only in the local Copilot harness/,
      );
      assert.match(
        regularTooltip,
        /Pricing note: AWS pricing varies by Region; verify current AWS rates\./,
      );
      assert.match(
        regularTooltip,
        /Context: Window: 200K tokens, Input: 136K tokens, Output: 64K tokens/,
      );
      assert.match(regularTooltip, /Features:.*Image input/);
      assert.match(
        fableTooltip,
        /Data retention warning: Data is retained for 30 days and might be manually reviewed\./,
      );
      assert.match(fableTooltip, /Model notes: Temperature setting is ignored\./);
      assert.doesNotMatch(fableTooltip, /Invocation route/);
      assert.match(
        fableTooltip,
        /Pricing note: AWS pricing varies by Region; verify current AWS rates\./,
      );
      assert.doesNotMatch(fableTooltip, /\*\*|&nbsp;/);
    });
  });

  suite("utils/convertMessages", () => {
    test("converts basic user/assistant text messages to Bedrock format", () => {
      const messages: vscode.LanguageModelChatMessage[] = [
        {
          content: [new vscode.LanguageModelTextPart("hi")],
          name: undefined,
          role: vscode.LanguageModelChatMessageRole.User,
        },
        {
          content: [new vscode.LanguageModelTextPart("hello")],
          name: undefined,
          role: vscode.LanguageModelChatMessageRole.Assistant,
        },
      ];
      const out = convertMessages(messages, "test.model-id");

      // Check structure
      assert.ok(out.messages);
      assert.ok(Array.isArray(out.messages));
      assert.equal(out.messages.length, 2);

      // Check first message (user)
      assert.equal(out.messages[0].role, "user");
      assert.ok(Array.isArray(out.messages[0].content));
      assert.equal(out.messages[0].content?.length, 1);
      assert.equal(out.messages[0].content?.[0]?.text, "hi");

      // Check second message (assistant)
      assert.equal(out.messages[1].role, "assistant");
      assert.ok(Array.isArray(out.messages[1].content));
      assert.equal(out.messages[1].content?.length, 1);
      assert.equal(out.messages[1].content?.[0]?.text, "hello");
    });

    test("converts assistant message with tool call to Bedrock format", () => {
      const toolCall = new vscode.LanguageModelToolCallPart("call1", "search", { q: "hello" });
      const messages: vscode.LanguageModelChatMessage[] = [
        {
          content: [new vscode.LanguageModelTextPart("Let me search for that")],
          name: undefined,
          role: vscode.LanguageModelChatMessageRole.User,
        },
        {
          content: [new vscode.LanguageModelTextPart("I'll search for you."), toolCall],
          name: undefined,
          role: vscode.LanguageModelChatMessageRole.Assistant,
        },
      ];

      const out = convertMessages(messages, "test.model-id");

      assert.equal(out.messages.length, 2);
      assert.equal(out.messages[1].role, "assistant");
      assert.equal(out.messages[1].content?.length, 2);

      // Check text content
      assert.equal(out.messages[1].content?.[0]?.text, "I'll search for you.");

      // Check tool call
      const toolUse = out.messages[1].content?.[1]?.toolUse;
      assert.ok(toolUse);
      assert.equal(toolUse.toolUseId, "call1");
      assert.equal(toolUse.name, "search");
      assert.deepStrictEqual(toolUse.input, { q: "hello" });
    });

    test("converts user message with tool result to Bedrock format", () => {
      const toolResult = new vscode.LanguageModelToolResultPart("call1", [
        new vscode.LanguageModelTextPart("Search results: Found 5 items"),
      ]);
      const messages: vscode.LanguageModelChatMessage[] = [
        {
          content: [new vscode.LanguageModelTextPart("Search for cats")],
          name: undefined,
          role: vscode.LanguageModelChatMessageRole.User,
        },
        {
          content: [new vscode.LanguageModelToolCallPart("call1", "search", { q: "cats" })],
          name: undefined,
          role: vscode.LanguageModelChatMessageRole.Assistant,
        },
        {
          content: [toolResult],
          name: undefined,
          role: vscode.LanguageModelChatMessageRole.User,
        },
      ];

      const out = convertMessages(messages, "test.model-id");

      assert.equal(out.messages.length, 3);
      assert.equal(out.messages[2].role, "user");

      // Check tool result
      const toolResultBlock = out.messages[2].content?.[0]?.toolResult;
      assert.ok(toolResultBlock);
      assert.equal(toolResultBlock.toolUseId, "call1");
      assert.ok(Array.isArray(toolResultBlock.content));
      assert.equal(toolResultBlock.content?.length, 1);
      // Tool result content is wrapped in a text object
      const resultContent: any = toolResultBlock.content?.[0];
      assert.ok(resultContent.text);
      assert.equal(resultContent.text, "Search results: Found 5 items");
    });

    test("preserves unmatched continuation tool results as text instead of Bedrock tool results", () => {
      const messages: vscode.LanguageModelChatMessage[] = [
        {
          content: [new vscode.LanguageModelTextPart("Search for cats")],
          name: undefined,
          role: vscode.LanguageModelChatMessageRole.User,
        },
        {
          content: [new vscode.LanguageModelToolCallPart("call1", "search", { q: "cats" })],
          name: undefined,
          role: vscode.LanguageModelChatMessageRole.Assistant,
        },
        {
          content: [
            new vscode.LanguageModelToolResultPart("call1", [
              new vscode.LanguageModelTextPart("Search results: Found 5 items"),
            ]),
          ],
          name: undefined,
          role: vscode.LanguageModelChatMessageRole.User,
        },
        {
          content: [
            new vscode.LanguageModelToolResultPart("call1", [
              new vscode.LanguageModelTextPart("Duplicate result from prior turn"),
            ]),
            new vscode.LanguageModelTextPart("Continue from the result"),
          ],
          name: undefined,
          role: vscode.LanguageModelChatMessageRole.User,
        },
      ];

      const out = convertMessages(messages, "test.model-id");
      const latestUserContent = out.messages.at(-1)?.content ?? [];

      assert.equal(
        out.messages.flatMap((message) => message.content ?? []).filter((block) => block.toolResult)
          .length,
        1,
      );
      assert.ok(
        latestUserContent.some((block) => block.text?.includes("Duplicate result from prior turn")),
      );
      assert.ok(latestUserContent.some((block) => block.text === "Continue from the result"));
    });

    test("serializes structured tool results as JSON text", () => {
      const toolResult = new vscode.LanguageModelToolResultPart("call1", [
        { result: "ok", values: [1, 2, 3] },
      ]);
      const messages: vscode.LanguageModelChatMessage[] = [
        {
          content: [new vscode.LanguageModelToolCallPart("call1", "search", { q: "cats" })],
          name: undefined,
          role: vscode.LanguageModelChatMessageRole.Assistant,
        },
        {
          content: [toolResult],
          name: undefined,
          role: vscode.LanguageModelChatMessageRole.User,
        },
      ];

      const out = convertMessages(messages, "test.model-id");
      const resultContent = out.messages[1].content?.[0]?.toolResult?.content?.[0] as {
        text?: string;
      };

      assert.equal(resultContent.text, '{"result":"ok","values":[1,2,3]}');
    });

    test("merges consecutive user messages", () => {
      const messages: vscode.LanguageModelChatMessage[] = [
        {
          content: [new vscode.LanguageModelTextPart("First user message")],
          name: undefined,
          role: vscode.LanguageModelChatMessageRole.User,
        },
        {
          content: [new vscode.LanguageModelTextPart("Second user message")],
          name: undefined,
          role: vscode.LanguageModelChatMessageRole.User,
        },
      ];

      const out = convertMessages(messages, "test.model-id");

      // Should merge consecutive user messages into one
      assert.equal(out.messages.length, 1);
      assert.equal(out.messages[0].role, "user");
      assert.equal(out.messages[0].content?.length, 2);
      assert.equal(out.messages[0].content?.[0]?.text, "First user message");
      assert.equal(out.messages[0].content?.[1]?.text, "Second user message");
    });
  });

  suite("reconcileBedrockToolResults", () => {
    test("converts duplicate and stale tool results to text", () => {
      const messages: Message[] = [
        {
          content: [{ toolUse: { input: {}, name: "search", toolUseId: "old-call" } }],
          role: "assistant",
        },
        {
          content: [{ toolResult: { content: [{ text: "Old result" }], toolUseId: "old-call" } }],
          role: "user",
        },
        { content: [{ text: "Final answer" }], role: "assistant" },
        {
          content: [
            { toolResult: { content: [{ text: "Replayed old result" }], toolUseId: "old-call" } },
            { toolResult: { content: [{ text: "Duplicate result" }], toolUseId: "old-call" } },
          ],
          role: "user",
        },
      ];

      assert.equal(reconcileBedrockToolResults(messages), 2);
      assert.equal(messages[1]?.content?.[0]?.toolResult?.toolUseId, "old-call");
      assert.match(messages[3]?.content?.[0]?.text ?? "", /Replayed old result/);
      assert.match(messages[3]?.content?.[1]?.text ?? "", /Duplicate result/);
      assert.equal(
        messages.flatMap((message) => message.content ?? []).filter((block) => block.toolResult)
          .length,
        1,
      );
    });
  });

  suite("utils/stripThinkingContent", () => {
    test("strips reasoningContent blocks from messages", () => {
      const messages = [
        {
          content: [
            { reasoningContent: { reasoningText: { signature: "sig123", text: "thinking..." } } },
            { text: "Hello" },
          ],
          role: "assistant" as const,
        },
      ];

      const result = stripThinkingContent(messages);

      assert.equal(result.length, 1);
      assert.equal(result[0].content?.length, 1);
      assert.equal(result[0].content?.[0]?.text, "Hello");
    });

    test("strips thinking and redacted_thinking blocks from messages", () => {
      const messages = [
        {
          content: [
            nonStandardBlock({ thinking: "internal thought process" }),
            { text: "Response" },
          ],
          role: "assistant" as const,
        },
        {
          content: [
            nonStandardBlock({ redacted_thinking: "redacted" }),
            { text: "Another response" },
          ],
          role: "assistant" as const,
        },
      ];

      const result = stripThinkingContent(messages);

      assert.equal(result.length, 2);
      assert.equal(result[0].content?.length, 1);
      assert.equal(result[0].content?.[0]?.text, "Response");
      assert.equal(result[1].content?.length, 1);
      assert.equal(result[1].content?.[0]?.text, "Another response");
    });

    test("preserves non-thinking content", () => {
      const messages = [
        {
          content: [{ text: "User message" }],
          role: "user" as const,
        },
        {
          content: [
            { text: "Assistant response" },
            { toolUse: { input: {}, name: "search", toolUseId: "123" } },
          ],
          role: "assistant" as const,
        },
      ];

      const result = stripThinkingContent(messages);

      assert.equal(result.length, 2);
      assert.equal(result[0].content?.length, 1);
      assert.equal(result[1].content?.length, 2);
    });

    test("removes empty messages after stripping", () => {
      const messages = [
        {
          content: [
            { reasoningContent: { reasoningText: { signature: "sig", text: "only thinking" } } },
          ],
          role: "assistant" as const,
        },
        {
          content: [{ text: "Keep this" }],
          role: "user" as const,
        },
      ];

      const result = stripThinkingContent(messages);

      assert.equal(result.length, 1);
      assert.equal(result[0].role, "user");
      assert.equal(result[0].content?.[0]?.text, "Keep this");
    });

    test("handles messages without content", () => {
      const messages = [
        { content: undefined, role: "user" as const },
        { content: [{ text: "Hello" }], role: "assistant" as const },
      ];

      const result = stripThinkingContent(messages);

      // Message without content is removed (empty content array check)
      assert.equal(result.length, 1);
      assert.equal(result[0].content?.[0]?.text, "Hello");
    });
  });

  suite("utils/tools", () => {
    test("convertTools creates Bedrock tool configuration", () => {
      const out = convertTools(
        {
          toolMode: vscode.LanguageModelChatToolMode.Auto,
          tools: [
            {
              description: "Does something",
              inputSchema: {
                additionalProperties: false,
                properties: { x: { type: "number" } },
                required: ["x"],
                type: "object",
              },
              name: "do_something",
            },
          ],
        },
        "test.model-id",
      );

      assert.ok(out);
      assert.ok(out.tools);
      assert.ok(Array.isArray(out.tools));
      assert.equal(out.tools.length, 1);

      // Check tool spec
      const toolSpec = out.tools[0].toolSpec;
      assert.ok(toolSpec);
      assert.equal(toolSpec.name, "do_something");
      assert.equal(toolSpec.description, "Does something");
      assert.ok(toolSpec.inputSchema);
      assert.ok(toolSpec.inputSchema.json);

      // Tool choice should not be set for models that don't support it
      assert.equal(out.toolChoice, undefined);
    });

    test("convertTools omits tool-definition cache points for Nova", () => {
      const out = convertTools(
        {
          tools: [{ description: "Tool", inputSchema: { type: "object" }, name: "my_tool" }],
        },
        "amazon.nova-2-lite-v1:0",
        false,
        true,
      );

      assert.ok(out);
      assert.equal(
        out.tools?.some((tool) => "cachePoint" in tool),
        false,
      );
    });

    test("convertTools omits tools when models.dev explicitly disables tool calls", () => {
      const out = convertTools(
        {
          tools: [{ description: "Tool", inputSchema: { type: "object" }, name: "my_tool" }],
        },
        "google.gemma-3-27b-it",
        false,
        false,
        false,
      );

      assert.equal(out, undefined);
    });

    test("convertTools retains tool-definition caching for supported Claude models", () => {
      const out = convertTools(
        {
          tools: [{ description: "Tool", inputSchema: { type: "object" }, name: "my_tool" }],
        },
        "anthropic.claude-sonnet-4-6",
        false,
        true,
      );

      assert.ok(out);
      assert.equal(
        out.tools?.some((tool) => "cachePoint" in tool),
        true,
      );
    });

    test("convertTools sets toolChoice for models that support it", () => {
      // Test with Anthropic model (supports tool choice)
      const out = convertTools(
        {
          toolMode: vscode.LanguageModelChatToolMode.Required,
          tools: [
            {
              description: "Only tool",
              inputSchema: { type: "object" },
              name: "only_tool",
            },
          ],
        },
        "anthropic.claude-3-5-sonnet-20241022-v2:0",
      );

      assert.ok(out);
      assert.ok(out.toolChoice);
      assert.deepStrictEqual(out.toolChoice, { any: {} });
    });

    test("convertTools handles Auto tool mode", () => {
      const out = convertTools(
        {
          toolMode: vscode.LanguageModelChatToolMode.Auto,
          tools: [
            {
              description: "Tool",
              inputSchema: { type: "object" },
              name: "my_tool",
            },
          ],
        },
        "anthropic.claude-3-5-sonnet-20241022-v2:0",
      );

      assert.ok(out);
      assert.ok(out.toolChoice);
      assert.deepStrictEqual(out.toolChoice, { auto: {} });
    });

    test("convertTools returns undefined when no tools provided", () => {
      const out = convertTools(
        {
          tools: [],
        },
        "test.model-id",
      );

      assert.equal(out, undefined);
    });
  });

  // Note: validation tests skipped - validateBedrockMessages now validates converted messages

  suite("logger", () => {
    test("logs per-call token limits and Bedrock usage for a chat stream at debug level", async () => {
      const logs: { args: unknown[]; level: string }[] = [];
      const mockChannel = {
        debug: (message: string, ...arguments_: unknown[]) =>
          recordLog(logs, "debug", message, arguments_),
        error: (message: string, ...arguments_: unknown[]) =>
          recordLog(logs, "error", message, arguments_),
        info: (message: string, ...arguments_: unknown[]) =>
          recordLog(logs, "info", message, arguments_),
        trace: (message: string, ...arguments_: unknown[]) =>
          recordLog(logs, "trace", message, arguments_),
        warn: (message: string, ...arguments_: unknown[]) =>
          recordLog(logs, "warn", message, arguments_),
      } as unknown as vscode.LogOutputChannel;
      logger.initialize(mockChannel, vscode.ExtensionMode.Test);

      const tokenCallContext = {
        estimatedInputTokens: 12_000,
        inputTokenLimit: 5e4,
        modelOutputTokenLimit: 8.192e3,
        outputTokenLimit: 2000,
      };
      const events: ConverseStreamOutput[] = [
        { contentBlockDelta: { contentBlockIndex: 0, delta: { text: "response" } } },
        { messageStop: { stopReason: "end_turn" } },
        {
          metadata: {
            metrics: { latencyMs: 1 },
            usage: {
              cacheReadInputTokens: 100,
              cacheWriteInputTokens: 50,
              inputTokens: 300,
              outputTokens: 1.8e3,
              totalTokens: 2.25e3,
            },
          },
        },
      ];

      await new StreamProcessor().processStream(
        (async function* () {
          yield* events;
        })(),
        { report: () => {} },
        new vscode.CancellationTokenSource().token,
        tokenCallContext,
      );

      const usageLog = logs.find((entry) => String(entry.args[0]).includes("Bedrock token usage"));
      assert.ok(usageLog);
      assert.equal(usageLog.level, "debug");
      assert.deepEqual(usageLog.args[1], {
        ...tokenCallContext,
        cacheReadInputTokens: 100,
        cacheWriteInputTokens: 50,
        inputTokens: 300,
        outputTokens: 1.8e3,
        outputTokensIncludeReasoning: true,
        promptTokens: 450,
        totalTokens: 2.25e3,
      });
    });

    test("logger supports all log levels", () => {
      const logs: { args: unknown[]; level: string }[] = [];
      const mockChannel = {
        debug: (message: string, ...arguments_: unknown[]) =>
          recordLog(logs, "debug", message, arguments_),
        error: (message: string, ...arguments_: unknown[]) =>
          recordLog(logs, "error", message, arguments_),
        info: (message: string, ...arguments_: unknown[]) =>
          recordLog(logs, "info", message, arguments_),
        trace: (message: string, ...arguments_: unknown[]) =>
          recordLog(logs, "trace", message, arguments_),
        warn: (message: string, ...arguments_: unknown[]) =>
          recordLog(logs, "warn", message, arguments_),
      } as unknown as vscode.LogOutputChannel;

      logger.initialize(mockChannel, vscode.ExtensionMode.Development);

      logger.trace("Trace message");
      logger.debug("Debug message");
      logger.info("Info message");
      logger.warn("Warn message");
      logger.error("Error message");

      assert.equal(logs.length, 5);
      assert.equal(logs[0].level, "trace");
      assert.equal(logs[0].args[0], "Trace message");
      assert.equal(logs[1].level, "debug");
      assert.equal(logs[1].args[0], "Debug message");
      assert.equal(logs[2].level, "info");
      assert.equal(logs[2].args[0], "Info message");
      assert.equal(logs[3].level, "warn");
      assert.equal(logs[3].args[0], "Warn message");
      assert.equal(logs[4].level, "error");
      assert.equal(logs[4].args[0], "Error message");
    });

    test("logger.log (deprecated) uses info level", () => {
      const logs: { args: unknown[]; level: string }[] = [];
      const mockChannel = {
        debug: (message: string, ...arguments_: unknown[]) =>
          recordLog(logs, "debug", message, arguments_),
        error: (message: string, ...arguments_: unknown[]) =>
          recordLog(logs, "error", message, arguments_),
        info: (message: string, ...arguments_: unknown[]) =>
          recordLog(logs, "info", message, arguments_),
        trace: (message: string, ...arguments_: unknown[]) =>
          recordLog(logs, "trace", message, arguments_),
        warn: (message: string, ...arguments_: unknown[]) =>
          recordLog(logs, "warn", message, arguments_),
      } as unknown as vscode.LogOutputChannel;

      logger.initialize(mockChannel, vscode.ExtensionMode.Production);
      logger.log("Deprecated log message", { key: "value" });

      assert.equal(logs.length, 1);
      assert.equal(logs[0].level, "info");
      assert.equal(logs[0].args[0], "Deprecated log message");
      assert.deepStrictEqual(logs[0].args[1], { key: "value" });
    });

    test("logger passes structured data directly", () => {
      const logs: { args: unknown[]; level: string }[] = [];
      const mockChannel = {
        debug: (message: string, ...arguments_: unknown[]) =>
          recordLog(logs, "debug", message, arguments_),
        error: (message: string, ...arguments_: unknown[]) =>
          recordLog(logs, "error", message, arguments_),
        info: (message: string, ...arguments_: unknown[]) =>
          recordLog(logs, "info", message, arguments_),
        trace: (message: string, ...arguments_: unknown[]) =>
          recordLog(logs, "trace", message, arguments_),
        warn: (message: string, ...arguments_: unknown[]) =>
          recordLog(logs, "warn", message, arguments_),
      } as unknown as vscode.LogOutputChannel;

      logger.initialize(mockChannel, vscode.ExtensionMode.Development);
      logger.info("Object test", { nested: { key: "value" } });

      assert.equal(logs.length, 1);
      assert.equal(logs[0].args[0], "Object test");
      // Structured data is preserved as an object, not formatted
      assert.deepStrictEqual(logs[0].args[1], { nested: { key: "value" } });
    });
  });

  suite("buildModelCandidates", () => {
    test("preferRegional=false (default): prioritizes global profiles", () => {
      const provider = new BedrockChatModelProvider(mockSecretStorage, mockGlobalState);
      const models = [createTestModel("anthropic.claude-3-5-sonnet-20241022-v2:0")];
      const availableProfiles = new Set([
        "global.anthropic.claude-3-5-sonnet-20241022-v2:0",
        "us-west-2.anthropic.claude-3-5-sonnet-20241022-v2:0",
      ]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- private-method test
      const candidates = (provider as any).buildModelCandidates(
        models,
        availableProfiles,
        "us-west-2",
        false,
      );

      assert.equal(candidates.length, 1);

      assert.equal(candidates[0].modelIdToUse, "global.anthropic.claude-3-5-sonnet-20241022-v2:0");

      assert.equal(candidates[0].hasInferenceProfile, true);
    });

    test("preferRegional=true: prioritizes regional profiles", () => {
      const provider = new BedrockChatModelProvider(mockSecretStorage, mockGlobalState);
      const models = [createTestModel("anthropic.claude-3-5-sonnet-20241022-v2:0")];
      const availableProfiles = new Set([
        "global.anthropic.claude-3-5-sonnet-20241022-v2:0",
        "us-west-2.anthropic.claude-3-5-sonnet-20241022-v2:0",
      ]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- private-method test
      const candidates = (provider as any).buildModelCandidates(
        models,
        availableProfiles,
        "us-west-2",
        true,
      );

      assert.equal(candidates.length, 1);

      assert.equal(
        candidates[0].modelIdToUse,
        "us-west-2.anthropic.claude-3-5-sonnet-20241022-v2:0",
      );

      assert.equal(candidates[0].hasInferenceProfile, true);
    });

    test("preferRegional=true, regional unavailable: falls back to global", () => {
      const provider = new BedrockChatModelProvider(mockSecretStorage, mockGlobalState);
      const models = [createTestModel("anthropic.claude-3-5-sonnet-20241022-v2:0")];
      const availableProfiles = new Set(["global.anthropic.claude-3-5-sonnet-20241022-v2:0"]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- private-method test
      const candidates = (provider as any).buildModelCandidates(
        models,
        availableProfiles,
        "us-west-2",
        true,
      );

      assert.equal(candidates.length, 1);

      assert.equal(candidates[0].modelIdToUse, "global.anthropic.claude-3-5-sonnet-20241022-v2:0");

      assert.equal(candidates[0].hasInferenceProfile, true);
    });

    test("preferRegional=false, global unavailable: uses regional profile", () => {
      const provider = new BedrockChatModelProvider(mockSecretStorage, mockGlobalState);
      const models = [createTestModel("anthropic.claude-3-5-sonnet-20241022-v2:0")];
      const availableProfiles = new Set(["us-west-2.anthropic.claude-3-5-sonnet-20241022-v2:0"]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- private-method test
      const candidates = (provider as any).buildModelCandidates(
        models,
        availableProfiles,
        "us-west-2",
        false,
      );

      assert.equal(candidates.length, 1);

      assert.equal(
        candidates[0].modelIdToUse,
        "us-west-2.anthropic.claude-3-5-sonnet-20241022-v2:0",
      );

      assert.equal(candidates[0].hasInferenceProfile, true);
    });

    test("uses detected regional profile when prefix differs from region prefix", () => {
      const provider = new BedrockChatModelProvider(mockSecretStorage, mockGlobalState);
      const models = [createTestModel("anthropic.claude-opus-4-7")];
      const availableProfiles = new Set([
        "au.anthropic.claude-opus-4-7",
        "jp.anthropic.claude-opus-4-7",
      ]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- private-method test
      const candidates = (provider as any).buildModelCandidates(
        models,
        availableProfiles,
        "ap",
        false,
        "ap-northeast-1",
      );

      assert.equal(candidates.length, 1);
      assert.equal(candidates[0].modelIdToUse, "jp.anthropic.claude-opus-4-7");
      assert.equal(candidates[0].hasInferenceProfile, true);
    });

    test("no profiles available: uses base model", () => {
      const provider = new BedrockChatModelProvider(mockSecretStorage, mockGlobalState);
      const models = [createTestModel("anthropic.claude-3-5-sonnet-20241022-v2:0")];
      const availableProfiles = new Set<string>();

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- private-method test
      const candidates = (provider as any).buildModelCandidates(
        models,
        availableProfiles,
        "us-west-2",
        false,
      );

      assert.equal(candidates.length, 1);

      assert.equal(candidates[0].modelIdToUse, "anthropic.claude-3-5-sonnet-20241022-v2:0");

      assert.equal(candidates[0].hasInferenceProfile, false);
    });

    test("filters models without streaming support", () => {
      const provider = new BedrockChatModelProvider(mockSecretStorage, mockGlobalState);
      const models = [
        {
          ...createTestModel("no-streaming-model"),
          responseStreamingSupported: false,
        },
      ];
      const availableProfiles = new Set<string>();

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- private-method test
      const candidates = (provider as any).buildModelCandidates(
        models,
        availableProfiles,
        "us-west-2",
        false,
      );

      assert.equal(candidates.length, 0);
    });

    test("filters models without TEXT output modality", () => {
      const provider = new BedrockChatModelProvider(mockSecretStorage, mockGlobalState);
      const models = [
        {
          ...createTestModel("embedding-only-model"),
          outputModalities: ["EMBEDDING"],
        },
      ];
      const availableProfiles = new Set<string>();

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- private-method test
      const candidates = (provider as any).buildModelCandidates(
        models,
        availableProfiles,
        "us-west-2",
        false,
      );

      assert.equal(candidates.length, 0);
    });

    test("returns correct candidate structure", () => {
      const provider = new BedrockChatModelProvider(mockSecretStorage, mockGlobalState);
      const model = createTestModel("anthropic.claude-3-5-sonnet-20241022-v2:0");
      const models = [model];
      const availableProfiles = new Set(["global.anthropic.claude-3-5-sonnet-20241022-v2:0"]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- private-method test
      const candidates = (provider as any).buildModelCandidates(
        models,
        availableProfiles,
        "us-west-2",
        false,
      );

      assert.equal(candidates.length, 1);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- private-method test
      const candidate = candidates[0];
      assert.ok(candidate);

      assert.equal(candidate.modelIdToUse, "global.anthropic.claude-3-5-sonnet-20241022-v2:0");

      assert.equal(candidate.hasInferenceProfile, true);

      assert.deepStrictEqual(candidate.model, model);
    });
  });

  suite("findAlternativeProfile", () => {
    test("preferRegional=false, global fails: falls back to regional profile", async () => {
      const provider = createMockClientProvider(false);
      const model = createTestModel("anthropic.claude-3-5-sonnet-20241022-v2:0");
      const candidate = {
        hasInferenceProfile: true,
        model,
        modelIdToUse: "global.anthropic.claude-3-5-sonnet-20241022-v2:0",
      };
      const availableProfiles = new Set([
        "global.anthropic.claude-3-5-sonnet-20241022-v2:0",
        "us-west-2.anthropic.claude-3-5-sonnet-20241022-v2:0",
      ]);
      const abortController = new AbortController();

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- private-method test
      const result = await (provider as any).findAlternativeProfile(
        candidate,
        "us-west-2",
        availableProfiles,
        false,
        abortController.signal,
      );

      assert.equal(result.isAccessible, true);

      assert.equal(result.hasInferenceProfile, true);

      assert.equal(result.modelIdToUse, "us-west-2.anthropic.claude-3-5-sonnet-20241022-v2:0");
    });

    test("global failure falls back to alternate regional profile", async () => {
      const provider = createMockClientProvider(false);
      const model = createTestModel("anthropic.claude-opus-4-7");
      const candidate = {
        hasInferenceProfile: true,
        model,
        modelIdToUse: "global.anthropic.claude-opus-4-7",
      };
      const availableProfiles = new Set([
        "au.anthropic.claude-opus-4-7",
        "global.anthropic.claude-opus-4-7",
        "jp.anthropic.claude-opus-4-7",
      ]);
      const abortController = new AbortController();

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- private-method test
      const result = await (provider as any).findAlternativeProfile(
        candidate,
        "ap",
        availableProfiles,
        false,
        abortController.signal,
        "ap-northeast-1",
      );

      assert.equal(result.isAccessible, true);
      assert.equal(result.hasInferenceProfile, true);
      assert.equal(result.modelIdToUse, "jp.anthropic.claude-opus-4-7");
    });

    test("preferRegional=false, regional fails: falls back to global profile", async () => {
      const provider = createMockClientProvider(false);
      const model = createTestModel("anthropic.claude-3-5-sonnet-20241022-v2:0");
      const candidate = {
        hasInferenceProfile: true,
        model,
        modelIdToUse: "us-west-2.anthropic.claude-3-5-sonnet-20241022-v2:0",
      };
      const availableProfiles = new Set([
        "global.anthropic.claude-3-5-sonnet-20241022-v2:0",
        "us-west-2.anthropic.claude-3-5-sonnet-20241022-v2:0",
      ]);
      const abortController = new AbortController();

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- private-method test
      const result = await (provider as any).findAlternativeProfile(
        candidate,
        "us-west-2",
        availableProfiles,
        false,
        abortController.signal,
      );

      assert.equal(result.isAccessible, true);

      assert.equal(result.hasInferenceProfile, true);

      assert.equal(result.modelIdToUse, "global.anthropic.claude-3-5-sonnet-20241022-v2:0");
    });

    test("preferRegional=true, regional fails: skips global fallback, tries base model", async () => {
      const provider = createMockClientProvider(true);
      const model = createTestModel("anthropic.claude-3-5-sonnet-20241022-v2:0");
      const candidate = {
        hasInferenceProfile: true,
        model,
        modelIdToUse: "us-west-2.anthropic.claude-3-5-sonnet-20241022-v2:0",
      };
      const availableProfiles = new Set([
        "global.anthropic.claude-3-5-sonnet-20241022-v2:0",
        "us-west-2.anthropic.claude-3-5-sonnet-20241022-v2:0",
      ]);
      const abortController = new AbortController();

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- private-method test
      const result = await (provider as any).findAlternativeProfile(
        candidate,
        "us-west-2",
        availableProfiles,
        true,
        abortController.signal,
      );

      // Should skip global profile and go directly to base model

      assert.equal(result.isAccessible, true);

      assert.equal(result.hasInferenceProfile, false);

      assert.equal(result.modelIdToUse, "anthropic.claude-3-5-sonnet-20241022-v2:0");
    });

    test("preferRegional=true, global fails: still tries regional fallback", async () => {
      const provider = createMockClientProvider(false);
      const model = createTestModel("anthropic.claude-3-5-sonnet-20241022-v2:0");
      const candidate = {
        hasInferenceProfile: true,
        model,
        modelIdToUse: "global.anthropic.claude-3-5-sonnet-20241022-v2:0",
      };
      const availableProfiles = new Set([
        "global.anthropic.claude-3-5-sonnet-20241022-v2:0",
        "us-west-2.anthropic.claude-3-5-sonnet-20241022-v2:0",
      ]);
      const abortController = new AbortController();

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- private-method test
      const result = await (provider as any).findAlternativeProfile(
        candidate,
        "us-west-2",
        availableProfiles,
        true,
        abortController.signal,
      );

      // Should try regional profile even when preferRegional=true

      assert.equal(result.isAccessible, true);

      assert.equal(result.hasInferenceProfile, true);

      assert.equal(result.modelIdToUse, "us-west-2.anthropic.claude-3-5-sonnet-20241022-v2:0");
    });

    test("no alternative profile available: falls back to base model", async () => {
      const provider = createMockClientProvider(true);
      const model = createTestModel("anthropic.claude-3-5-sonnet-20241022-v2:0");
      const candidate = {
        hasInferenceProfile: true,
        model,
        modelIdToUse: "global.anthropic.claude-3-5-sonnet-20241022-v2:0",
      };
      const availableProfiles = new Set(["global.anthropic.claude-3-5-sonnet-20241022-v2:0"]);
      const abortController = new AbortController();

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- private-method test
      const result = await (provider as any).findAlternativeProfile(
        candidate,
        "us-west-2",
        availableProfiles,
        false,
        abortController.signal,
      );

      assert.equal(result.isAccessible, true);

      assert.equal(result.hasInferenceProfile, false);

      assert.equal(result.modelIdToUse, "anthropic.claude-3-5-sonnet-20241022-v2:0");
    });

    test("no accessible alternative or base model: returns inaccessible", async () => {
      const provider = createMockClientProvider(false);
      const model = createTestModel("anthropic.claude-3-5-sonnet-20241022-v2:0");
      const candidate = {
        hasInferenceProfile: true,
        model,
        modelIdToUse: "global.anthropic.claude-3-5-sonnet-20241022-v2:0",
      };
      const availableProfiles = new Set(["global.anthropic.claude-3-5-sonnet-20241022-v2:0"]);
      const abortController = new AbortController();

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- private-method test
      const result = await (provider as any).findAlternativeProfile(
        candidate,
        "us-west-2",
        availableProfiles,
        false,
        abortController.signal,
      );

      assert.equal(result.isAccessible, false);

      assert.equal(result.hasInferenceProfile, true);

      assert.equal(result.modelIdToUse, "global.anthropic.claude-3-5-sonnet-20241022-v2:0");
    });
  });

  suite("calculateThinkingConfig", () => {
    const thinkingProfile = { supportsThinking: true };
    const nonThinkingProfile = { supportsThinking: false };

    test("large model defaults produce 16k budget (base budget is the binding constraint)", () => {
      // Claude Sonnet 4: maxOutputTokens = 64000
      // baseBudget = 16000, maxBudgetFromOutput = 16000, visibleReserve = max(100, 16000) = 16000
      // maxTokensForRequest - visibleReserve = 64000 - 16000 = 48000
      // budgetTokens = min(16000, 16000, 48000) = 16000
      const result = callCalcThinkingConfig(thinkingProfile, 64_000, 64_000, true);
      assert.equal(result.budgetTokens, 16_000);
      assert.equal(result.extendedThinkingEnabled, true);
    });

    test("small explicit max_tokens disables thinking when budget < 1024", () => {
      // max_tokens = 500 → visibleReserve = max(100, 125) = 125
      // maxTokensForRequest - visibleReserve = 500 - 125 = 375
      // budgetTokens = min(16000, 16000, 375) = 375 → < 1024 → thinking disabled
      const result = callCalcThinkingConfig(thinkingProfile, 64_000, 500, true);
      assert.ok(
        result.budgetTokens < 1024,
        `Expected budgetTokens < 1024, got ${result.budgetTokens}`,
      );
      assert.equal(result.extendedThinkingEnabled, false);
    });

    test("budgetTokens never goes negative when maxTokensForRequest < visibleReserve", () => {
      // max_tokens = 50 → visibleReserve = max(100, 12) = 100
      // maxTokensForRequest - visibleReserve = 50 - 100 = -50
      // budgetTokens = max(0, min(16000, 16000, -50)) = 0
      const result = callCalcThinkingConfig(thinkingProfile, 64_000, 50, true);
      assert.equal(result.budgetTokens, 0);
      assert.equal(result.extendedThinkingEnabled, false);
    });

    test("thinking disabled when model does not support it", () => {
      const result = callCalcThinkingConfig(nonThinkingProfile, 64_000, 64_000, true);
      assert.equal(result.extendedThinkingEnabled, false);
      // budgetTokens is still computed but thinking is disabled
      assert.equal(result.budgetTokens, 16_000);
    });

    test("thinking disabled when setting is off", () => {
      const result = callCalcThinkingConfig(thinkingProfile, 64_000, 64_000, false);
      assert.equal(result.extendedThinkingEnabled, false);
    });

    test("reserve leaves room for visible output with moderate max_tokens", () => {
      // max_tokens = 2000 → visibleReserve = max(100, 500) = 500
      // maxTokensForRequest - visibleReserve = 2000 - 500 = 1500
      // budgetTokens = min(16000, 16000, 1500) = 1500
      // Remaining for visible output = 2000 - 1500 = 500 ≥ visibleReserve
      const result = callCalcThinkingConfig(thinkingProfile, 64_000, 2000, true);
      assert.equal(result.budgetTokens, 1500);
      assert.ok(
        2000 - result.budgetTokens >= 500,
        "Should leave at least visibleReserve tokens for visible output",
      );
      assert.equal(result.extendedThinkingEnabled, true);
    });

    test("maxBudgetFromOutput caps budget for small-output models", () => {
      // Model with maxOutputTokens = 4096
      // maxBudgetFromOutput = floor(4096 * 0.25) = 1024
      // visibleReserve = max(100, floor(4096 * 0.25)) = 1024
      // maxTokensForRequest - visibleReserve = 4096 - 1024 = 3072
      // budgetTokens = min(16000, 1024, 3072) = 1024
      const result = callCalcThinkingConfig(thinkingProfile, 4096, 4096, true);
      assert.equal(result.budgetTokens, 1024);
      assert.equal(result.extendedThinkingEnabled, true);
    });

    test("very small model output disables thinking (budget below 1024 threshold)", () => {
      // Model with maxOutputTokens = 2000
      // maxBudgetFromOutput = floor(2000 * 0.25) = 500
      // budgetTokens = min(16000, 500, ...) = at most 500 → < 1024
      const result = callCalcThinkingConfig(thinkingProfile, 2000, 2000, true);
      assert.ok(result.budgetTokens < 1024);
      assert.equal(result.extendedThinkingEnabled, false);
    });

    test("budget math when maxTokensForRequest falls back to maxOutputTokens (no explicit max_tokens)", () => {
      // Simulates the case where VSCode doesn't provide max_tokens
      // and maxTokensForRequest falls back to model.maxOutputTokens
      const maxOutput = 128_000; // Claude Opus 4.6
      const result = callCalcThinkingConfig(thinkingProfile, maxOutput, maxOutput, true);
      // baseBudget = 16000, maxBudgetFromOutput = 32000, visibleReserve = 32000
      // maxTokensForRequest - visibleReserve = 128000 - 32000 = 96000
      // budgetTokens = min(16000, 32000, 96000) = 16000
      assert.equal(result.budgetTokens, 16_000);
      assert.equal(result.extendedThinkingEnabled, true);
    });
  });

  suite("buildConfigurationSchema", () => {
    test("returns context choices for regular models and defaults to the largest available context", () => {
      const schema = callBuildConfigSchema("amazon.nova-lite-v1:0", new Map(), {
        maxInputTokens: 291_808,
        maxOutputTokens: 8192,
      });

      assert.deepEqual(schema?.properties?.contextSize?.enum, [256_000, 300_000]);
      assert.deepEqual(schema?.properties?.contextSize?.enumItemLabels, ["256K", "300K"]);
      assert.equal(schema?.properties?.contextSize?.default, 300_000);
      assert.equal(schema?.properties?.contextSize?.group, "tokens");
      assert.equal(schema?.properties?.maxContextWindowTokens?.default, undefined);
    });

    test("does not offer context size for models without supplied limits", () => {
      const schema = callBuildConfigSchema("amazon.nova-lite-v1:0");
      assert.equal(schema, undefined);
    });

    test("does not offer reasoning effort for Nova 2 Lite despite models.dev reasoning metadata", () => {
      const modelsDevelopmentMap: ModelsDevelopmentMap = new Map([
        [
          "amazon.nova-2-lite-v1:0",
          { limit: { context: 1_000_000, output: 65_535 }, reasoning: true },
        ],
      ]);

      const schema = callBuildConfigSchema("global.amazon.nova-2-lite-v1:0", modelsDevelopmentMap, {
        maxInputTokens: 934_465,
        maxOutputTokens: 65_535,
      });

      assert.equal(schema?.properties?.reasoningEffort, undefined);
      assert.deepEqual(schema?.properties?.contextSize?.enum, [256_000, 750_000, 1_000_000]);
      assert.equal(
        getModelProfile("global.amazon.nova-2-lite-v1:0").supportsReasoningEffort,
        false,
      );
    });

    test("exposes standard and extended context sizes when the workspace default is extended", () => {
      const schema = callBuildConfigSchema(
        "anthropic.claude-opus-4-6-v1",
        new Map(),
        { maxInputTokens: 872_000, maxOutputTokens: 128_000 },
        { maxInputTokens: 72_000, maxOutputTokens: 128_000 },
      );
      const context = schema?.properties?.contextSize;

      assert.ok(context);
      assert.deepEqual(context.enum, [200_000, 256_000, 750_000, 1_000_000]);
      assert.deepEqual(context.enumItemLabels, ["200K", "256K", "750K", "1M"]);
      assert.equal(context.default, 1_000_000);
      assert.equal(context.group, "tokens");
    });

    test("offers maximum context choices to every model with known limits", () => {
      const schema = callBuildConfigSchema("global.openai.gpt-6-luna", new Map(), {
        maxInputTokens: 922_000,
        maxOutputTokens: 128_000,
      });
      const context = schema?.properties?.contextSize;

      assert.ok(context);
      assert.deepEqual(context.enum, [256_000, 750_000, 1_050_000]);
      assert.deepEqual(context.enumItemLabels, ["256K", "750K", "1.05M"]);
      assert.equal(schema.properties?.contextSize?.default, 1_050_000);
      assert.equal(schema.properties?.maxContextWindowTokens?.default, undefined);
    });

    test("offers all context options for the per-model 1M context selector", () => {
      const schema = callBuildConfigSchema("anthropic.claude-opus-4-6-v1", new Map(), {
        maxInputTokens: 72_000,
        maxOutputTokens: 128_000,
      });

      assert.deepEqual(
        schema?.properties?.contextSize?.enum,
        [200_000, 256_000, 750_000, 1_000_000],
      );
      assert.equal(schema?.properties?.contextSize?.default, 200_000);
    });

    test("shows local caps for always-1M Opus 4.7 without a redundant 1M choice", () => {
      const schema = callBuildConfigSchema("anthropic.claude-opus-4-7-20260420-v1:0", new Map(), {
        maxInputTokens: 872_000,
        maxOutputTokens: 128_000,
      });
      assert.deepEqual(schema?.properties?.contextSize?.enum, [256_000, 750_000, 1_000_000]);
      assert.equal(schema?.properties?.contextSize?.default, 1_000_000);
    });

    test("returns thinkingEffort picker for Sonnet 4.6 (supportsThinkingEffort)", () => {
      // Sonnet 4.6 default: 200K context window
      const schema = callBuildConfigSchema("anthropic.claude-sonnet-4-6");
      assert.ok(schema?.properties?.thinkingEffort, "should have thinkingEffort property");
      const te = schema.properties.thinkingEffort;
      assert.deepEqual(te.enum, ["default", "low", "medium", "high"]);
      assert.equal(te.group, "navigation");
      assert.equal(te.default, "high");
    });

    test("offers model-default and all advertised Claude 5 effort tiers", () => {
      for (const modelId of [
        "global.anthropic.claude-fable-5",
        "global.anthropic.claude-fable-5-1",
        "global.anthropic.claude-haiku-5-5",
        "global.anthropic.claude-opus-5",
        "global.anthropic.claude-opus-5-5",
        "global.anthropic.claude-sonnet-5-5",
      ]) {
        const schema = callBuildConfigSchema(modelId);
        const effort = schema?.properties?.thinkingEffort;
        assert.ok(effort, `${modelId} should expose Claude effort controls`);
        assert.deepEqual(effort.enum, ["default", "low", "medium", "high", "xhigh", "max"]);
        assert.equal((effort.enumItemLabels as string[])[0], "Model default");
      }
      assert.equal(
        callBuildConfigSchema("global.anthropic.claude-sonnet-5")?.properties?.thinkingEffort,
        undefined,
        "Sonnet 5 uses adaptive thinking without output_config.effort",
      );
    });

    test("offers nested reasoning effort controls for GPT-6 variants", () => {
      for (const modelId of [
        "global.openai.gpt-6-astra",
        "global.openai.gpt-6-luna",
        "global.openai.gpt-6-sol",
        "global.openai.gpt-6.1-sol",
      ]) {
        const schema = callBuildConfigSchema(modelId);
        const effort = schema?.properties?.reasoningEffort;
        assert.ok(effort, `${modelId} should expose reasoning controls`);
        assert.deepEqual(effort.enum, ["default", "low", "medium", "high"]);
        assert.equal((effort.enumItemLabels as string[])[0], "Model default");
        assert.equal(getModelProfile(modelId).reasoningEffortField, "nested");
      }
    });

    test("returns NO thinkingEffort picker for Sonnet 3.7 (thinking but not effort)", () => {
      const schema = callBuildConfigSchema("anthropic.claude-3-7-sonnet-20250219-v1:0");
      assert.equal(schema?.properties?.thinkingEffort, undefined);
    });

    test("returns reasoningEffort picker for DeepSeek V3.2 (supportsReasoningEffort)", () => {
      const schema = callBuildConfigSchema("deepseek.deepseek-v3-2-20250615");
      assert.ok(schema?.properties?.reasoningEffort, "should have reasoningEffort property");
      const re = schema.properties.reasoningEffort;
      assert.deepEqual(re.enum, ["default", "low", "medium", "high"]);
      assert.equal(re.group, "navigation");
    });

    test("includes minimal effort level for OpenAI gpt-oss", () => {
      const schema = callBuildConfigSchema("openai.gpt-oss-20b");
      assert.ok(schema?.properties?.reasoningEffort);
      assert.deepEqual(schema.properties.reasoningEffort.enum, [
        "default",
        "minimal",
        "low",
        "medium",
        "high",
      ]);
    });

    test("Sonnet 4.6 has contextSize and thinkingEffort pickers", () => {
      const schema = callBuildConfigSchema("anthropic.claude-sonnet-4-6", new Map(), {
        maxInputTokens: 872_000,
        maxOutputTokens: 128_000,
      });
      assert.ok(schema?.properties?.contextSize);
      assert.ok(schema?.properties?.thinkingEffort, "should have thinkingEffort");
      assert.equal(schema?.properties?.reasoningEffort, undefined);
    });

    test("Sonnet 4.5 returns contextSize picker and thinkingEffort picker", () => {
      // Sonnet 4.5 has optional 1M via beta header, and supports extended thinking.
      const schema = callBuildConfigSchema("anthropic.claude-sonnet-4-5-20250929-v1:0", new Map(), {
        maxInputTokens: 72_000,
        maxOutputTokens: 128_000,
      });
      assert.ok(schema?.properties?.contextSize, "should have contextSize");
      // Sonnet 4.5 supports thinking (supportsThinking) but not thinkingEffort
      // (effort control is only on Opus 4.5/4.6/4.8 and Sonnet 4.6)
      assert.equal(schema?.properties?.thinkingEffort, undefined);
      assert.equal(schema?.properties?.reasoningEffort, undefined);
    });
  });

  suite("local prompt context choices", () => {
    test("exposes maximum, 256K, and 750K choices in the model configuration", () => {
      const schema = callBuildConfigSchema("global.openai.gpt-6-luna", new Map(), {
        maxInputTokens: 922_000,
        maxOutputTokens: 128_000,
      });
      const contextSize = schema?.properties?.contextSize;

      assert.ok(contextSize);
      assert.deepEqual(contextSize.enum, [256_000, 750_000, 1_050_000]);
      assert.deepEqual(contextSize.enumItemLabels, ["256K", "750K", "1.05M"]);
      assert.equal(contextSize.default, 1_050_000);
      assert.deepEqual(contextSize.enumDescriptions, [
        "Limit the local prompt budget",
        "Limit the local prompt budget",
        "Use the model's maximum context",
      ]);
    });
  });

  suite("modelConfiguration overrides in provideLanguageModelChatResponse", () => {
    // These tests verify that modelConfiguration values from the VS Code model
    // picker are correctly validated and applied to per-request model limits.
    // Provider helpers avoid AWS access while covering the request budget logic.

    test("modelOptions.max_tokens is respected (existing behaviour)", () => {
      const requestInput = callBuildRequestInput("global.anthropic.claude-sonnet-4-6", {
        modelOptions: { max_tokens: 8192 },
      });
      assert.equal(requestInput.inferenceConfig?.maxTokens, 8192);
    });

    test("buildBetaHeaders uses context1MEnabled=true when contextSize=1M is selected", () => {
      const provider = providerInternals(
        new BedrockChatModelProvider(mockSecretStorage, mockGlobalState),
      );
      // Use Sonnet 4.5 — it has optional 1M (requires beta header) unlike Sonnet 4.6 (always-1M).
      const modelId = "anthropic.claude-sonnet-4-5-20250929-v1:0";
      const profile = getModelProfile(modelId);

      // With context1MEnabled = false (default) — no 1M beta header
      const headersDefault = provider.buildBetaHeaders(profile, modelId, false, false, false);
      assert.equal(headersDefault.includes("context-1m-2025-08-07"), false);

      // With context1MEnabled = true (as set when contextSize picker selects 1M)
      const headersWith1M = provider.buildBetaHeaders(profile, modelId, false, true, false);
      assert.equal(headersWith1M.includes("context-1m-2025-08-07"), true);
    });
  });

  suite("per-model context size selection", () => {
    test("accepts only context sizes offered by the model schema", () => {
      const provider = providerInternals(
        new BedrockChatModelProvider(mockSecretStorage, mockGlobalState),
      );

      const modelInformation: vscode.LanguageModelChatInformation = {
        capabilities: {},
        configurationSchema: {
          properties: {
            contextSize: { enum: [200_000, 1_000_000, 256_000], type: "number" },
          },
        },
        family: "bedrock",
        id: "m1",
        maxInputTokens: 72_000,
        maxOutputTokens: 128_000,
        name: "m1",
        version: "1.0.0",
      };
      assert.equal(provider.getSelectedContextSize(modelInformation, 256_000), 256_000);
      assert.equal(provider.getSelectedContextSize(modelInformation, 500_000), undefined);
      assert.equal(provider.getSelectedContextSize(modelInformation, NaN), undefined);
      assert.equal(provider.getSelectedContextSize(modelInformation, "256000"), undefined);
    });

    test("uses the selected callback context consistently for compaction and request construction", async () => {
      const messages = [
        vscode.LanguageModelChatMessage.User("Earlier turn ".repeat(16_000)),
        vscode.LanguageModelChatMessage.Assistant("Acknowledged"),
        vscode.LanguageModelChatMessage.User("What should we do next?"),
      ];

      const smallerSelection = await callProviderWithContextSize({ contextSize: 50_000 }, messages);
      const largerSelection = await callProviderWithContextSize({ contextSize: 100_000 }, messages);

      assert.equal(smallerSelection.requestMaxInputTokens, 41_808);
      assert.equal(largerSelection.requestMaxInputTokens, 91_808);
      assert.equal(smallerSelection.model.maxInputTokens, 291_808);
      assert.equal(largerSelection.model.maxInputTokens, 291_808);
      assert.ok(
        smallerSelection.summarizeCalls > 0,
        "the smaller allowance should compact history",
      );
      assert.equal(largerSelection.summarizeCalls, 0, "the larger allowance should fit as-is");
    });

    test("uses the existing no-selection fallback for omitted, malformed, and unsupported values", async () => {
      const messages = [vscode.LanguageModelChatMessage.User("A short request")];
      const configurations: (Record<string, unknown> | undefined)[] = [
        undefined,
        {},
        { contextSize: "50000" },
        { contextSize: 0 },
        { contextSize: 25_000 },
        { contextSize: NaN },
      ];

      for (const modelConfig of configurations) {
        const result = await callProviderWithContextSize(modelConfig, messages);
        assert.equal(result.requestMaxInputTokens, result.model.maxInputTokens);
        assert.equal(result.model.maxInputTokens, 291_808);
        assert.equal(result.summarizeCalls, 0);
      }
    });

    test("applies a local input budget to models with and without optional 1M context", () => {
      const provider = providerInternals(
        new BedrockChatModelProvider(mockSecretStorage, mockGlobalState),
      );
      const regularModel: vscode.LanguageModelChatInformation = {
        capabilities: {},
        configurationSchema: { properties: { contextSize: { enum: [300_000, 256_000] } } },
        family: "bedrock",
        id: "amazon.nova-lite-v1:0",
        maxInputTokens: 291_808,
        maxOutputTokens: 8192,
        name: "Amazon Nova Lite",
        version: "1.0.0",
      };

      assert.equal(
        provider.getRequestMaxInputTokens(regularModel, regularModel.id, 256_000, true, new Map()),
        195_904,
      );
      assert.equal(
        provider.getRequestMaxInputTokens(
          regularModel,
          regularModel.id,
          undefined,
          true,
          new Map(),
        ),
        291_808,
      );
      assert.equal(regularModel.maxInputTokens, 291_808);
    });

    test("uses the schema's maximum context when a harness omits modelConfiguration metadata", () => {
      const provider = providerInternals(
        new BedrockChatModelProvider(mockSecretStorage, mockGlobalState),
      );
      const model: vscode.LanguageModelChatInformation = {
        capabilities: {},
        configurationSchema: {
          properties: { contextSize: { enum: [200_000, 1_000_000], type: "number" } },
        },
        family: "bedrock",
        id: "anthropic.claude-opus-4-6-v1",
        maxInputTokens: 72_000,
        maxOutputTokens: 128_000,
        name: "Claude Opus 4.6",
        version: "1.0.0",
      };

      // Simulate a harness that preserves the public configuration schema but
      // drops maxContextWindowTokens and options.modelConfiguration.
      assert.equal(
        provider.getRequestMaxInputTokens(model, model.id, undefined, true, new Map()),
        872_000,
      );
      assert.equal(model.maxInputTokens, 72_000);
    });

    test("uses known 1M model limits when a harness omits schema and modelConfiguration", () => {
      const provider = providerInternals(
        new BedrockChatModelProvider(mockSecretStorage, mockGlobalState),
      );
      const model: vscode.LanguageModelChatInformation = {
        capabilities: {},
        family: "bedrock",
        id: "anthropic.claude-opus-4-6-v1",
        maxInputTokens: 72_000,
        maxOutputTokens: 128_000,
        name: "Claude Opus 4.6",
        version: "1.0.0",
      };

      // No modelConfiguration, context-size schema, or extra maximum-context
      // metadata is available from this harness.
      assert.equal(
        provider.getRequestMaxInputTokens(model, model.id, undefined, true, new Map()),
        872_000,
      );
      assert.equal(model.maxInputTokens, 72_000);
    });

    test("switches optional 1M context on and off per model request", () => {
      const provider = providerInternals(
        new BedrockChatModelProvider(mockSecretStorage, mockGlobalState),
      );
      const modelId = "anthropic.claude-opus-4-6-v1";
      const opus: vscode.LanguageModelChatInformation = {
        capabilities: {},
        family: "bedrock",
        id: modelId,
        maxInputTokens: 72_000,
        maxOutputTokens: 128_000,
        name: "Claude Opus 4.6",
        version: "1.0.0",
      };
      const developmentMap = makeDevelopmentMapEntry(modelId, 1_000_000, 128_000);

      assert.equal(
        provider.getRequestMaxInputTokens(opus, modelId, 1_000_000, true, developmentMap),
        872_000,
      );
      assert.equal(
        provider.getRequestMaxInputTokens(opus, modelId, 200_000, false, developmentMap),
        72_000,
      );
      assert.equal(opus.maxInputTokens, 72_000);
    });
  });

  suite("compactMessageHistory", () => {
    test("summarizes earlier messages, retains the latest user turn, and keeps system instructions", async () => {
      const messages: Message[] = [
        { content: [{ text: "Old user request " + "a".repeat(2000) }], role: "user" },
        { content: [{ text: "Old assistant answer " + "b".repeat(2000) }], role: "assistant" },
        { content: [{ text: "Previous user turn" }], role: "user" },
        { content: [{ text: "Previous assistant turn" }], role: "assistant" },
        { content: [{ text: "Recent user question" }], role: "user" },
      ];
      let summarizeCalls = 0;
      const result = await compactMessageHistory(
        messages,
        [{ text: "Follow the user request safely." }],
        800,
        512,
        async (_transcript) => {
          summarizeCalls += 1;
          return "Prior goal and constraints.";
        },
      );

      assert.equal(result.compacted, true);
      assert.equal(summarizeCalls, result.summaryChunkCount);
      assert.ok(summarizeCalls > 1);
      assert.equal(result.messages.length, 3);
      assert.equal(
        result.messages[0]?.content?.[0]?.text,
        "The following assistant message is compressed background from earlier conversation turns, not a new user request.",
      );
      assert.match(result.messages[1]?.content?.[0]?.text ?? "", /Prior goal and constraints\./);
      assert.match(result.messages[2]?.content?.[0]?.text ?? "", /Recent user question/);
      assert.equal(result.system[0]?.text, "Follow the user request safely.");
      assert.equal(result.system[0]?.text, "Follow the user request safely.");
      assert.ok(result.originalTokenEstimate > 900);
    });

    test("does not call Bedrock summarization when messages already fit", async () => {
      let summarizeCalls = 0;
      const result = await compactMessageHistory(
        [{ content: [{ text: "Short user message" }], role: "user" }],
        [],
        1000,
        512,
        async () => {
          summarizeCalls += 1;
          return "unexpected";
        },
      );

      assert.equal(result.compacted, false);
      assert.equal(summarizeCalls, 0);
      assert.equal(result.messages.length, 1);
    });

    test("refuses compaction when the latest user turn alone exceeds the selected context", async () => {
      await assert.rejects(
        compactMessageHistory(
          [
            { content: [{ text: "Old user turn" }], role: "user" },
            { content: [{ text: "Old assistant turn" }], role: "assistant" },
            { content: [{ text: "Latest turn " + "x".repeat(4000) }], role: "user" },
          ],
          [],
          700,
          512,
          async () => "summary",
        ),
        /latest conversation turn and tool interactions exceed the selected context size/,
      );
    });

    test("retains the initiating turn and matching tool call when the latest user message is a tool result", async () => {
      const toolUseId = "call-latest";
      const messages: Message[] = [
        { content: [{ text: "Old conversation " + "x".repeat(5000) }], role: "user" },
        { content: [{ text: "Old assistant response " + "y".repeat(5000) }], role: "assistant" },
        { content: [{ text: "Start a tool-assisted task" }], role: "user" },
        {
          content: [{ toolUse: { input: { query: "latest" }, name: "search", toolUseId } }],
          role: "assistant",
        },
        {
          content: [{ toolResult: { content: [{ text: "Tool output" }], toolUseId } }],
          role: "user",
        },
      ];

      const result = await compactMessageHistory(messages, [], 2000, 512, async () => "Summary");

      assert.equal(result.compacted, true);
      assert.ok(
        result.messages.some((message) =>
          message.content?.some((block) => block.toolUse?.toolUseId === toolUseId),
        ),
      );
      assert.ok(
        result.messages.some((message) =>
          message.content?.some((block) => block.toolResult?.toolUseId === toolUseId),
        ),
      );
      assert.ok(
        result.messages.some((message) =>
          message.content?.some((block) => block.text === "Start a tool-assisted task"),
        ),
      );
    });

    test("uses at least 1,000 output tokens for each retained tool-result summary", async () => {
      const toolUseIds = Array.from({ length: 10 }, (_, index) => `call-${index}`);
      const messages: Message[] = [
        { content: [{ text: "Old user request " + "a".repeat(30_000) }], role: "user" },
        { content: [{ text: "Old assistant answer " + "b".repeat(30_000) }], role: "assistant" },
        { content: [{ text: "Start the current task" }], role: "user" },
        {
          content: toolUseIds.map((toolUseId) => ({
            toolUse: { input: { query: toolUseId }, name: "search", toolUseId },
          })),
          role: "assistant",
        },
        {
          content: toolUseIds.map((toolUseId) => ({
            toolResult: {
              content: [{ text: `Large result ${"x".repeat(10_000)}` }],
              toolUseId,
            },
          })),
          role: "user",
        },
      ];
      const toolSummaryTokenLimits: number[] = [];

      const result = await compactMessageHistory(
        messages,
        [],
        13_600,
        4096,
        async (transcript, maxTokens) => {
          if (transcript.startsWith("Tool result (preserve relevant facts and outcome):")) {
            toolSummaryTokenLimits.push(maxTokens);
          }
          return "Concise result summary.";
        },
      );

      assert.equal(result.compacted, true);
      assert.equal(toolSummaryTokenLimits.length, toolUseIds.length);
      assert.deepEqual(new Set(toolSummaryTokenLimits), new Set([1000]));
      assert.ok(result.compactedTokenEstimate <= 13_600);
    });

    test("rejects compaction when the summarizer returns no visible summary", async () => {
      await assert.rejects(
        compactMessageHistory(
          [
            { content: [{ text: "Old user request " + "a".repeat(2000) }], role: "user" },
            { content: [{ text: "Old assistant answer " + "b".repeat(2000) }], role: "assistant" },
            { content: [{ text: "Current question" }], role: "user" },
          ],
          [],
          800,
          512,
          async () => "  ",
        ),
        /conversation summary was empty/,
      );
    });

    test("preserves the latest assistant tool call and user turn when awaiting a tool result", async () => {
      const toolUseId = "call-pending";
      const messages: Message[] = [
        { content: [{ text: "Old conversation " + "x".repeat(5000) }], role: "user" },
        { content: [{ text: "Old assistant response " + "y".repeat(5000) }], role: "assistant" },
        { content: [{ text: "Please search for the latest result" }], role: "user" },
        {
          content: [{ toolUse: { input: { query: "latest" }, name: "search", toolUseId } }],
          role: "assistant",
        },
      ];

      const result = await compactMessageHistory(messages, [], 2000, 512, async () => "Summary");

      assert.equal(result.compacted, true);
      assert.ok(
        result.messages.some((message) =>
          message.content?.some((block) => block.toolUse?.toolUseId === toolUseId),
        ),
      );
      assert.ok(
        result.messages.some((message) =>
          message.content?.some((block) => block.text === "Please search for the latest result"),
        ),
      );
    });

    test("refuses excessive history rather than silently discarding the oldest chunk", async () => {
      const messages: Message[] = Array.from({ length: 40 }, (_, index) => ({
        content: [{ text: `User history ${index} ${"x".repeat(3000)}` }],
        role: "user",
      }));
      let summarizeCalls = 0;

      await assert.rejects(
        compactMessageHistory(messages, [], 2000, 512, async () => {
          summarizeCalls += 1;
          return "summary";
        }),
        /too large to summarize safely/,
      );
      assert.equal(summarizeCalls, 0);
    });
  });

  suite("buildRequestInput", () => {
    test("omits temperature for Claude Opus 4.7", () => {
      const requestInput = callBuildRequestInput("global.anthropic.claude-opus-4-7-v1:0", {
        modelOptions: { temperature: 0.2 },
      });

      assert.equal(requestInput.inferenceConfig?.temperature, undefined);
      assert.equal(requestInput.inferenceConfig?.maxTokens, 64_000);
    });

    test("omits temperature for Claude Opus 4.7 extended thinking requests", () => {
      const requestInput = callBuildRequestInput("global.anthropic.claude-opus-4-7-v1:0", {}, true);

      assert.equal(requestInput.inferenceConfig?.temperature, undefined);
    });

    test("preserves temperature for models that still support it", () => {
      const requestInput = callBuildRequestInput("global.anthropic.claude-opus-4-6-v1:0", {
        modelOptions: { temperature: 0.2 },
      });

      assert.equal(requestInput.inferenceConfig?.temperature, 0.2);
    });
  });

  suite("resolveModelLimits", () => {
    test("uses refreshed models.dev limits for GPT-6 Luna", () => {
      const result = callResolveModelLimits(
        "global.openai.gpt-6-luna",
        false,
        loadModelsDevelopmentData(),
      );

      assert.equal(result.maxOutputTokens, 128_000);
      assert.equal(result.maxInputTokens, 1_050_000 - 128_000);
    });

    test("uses refreshed models.dev limits for Claude Sonnet 5.5", () => {
      const result = callResolveModelLimits(
        "global.anthropic.claude-sonnet-5-5",
        false,
        loadModelsDevelopmentData(),
      );

      assert.equal(result.maxOutputTokens, 128_000);
      assert.equal(result.maxInputTokens, 1_000_000 - 128_000);
    });

    test("uses known offline limits for Claude Opus 5.5", () => {
      const result = getModelTokenLimits("global.anthropic.claude-opus-5-5");

      assert.equal(result.maxOutputTokens, 128_000);
      assert.equal(result.maxInputTokens, 1_000_000 - 128_000);
    });

    test("uses known offline limits for all GPT-6 variants", () => {
      for (const modelId of [
        "global.openai.gpt-6-astra",
        "global.openai.gpt-6-luna",
        "global.openai.gpt-6-sol",
        "global.openai.gpt-6.1-sol",
      ]) {
        const result = getModelTokenLimits(modelId);
        assert.equal(result.maxOutputTokens, 128_000, modelId);
        assert.equal(result.maxInputTokens, 1_050_000 - 128_000, modelId);
      }
    });

    test("uses models.dev limits when available — Sonnet 4.6 is always-1M", () => {
      // models.dev says Sonnet 4.6 has 1M context / 64K output (always-on, no beta header).
      // context1M.enabled flag has no effect — 1M is the default.
      const map = makeDevelopmentMapEntry("anthropic.claude-sonnet-4-6", 1_000_000, 64_000);
      const withoutExtended = callResolveModelLimits("anthropic.claude-sonnet-4-6", false, map);
      assert.equal(withoutExtended.maxOutputTokens, 64_000);
      assert.equal(withoutExtended.maxInputTokens, 1_000_000 - 64_000); // always 1M - 64K

      const withExtended = callResolveModelLimits("anthropic.claude-sonnet-4-6", true, map);
      assert.equal(withExtended.maxOutputTokens, 64_000);
      assert.equal(withExtended.maxInputTokens, 1_000_000 - 64_000); // same — always 1M
    });

    test("uses models.dev limits — Sonnet 4.5 is optional-1M (capped at 200K when disabled)", () => {
      // Sonnet 4.5 has optional 1M via beta header.
      const map = makeDevelopmentMapEntry(
        "anthropic.claude-sonnet-4-5-20250929-v1:0",
        1_000_000,
        64_000,
      );
      const withoutExtended = callResolveModelLimits(
        "anthropic.claude-sonnet-4-5-20250929-v1:0",
        false,
        map,
      );
      assert.equal(withoutExtended.maxOutputTokens, 64_000);
      assert.equal(withoutExtended.maxInputTokens, 200_000 - 64_000); // capped at 200K

      const withExtended = callResolveModelLimits(
        "anthropic.claude-sonnet-4-5-20250929-v1:0",
        true,
        map,
      );
      assert.equal(withExtended.maxOutputTokens, 64_000);
      assert.equal(withExtended.maxInputTokens, 1_000_000 - 64_000); // 1M when enabled
    });

    test("uses models.dev limits for always-1M models (Opus 4.7)", () => {
      // Opus 4.7 doesn't require beta header — 1M is always-on.
      // maxInputTokens = 1M - 128K (input budget; picker shows 1M total).
      const map = makeDevelopmentMapEntry("anthropic.claude-opus-4-7", 1_000_000, 128_000);
      const result = callResolveModelLimits("anthropic.claude-opus-4-7", false, map);
      assert.equal(result.maxOutputTokens, 128_000);
      assert.equal(result.maxInputTokens, 1_000_000 - 128_000); // input budget = 1M - 128K
    });

    test("uses models.dev limits for non-Claude models (Nova Pro)", () => {
      // Nova Pro: 300K context window, 8192 output.
      const map = makeDevelopmentMapEntry("amazon.nova-pro-v1:0", 300_000, 8192);
      const result = callResolveModelLimits("amazon.nova-pro-v1:0", false, map);
      assert.equal(result.maxOutputTokens, 8192);
      assert.equal(result.maxInputTokens, 300_000 - 8192); // input budget = 300K - 8K
    });

    test("reserves usable input context when models.dev output limit is implausibly large", () => {
      const map = makeDevelopmentMapEntry("qwen.qwen3-next-80b-a3b", 262_144, 262_000);
      const result = callResolveModelLimits("qwen.qwen3-next-80b-a3b", false, map);

      assert.equal(result.maxInputTokens, 131_072);
      assert.equal(result.maxOutputTokens, 131_072);
    });

    test("preserves models.dev output limit when it is below the context window", () => {
      const map = makeDevelopmentMapEntry("nvidia.nemotron-super-3-120b", 262_144, 131_072);
      const result = callResolveModelLimits("nvidia.nemotron-super-3-120b", false, map);

      assert.equal(result.maxInputTokens, 131_072);
      assert.equal(result.maxOutputTokens, 131_072);
    });

    test("falls back to getModelTokenLimits for unknown models", () => {
      const result = callResolveModelLimits("anthropic.claude-sonnet-4-6", false, new Map());
      // Hardcoded fallback: Sonnet 4.6 → always-1M, 64K output
      assert.equal(result.maxOutputTokens, 64_000);
      assert.equal(result.maxInputTokens, 1_000_000 - 64_000); // always 1M - 64K
    });

    test("strips regional prefix when looking up models.dev entry", () => {
      // models.dev has bare ID; model ID has regional prefix
      const map = makeDevelopmentMapEntry("anthropic.claude-sonnet-4-6", 1_000_000, 64_000);
      const result = callResolveModelLimits("us.anthropic.claude-sonnet-4-6", true, map);
      assert.equal(result.maxInputTokens, 1_000_000 - 64_000); // always 1M - 64K
    });
  });

  suite("buildConfigurationSchema with models.dev data", () => {
    test("reasoningEffort picker appears for new non-Anthropic reasoning model via models.dev", () => {
      // Simulate a brand-new model not in profiles.ts but present in models.dev
      const developmentMap: ModelsDevelopmentMap = new Map([
        [
          "newprovider.new-reasoning-model",
          { limit: { context: 100_000, output: 8000 }, reasoning: true },
        ],
      ]);
      const schema = callBuildConfigSchema(
        "newprovider.new-reasoning-model",
        developmentMap,
        { maxInputTokens: 92_000, maxOutputTokens: 8000 },
        { maxInputTokens: 92_000, maxOutputTokens: 8000 },
      );
      assert.ok(schema?.properties?.reasoningEffort);
      assert.equal(schema?.properties?.contextSize, undefined);
    });

    test("reasoningEffort picker does NOT appear for Anthropic models via models.dev reasoning flag", () => {
      // Anthropic models use thinkingEffort, not reasoningEffort
      const developmentMap: ModelsDevelopmentMap = new Map([
        [
          "anthropic.claude-sonnet-4-6",
          { limit: { context: 1_000_000, output: 64_000 }, reasoning: true },
        ],
      ]);
      const schema = callBuildConfigSchema("anthropic.claude-sonnet-4-6", developmentMap);
      assert.equal(schema?.properties?.reasoningEffort, undefined);
    });
  });

  suite("normalizeModelId", () => {
    test("strips 2-char ISO region prefix", () => {
      assert.equal(
        normalizeModelId("us.anthropic.claude-sonnet-4-6"),
        "anthropic.claude-sonnet-4-6",
      );
      assert.equal(normalizeModelId("eu.anthropic.claude-opus-4-7"), "anthropic.claude-opus-4-7");
      assert.equal(
        normalizeModelId("ap.anthropic.claude-haiku-4-5-20251001-v1:0"),
        "anthropic.claude-haiku-4-5-20251001-v1:0",
      );
    });

    test("strips global prefix", () => {
      assert.equal(
        normalizeModelId("global.anthropic.claude-opus-4-6-v1"),
        "anthropic.claude-opus-4-6-v1",
      );
    });

    test("strips GovCloud prefixes (us-gov-east, us-gov-west)", () => {
      assert.equal(
        normalizeModelId("us-gov-east.anthropic.claude-sonnet-4-5-20250929-v1:0"),
        "anthropic.claude-sonnet-4-5-20250929-v1:0",
      );
      assert.equal(
        normalizeModelId("us-gov-west.anthropic.claude-haiku-4-5-20251001-v1:0"),
        "anthropic.claude-haiku-4-5-20251001-v1:0",
      );
    });

    test("strips China region prefixes (cn-north, cn-northwest)", () => {
      assert.equal(
        normalizeModelId("cn-north.anthropic.claude-sonnet-4-6"),
        "anthropic.claude-sonnet-4-6",
      );
      assert.equal(
        normalizeModelId("cn-northwest.anthropic.claude-opus-4-7"),
        "anthropic.claude-opus-4-7",
      );
    });

    test("strips apac alias prefix", () => {
      assert.equal(
        normalizeModelId("apac.anthropic.claude-sonnet-4-6"),
        "anthropic.claude-sonnet-4-6",
      );
    });

    test("leaves bare model IDs unchanged", () => {
      assert.equal(normalizeModelId("anthropic.claude-sonnet-4-6"), "anthropic.claude-sonnet-4-6");
      assert.equal(normalizeModelId("amazon.nova-pro-v1:0"), "amazon.nova-pro-v1:0");
    });

    test("leaves short IDs with only two segments unchanged", () => {
      assert.equal(normalizeModelId("amazon.titan"), "amazon.titan");
    });
  });
});

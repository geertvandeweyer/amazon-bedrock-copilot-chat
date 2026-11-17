import type {
  ContentBlock,
  Message,
  SystemContentBlock,
  ToolResultContentBlock,
} from "@aws-sdk/client-bedrock-runtime";
import { ConversationRole } from "@aws-sdk/client-bedrock-runtime";

import { logger } from "./logger";

const RECENT_HISTORY_FRACTION = 0.35;
const PROMPT_OVERHEAD_TOKENS = 512;
const IMAGE_TOKEN_ESTIMATE = 1024;
const MIN_TOOL_RESULT_SUMMARY_TOKENS = 1000;
const MAX_TOOL_RESULT_SUMMARY_TOKENS = 1024;
const MAX_SUMMARY_CHUNKS = 16;
const TOKENS_PER_CHARACTER = 4;
const COMPACTION_NOTICE =
  "The following assistant message is compressed background from earlier conversation turns, not a new user request.";

export interface CompactHistoryResult {
  readonly compacted: boolean;
  readonly compactedTokenEstimate: number;
  readonly messages: Message[];
  readonly originalTokenEstimate: number;
  readonly summaryChunkCount: number;
  readonly system: SystemContentBlock[];
}

export type HistorySummarizer = (transcript: string, maxOutputTokens: number) => Promise<string>;

export async function compactMessageHistory(
  messages: readonly Message[],
  system: readonly SystemContentBlock[],
  maxInputTokens: number,
  maxOutputTokens: number,
  summarize: HistorySummarizer,
): Promise<CompactHistoryResult> {
  const systemTokenEstimate = estimateSystemTokens(system);
  const messageTokenEstimates = messages.map((message) => estimateMessageTokens(message));
  const originalTokenEstimate =
    systemTokenEstimate + messageTokenEstimates.reduce((total, estimate) => total + estimate, 0);

  if (originalTokenEstimate <= maxInputTokens) {
    return {
      compacted: false,
      compactedTokenEstimate: originalTokenEstimate,
      messages: [...messages],
      originalTokenEstimate,
      summaryChunkCount: 0,
      system: [...system],
    };
  }

  const availableTokens = maxInputTokens - systemTokenEstimate;
  if (availableTokens <= PROMPT_OVERHEAD_TOKENS) {
    throw new Error(
      "The selected context size is too small to summarize this conversation. Choose a larger context size or remove earlier messages.",
    );
  }

  const latestUserIndex = messages.findLastIndex(({ role }) => role === ConversationRole.USER);
  if (latestUserIndex === -1) {
    throw new Error(
      "The conversation exceeds the selected context size and cannot be compacted safely.",
    );
  }

  const recentStartIndex = getRecentHistoryStartIndex(
    messages,
    messageTokenEstimates,
    latestUserIndex,
    availableTokens,
  );
  const latestUserMessage = messages.at(latestUserIndex);
  if (latestUserMessage === undefined) {
    throw new Error("The latest user turn could not be found for context compaction.");
  }
  let retainedMessages = messages.slice(recentStartIndex);
  let recentTokenEstimate = sum(messageTokenEstimates, recentStartIndex);
  logger.debug("[Context Compactor] Input estimate before compaction", {
    availableInputTokens: availableTokens,
    estimatedInputTokens: originalTokenEstimate,
    latestUserIndex,
    maxInputTokens,
    maxOutputTokens,
    messageCount: messages.length,
    recentStartIndex,
    retainedTokenEstimate: recentTokenEstimate,
    systemTokenEstimate,
  });
  if (recentTokenEstimate > availableTokens) {
    retainedMessages = await summarizeOversizedToolResults(
      retainedMessages,
      availableTokens,
      maxOutputTokens,
      summarize,
    );
    recentTokenEstimate = retainedMessages.reduce(
      (total, message) => total + estimateMessageTokens(message),
      0,
    );
  }
  if (recentTokenEstimate > availableTokens) {
    logger.warn("[Context Compactor] Retained latest turn still exceeds input budget", {
      availableInputTokens: availableTokens,
      retainedMessageCount: retainedMessages.length,
      retainedTokenEstimate: recentTokenEstimate,
    });
    throw new Error(
      "The latest conversation turn and tool interactions exceed the selected context size, even after summarizing tool results. Choose a larger context size or shorten the latest turn.",
    );
  }

  const earlierMessages = messages.slice(0, recentStartIndex);
  if (earlierMessages.length === 0) {
    throw new Error(
      "The conversation exceeds the selected context size and has no older turns available to summarize. Choose a larger context size or shorten the latest turn.",
    );
  }

  const { summary, summaryChunkCount } = await summarizeEarlierMessages(
    earlierMessages,
    recentTokenEstimate,
    availableTokens,
    maxOutputTokens,
    summarize,
  );
  if (!summary) {
    throw new Error("The conversation summary was empty; the request was not sent.");
  }

  const summaryNotice: Message = {
    content: [
      {
        text: COMPACTION_NOTICE,
      },
    ],
    role: ConversationRole.USER,
  };
  const summaryMessage: Message = {
    content: [{ text: summary }],
    role: ConversationRole.ASSISTANT,
  };
  const firstRetainedMessage = retainedMessages[0];
  const compactedMessages = [
    summaryNotice,
    ...(firstRetainedMessage?.role === ConversationRole.ASSISTANT
      ? [
          {
            ...firstRetainedMessage,
            content: [...(summaryMessage.content ?? []), ...(firstRetainedMessage.content ?? [])],
          },
          ...retainedMessages.slice(1),
        ]
      : [summaryMessage, ...retainedMessages]),
  ];
  const compactedTokenEstimate =
    systemTokenEstimate +
    compactedMessages.reduce((total, message) => total + estimateMessageTokens(message), 0);
  if (compactedTokenEstimate > maxInputTokens) {
    throw new Error(
      "The conversation summary and latest turns still exceed the selected context size. Choose a larger context size or shorten the latest turn.",
    );
  }
  logger.info("[Context Compactor] Compacted conversation to fit input budget", {
    compactedInputTokens: compactedTokenEstimate,
    effectiveInputLimit: maxInputTokens,
    estimatedInputTokens: originalTokenEstimate,
    retainedMessageCount: retainedMessages.length,
    summaryChunkCount,
  });

  return {
    compacted: true,
    compactedTokenEstimate,
    messages: compactedMessages,
    originalTokenEstimate,
    summaryChunkCount,
    system: [...system],
  };
}

function chunkHistory(messages: readonly Message[], maxCharacters: number): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const message of messages) {
    const text = formatMessageForSummary(message);
    const remainingSegments = chunkText(text, maxCharacters);
    for (const segment of remainingSegments) {
      const separator = current ? "\n\n" : "";
      if (current.length + separator.length + segment.length > maxCharacters) {
        chunks.push(current);
        current = "";
      }
      current += `${current ? "\n\n" : ""}${segment}`;
    }
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

function chunkText(text: string, maxCharacters: number): string[] {
  if (text.length <= maxCharacters) {
    return [text];
  }

  const chunks: string[] = [];
  for (let offset = 0; offset < text.length; offset += maxCharacters) {
    chunks.push(text.slice(offset, offset + maxCharacters));
  }
  return chunks;
}

function estimateMessageTokens(message: Message): number {
  let textLength = 0;
  let nonTextParts = 0;
  const content = message.content ?? [];
  for (const block of content) {
    const text = formatContentBlock(block);
    textLength += text.length;
    if (block.image !== undefined || block.document !== undefined) {
      nonTextParts += 1;
    }
  }
  return Math.ceil(textLength / TOKENS_PER_CHARACTER) + nonTextParts * IMAGE_TOKEN_ESTIMATE;
}

function estimateSystemTokens(system: readonly SystemContentBlock[]): number {
  const text = system
    .flatMap((block) => ("text" in block && typeof block.text === "string" ? [block.text] : []))
    .join("\n");
  return Math.ceil(text.length / TOKENS_PER_CHARACTER);
}

function formatContentBlock(block: ContentBlock): string {
  if ("text" in block && typeof block.text === "string") {
    return block.text;
  }
  if (block.toolUse !== undefined) {
    return `Tool call ${block.toolUse.name}: ${safeStringify(block.toolUse.input)}`;
  }
  if (block.toolResult !== undefined) {
    const result = (block.toolResult.content ?? [])
      .map((part) =>
        "text" in part && typeof part.text === "string" ? part.text : "[non-text tool result]",
      )
      .join("\n");
    return `Tool result ${block.toolResult.toolUseId}: ${result}`;
  }
  if (block.image !== undefined) {
    return "[Image attachment was included; image bytes are not copied into the summary request]";
  }
  if (block.document !== undefined) {
    return `Document attachment: ${block.document.name ?? "unnamed"}`;
  }
  return "";
}

function formatMessageForSummary(message: Message): string {
  const role = message.role === ConversationRole.ASSISTANT ? "Assistant" : "User";
  const content = (message.content ?? [])
    .map((block) => formatContentBlock(block))
    .filter(Boolean)
    .join("\n");
  return `${role}: ${content || "[No text content]"}`;
}

function formatToolResultPart(part: ToolResultContentBlock): string {
  if ("text" in part && typeof part.text === "string") {
    return part.text;
  }
  if ("json" in part) {
    return safeStringify(part.json);
  }
  return "[non-text tool result content]";
}

function getRecentHistoryStartIndex(
  messages: readonly Message[],
  tokenEstimates: readonly number[],
  latestUserIndex: number,
  availableTokens: number,
): number {
  const latestUserMessage = messages.at(latestUserIndex);
  if (latestUserMessage === undefined) {
    return latestUserIndex;
  }

  let recentStartIndex = latestUserIndex;
  const hasLatestUserToolResult =
    latestUserMessage.content?.some((block) => block.toolResult !== undefined) === true;
  if (hasLatestUserToolResult) {
    recentStartIndex = getToolInteractionStartIndex(messages, latestUserIndex);
  } else if (
    latestUserIndex > 0 &&
    messages[latestUserIndex - 1]?.role === ConversationRole.ASSISTANT
  ) {
    recentStartIndex = latestUserIndex - 1;
  }

  let recentTokenEstimate = sum(tokenEstimates, recentStartIndex);
  const recentTargetTokens = Math.floor(availableTokens * RECENT_HISTORY_FRACTION);
  if (recentTokenEstimate > availableTokens) {
    return recentStartIndex;
  }
  while (recentTokenEstimate <= recentTargetTokens && recentStartIndex >= 2) {
    const assistantIndex = recentStartIndex - 1;
    const userIndex = assistantIndex - 1;
    const assistant = messages[assistantIndex];
    const user = messages[userIndex];
    if (
      assistant?.role !== ConversationRole.ASSISTANT ||
      assistant.content?.some((block) => block.toolUse !== undefined) === true ||
      user?.role !== ConversationRole.USER
    ) {
      break;
    }
    const candidateEstimate = sum(tokenEstimates, userIndex);
    if (candidateEstimate > recentTargetTokens) {
      break;
    }
    recentStartIndex = userIndex;
    recentTokenEstimate = candidateEstimate;
  }

  return recentStartIndex;
}

function getToolInteractionStartIndex(
  messages: readonly Message[],
  latestToolResultMessageIndex: number,
): number {
  let resultMessageIndex = latestToolResultMessageIndex;
  while (true) {
    const resultMessage = messages[resultMessageIndex];
    const toolUseIndices = (resultMessage?.content ?? [])
      .flatMap((block) => (block.toolResult ? [block.toolResult.toolUseId] : []))
      .map((toolUseId) =>
        messages.findLastIndex(
          (message, index) =>
            index < resultMessageIndex &&
            message.role === ConversationRole.ASSISTANT &&
            message.content?.some((block) => block.toolUse?.toolUseId === toolUseId) === true,
        ),
      );
    if (toolUseIndices.length === 0 || toolUseIndices.includes(-1)) {
      throw new Error(
        "The latest tool interaction cannot be preserved safely within the selected context.",
      );
    }

    const firstToolUseIndex = Math.min(...toolUseIndices);
    const initiatingUserIndex = messages.findLastIndex(
      (message, index) => index < firstToolUseIndex && message.role === ConversationRole.USER,
    );
    if (initiatingUserIndex === -1) {
      throw new Error(
        "The latest tool interaction cannot be preserved safely within the selected context.",
      );
    }

    const initiatingMessage = messages[initiatingUserIndex];
    const isContinuingToolInteraction =
      initiatingMessage?.content?.some((block) => block.toolResult !== undefined) === true;
    if (!isContinuingToolInteraction) {
      return initiatingUserIndex;
    }
    resultMessageIndex = initiatingUserIndex;
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "[unavailable]";
  } catch {
    return "[unavailable]";
  }
}

function sum(values: readonly number[], startIndex: number): number {
  return values.slice(startIndex).reduce((total, value) => total + value, 0);
}

async function summarizeEarlierMessages(
  earlierMessages: readonly Message[],
  retainedTokenEstimate: number,
  availableTokens: number,
  maxOutputTokens: number,
  summarize: HistorySummarizer,
): Promise<{ summary: string; summaryChunkCount: number }> {
  const chunkCharacterLimit = Math.max(128, (availableTokens - PROMPT_OVERHEAD_TOKENS) * 3);
  const transcriptChunks = chunkHistory(earlierMessages, chunkCharacterLimit);
  if (transcriptChunks.length > MAX_SUMMARY_CHUNKS) {
    throw new Error(
      "The conversation is too large to summarize safely in one request. Remove earlier messages or choose a larger context size.",
    );
  }

  const safeSummaryOutputLimit = Math.min(maxOutputTokens, 1024, Math.floor(availableTokens / 8));
  if (safeSummaryOutputLimit < 16) {
    throw new Error(
      "The selected context size leaves too little room to summarize older turns. Choose a larger context size.",
    );
  }
  let summaryChunkCount = 0;
  let summaries: string[] = [];
  for (const transcript of transcriptChunks) {
    summaries.push(await summarize(transcript, safeSummaryOutputLimit));
    summaryChunkCount += 1;
  }

  const noticeTokenEstimate = estimateMessageTokens({
    content: [{ text: COMPACTION_NOTICE }],
    role: ConversationRole.USER,
  });
  const summaryTokenLimit = availableTokens - retainedTokenEstimate - noticeTokenEstimate;
  if (summaryTokenLimit < 16) {
    throw new Error(
      "The latest turn leaves too little room for a safe history summary. Choose a larger context size or shorten the current turn.",
    );
  }
  let reductionPass = 0;
  while (Math.ceil(summaries.join("\n\n").length / TOKENS_PER_CHARACTER) > summaryTokenLimit) {
    if (reductionPass >= 4) {
      throw new Error(
        "The conversation summary could not be reduced to fit the selected context size.",
      );
    }
    const reductionChunks = chunkText(summaries.join("\n\n"), chunkCharacterLimit);
    const reducedSummaries: string[] = [];
    for (const transcript of reductionChunks) {
      reducedSummaries.push(await summarize(transcript, safeSummaryOutputLimit));
      summaryChunkCount += 1;
    }
    summaries = reducedSummaries;
    reductionPass += 1;
  }

  const summary = summaries.join("\n\n").trim();
  if (!summary) {
    throw new Error("The conversation summary was empty; the request was not sent.");
  }
  return { summary, summaryChunkCount };
}

async function summarizeOversizedToolResults(
  messages: readonly Message[],
  availableTokens: number,
  maxOutputTokens: number,
  summarize: HistorySummarizer,
): Promise<Message[]> {
  const resultCount = messages.reduce(
    (count, message) =>
      count + (message.content ?? []).filter((block) => block.toolResult !== undefined).length,
    0,
  );
  if (resultCount === 0) {
    return [...messages];
  }

  const calculatedTokensPerResult = Math.min(
    MAX_TOOL_RESULT_SUMMARY_TOKENS,
    Math.floor(availableTokens / (2 * resultCount)),
    Math.floor(maxOutputTokens / resultCount),
  );
  const maxTokensPerResult = Math.min(
    maxOutputTokens,
    Math.max(MIN_TOOL_RESULT_SUMMARY_TOKENS, calculatedTokensPerResult),
  );
  let summarizedCount = 0;
  const compactedMessages: Message[] = [];
  for (const message of messages) {
    let hasChanged = false;
    const content = await Promise.all(
      (message.content ?? []).map(async (block) => {
        if (!block.toolResult) {
          return block;
        }
        const transcript = (block.toolResult.content ?? [])
          .map((part) => formatToolResultPart(part))
          .filter(Boolean)
          .join("\n");
        if (!transcript) {
          return block;
        }
        const summary = await summarize(
          `Tool result (preserve relevant facts and outcome):\n${transcript}`,
          maxTokensPerResult,
        );
        if (!summary.trim()) {
          throw new Error("A tool result summary was empty; the request was not sent.");
        }
        hasChanged = true;
        summarizedCount += 1;
        return {
          toolResult: {
            ...block.toolResult,
            content: [{ text: summary.trim() }],
          },
        };
      }),
    );
    compactedMessages.push(hasChanged ? { ...message, content } : message);
  }
  if (summarizedCount > 0) {
    logger.info("[Context Compactor] Summarized tool results in retained turn", {
      maxTokensPerResult,
      summarizedResultCount: summarizedCount,
    });
  }
  return compactedMessages;
}

import {
  type Message as BedrockMessage,
  type ContentBlock,
  ConversationRole,
} from "@aws-sdk/client-bedrock-runtime";

/**
 * Ensure tool results match tool calls in the immediately preceding assistant turn.
 * VS Code can replay tool results in continuation history; unmatched results are
 * converted to ordinary text so Bedrock never receives an invalid toolResult block.
 */
export function reconcileBedrockToolResults(messages: BedrockMessage[]): number {
  let pendingToolUses = new Map<string, number>();
  let convertedResultCount = 0;

  for (const message of messages) {
    const content = message.content;
    if (!content) {
      pendingToolUses = new Map();
      continue;
    }

    if (message.role === ConversationRole.ASSISTANT) {
      pendingToolUses = collectToolUses(content);
      continue;
    }

    convertedResultCount += reconcileMessageToolResults(content, pendingToolUses);
    pendingToolUses = new Map();
  }

  return convertedResultCount;
}

/**
 * Validate converted Bedrock messages before sending to API
 * Bedrock Converse API requires:
 * - At least one message
 * - First message must be user role
 * - Messages must alternate between user and assistant roles
 */
export function validateBedrockMessages(messages: BedrockMessage[]): void {
  if (messages.length === 0) {
    throw new Error("Messages array cannot be empty");
  }

  // Bedrock requires first message to be user role
  if (messages[0].role !== ConversationRole.USER) {
    throw new Error("First message must be User role");
  }

  // Validate alternating user/assistant pattern
  let lastRole: ConversationRole | undefined;
  for (const message of messages) {
    const currentRole = message.role;

    // Check for consecutive messages with same role
    if (lastRole === currentRole) {
      throw new Error(
        `Invalid message sequence: consecutive ${currentRole === ConversationRole.USER ? "User" : "Assistant"} messages`,
      );
    }
    lastRole = currentRole;
  }
}

function collectToolUses(content: ContentBlock[]): Map<string, number> {
  const pendingToolUses = new Map<string, number>();

  for (const block of content) {
    const toolUseId = block.toolUse?.toolUseId;
    if (toolUseId) {
      pendingToolUses.set(toolUseId, (pendingToolUses.get(toolUseId) ?? 0) + 1);
    }
  }

  return pendingToolUses;
}

function formatUnmatchedToolResult(block: ContentBlock.ToolResultMember): string {
  const resultText = (block.toolResult.content ?? [])
    .map((part) => {
      if ("text" in part && typeof part.text === "string") {
        return part.text;
      }
      if ("json" in part) {
        try {
          return JSON.stringify(part.json) ?? "[unavailable]";
        } catch {
          return "[unavailable]";
        }
      }
      return "[non-text tool result]";
    })
    .join("\n");

  return `Unmatched tool result for ${block.toolResult.toolUseId}: ${resultText}`;
}

function reconcileMessageToolResults(
  content: ContentBlock[],
  pendingToolUses: Map<string, number>,
): number {
  let convertedResultCount = 0;

  for (let index = 0; index < content.length; index++) {
    const block = content[index];
    if (block?.toolResult) {
      const toolUseId = block.toolResult.toolUseId;
      const remainingToolUses = toolUseId ? (pendingToolUses.get(toolUseId) ?? 0) : 0;

      if (toolUseId && remainingToolUses > 0) {
        pendingToolUses.set(toolUseId, remainingToolUses - 1);
      } else {
        content[index] = { text: formatUnmatchedToolResult(block) } satisfies ContentBlock;
        convertedResultCount++;
      }
    }
  }

  return convertedResultCount;
}

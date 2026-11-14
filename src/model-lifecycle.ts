import { logger } from "./logger";
import { normalizeModelId } from "./profiles";
import type { BedrockModelSummary, ModelsDevelopmentMap } from "./types";

/**
 * Exclude foundation models marked deprecated by models.dev.
 */
export function filterDeprecatedFoundationModels(
  models: BedrockModelSummary[],
  modelsDevelopmentMap: ModelsDevelopmentMap,
): BedrockModelSummary[] {
  return models.filter((model) => {
    if (!isDeprecatedModel(model.modelId, modelsDevelopmentMap)) {
      return true;
    }
    logger.debug(
      `[Bedrock Model Provider] Excluding deprecated model from models.dev: ${model.modelId} (${model.modelName})`,
    );
    return false;
  });
}

/**
 * Check whether models.dev marks a model as deprecated.
 */
export function isDeprecatedModel(
  modelId: string,
  modelsDevelopmentMap: ModelsDevelopmentMap,
): boolean {
  const normalizedId = normalizeModelId(modelId);
  for (const [key, entry] of modelsDevelopmentMap) {
    if (
      (key === modelId || normalizeModelId(key) === normalizedId) &&
      entry.status === "deprecated"
    ) {
      return true;
    }
  }
  return false;
}

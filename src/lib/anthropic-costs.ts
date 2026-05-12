export interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface LlmUsageCost {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  costUsd: number;
}

const MODEL_PRICING_USD_PER_MTOK: Record<string, {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheRead: number;
}> = {
  "claude-opus-4-7": { input: 5, output: 25, cacheWrite5m: 6.25, cacheRead: 0.5 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheWrite5m: 3.75, cacheRead: 0.3 },
  "claude-haiku-4-5": { input: 0.5, output: 2.5, cacheWrite5m: 0.625, cacheRead: 0.05 },
};

function perMillion(tokens: number, usdPerMillion: number): number {
  return (tokens / 1_000_000) * usdPerMillion;
}

export function costAnthropicUsage(model: string, usage: AnthropicUsage): LlmUsageCost {
  const pricing = MODEL_PRICING_USD_PER_MTOK[model];
  if (!pricing) {
    throw new Error(`No pricing configured for model ${model}`);
  }

  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cacheCreationInputTokens = usage.cache_creation_input_tokens ?? 0;
  const cacheReadInputTokens = usage.cache_read_input_tokens ?? 0;

  const costUsd =
    perMillion(inputTokens, pricing.input) +
    perMillion(outputTokens, pricing.output) +
    perMillion(cacheCreationInputTokens, pricing.cacheWrite5m) +
    perMillion(cacheReadInputTokens, pricing.cacheRead);

  return {
    model,
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    costUsd,
  };
}

export function addUsageCost(a: LlmUsageCost, b: LlmUsageCost): LlmUsageCost {
  return {
    model: b.model,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
    costUsd: a.costUsd + b.costUsd,
  };
}

export function emptyUsageCost(model: string): LlmUsageCost {
  return {
    model,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    costUsd: 0,
  };
}

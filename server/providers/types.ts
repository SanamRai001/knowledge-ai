/**
 * Provider-neutral LLM contract for Knowledge AI.
 *
 * Application/RAG code should depend on these interfaces instead of a vendor SDK.
 * Deterministic evidence synthesis is intentionally NOT modeled as an external
 * provider; it remains an application-level fallback when provider generation
 * is unavailable or fails.
 */

export type LLMProviderId = 'gemini' | (string & {});

export type LLMProviderFailureCategory =
  | 'NOT_CONFIGURED'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'UNAVAILABLE'
  | 'AUTHENTICATION'
  | 'INVALID_REQUEST'
  | 'PROVIDER_ERROR';

export interface LLMProviderCapabilities {
  providerId: LLMProviderId;
  textGeneration: boolean;
  jsonGeneration: boolean;
  systemInstructions: boolean;
  usageMetadata: boolean;
}

export interface LLMProviderHealth {
  providerId: LLMProviderId;
  status: 'CONFIGURED' | 'NOT_CONFIGURED';
  checkedAt: number;
  detail?: string;
}

export interface LLMGenerateRequest {
  prompt: string;
  systemInstruction?: string;
  model?: string;
  responseFormat?: 'text' | 'json';
  temperature?: number;
}

export interface LLMUsageMetadata {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  source: 'MEASURED' | 'UNAVAILABLE';
}

export interface LLMProviderFailure {
  category: LLMProviderFailureCategory;
  message: string;
  retryable: boolean;
  statusCode?: number;
}

export interface LLMGenerateResult {
  ok: boolean;
  providerId: LLMProviderId;
  modelId: string;
  text: string;
  latencyMs: number;
  usage: LLMUsageMetadata;
  failure?: LLMProviderFailure;
}

export interface LLMProvider {
  readonly id: LLMProviderId;
  isConfigured(): boolean;
  capabilities(): LLMProviderCapabilities;
  healthCheck(): Promise<LLMProviderHealth>;
  generate(request: LLMGenerateRequest): Promise<LLMGenerateResult>;
}

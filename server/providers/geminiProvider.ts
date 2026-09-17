import { GoogleGenAI } from '@google/genai';
import {
  LLMGenerateRequest,
  LLMGenerateResult,
  LLMProvider,
  LLMProviderCapabilities,
  LLMProviderFailure,
  LLMProviderHealth,
  LLMUsageMetadata,
} from './types.js';

const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

function emptyUsage(): LLMUsageMetadata {
  return {
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    source: 'UNAVAILABLE',
  };
}

function classifyFailure(error: any): LLMProviderFailure {
  const statusCode = Number(error?.status ?? error?.code ?? error?.error?.code) || undefined;
  const rawMessage =
    error?.message ||
    error?.error?.message ||
    (typeof error === 'string' ? error : 'Unknown Gemini provider error');
  const message = String(rawMessage);
  const lower = message.toLowerCase();

  if (statusCode === 429 || lower.includes('quota') || lower.includes('rate limit')) {
    return { category: 'RATE_LIMITED', message, retryable: true, statusCode };
  }
  if (statusCode === 401 || statusCode === 403 || lower.includes('api key') || lower.includes('authentication')) {
    return { category: 'AUTHENTICATION', message, retryable: false, statusCode };
  }
  if (statusCode === 408 || lower.includes('timeout') || lower.includes('timed out')) {
    return { category: 'TIMEOUT', message, retryable: true, statusCode };
  }
  if (statusCode === 503 || lower.includes('unavailable') || lower.includes('high demand')) {
    return { category: 'UNAVAILABLE', message, retryable: true, statusCode };
  }
  if (statusCode === 400 || lower.includes('invalid argument') || lower.includes('invalid request')) {
    return { category: 'INVALID_REQUEST', message, retryable: false, statusCode };
  }

  return {
    category: 'PROVIDER_ERROR',
    message,
    retryable: typeof statusCode === 'number' ? statusCode >= 500 : false,
    statusCode,
  };
}

export class GeminiProvider implements LLMProvider {
  public readonly id = 'gemini' as const;
  private client: GoogleGenAI | null = null;

  public isConfigured(): boolean {
    const key = process.env.GEMINI_API_KEY;
    return Boolean(key && key.trim() && key !== 'MY_GEMINI_API_KEY');
  }

  public capabilities(): LLMProviderCapabilities {
    return {
      providerId: this.id,
      textGeneration: true,
      jsonGeneration: true,
      systemInstructions: true,
      usageMetadata: true,
    };
  }

  public async healthCheck(): Promise<LLMProviderHealth> {
    return {
      providerId: this.id,
      status: this.isConfigured() ? 'CONFIGURED' : 'NOT_CONFIGURED',
      checkedAt: Date.now(),
      detail: this.isConfigured()
        ? 'Gemini credentials are configured. No billable probe was performed.'
        : 'GEMINI_API_KEY is not configured.',
    };
  }

  private getClient(): GoogleGenAI | null {
    if (!this.isConfigured()) return null;
    if (!this.client) {
      this.client = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY!,
        httpOptions: {
          headers: {
            'User-Agent': 'knowledge-ai',
          },
        },
      });
    }
    return this.client;
  }

  public async generate(request: LLMGenerateRequest): Promise<LLMGenerateResult> {
    const started = Date.now();
    const modelId = request.model || process.env.KNOWLEDGE_AI_GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
    const client = this.getClient();

    if (!client) {
      return {
        ok: false,
        providerId: this.id,
        modelId,
        text: '',
        latencyMs: Date.now() - started,
        usage: emptyUsage(),
        failure: {
          category: 'NOT_CONFIGURED',
          message: 'GEMINI_API_KEY is not configured.',
          retryable: false,
        },
      };
    }

    try {
      const response = await client.models.generateContent({
        model: modelId,
        contents: request.prompt,
        config: {
          systemInstruction: request.systemInstruction,
          responseMimeType: request.responseFormat === 'json' ? 'application/json' : undefined,
          temperature: request.temperature,
        },
      });

      const usageMetadata: any = (response as any).usageMetadata;
      const inputTokens =
        typeof usageMetadata?.promptTokenCount === 'number' ? usageMetadata.promptTokenCount : null;
      const outputTokens =
        typeof usageMetadata?.candidatesTokenCount === 'number' ? usageMetadata.candidatesTokenCount : null;
      const totalTokens =
        typeof usageMetadata?.totalTokenCount === 'number' ? usageMetadata.totalTokenCount : null;
      const hasMeasuredUsage = inputTokens !== null || outputTokens !== null || totalTokens !== null;

      return {
        ok: true,
        providerId: this.id,
        modelId,
        text: response.text || '',
        latencyMs: Date.now() - started,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens,
          source: hasMeasuredUsage ? 'MEASURED' : 'UNAVAILABLE',
        },
      };
    } catch (error: any) {
      return {
        ok: false,
        providerId: this.id,
        modelId,
        text: '',
        latencyMs: Date.now() - started,
        usage: emptyUsage(),
        failure: classifyFailure(error),
      };
    }
  }
}

export const geminiProvider = new GeminiProvider();

import { geminiProvider } from './geminiProvider.js';
import { LLMGenerateRequest, LLMGenerateResult, LLMProvider } from './types.js';

/**
 * Central provider selection boundary.
 *
 * For Phase 0 the router intentionally has a single live provider. Future
 * providers can be registered here without coupling retrieval/reasoning code
 * to vendor SDKs. Deterministic synthesis remains an explicit application
 * fallback outside this router.
 */
export class ProviderRouter {
  private readonly providers = new Map<string, LLMProvider>();

  constructor() {
    this.register(geminiProvider);
  }

  public register(provider: LLMProvider): void {
    this.providers.set(provider.id, provider);
  }

  public getPrimaryProvider(): LLMProvider | null {
    const configuredPrimary = (process.env.KNOWLEDGE_AI_LLM_PROVIDER || 'gemini').trim().toLowerCase();
    return this.providers.get(configuredPrimary) || null;
  }

  public getProvider(providerId: string): LLMProvider | null {
    return this.providers.get(providerId) || null;
  }

  public async generate(request: LLMGenerateRequest): Promise<LLMGenerateResult> {
    const provider = this.getPrimaryProvider();
    if (!provider) {
      const providerId = (process.env.KNOWLEDGE_AI_LLM_PROVIDER || 'gemini').trim().toLowerCase();
      return {
        ok: false,
        providerId,
        modelId: request.model || 'unknown',
        text: '',
        latencyMs: 0,
        usage: {
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
          source: 'UNAVAILABLE',
        },
        failure: {
          category: 'NOT_CONFIGURED',
          message: `No LLM provider is registered for "${providerId}".`,
          retryable: false,
        },
      };
    }

    return provider.generate(request);
  }
}

export const providerRouter = new ProviderRouter();

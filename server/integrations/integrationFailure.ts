import {
  IntegrationAttentionReason,
  IntegrationFailureCategory,
} from './types.js';

export interface IntegrationFailureClassification {
  category: IntegrationFailureCategory;
  retryable: boolean;
  attentionReason?: IntegrationAttentionReason;
  statusCode?: number;
  code?: string;
  message: string;
}

function text(error: any): string {
  return String(error?.message || error || 'Integration sync failed.');
}

export function classifyIntegrationFailure(
  error: any
): IntegrationFailureClassification {
  const statusCode =
    typeof error?.statusCode === 'number'
      ? error.statusCode
      : typeof error?.status === 'number'
        ? error.status
        : undefined;
  const code =
    typeof error?.code === 'string'
      ? error.code
      : undefined;
  const message = text(error);
  const haystack = (code + ' ' + message).toLowerCase();

  if (
    statusCode === 410 ||
    haystack.includes('cursor_invalid') ||
    haystack.includes('syncstatenotfound') ||
    haystack.includes('page token') ||
    haystack.includes('delta cursor')
  ) {
    return {
      category: 'CURSOR_INVALID',
      retryable: false,
      attentionReason: 'CURSOR_RESET_REQUIRED',
      statusCode,
      code,
      message,
    };
  }

  if (
    statusCode === 401 ||
    haystack.includes('credential') ||
    haystack.includes('refresh token') ||
    haystack.includes('invalid_grant') ||
    haystack.includes('token_refresh_failed')
  ) {
    return {
      category: 'AUTHORIZATION',
      retryable: false,
      attentionReason: 'REAUTHORIZE',
      statusCode,
      code,
      message,
    };
  }

  if (
    statusCode === 403 ||
    haystack.includes('forbidden') ||
    haystack.includes('permission')
  ) {
    return {
      category: 'PERMISSION',
      retryable: false,
      attentionReason: 'PERMISSION_LOST',
      statusCode,
      code,
      message,
    };
  }

  if (
    statusCode === 429 ||
    haystack.includes('rate limit') ||
    haystack.includes('too many requests') ||
    haystack.includes('quota')
  ) {
    return {
      category: 'RATE_LIMIT',
      retryable: true,
      statusCode,
      code,
      message,
    };
  }

  if (
    statusCode === 408 ||
    (statusCode !== undefined && statusCode >= 500) ||
    haystack.includes('timeout') ||
    haystack.includes('econnreset') ||
    haystack.includes('enotfound') ||
    haystack.includes('fetch failed') ||
    haystack.includes('temporar')
  ) {
    return {
      category: 'TRANSIENT',
      retryable: true,
      statusCode,
      code,
      message,
    };
  }

  if (
    statusCode === 409 ||
    haystack.includes('already running') ||
    haystack.includes('conflict')
  ) {
    return {
      category: 'CONFLICT',
      retryable: false,
      statusCode,
      code,
      message,
    };
  }

  if (
    statusCode === 415 ||
    haystack.includes('unsupported')
  ) {
    return {
      category: 'UNSUPPORTED',
      retryable: false,
      statusCode,
      code,
      message,
    };
  }

  if (
    statusCode !== undefined &&
    statusCode >= 400 &&
    statusCode < 500
  ) {
    return {
      category: 'DATA_INVALID',
      retryable: false,
      statusCode,
      code,
      message,
    };
  }

  return {
    category: 'UNKNOWN',
    retryable: false,
    attentionReason: 'SYNC_FAILED',
    statusCode,
    code,
    message,
  };
}

import crypto from 'crypto';
import {
  AsyncLocalStorage,
} from 'node:async_hooks';
import type {
  KnowledgeAiProcessRole,
} from '../runtime/processRole.js';
import type {
  OperationalMetricName,
} from './productionOperationsContract.js';

export type OperationalMetricKind =
  | 'COUNTER'
  | 'HISTOGRAM'
  | 'GAUGE';

export interface OperationalMetricSample {
  name: OperationalMetricName;
  kind: OperationalMetricKind;
  value: number;
  labels: Record<string, string>;
  recordedAt: number;
}

export interface OperationalEvent {
  timestamp: number;
  level:
    | 'debug'
    | 'info'
    | 'warn'
    | 'error';
  event_name: string;
  component: string;
  process_role: string;
  outcome: string;
  request_id?: string;
  trace_id?: string;
  tenant_correlation_id?: string;
  job_id?: string;
  sync_run_id?: string;
  watch_job_id?: string;
  action_execution_id?: string;
  automation_run_id?: string;
  metadata?: Record<string, unknown>;
}

export interface OperationalSink {
  recordMetric(
    sample: OperationalMetricSample
  ): void | Promise<void>;
  emitEvent(
    event: OperationalEvent
  ): void | Promise<void>;
}

export interface OperationalContext {
  requestId?: string;
  traceId?: string;
  tenantCorrelationId?: string;
  processRole?: KnowledgeAiProcessRole | string;
}

const contextStorage =
  new AsyncLocalStorage<
    OperationalContext
  >();

const FORBIDDEN_KEY =
  /(prompt|content|document|dataset.?rows?|oauth|access.?token|refresh.?token|api.?key|session.?token|password|ciphertext|authorization|secret.?value|kms.?key.?material)/i;

const SECRET_PATTERNS: RegExp[] = [
  /AIza[0-9A-Za-z_-]{20,}/g,
  /sk-[A-Za-z0-9_-]{16,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /((?:token|secret|password|api[_-]?key)\s*[=:]\s*)[^\s,;&]+/gi,
];

function sanitizeString(
  value: string
): string {
  let clean = value;
  for (const pattern of SECRET_PATTERNS) {
    clean = clean.replace(
      pattern,
      (match) => {
        const separator =
          match.match(
            /^((?:token|secret|password|api[_-]?key)\s*[=:]\s*)/i
          );
        return separator
          ? separator[1] + '[REDACTED]'
          : '[REDACTED]';
      }
    );
  }
  return clean.slice(0, 2000);
}

export function sanitizeOperationalMetadata(
  value: unknown,
  depth = 0
): unknown {
  if (depth > 5) {
    return '[MAX_DEPTH]';
  }
  if (
    value === null ||
    value === undefined ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'string') {
    return sanitizeString(value);
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 50)
      .map((item) =>
        sanitizeOperationalMetadata(
          item,
          depth + 1
        )
      );
  }
  if (typeof value === 'object') {
    const result:
      Record<string, unknown> = {};
    for (
      const [key, raw] of Object.entries(
        value as Record<
          string,
          unknown
        >
      )
    ) {
      if (FORBIDDEN_KEY.test(key)) {
        result[key] = '[REDACTED]';
        continue;
      }
      result[key] =
        sanitizeOperationalMetadata(
          raw,
          depth + 1
        );
    }
    return result;
  }
  return String(value);
}

export class InMemoryOperationalSink
  implements OperationalSink
{
  readonly metrics:
    OperationalMetricSample[] = [];
  readonly events:
    OperationalEvent[] = [];

  constructor(
    private readonly maxItems = 5000
  ) {}

  recordMetric(
    sample: OperationalMetricSample
  ): void {
    this.metrics.push(sample);
    if (
      this.metrics.length >
      this.maxItems
    ) {
      this.metrics.shift();
    }
  }

  emitEvent(
    event: OperationalEvent
  ): void {
    this.events.push(event);
    if (
      this.events.length >
      this.maxItems
    ) {
      this.events.shift();
    }
  }

  reset(): void {
    this.metrics.splice(0);
    this.events.splice(0);
  }
}

export class StructuredConsoleOperationalSink
  implements OperationalSink
{
  recordMetric(
    _sample: OperationalMetricSample
  ): void {
    // Metrics stay vendor-neutral in G2.
  }

  emitEvent(
    event: OperationalEvent
  ): void {
    const line = JSON.stringify(event);
    if (event.level === 'error') {
      console.error(line);
    } else if (event.level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }
  }
}

const memorySink =
  new InMemoryOperationalSink();

let testSink: OperationalSink | null =
  null;

function defaultSink():
  OperationalSink {
  if (testSink) return testSink;

  if (
    process.env.NODE_ENV ===
      'production' ||
    process.env
      .KNOWLEDGE_AI_OPERATIONAL_JSON_LOGS ===
      'true'
  ) {
    return {
      recordMetric(sample) {
        memorySink.recordMetric(
          sample
        );
      },
      emitEvent(event) {
        memorySink.emitEvent(event);
        new StructuredConsoleOperationalSink()
          .emitEvent(event);
      },
    };
  }

  return memorySink;
}

function cleanLabels(
  labels: Record<string, unknown>
): Record<string, string> {
  const result:
    Record<string, string> = {};
  for (
    const [key, value] of Object.entries(
      labels
    )
  ) {
    if (
      FORBIDDEN_KEY.test(key) ||
      value === undefined ||
      value === null
    ) {
      continue;
    }
    const text =
      String(value).trim();
    if (!text) continue;
    result[key] =
      sanitizeString(text).slice(
        0,
        120
      );
  }
  return result;
}

function correlationFields(
  explicit?: Partial<
    OperationalEvent
  >
): Partial<OperationalEvent> {
  const ctx =
    contextStorage.getStore();
  return {
    request_id:
      explicit?.request_id ||
      ctx?.requestId,
    trace_id:
      explicit?.trace_id ||
      ctx?.traceId,
    tenant_correlation_id:
      explicit
        ?.tenant_correlation_id ||
      ctx?.tenantCorrelationId,
  };
}

export const operationalTelemetry = {
  recordMetric(params: {
    name: OperationalMetricName;
    kind: OperationalMetricKind;
    value: number;
    labels?: Record<
      string,
      unknown
    >;
    recordedAt?: number;
  }): void {
    if (
      !Number.isFinite(
        params.value
      )
    ) {
      return;
    }
    void defaultSink().recordMetric({
      name: params.name,
      kind: params.kind,
      value: params.value,
      labels: cleanLabels(
        params.labels || {}
      ),
      recordedAt:
        params.recordedAt ||
        Date.now(),
    });
  },

  emitEvent(params: {
    level:
      | 'debug'
      | 'info'
      | 'warn'
      | 'error';
    eventName: string;
    component: string;
    outcome: string;
    processRole?: string;
    correlation?: Partial<
      OperationalEvent
    >;
    metadata?: Record<
      string,
      unknown
    >;
  }): void {
    const ctx =
      contextStorage.getStore();
    const correlation =
      correlationFields(
        params.correlation
      );
    const metadata =
      params.metadata
        ? (sanitizeOperationalMetadata(
            params.metadata
          ) as Record<
            string,
            unknown
          >)
        : undefined;

    void defaultSink().emitEvent({
      timestamp: Date.now(),
      level: params.level,
      event_name:
        params.eventName
          .slice(0, 160),
      component:
        params.component
          .slice(0, 120),
      process_role:
        params.processRole ||
        ctx?.processRole ||
        'unknown',
      outcome:
        params.outcome
          .slice(0, 80),
      ...correlation,
      job_id:
        params.correlation
          ?.job_id,
      sync_run_id:
        params.correlation
          ?.sync_run_id,
      watch_job_id:
        params.correlation
          ?.watch_job_id,
      action_execution_id:
        params.correlation
          ?.action_execution_id,
      automation_run_id:
        params.correlation
          ?.automation_run_id,
      metadata,
    });
  },

  snapshot(): {
    metrics:
      OperationalMetricSample[];
    events:
      OperationalEvent[];
  } {
    return {
      metrics:
        memorySink.metrics.map(
          (item) => ({
            ...item,
            labels: {
              ...item.labels,
            },
          })
        ),
      events:
        memorySink.events.map(
          (item) => ({
            ...item,
            metadata:
              item.metadata
                ? {
                    ...item.metadata,
                  }
                : undefined,
          })
        ),
    };
  },
};

export function runWithOperationalContext<T>(
  context: OperationalContext,
  work: () => T
): T {
  return contextStorage.run(
    context,
    work
  );
}

export function currentOperationalContext():
  OperationalContext | undefined {
  return contextStorage.getStore();
}

export function setOperationalTenantAccount(
  accountId: string
): void {
  const ctx =
    contextStorage.getStore();
  if (!ctx || !accountId.trim()) {
    return;
  }

  ctx.tenantCorrelationId =
    'tenant_' +
    crypto
      .createHash('sha256')
      .update(
        'knowledge-ai-tenant:' +
          accountId
      )
      .digest('hex')
      .slice(0, 20);
}

export function setOperationalSinkForTesting(
  sink: OperationalSink | null
): void {
  testSink = sink;
}

export function resetOperationalTelemetryForTesting():
  void {
  memorySink.reset();
  testSink = null;
}

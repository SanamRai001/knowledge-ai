import {
  performance,
} from 'node:perf_hooks';
import type {
  I1LoadSummary,
} from '../../server/security/i1SecurityThresholds.js';

function percentile(
  values: number[],
  fraction: number
): number {
  if (!values.length) return 0;
  const sorted = [...values].sort(
    (a, b) => a - b
  );
  const index = Math.min(
    sorted.length - 1,
    Math.max(
      0,
      Math.ceil(
        sorted.length * fraction
      ) - 1
    )
  );
  return sorted[index];
}

export async function runHttpLoad(input: {
  origin: string;
  path: string;
  requestCount: number;
  concurrency: number;
  requestInit?: (
    index: number
  ) => RequestInit;
  expectedStatus?: (
    status: number,
    index: number
  ) => boolean;
  validateResponse?: (
    response: Response,
    index: number
  ) => Promise<boolean> | boolean;
}): Promise<I1LoadSummary & {
  validationFailures: number;
}> {
  const requestCount = Math.max(
    1,
    Math.floor(input.requestCount)
  );
  const concurrency = Math.max(
    1,
    Math.min(
      requestCount,
      Math.floor(input.concurrency)
    )
  );
  const latencies: number[] = [];
  let nextIndex = 0;
  let successes = 0;
  let unexpectedErrors = 0;
  let validationFailures = 0;

  const worker = async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= requestCount) {
        return;
      }

      const started =
        performance.now();
      try {
        const response = await fetch(
          new URL(
            input.path,
            input.origin
          ),
          input.requestInit?.(index)
        );
        latencies.push(
          performance.now() -
            started
        );

        const expected =
          input.expectedStatus
            ? input.expectedStatus(
                response.status,
                index
              )
            : response.ok;

        if (!expected) {
          unexpectedErrors += 1;
          continue;
        }

        if (
          input.validateResponse &&
          !(await input.validateResponse(
            response,
            index
          ))
        ) {
          validationFailures += 1;
          continue;
        }

        successes += 1;
      } catch {
        latencies.push(
          performance.now() -
            started
        );
        unexpectedErrors += 1;
      }
    }
  };

  await Promise.all(
    Array.from(
      { length: concurrency },
      () => worker()
    )
  );

  return {
    requests: requestCount,
    successes,
    unexpectedErrors,
    validationFailures,
    p50LatencyMs:
      percentile(latencies, 0.5),
    p95LatencyMs:
      percentile(latencies, 0.95),
    maxLatencyMs:
      latencies.length
        ? Math.max(...latencies)
        : 0,
    unexpectedErrorRate:
      unexpectedErrors /
      requestCount,
  };
}

export function assertMeasuredThresholds(
  summary: I1LoadSummary & {
    validationFailures?: number;
  },
  thresholds: {
    p95LatencyMs: number;
    maxUnexpectedErrorRate: number;
    maxIsolationFailures?: number;
  }
): void {
  if (
    summary.p95LatencyMs >
    thresholds.p95LatencyMs
  ) {
    throw new Error(
      'Measured p95 latency ' +
        summary.p95LatencyMs.toFixed(1) +
        ' ms exceeded test threshold ' +
        thresholds.p95LatencyMs +
        ' ms.'
    );
  }

  if (
    summary.unexpectedErrorRate >
    thresholds.maxUnexpectedErrorRate
  ) {
    throw new Error(
      'Measured unexpected error rate ' +
        summary.unexpectedErrorRate +
        ' exceeded test threshold ' +
        thresholds.maxUnexpectedErrorRate +
        '.'
    );
  }

  if (
    (summary.validationFailures || 0) >
    (thresholds.maxIsolationFailures ||
      0)
  ) {
    throw new Error(
      'Measured isolation/validation failures exceeded threshold.'
    );
  }
}

import {
  I1_TEST_THRESHOLDS,
} from '../server/security/i1SecurityThresholds.js';
import {
  assertMeasuredThresholds,
  runHttpLoad,
} from './support/i1HttpLoadHarness.js';

async function main() {
  const origin =
    process.env
      .KNOWLEDGE_AI_I1_TARGET_ORIGIN
      ?.trim();

  if (!origin) {
    throw new Error(
      'KNOWLEDGE_AI_I1_TARGET_ORIGIN is required. Point it at an isolated test/staging deployment; never production.'
    );
  }

  const parsed = new URL(origin);
  if (
    parsed.username ||
    parsed.password
  ) {
    throw new Error(
      'I1 target origin must not embed credentials.'
    );
  }

  const summary =
    await runHttpLoad({
      origin: parsed.origin,
      path: '/api/health',
      requestCount:
        I1_TEST_THRESHOLDS
          .localHttpSmoke
          .requestCount,
      concurrency:
        I1_TEST_THRESHOLDS
          .localHttpSmoke
          .concurrency,
      expectedStatus:
        (status) => status === 200,
    });

  assertMeasuredThresholds(
    summary,
    I1_TEST_THRESHOLDS
      .localHttpSmoke
  );

  console.log(
    JSON.stringify(
      {
        target:
          parsed.origin,
        testClass:
          'isolated-health-smoke',
        thresholds:
          I1_TEST_THRESHOLDS
            .localHttpSmoke,
        measured: summary,
        disclaimer:
          'Synthetic smoke only; this is not a production capacity claim.',
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    'I1_LOAD_SECURITY_HARNESS_FAILED'
  );
  console.error(error);
  process.exit(1);
});

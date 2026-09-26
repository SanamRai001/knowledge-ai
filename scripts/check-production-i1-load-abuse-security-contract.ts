import fs from 'fs';
import {
  API_KEY_RATE_LIMIT_MAX_REQUESTS,
  API_KEY_RATE_LIMIT_WINDOW_MS,
} from '../server/apiKeyStore.js';
import {
  runtimeEdgeConfig,
} from '../server/runtime/runtimeEdgeConfig.js';
import {
  CSV_LIMITS,
} from '../server/datasets/csvParser.js';
import {
  XLSX_LIMITS,
} from '../server/datasets/xlsxParser.js';
import {
  I1_TEST_THRESHOLDS,
} from '../server/security/i1SecurityThresholds.js';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

function read(path: string): string {
  return fs.readFileSync(path, 'utf8');
}

async function main() {
  const edge = runtimeEdgeConfig({});

  assert(
    API_KEY_RATE_LIMIT_MAX_REQUESTS ===
      I1_TEST_THRESHOLDS.apiKey
        .maxRequestsPerWindow &&
      API_KEY_RATE_LIMIT_WINDOW_MS ===
        I1_TEST_THRESHOLDS.apiKey.windowMs,
    'I1 API-key abuse thresholds must match runtime enforcement.'
  );

  assert(
    edge.jsonBodyLimitBytes ===
      I1_TEST_THRESHOLDS.requestBodies
        .defaultJsonBytes &&
      edge.urlencodedBodyLimitBytes ===
        I1_TEST_THRESHOLDS.requestBodies
          .defaultUrlencodedBytes &&
      edge.maxRequestBodyBytes ===
        I1_TEST_THRESHOLDS.requestBodies
          .defaultApplicationEdgeBytes,
    'I1 request-body thresholds must match runtime edge defaults.'
  );

  assert(
    CSV_LIMITS.maxFileBytes ===
      I1_TEST_THRESHOLDS.requestBodies
        .csvFileBytes &&
      XLSX_LIMITS.maxFileBytes ===
        I1_TEST_THRESHOLDS.requestBodies
          .xlsxFileBytes,
    'I1 Dataset upload thresholds must match parser safety limits.'
  );

  const workspaceRouter = read(
    'server/workspaceRouter.ts'
  );
  assert(
    workspaceRouter.includes(
      'fileSize: 25 * 1024 * 1024'
    ) &&
      workspaceRouter.includes(
        'files: 10'
      ),
    'I1 PDF upload inventory must retain 25 MiB / 10-file limits.'
  );

  const requestIdentity = read(
    'server/requestIdentity.ts'
  );
  assert(
    requestIdentity.includes(
      'apiKeyStore.checkRateLimit'
    ) &&
      requestIdentity.includes(
        "'RATE_LIMITED'"
      ),
    'Modern application identity must apply API-key rate limiting.'
  );

  const middleware = read(
    'server/requestIdentityMiddleware.ts'
  );
  assert(
    middleware.includes(
      "'Retry-After'"
    ),
    'Modern API-key throttling must expose Retry-After.'
  );

  const googleConfig = read(
    'server/integrations/googleDriveConfig.ts'
  );
  const googleConnector = read(
    'server/integrations/connectors/googleDriveConnector.ts'
  );
  assert(
    googleConfig.includes(
      "'https://www.googleapis.com/drive/v3'"
    ) &&
      googleConfig.includes(
        "'https://oauth2.googleapis.com/token'"
      ) &&
      googleConnector.includes(
        'encodeURIComponent(ref.externalId)'
      ) &&
      !googleConnector.includes(
        'ref.webUrl'
      ),
    'Google Drive fetch paths must remain pinned to trusted provider endpoints rather than provider-supplied web URLs.'
  );

  const oneDriveConfig = read(
    'server/integrations/microsoftOneDriveConfig.ts'
  );
  const oneDriveConnector = read(
    'server/integrations/connectors/microsoftOneDriveConnector.ts'
  );
  assert(
    oneDriveConfig.includes(
      "'https://graph.microsoft.com/v1.0'"
    ) &&
      oneDriveConnector.includes(
        "url.origin !== 'https://graph.microsoft.com'"
      ) &&
      oneDriveConnector.includes(
        "'/v1.0/me/drive/root/delta'"
      ) &&
      oneDriveConnector.includes(
        'encodeURIComponent(ref.externalId)'
      ),
    'OneDrive delta/download paths must reject off-origin URLs and encode external IDs.'
  );

  const googleState = read(
    'server/integrations/googleDriveOAuthStateStore.ts'
  );
  const oneDriveState = read(
    'server/integrations/microsoftOneDriveOAuthStateStore.ts'
  );
  for (const [name, source] of [
    ['Google', googleState],
    ['OneDrive', oneDriveState],
  ] as const) {
    assert(
      source.includes(
        '10 * 60 * 1000'
      ) &&
        source.includes(
          '.delete('
        ),
      name +
        ' OAuth state must remain bounded and one-time consumable.'
    );
  }

  const authSecurity = read(
    'server/identity/authHttpSecurity.ts'
  );
  assert(
    authSecurity.includes(
      'requireSameOrigin'
    ) &&
      authSecurity.includes(
        'requireDoubleSubmitCsrf'
      ) &&
      authSecurity.includes(
        'timingSafeEqual'
      ),
    'I1 browser-auth abuse boundary must retain same-origin and double-submit CSRF controls.'
  );

  const harness = read(
    'scripts/support/i1HttpLoadHarness.ts'
  );
  const runner = read(
    'scripts/i1-load-security-harness.ts'
  );
  assert(
    harness.includes('p95LatencyMs') &&
      harness.includes(
        'unexpectedErrorRate'
      ) &&
      runner.includes(
        'Synthetic smoke only'
      ) &&
      runner.includes(
        'KNOWLEDGE_AI_I1_TARGET_ORIGIN'
      ),
    'I1 must include a measured isolated-target harness without scale claims.'
  );

  console.log(
    'PRODUCTION_I1_LOAD_ABUSE_SECURITY_CONTRACT_CHECK_PASSED'
  );
  console.log(
    'Runtime thresholds, modern API-key throttle, request/upload boundaries, OAuth replay controls, CSRF/origin enforcement, provider URL pinning, and measured-load harness contracts are verified.'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_I1_LOAD_ABUSE_SECURITY_CONTRACT_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});

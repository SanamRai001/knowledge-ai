import express from 'express';
import fs from 'fs';
import type { Server } from 'http';
import { multiTenancyService } from '../server/mediator/multiTenancyService.js';
import { quotaAndBillingService } from '../server/mediator/quotaAndBillingService.js';
import { tenantGovernanceService } from '../server/mediator/tenantGovernanceService.js';
import { webhookService } from '../server/mediator/webhookService.js';
import { saasReadinessService } from '../server/mediator/saasReadinessService.js';
import {
  LEGACY_ROUTE_COMPATIBILITY_FLAG,
  LEGACY_ROUTE_QUARANTINE_CODE,
  classifyLegacyRoute,
  legacyPrototypeRouteQuarantineMiddleware,
} from '../server/legacyRouteQuarantine.js';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

async function readJson(
  response: Response
): Promise<any> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function startServer(): Promise<{
  server: Server;
  baseUrl: string;
}> {
  const app = express();
  app.use(express.json());
  app.use(legacyPrototypeRouteQuarantineMiddleware);
  app.all('*', (req, res) => {
    res.json({
      source: 'post-quarantine-handler',
      path: req.path,
    });
  });

  const server = await new Promise<Server>(
    (resolve) => {
      const listener = app.listen(
        0,
        '127.0.0.1',
        () => resolve(listener)
      );
    }
  );

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error(
      'B2D3B2B retirement proof server failed to bind.'
    );
  }

  return {
    server,
    baseUrl:
      'http://127.0.0.1:' + address.port,
  };
}

async function main() {
  const serverSource = fs.readFileSync(
    'server.ts',
    'utf8'
  );
  const platformManagementSource = fs.readFileSync(
    'server/platform/platformManagementRouter.ts',
    'utf8'
  );

  for (const pattern of [
    /app\.(?:get|post|put|patch|delete)\(\s*['"]\/api\/v1\/tenants(?:\/|['"])/,
    /app\.(?:get|post|put|patch|delete)\(\s*['"]\/api\/v1\/saas(?:\/|['"])/,
  ]) {
    assert(
      !pattern.test(serverSource),
      'Retired tenant/SaaS HTTP route remains registered: ' +
        pattern
    );
  }

  for (const importName of [
    'multiTenancyService',
    'quotaAndBillingService',
    'tenantGovernanceService',
    'webhookService',
    'saasReadinessService',
  ]) {
    assert(
      !serverSource.includes(
        'import { ' + importName + ' }'
      ),
      'server.ts must not retain obsolete tenant/SaaS HTTP-only import ' +
        importName
    );
  }

  assert(
    serverSource.includes(
      "app.get('/api/v1/api-docs/openapi'"
    ) &&
      serverSource.includes(
        'apiManagementService.getOpenApiSpec()'
      ),
    'B2D3B2B must preserve the read-only API-docs compatibility route that still needs apiManagementService.'
  );

  assert(
    platformManagementSource.includes(
      'applicationIdentityMiddleware'
    ) &&
      platformManagementSource.includes(
        'requireOwnerOrAdmin'
      ) &&
      platformManagementSource.includes(
        'apiKeyRuntimeService'
      ),
    'Modern Platform Management must remain the HUMAN_SESSION OWNER/ADMIN API-key administration boundary.'
  );

  for (const prefix of [
    '/api/v1/tenants',
    '/api/v1/saas',
  ]) {
    assert(
      classifyLegacyRoute(prefix + '/proof')
        ?.disposition === 'RETIRED',
      prefix +
        ' must be classified RETIRED after HTTP removal.'
    );
  }

  assert(
    typeof multiTenancyService.listTenants ===
      'function' &&
      typeof multiTenancyService.getTenant ===
        'function',
    'Multi-tenancy service must remain directly importable.'
  );

  assert(
    typeof quotaAndBillingService
      .getTenantQuota === 'function' &&
      typeof quotaAndBillingService
        .listInvoices === 'function',
    'Quota/billing service must remain directly importable.'
  );

  assert(
    typeof tenantGovernanceService
      .getAuditLogs === 'function' &&
      typeof tenantGovernanceService
        .exportComplianceRecord === 'function',
    'Tenant governance service must remain directly importable.'
  );

  assert(
    typeof webhookService.listWebhooks ===
      'function' &&
      typeof webhookService.getDeliveryEvents ===
        'function',
    'Webhook service must remain directly importable.'
  );

  assert(
    typeof saasReadinessService
      .getOverallSaaSReadiness === 'function' &&
      typeof saasReadinessService
        .getSaaSReadinessReport === 'function',
    'SaaS readiness service must remain directly importable.'
  );

  const tenants = multiTenancyService.listTenants();
  const quota =
    quotaAndBillingService.getTenantQuota(
      'b2d3b2b_internal_fixture'
    );
  const invoices =
    quotaAndBillingService.listInvoices(
      'b2d3b2b_internal_fixture'
    );
  const auditLogs =
    tenantGovernanceService.getAuditLogs({
      tenantId: 'b2d3b2b_internal_fixture',
      limit: 5,
    });
  const webhooks =
    webhookService.listWebhooks(
      'b2d3b2b_internal_fixture'
    );
  const deliveries =
    webhookService.getDeliveryEvents(
      'b2d3b2b_internal_fixture'
    );
  const readiness =
    saasReadinessService.getOverallSaaSReadiness();

  assert(
    Array.isArray(tenants) &&
      Boolean(quota) &&
      Array.isArray(invoices) &&
      Array.isArray(auditLogs) &&
      Array.isArray(webhooks) &&
      Array.isArray(deliveries) &&
      Boolean(readiness),
    'Tenant/SaaS supporting services must remain directly callable outside HTTP.'
  );

  const originalNodeEnv = process.env.NODE_ENV;
  const originalCompatibility =
    process.env[LEGACY_ROUTE_COMPATIBILITY_FLAG];

  process.env.NODE_ENV = 'development';
  process.env[
    LEGACY_ROUTE_COMPATIBILITY_FLAG
  ] = 'true';

  const { server, baseUrl } = await startServer();

  try {
    for (const path of [
      '/api/v1/tenants',
      '/api/v1/tenants/tenant_demo',
      '/api/v1/tenants/tenant_demo/api-keys',
      '/api/v1/tenants/tenant_demo/billing',
      '/api/v1/tenants/tenant_demo/quotas',
      '/api/v1/tenants/tenant_demo/audit-logs',
      '/api/v1/tenants/tenant_demo/webhooks',
      '/api/v1/saas/status',
      '/api/v1/saas/sim-billing-cycle',
    ]) {
      const response = await fetch(
        baseUrl + path
      );
      const body = await readJson(response);
      assert(
        response.status === 404 &&
          body?.code ===
            LEGACY_ROUTE_QUARANTINE_CODE,
        'Retired tenant/SaaS route must stay unavailable even with compatibility enabled: ' +
          path
      );
    }

    const devOnly = await fetch(
      baseUrl + '/api/v1/mediator/execute'
    );
    const devOnlyBody = await readJson(devOnly);
    assert(
      devOnly.status === 200 &&
        devOnlyBody?.source ===
          'post-quarantine-handler',
      'B2D3B2B must preserve explicit non-production compatibility for the remaining mediator/RAG/cognitive/Phase 4 DEVELOPMENT_ONLY group.'
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) =>
        error ? reject(error) : resolve()
      );
    });

    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }

    if (originalCompatibility === undefined) {
      delete process.env[
        LEGACY_ROUTE_COMPATIBILITY_FLAG
      ];
    } else {
      process.env[
        LEGACY_ROUTE_COMPATIBILITY_FLAG
      ] = originalCompatibility;
    }
  }

  console.log(
    'PRODUCTION_B2D3B2B_TENANT_SAAS_RETIREMENT_CHECK_PASSED'
  );
  console.log(
    'Tenant and SaaS HTTP administration is removed; legacy tenant provisioning/key/billing/quota/governance/webhook/SaaS routes are permanently retired; supporting services remain internally callable; API docs remain supported; and modern HUMAN_SESSION OWNER/ADMIN Platform Management remains the API-key administration boundary.'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_B2D3B2B_TENANT_SAAS_RETIREMENT_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});

import express from 'express';
import fs from 'fs';
import type { Server } from 'http';
import { apiKeyStore } from '../server/apiKeyStore.js';
import {
  LEGACY_DEVELOPER_ROUTE_RETIRED_CODE,
  legacyDeveloperRouteClosureRouter,
} from '../server/platform/legacyDeveloperRouteClosureRouter.js';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

async function startServer(): Promise<{
  server: Server;
  baseUrl: string;
}> {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/v1/developer',
    legacyDeveloperRouteClosureRouter
  );

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
    throw new Error('B2D2A test server failed to bind.');
  }

  return {
    server,
    baseUrl:
      'http://127.0.0.1:' + address.port,
  };
}

async function assertRetired(
  response: Response,
  label: string
): Promise<void> {
  assert(
    response.status === 410,
    label + ' must return 410 Gone.'
  );

  const body = await response.json();
  assert(
    body.code ===
      LEGACY_DEVELOPER_ROUTE_RETIRED_CODE &&
      body.replacement ===
        '/api/platform-management' &&
      body.stableMachineApi ===
        '/api/platform/v1',
    label +
      ' must point callers to the human control plane and stable machine API.'
  );
}

async function main() {
  const beforeDefaultKeys =
    apiKeyStore.listApiKeys('acc_default').length;

  const { server, baseUrl } = await startServer();

  try {
    await assertRetired(
      await fetch(
        baseUrl + '/api/v1/developer/keys'
      ),
      'Legacy key listing'
    );

    await assertRetired(
      await fetch(
        baseUrl + '/api/v1/developer/keys',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'Attempted legacy owner key',
            environment: 'live',
            scopes: [
              'role:owner',
              'role:admin',
              'role:approver',
              'platform-internal:developer:manage',
              'platform:automation:execute',
            ],
          }),
        }
      ),
      'Legacy key creation'
    );

    await assertRetired(
      await fetch(
        baseUrl +
          '/api/v1/developer/keys/key_attempted',
        {
          method: 'DELETE',
        }
      ),
      'Legacy key revocation'
    );

    await assertRetired(
      await fetch(
        baseUrl + '/api/v1/developer/usage'
      ),
      'Legacy developer usage'
    );

    const afterDefaultKeys =
      apiKeyStore.listApiKeys('acc_default').length;

    assert(
      afterDefaultKeys === beforeDefaultKeys,
      'Retired legacy developer routes must not mutate acc_default API keys.'
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) =>
        error ? reject(error) : resolve()
      );
    });
  }

  const serverSource = fs.readFileSync(
    'server.ts',
    'utf8'
  );
  const closureSource = fs.readFileSync(
    'server/platform/legacyDeveloperRouteClosureRouter.ts',
    'utf8'
  );
  const modernManagement = fs.readFileSync(
    'server/platform/platformManagementRouter.ts',
    'utf8'
  );
  const platformAuth = fs.readFileSync(
    'server/platform/platformApiAuth.ts',
    'utf8'
  );
  const developerUi = fs.readFileSync(
    'src/components/DeveloperPlatform.tsx',
    'utf8'
  );

  assert(
    serverSource.includes(
      "app.use('/api/v1/developer', legacyDeveloperRouteClosureRouter)"
    ),
    'server.ts must mount the explicit legacy developer closure router.'
  );

  for (const retiredDeclaration of [
    "app.get('/api/v1/developer/keys'",
    "app.post('/api/v1/developer/keys'",
    "app.delete('/api/v1/developer/keys/:id'",
    "app.get('/api/v1/developer/usage'",
  ]) {
    assert(
      !serverSource.includes(retiredDeclaration),
      'server.ts must not retain active legacy developer handler: ' +
        retiredDeclaration
    );
  }

  assert(
    !/developer\/keys[\s\S]{0,1200}acc_default/.test(
      serverSource
    ) &&
      !/developer\/usage[\s\S]{0,1200}acc_default/.test(
        serverSource
      ),
    'Legacy developer administration must not retain hard-coded acc_default behavior.'
  );

  assert(
    closureSource.includes(
      "status(410)"
    ) &&
      closureSource.includes(
        'LEGACY_DEVELOPER_ROUTE_RETIRED'
      ) &&
      !closureSource.includes(
        'createApiKey'
      ) &&
      !closureSource.includes(
        'revokeApiKey'
      ),
    'Legacy closure router must be non-mutating and explicitly retired.'
  );

  assert(
    modernManagement.includes(
      'requireOwnerOrAdmin'
    ) &&
      modernManagement.includes(
        'applicationIdentityMiddleware'
      ) &&
      modernManagement.includes(
        'apiKeyRuntimeService'
      ),
    'Modern Platform Management must remain the OWNER/ADMIN human control plane.'
  );

  assert(
    platformAuth.includes(
      'Authorization: Bearer <API_KEY>'
    ) &&
      platformAuth.includes(
        'apiKeyStore.validateApiKey'
      ),
    'Stable /api/platform/v1 must remain API-key authenticated.'
  );

  assert(
    developerUi.includes(
      '/api/platform-management/keys'
    ) &&
      developerUi.includes(
        '/api/platform-management/usage'
      ) &&
      !developerUi.includes(
        '/api/v1/developer/keys'
      ) &&
      !developerUi.includes(
        '/api/v1/developer/usage'
      ),
    'Developer UI must remain on the modern Platform Management control plane.'
  );

  console.log(
    'PRODUCTION_B2D2A_LEGACY_DEVELOPER_ROUTE_CLOSURE_CHECK_PASSED'
  );
  console.log(
    'All legacy developer key-management endpoints return 410 Gone, perform no key mutations, retain no hard-coded acc_default administration path, and point callers to the human OWNER/ADMIN Platform Management control plane while the stable Platform API remains API-key-only.'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_B2D2A_LEGACY_DEVELOPER_ROUTE_CLOSURE_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});

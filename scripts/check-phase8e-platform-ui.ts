import express from 'express';
import fs from 'fs';
import { apiKeyStore } from '../server/apiKeyStore.js';
import {
  PLATFORM_INTERNAL_DEVELOPER_MANAGE_SCOPE,
  platformManagementRouter,
} from '../server/platform/platformManagementRouter.js';
import {
  PLATFORM_SCOPES,
  publicPlatformManifest,
} from '../server/platform/platformApiManifest.js';

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
  const accountA = 'acc_phase8e_platform_a';
  const accountB = 'acc_phase8e_platform_b';

  const { secret: adminA } = apiKeyStore.createApiKey({
    name: 'Phase 8E developer admin A',
    accountId: accountA,
    environment: 'test',
    scopes: [PLATFORM_INTERNAL_DEVELOPER_MANAGE_SCOPE],
  });
  const { secret: adminB } = apiKeyStore.createApiKey({
    name: 'Phase 8E developer admin B',
    accountId: accountB,
    environment: 'test',
    scopes: [PLATFORM_INTERNAL_DEVELOPER_MANAGE_SCOPE],
  });
  const { secret: readOnlyA } = apiKeyStore.createApiKey({
    name: 'Phase 8E stable read key',
    accountId: accountA,
    environment: 'test',
    scopes: [PLATFORM_SCOPES.sourcesRead],
  });

  apiKeyStore.recordUsage({
    requestId: 'phase8e_usage_a',
    apiKeyId: 'phase8e_key_a',
    accountId: accountA,
    aiId: 'platform',
    endpoint: '/api/platform/v1/sources',
    timestamp: Date.now(),
    status: 200,
    latencyMs: 12,
    refused: false,
    grounded: true,
  });
  apiKeyStore.recordUsage({
    requestId: 'phase8e_usage_b',
    apiKeyId: 'phase8e_key_b',
    accountId: accountB,
    aiId: 'platform',
    endpoint: '/api/platform/v1/knowledge/summary',
    timestamp: Date.now(),
    status: 200,
    latencyMs: 15,
    refused: false,
    grounded: true,
  });

  const app = express();
  app.use(express.json());
  app.use('/api/platform-management', platformManagementRouter);
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', () => resolve());
      server.once('error', reject);
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Could not resolve Phase 8E HTTP test port.');
    }
    const baseUrl = 'http://127.0.0.1:' + address.port;

    const createAResponse = await fetch(
      baseUrl + '/api/platform-management/keys',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + adminA,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'A scoped Platform key',
          environment: 'test',
          scopes: [
            PLATFORM_SCOPES.sourcesRead,
            PLATFORM_SCOPES.toolsRead,
            PLATFORM_SCOPES.detectorsRead,
          ],
        }),
      }
    );
    assert(
      createAResponse.status === 201,
      'Developer admin should be able to create an explicitly scoped Platform key.'
    );
    const createABody = await createAResponse.json();
    const createdAId = createABody.apiKey?.id;

    assert(
      typeof createdAId === 'string' &&
        typeof createABody.secret === 'string' &&
        createABody.secret.startsWith('kn_test_') &&
        createABody.apiKey.accountId === accountA &&
        createABody.apiKey.keyHash === undefined &&
        JSON.stringify(createABody).includes('keyHash') === false &&
        createABody.apiKey.scopes.length === 3 &&
        createABody.apiKey.scopes.includes(
          PLATFORM_SCOPES.sourcesRead
        ),
      'Created-key response must preserve requested stable scopes while never exposing the stored key hash.'
    );

    const storedA = apiKeyStore.getApiKeyById(createdAId);
    assert(
      storedA?.accountId === accountA &&
        storedA.scopes.includes(PLATFORM_SCOPES.toolsRead) &&
        typeof storedA.keyHash === 'string' &&
        storedA.keyHash.length > 0,
      'Key hash should remain available internally while being absent from management responses.'
    );

    const invalidScopeResponse = await fetch(
      baseUrl + '/api/platform-management/keys',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + adminA,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Unsafe arbitrary scope',
          scopes: [
            PLATFORM_SCOPES.sourcesRead,
            'platform:automation:execute',
          ],
        }),
      }
    );
    assert(
      invalidScopeResponse.status === 400,
      'Developer key management must reject scopes that are not declared by the stable Platform manifest.'
    );

    const readKeyManagementResponse = await fetch(
      baseUrl + '/api/platform-management/keys',
      {
        headers: {
          Authorization: 'Bearer ' + readOnlyA,
        },
      }
    );
    assert(
      readKeyManagementResponse.status === 403,
      'A normal stable API read key must not gain developer key-management authority.'
    );

    const listAResponse = await fetch(
      baseUrl + '/api/platform-management/keys',
      {
        headers: {
          Authorization: 'Bearer ' + adminA,
          'X-Account-ID': accountB,
        },
      }
    );
    assert(
      listAResponse.status === 200,
      'Developer admin should be able to list keys in its own account scope.'
    );
    const listABody = await listAResponse.json();

    assert(
      Array.isArray(listABody.keys) &&
        listABody.keys.some(
          (key: any) => key.id === createdAId
        ) &&
        listABody.keys.every(
          (key: any) =>
            key.accountId === accountA &&
            key.keyHash === undefined
        ) &&
        JSON.stringify(listABody).includes('keyHash') === false,
      'Key listing must derive account identity from the Bearer key, ignore spoofed account headers, and omit key hashes.'
    );

    const listBResponse = await fetch(
      baseUrl + '/api/platform-management/keys',
      {
        headers: {
          Authorization: 'Bearer ' + adminB,
        },
      }
    );
    const listBBody = await listBResponse.json();
    assert(
      listBResponse.status === 200 &&
        listBBody.keys.every(
          (key: any) => key.accountId === accountB
        ) &&
        !listBBody.keys.some(
          (key: any) => key.id === createdAId
        ),
      'Developer management key inventory must be tenant isolated.'
    );

    const foreignRevoke = await fetch(
      baseUrl +
        '/api/platform-management/keys/' +
        createdAId,
      {
        method: 'DELETE',
        headers: {
          Authorization: 'Bearer ' + adminB,
          'X-Account-ID': accountA,
        },
      }
    );
    assert(
      foreignRevoke.status === 404,
      'Foreign developer admin must not revoke another account API key.'
    );

    const usageAResponse = await fetch(
      baseUrl + '/api/platform-management/usage',
      {
        headers: {
          Authorization: 'Bearer ' + adminA,
          'X-Account-ID': accountB,
        },
      }
    );
    const usageABody = await usageAResponse.json();
    assert(
      usageAResponse.status === 200 &&
        usageABody.recentLogs.some(
          (item: any) =>
            item.requestId === 'phase8e_usage_a'
        ) &&
        !usageABody.recentLogs.some(
          (item: any) =>
            item.requestId === 'phase8e_usage_b'
        ),
      'Developer usage/audit must remain account scoped.'
    );

    const revokeA = await fetch(
      baseUrl +
        '/api/platform-management/keys/' +
        createdAId,
      {
        method: 'DELETE',
        headers: {
          Authorization: 'Bearer ' + adminA,
        },
      }
    );
    assert(
      revokeA.status === 200 &&
        apiKeyStore.getApiKeyById(createdAId)?.status ===
          'revoked',
      'Owning developer admin must be able to revoke its scoped key.'
    );
  } finally {
    await new Promise<void>((resolve) =>
      server.close(() => resolve())
    );
  }

  const ui = read('src/components/DeveloperPlatform.tsx');
  const header = read('src/components/Header.tsx');
  const appSource = read('src/App.tsx');
  const management = read(
    'server/platform/platformManagementRouter.ts'
  );
  const manifestSource = read(
    'server/platform/platformApiManifest.ts'
  );
  const tools = read(
    'server/platform/tools/builtInTools.ts'
  );
  const detectors = read(
    'server/platform/detectors/builtInDetectors.ts'
  );
  const packs = read(
    'server/platform/domainPacks/builtInDomainPacks.ts'
  );

  assert(
    header.includes("currentTab === 'developer'") &&
      header.includes('nav-tab-developer') &&
      header.includes('<span>Developers</span>') &&
      appSource.includes('<DeveloperPlatform'),
    'Developer Platform must be a real first-class application workspace.'
  );

  assert(
    ui.includes('/api/platform/v1/manifest') &&
      ui.includes('Stable API v1') &&
      ui.includes('/api/platform/v1') &&
      ui.includes('/api/v1 is legacy compatibility'),
    'Developer UI must make the stable namespace and legacy compatibility boundary explicit.'
  );

  assert(
    ui.includes('/api/platform-management/keys') &&
      ui.includes('/api/platform-management/usage') &&
      !ui.includes('/api/v1/developer/keys') &&
      !ui.includes('/api/v1/developer/usage'),
    'Developer UI must use the account-scoped control plane rather than legacy hard-coded management routes.'
  );

  assert(
    ui.includes('manifest?.scopes') &&
      ui.includes('selectedScopes') &&
      ui.includes('platform-create-key-button') &&
      ui.includes('Secret shown once'),
    'Developer UI must create explicitly scoped keys from the authoritative stable manifest and make one-time secret handling visible.'
  );

  assert(
    ui.includes('/api/platform/v1/tools') &&
      ui.includes('/api/platform/v1/detectors') &&
      ui.includes('/api/platform/v1/domain-packs') &&
      ui.includes('Registered tools') &&
      ui.includes('Registered detectors') &&
      ui.includes('Domain packs'),
    'Developer UI must expose the governed tool, detector, and domain-pack inventories.'
  );

  assert(
    ui.includes("operation.method === 'GET'") &&
      ui.includes("!operation.path.includes(':')") &&
      ui.includes('Safe read explorer') &&
      ui.includes('parameter-free GET operations') &&
      !ui.includes('/invoke') &&
      !ui.includes('/detectors/') &&
      !ui.includes('/domain-packs/') &&
      !ui.includes('fetch(selectedExplorer.path'),
    'Browser API explorer must remain bounded to manifest-declared parameter-free GET operations and not become an arbitrary mutation console.'
  );

  assert(
    ui.includes('API usage') &&
      ui.includes('recentLogs') &&
      ui.includes('averageLatencyMs'),
    'Developer UI must expose account API usage/audit state.'
  );

  assert(
    management.includes('ALLOWED_PLATFORM_SCOPES') &&
      management.includes(
        'PLATFORM_INTERNAL_DEVELOPER_MANAGE_SCOPE'
      ) &&
      management.includes('resolveRequestIdentity') &&
      management.includes('listApiKeyMetadata'),
    'Developer management control plane must enforce authoritative identity, explicit stable-scope allowlisting, management privilege, and safe key metadata.'
  );

  const publicManifest = publicPlatformManifest();
  assert(
    publicManifest.basePath === '/api/platform/v1' &&
      publicManifest.stability === 'STABLE' &&
      publicManifest.scopes.length > 0 &&
      publicManifest.operations.every(
        (operation) =>
          operation.version === 'v1' &&
          operation.stability === 'STABLE'
      ),
    'Stable manifest must remain machine-readable and versioned.'
  );

  assert(
    !manifestSource.includes('automation.execute') &&
      !manifestSource.includes('/confirm') &&
      !manifestSource.includes('/execute') &&
      !manifestSource.includes('/shell') &&
      !tools.includes('eval(') &&
      !tools.includes('child_process') &&
      !detectors.includes('eval(') &&
      !packs.includes('handler:'),
    'Developer surface and extension catalogs must not smuggle controlled automation or arbitrary runtime execution into the stable platform.'
  );

  console.log('PHASE_8E_PLATFORM_UI_CHECK_PASSED');
  console.log(
    'Account-scoped developer key management, stable-scope allowlisting, hash-safe metadata, tenant isolation, stable/legacy namespace separation, governed extension inventory, read-only API explorer, and usage/audit visibility are verified.'
  );
}

main().catch((error) => {
  console.error('PHASE_8E_PLATFORM_UI_CHECK_FAILED');
  console.error(error);
  process.exit(1);
});

import fs from 'fs';
import {
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
  const ui = read('src/components/DeveloperPlatform.tsx');
  const header = read('src/components/Header.tsx');
  const appSource = read('src/App.tsx');
  const management = read(
    'server/platform/platformManagementRouter.ts'
  );
  const privilegedAuthorization = read(
    'server/identity/privilegedAuthorization.ts'
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
    ui.includes('ka_csrf=') &&
      ui.includes("'X-CSRF-Token': csrfToken()"),
    'Developer key create/revoke mutations must send the browser CSRF token required by the privileged control plane.'
  );

  assert(
    management.includes('ALLOWED_PLATFORM_SCOPES') &&
      management.includes(
        'applicationIdentityMiddleware'
      ) &&
      management.includes('requireOwnerOrAdmin') &&
      management.includes('apiKeyRuntimeService') &&
      !management.includes('resolveRequestIdentity') &&
      !management.includes(
        'platform-internal:developer:manage'
      ),
    'Platform Management must use durable human-session identity, OWNER/ADMIN authorization, PostgreSQL-aware API-key runtime operations, and stable-scope allowlisting.'
  );

  assert(
    privilegedAuthorization.includes(
      "identity.source !== 'HUMAN_SESSION'"
    ) &&
      privilegedAuthorization.includes(
        'PRIVILEGED_HUMAN_SESSION_REQUIRED'
      ) &&
      privilegedAuthorization.includes(
        'PRIVILEGED_ROLE_REQUIRED'
      ) &&
      privilegedAuthorization.includes("'OWNER'") &&
      privilegedAuthorization.includes("'ADMIN'"),
    'Privileged browser authorization must require HUMAN_SESSION and explicit OWNER/ADMIN membership roles.'
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
    'Developer workspace wiring, human-admin Platform Management contract, PostgreSQL-aware key control plane, stable-scope allowlisting, stable/legacy namespace separation, governed extension inventory, read-only API explorer, and usage/audit visibility are verified.'
  );
}

main().catch((error) => {
  console.error('PHASE_8E_PLATFORM_UI_CHECK_FAILED');
  console.error(error);
  process.exit(1);
});

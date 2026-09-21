import fs from 'fs';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function read(path: string): string {
  return fs.readFileSync(path, 'utf8');
}

function main() {
  const app = read('src/App.tsx');
  const header = read('src/components/Header.tsx');
  const workspace = read(
    'src/components/IntegrationsWorkspace.tsx'
  );
  const router = read(
    'server/integrations/integrationRouter.ts'
  );
  const packageJson = read('package.json');

  assert(
    header.includes("'integrations'") &&
      header.includes('nav-tab-integrations') &&
      header.includes('<span>Integrations</span>'),
    'Integrations must be a first-class navigation workspace.'
  );

  assert(
    app.includes('<IntegrationsWorkspace') &&
      app.includes("currentTab === 'integrations'") &&
      app.includes("get('tab')") &&
      app.includes("'integrations'"),
    'App must mount Integrations and restore the OAuth return tab from the URL.'
  );

  assert(
    workspace.includes(
      '/api/integrations/google-drive/oauth/start'
    ) &&
      workspace.includes(
        '/api/integrations/onedrive/oauth/start'
      ) &&
      workspace.includes('window.location.assign'),
    'Provider connect and reauthorize actions must use the real backend OAuth start endpoints.'
  );

  assert(
    packageJson.includes(
      '@googleworkspace/drive-picker-react'
    ) &&
      workspace.includes('DrivePicker') &&
      workspace.includes('DrivePickerDocsView') &&
      workspace.includes('google-drive-picker-button') &&
      workspace.includes('onPicked'),
    'Google Drive UI must use the official Google Workspace Picker wrapper.'
  );

  assert(
    workspace.includes('VITE_GOOGLE_DRIVE_CLIENT_ID') &&
      workspace.includes('VITE_GOOGLE_DRIVE_APP_ID'),
    'Google Picker must use explicit public browser configuration instead of server secrets.'
  );

  assert(
    workspace.includes('/api/integrations/connections') &&
      workspace.includes("action: 'sync' | 'pause' | 'resume' | 'reset-cursor'") &&
      workspace.includes("'/api/integrations/connections/' + connection.id + '/' + action"),
    'Integrations UI must be backed by persisted connection lifecycle APIs.'
  );

  assert(
    workspace.includes("'REAUTHORIZE'") &&
      workspace.includes("'PERMISSION_LOST'") &&
      workspace.includes("'CURSOR_RESET_REQUIRED'") &&
      workspace.includes("'SYNC_FAILED'") &&
      workspace.includes('integration-attention-panel'),
    'Integrations UI must surface the Phase 6D recovery states rather than collapsing them into generic errors.'
  );

  assert(
    workspace.includes('integration-reauthorize-button') &&
      workspace.includes('integration-reset-cursor-button') &&
      workspace.includes('integration-disconnect-button') &&
      workspace.includes('Sync now') &&
      workspace.includes('Pause') &&
      workspace.includes('Resume'),
    'Integrations UI must expose the valid lifecycle and explicit recovery controls.'
  );

  assert(
    workspace.includes('/runs?limit=40') &&
      workspace.includes('/imports?limit=80') &&
      workspace.includes('Sync runs') &&
      workspace.includes('External sources') &&
      workspace.includes('provenance.externalId') &&
      workspace.includes('provenance.externalVersion'),
    'Integrations UI must expose sync-run history and external source/version provenance.'
  );

  assert(
    workspace.includes('ka_csrf=') &&
      workspace.includes("'X-CSRF-Token': csrfToken()"),
    'Integration browser mutations must send the CSRF token required by HUMAN_SESSION protection.'
  );

  assert(
    router.includes("tab: 'integrations'") &&
      router.includes("status: 'connected'") &&
      router.includes("status: 'error'") &&
      router.includes('res.redirect'),
    'Browser OAuth callbacks must return to the Integrations workspace with explicit result state.'
  );

  assert(
    !workspace.includes('localStorage.setItem') &&
      !workspace.includes('sessionStorage.setItem') &&
      !workspace.includes('access_token') &&
      !workspace.includes('refresh_token'),
    'Normal Integrations UI must not persist or handle provider OAuth secrets in browser storage.'
  );

  assert(
    workspace.includes('Encrypted vault reference') &&
      !workspace.includes('credentialRef'),
    'UI must communicate credential security without exposing the internal credential reference.'
  );

  console.log('PHASE_6E_INTEGRATIONS_UI_CONTRACT_CHECK_PASSED');
  console.log(
    'First-class navigation, real OAuth flows, Google Picker, Phase 6D recovery actions, sync history, provenance, browser callback UX, and secret-safe frontend boundaries are present.'
  );
}

try {
  main();
} catch (error) {
  console.error(
    'PHASE_6E_INTEGRATIONS_UI_CONTRACT_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
}

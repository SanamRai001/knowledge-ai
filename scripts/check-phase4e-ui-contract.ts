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
  const ask = read('src/components/UnifiedAskView.tsx');
  const panel = read('src/components/ActionProposalPanel.tsx');
  const actions = read('src/components/ActionsWorkspace.tsx');
  const datasetTypes = read('src/datasetTypes.ts');
  const insightTypes = read('src/insightTypes.ts');
  const insights = read('src/components/InsightsWorkspace.tsx');

  assert(
    header.includes("'actions'") &&
      header.includes('nav-tab-actions') &&
      header.includes('<span>Actions</span>'),
    'Header must expose a first-class Actions workspace.'
  );

  assert(
    app.includes('<ActionsWorkspace') &&
      (app.includes("currentTab === 'actions'") ||
        app.includes("effectiveTab === 'actions'")),
    'App must mount the first-class Actions audit workspace.'
  );

  assert(
    ask.includes("useState<'ask' | 'update'>('ask')") &&
      ask.includes("mode === 'update'") &&
      ask.includes('Update your business') &&
      ask.includes('Prepare change'),
    'Main business workspace must expose separate Ask and Update modes.'
  );

  assert(
    ask.includes("fetch('/api/actions/propose'") &&
      ask.includes("'/confirm'") &&
      ask.includes("'/cancel'") &&
      ask.includes("'/select-target'"),
    'Update mode must use proposal, confirm, cancel, and explicit target-selection APIs.'
  );

  assert(
    panel.includes('Nothing is written until you confirm.') &&
      panel.includes('Exact changes') &&
      panel.includes('beforeValue') &&
      panel.includes('afterValue') &&
      panel.includes('Calculated by application logic') &&
      panel.includes('Explicitly requested'),
    'Proposal UI must make no-write-before-confirmation and exact before/after effects explicit.'
  );

  assert(
    panel.includes('Choose the intended target') &&
      panel.includes('will not guess') &&
      panel.includes('This proposal is stale') &&
      panel.includes('underlying company state changed'),
    'Proposal UI must expose ambiguity and stale-state safety instead of guessing or silently executing.'
  );

  assert(
    actions.includes('/api/actions?') &&
      actions.includes('/api/actions/') &&
      actions.includes('Audit trail') &&
      actions.includes('Execution recorded') &&
      actions.includes('Needs review'),
    'Actions workspace must preserve proposal history, execution status, and audit lifecycle.'
  );

  assert(
    datasetTypes.includes('companyStateOverlay') &&
      ask.includes('confirmed company-state overlay') &&
      ask.includes('The imported file remains unchanged.'),
    'Ask analytics UI must disclose confirmed-state overlays while preserving imported-file provenance.'
  );

  assert(
    insightTypes.includes('companyStateOverlay') &&
      insights.includes('Confirmed company state applied') &&
      insights.includes('without modifying the imported file'),
    'Insights evidence must disclose confirmed-state overlays.'
  );

  assert(
    !ask.includes("fetch('/api/actions/execute'") &&
      !ask.includes("fetch('/api/actions/write'") &&
      !panel.includes('Auto confirm'),
    'Normal UI must not contain a direct auto-write or hidden execute path.'
  );

  console.log('PHASE_4E_UI_CONTRACT_CHECK_PASSED');
  console.log(
    'Ask/Update separation, proposal previews, ambiguity/stale handling, explicit confirmation, Actions audit history, and confirmed-state provenance disclosures are present.'
  );
}

try {
  main();
} catch (error) {
  console.error('PHASE_4E_UI_CONTRACT_CHECK_FAILED');
  console.error(error);
  process.exit(1);
}

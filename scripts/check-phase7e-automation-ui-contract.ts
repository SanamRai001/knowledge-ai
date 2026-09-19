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
  const automation = read('src/components/AutomationWorkspace.tsx');

  assert(
    header.includes("'automation'") &&
      header.includes('nav-tab-automation') &&
      header.includes('<span>Automation</span>'),
    'Header must expose Automation as a first-class advanced workspace.'
  );

  assert(
    app.includes('<AutomationWorkspace') &&
      app.includes("currentTab === 'automation'"),
    'App must mount the real Automation workspace.'
  );

  assert(
    automation.includes('/api/automation/dashboard') &&
      automation.includes('/api/automation/context'),
    'Automation UI must load real persisted dashboard and actor capability state.'
  );

  assert(
    automation.includes('/api/automation/control/') &&
      automation.includes('Stop automatic execution') &&
      automation.includes('Clear emergency stop'),
    'Automation UI must expose the real emergency stop lifecycle.'
  );

  assert(
    automation.includes('/api/automation/approvals/') &&
      automation.includes("'approve'") &&
      automation.includes("'reject'"),
    'Automation UI must expose real approval resolution paths.'
  );

  assert(
    automation.includes('/api/automation/runs/') &&
      automation.includes('/compensate') &&
      automation.includes('/feedback'),
    'Automation UI must expose real recovery and run-feedback APIs.'
  );

  assert(
    automation.includes('Clean success') &&
      automation.includes('Execution failures') &&
      automation.includes('Approval escalation') &&
      automation.includes('False triggers') &&
      automation.includes('Policy blocks') &&
      automation.includes('Recovery required'),
    'Automation UI must surface the required quality and governance metrics.'
  );

  assert(
    automation.includes('Suggested actions still live in Actions') &&
      automation.includes('Approval queue') &&
      automation.includes('Automation run history') &&
      automation.includes('pretty(policy.mode)'),
    'Automation UI must distinguish suggested work, approval routing, policy mode, and automatic run outcomes in operator-facing language.'
  );

  assert(
    automation.includes('Time-saved metric intentionally unavailable') &&
      automation.includes('quality.timeSaved.reason') &&
      !automation.includes('minutes saved per run') &&
      !automation.includes('estimatedMinutes ||'),
    'Automation UI must not fabricate a time-saved estimate.'
  );

  assert(
    automation.includes('context?.capabilities.canControlEmergencyStop') &&
      automation.includes('context?.capabilities.canResolveApprovals') &&
      automation.includes('context?.capabilities.canCompensate'),
    'Dangerous Automation controls must respect authenticated capability context in the UI.'
  );

  assert(
    !automation.includes('/api/actions/confirm') &&
      !automation.includes('/api/company-knowledge/write') &&
      !automation.includes('fetch("/api/automation/direct') &&
      !automation.includes("fetch('/api/automation/direct"),
    'Automation UI must not contain a hidden direct-write bypass.'
  );

  console.log('PHASE_7E_AUTOMATION_UI_CONTRACT_CHECK_PASSED');
  console.log(
    'First-class Automation navigation, quality metrics, emergency controls, approvals, compensation, feedback, honest time-saved handling, capability-aware controls, and no direct-write bypass are present.'
  );
}

try {
  main();
} catch (error) {
  console.error('PHASE_7E_AUTOMATION_UI_CONTRACT_CHECK_FAILED');
  console.error(error);
  process.exit(1);
}

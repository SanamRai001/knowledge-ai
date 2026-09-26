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
  const watch = read('src/components/WatchWorkspace.tsx');
  const watchTypes = read('src/watchTypes.ts');

  assert(
    header.includes("'watch'") &&
      header.includes('nav-tab-watch') &&
      header.includes('<span>Watch</span>'),
    'Header must expose Watch as a first-class workspace.'
  );

  assert(
    app.includes('<WatchWorkspace') &&
      (app.includes("currentTab === 'watch'") ||
        app.includes("effectiveTab === 'watch'")),
    'App must mount the first-class Watch workspace.'
  );

  assert(
    watch.includes('/api/watch/drafts/propose') &&
      watch.includes('/select-target') &&
      watch.includes('/save') &&
      watch.includes('/cancel'),
    'Watch creation UI must use preview, target-selection, explicit save, and cancel APIs.'
  );

  assert(
    watch.includes('Nothing is monitored until you save this preview.') &&
      watch.includes('Structured condition') &&
      watch.includes('Preview watch') &&
      watch.includes('Save watch'),
    'Watch creation must make preview-before-activation explicit.'
  );

  assert(
    watch.includes('/api/watch/rules?') &&
      watch.includes("action: 'evaluate' | 'pause' | 'resume' | 'archive'") &&
      watch.includes("'/api/watch/rules/' + rule.id + '/' + action"),
    'Watch workspace must expose persisted rules and typed rule lifecycle controls.'
  );

  assert(
    watch.includes('/api/watch/alerts?') &&
      watch.includes("action: 'acknowledge' | 'resolve' | 'snooze'") &&
      watch.includes("'/api/watch/alerts/' + alert.id + '/' + action"),
    'Watch workspace must expose the typed alert lifecycle.'
  );

  assert(
    watch.includes('/api/watch/jobs?watchRuleId=') &&
      watch.includes('Evaluation history') &&
      watch.includes('Worker history') &&
      watch.includes('Alert episodes'),
    'Watch detail must expose deterministic evaluation, durable worker, and alert history.'
  );

  assert(
    watch.includes('Evidence:') &&
      watch.includes('effectiveClaimId') === false &&
      watch.includes('Confirmed company state') === false,
    'Normal Watch UI should show evidence in business terms without leaking internal claim identifiers.'
  );

  assert(
    watch.includes('Remind me 3 days') &&
      watchTypes.includes("'ENTITY_DATE_WINDOW'") &&
      watchTypes.includes("'TIME_REACHED'"),
    'Watch UI and contracts must expose source-relative and explicit-time reminder capability.'
  );

  assert(
    !watch.includes('/api/watch/direct-trigger') &&
      !watch.includes('Auto-create watch') &&
      !watch.includes('setInterval('),
    'Normal Watch UI must not bypass preview/save or implement browser-only scheduling.'
  );

  console.log('PHASE_5F_WATCH_UI_CONTRACT_CHECK_PASSED');
  console.log(
    'First-class Watch navigation, preview-first creation, ambiguity handling, deterministic rule controls, alert lifecycle, evidence, worker history, and reminder affordances are present.'
  );
}

try {
  main();
} catch (error) {
  console.error('PHASE_5F_WATCH_UI_CONTRACT_CHECK_FAILED');
  console.error(error);
  process.exit(1);
}

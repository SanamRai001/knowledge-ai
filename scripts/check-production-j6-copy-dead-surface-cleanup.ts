import fs from 'fs';

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
  const app = read('src/App.tsx');
  const automation = read(
    'src/components/AutomationWorkspace.tsx'
  );
  const sidebar = read(
    'src/components/DocumentSidebar.tsx'
  );
  const aiConfig = read(
    'src/components/SpecializedAIConfig.tsx'
  );
  const developer = read(
    'src/components/DeveloperPlatform.tsx'
  );

  for (const deadSurface of [
    'src/components/Phase7ReadinessView.tsx',
    'src/components/Phase8OperationalDashboard.tsx',
    'src/components/Phase9SaaSPlatformView.tsx',
  ]) {
    assert(
      !fs.existsSync(deadSurface),
      'J6 must remove orphan phase-numbered frontend surface: ' +
        deadSurface
    );
  }

  for (const deadImport of [
    'Phase7ReadinessView',
    'Phase8OperationalDashboard',
    'Phase9SaaSPlatformView',
  ]) {
    assert(
      !app.includes(deadImport),
      'J6 supported App shell must not import or render orphan surface: ' +
        deadImport
    );
  }

  assert(
    !automation.includes(
      'Phase 7 execution boundary:'
    ) &&
      automation.includes(
        'Execution safety boundary:'
      ),
    'J6 must express the Automation write boundary as product capability language, not an internal phase number.'
  );

  assert(
    !sidebar.includes(
      'Knowledge Isolation Active • Phase 1 Core'
    ) &&
      sidebar.includes(
        'Knowledge isolation active'
      ),
    'J6 must remove phase-numbered copy from the supported document sidebar.'
  );

  assert(
    !aiConfig.includes(
      'Memory Retrieval Governance (Phase 4)'
    ) &&
      aiConfig.includes(
        'Memory Retrieval Governance'
      ),
    'J6 must remove phase-numbered copy from the supported Specialized AI configuration UI.'
  );

  for (const staleVisibleCopy of [
    'Phase 1 Core',
    'Phase 7 execution boundary',
    'Memory Retrieval Governance (Phase 4)',
  ]) {
    assert(
      ![
        automation,
        sidebar,
        aiConfig,
      ].some((source) =>
        source.includes(staleVisibleCopy)
      ),
      'J6 supported product copy regressed to internal phase wording: ' +
        staleVisibleCopy
    );
  }

  assert(
    developer.includes(
      '/api/v1 is legacy compatibility'
    ),
    'J6 must preserve accurate Developer API compatibility wording rather than cosmetically renaming a stable backend contract.'
  );

  const historicalTypes = read(
    'src/types.ts'
  );
  assert(
    historicalTypes.includes(
      '// Phase 4 Memory Configuration'
    ) &&
      historicalTypes.includes(
        '// PHASE 6: ADAPTIVE EVIDENCE-DRIVEN MULTI-AGENT TYPES'
      ),
    'J6 must not erase legitimate engineering-phase identifiers from historical/internal type documentation.'
  );

  console.log(
    'PRODUCTION_J6_COPY_DEAD_SURFACE_CLEANUP_CHECK_PASSED'
  );
  console.log(
    'Orphan Phase7/8/9 frontend surfaces are removed, supported product copy uses capability language, stable API compatibility wording remains intact, and engineering-only historical identifiers are preserved.'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_J6_COPY_DEAD_SURFACE_CLEANUP_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});

import fs from 'fs';
import path from 'path';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

function read(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

function collectSourceFiles(
  root: string
): string[] {
  const output: string[] = [];
  for (const entry of fs.readdirSync(root, {
    withFileTypes: true,
  })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      output.push(...collectSourceFiles(fullPath));
      continue;
    }

    if (
      entry.isFile() &&
      /\.(?:ts|tsx)$/.test(entry.name)
    ) {
      output.push(fullPath);
    }
  }
  return output;
}

async function main() {
  const app = read('src/App.tsx');
  const header = read('src/components/Header.tsx');
  const testModal = read(
    'src/components/TestSuiteModal.tsx'
  );
  const ask = read(
    'src/components/UnifiedAskView.tsx'
  );
  const workspaceRouter = read(
    'server/workspaceRouter.ts'
  );

  const retiredComponents = [
    'src/components/Phase4LearningSandbox.tsx',
    'src/components/MediatorOrchestrationView.tsx',
    'src/components/AdaptiveEvidenceStudio.tsx',
    'src/components/CognitiveStudioView.tsx',
    'src/components/KnowledgeGraphExplorer.tsx',
    'src/components/ComplexPdfInspector.tsx',
    'src/components/ChatArea.tsx',
  ];

  for (const filePath of retiredComponents) {
    assert(
      !fs.existsSync(filePath),
      'Retired experimental frontend component must stay removed: ' +
        filePath
    );
  }

  for (const retiredTab of [
    "'sandbox'",
    "'mediator'",
    "'cognitive'",
  ]) {
    assert(
      !header.includes(retiredTab),
      'Retired tab must not remain in Header ActiveTab/navigation: ' +
        retiredTab
    );
    assert(
      !app.includes(
        `currentTab === ${retiredTab}`
      ),
      'Retired tab render branch must not remain in App: ' +
        retiredTab
    );
  }

  for (const retiredLabel of [
    'Learning Lab',
    'Advanced Orchestration',
    'Answer Diagnostics',
  ]) {
    assert(
      !header.includes(retiredLabel),
      'Retired experimental navigation label must stay removed: ' +
        retiredLabel
    );
  }

  for (const retiredImport of [
    'Phase4LearningSandbox',
    'MediatorOrchestrationView',
    'CognitiveStudioView',
  ]) {
    assert(
      !app.includes(retiredImport),
      'App must not import/render retired experimental surface: ' +
        retiredImport
    );
  }

  assert(
    !app.includes(
      "/api/kb/run-tests"
    ) &&
      !app.includes(
        'TestSuiteModal'
      ) &&
      !header.includes(
        'Trust Checks'
      ),
    'J2 must keep Trust Checks out of the normal browser shell while the supported server endpoint remains available for controlled tooling.'
  );

  assert(
    !app.includes('/api/v1/tests/phase4'),
    'App must not call the retired Phase 4 HTTP test runner.'
  );

  assert(
    testModal.includes('Production Trust Suite') &&
      testModal.includes('/api/kb/run-tests'),
    'Trust modal must describe the single supported production regression suite.'
  );

  assert(
    !testModal.includes('selectedSuite') &&
      !testModal.includes('Phase 4 Suite') &&
      !testModal.includes('Phase 1 Grounding'),
    'Trust modal must not present retired suite selection.'
  );

  assert(
    app.includes('<UnifiedAskView') &&
      ask.includes("fetch('/api/query/ask'"),
    'Primary Ask experience must remain UnifiedAskView on /api/query/ask.'
  );

  assert(
    workspaceRouter.includes(
      "workspaceRouter.post('/run-tests'"
    ) &&
      workspaceRouter.includes(
        'workspaceRouter.use(applicationIdentityMiddleware);'
      ),
    'Supported Trust Checks server contract must remain behind the workspace identity boundary.'
  );

  const sourceFiles =
    collectSourceFiles('src');
  const retiredApiPatterns = [
    '/api/phase4',
    '/api/v1/mediator',
    '/api/v1/cognitive',
    '/api/v1/rag',
    '/api/v1/tests/phase4',
  ];

  for (const filePath of sourceFiles) {
    const source = read(filePath);
    for (const retiredApi of retiredApiPatterns) {
      assert(
        !source.includes(retiredApi),
        'Frontend source must not call retired API family ' +
          retiredApi +
          ': ' +
          filePath
      );
    }
  }

  for (const internalModule of [
    'server/memoryStore.ts',
    'server/memoryRetrievalService.ts',
    'server/sandboxService.ts',
    'server/learningService.ts',
    'server/mediator/orchestrationEngine.ts',
    'server/cognitiveEngine/knowledgeCognitiveEngine.ts',
  ]) {
    assert(
      fs.existsSync(internalModule),
      'Backend/internal capability must remain available: ' +
        internalModule
    );
  }

  console.log(
    'PRODUCTION_B2D3B4_RETIRED_FRONTEND_SURFACE_CLEANUP_CHECK_PASSED'
  );
  console.log(
    'Retired experimental tabs/components and stale frontend calls are removed; J2 no longer exposes Trust Checks in the normal browser shell; the authenticated /api/kb/run-tests server contract remains available for controlled tooling; Unified Ask stays on /api/query/ask; and reusable backend internals remain available.'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_B2D3B4_RETIRED_FRONTEND_SURFACE_CLEANUP_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});

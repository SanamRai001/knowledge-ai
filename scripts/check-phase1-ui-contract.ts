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
  const datasets = read('src/components/DatasetWorkspace.tsx');
  const ask = read('src/components/UnifiedAskView.tsx');

  assert(
    header.includes("'datasets'") &&
      header.includes('nav-tab-datasets') &&
      header.includes('>Datasets<'),
    'Header must expose the first-class Datasets workspace.'
  );

  assert(
    app.includes('<DatasetWorkspace') &&
      app.includes("currentTab === 'datasets'"),
    'App must mount the Datasets workspace.'
  );

  assert(
    app.includes('<UnifiedAskView') &&
      app.includes("currentTab === 'playground'"),
    'Primary Ask tab must mount the unified Ask experience.'
  );

  assert(
    ask.includes("fetch('/api/query/ask'") &&
      !ask.includes("fetch('/api/kb/chat'"),
    'Unified Ask must use /api/query/ask rather than the legacy document-only chat route.'
  );

  assert(
    ask.includes('datasetId: selectedDatasetId') &&
      ask.includes('knowledgeBaseId:') &&
      ask.includes("response.route === 'DATASET_ANALYTICS'") &&
      ask.includes('DocumentEvidence'),
    'Unified Ask must send both source contexts and render analytics/document evidence separately.'
  );

  assert(
    datasets.includes("fetch('/api/datasets/preview'") &&
      datasets.includes("fetch('/api/datasets/import'") &&
      datasets.includes('schemaOverrides') &&
      datasets.includes('Validate schema changes'),
    'Datasets UI must preserve preview -> schema validation -> import workflow.'
  );

  assert(
    datasets.includes('/versions/') &&
      datasets.includes('Source SHA-256') &&
      datasets.includes('Version history'),
    'Datasets UI must expose immutable version/source provenance.'
  );

  assert(
    ask.includes('LLM for language. Deterministic code for business calculations.'),
    'Ask UI must communicate the hybrid trust model.'
  );

  console.log('PHASE_1_UI_CONTRACT_CHECK_PASSED');
  console.log(
    'Datasets, unified Ask routing, schema preview/import, and provenance UI contracts are present.'
  );
}

try {
  main();
} catch (error) {
  console.error('PHASE_1_UI_CONTRACT_CHECK_FAILED');
  console.error(error);
  process.exit(1);
}

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
  const insights = read('src/components/InsightsWorkspace.tsx');
  const datasets = read('src/components/DatasetWorkspace.tsx');

  assert(
    header.includes("'insights'") &&
      header.includes('nav-tab-insights') &&
      header.includes('>Insights<'),
    'Header must expose a first-class Insights workspace.'
  );

  assert(
    app.includes('<InsightsWorkspace') &&
      (app.includes("currentTab === 'insights'") ||
        app.includes("effectiveTab === 'insights'")),
    'App must mount the proactive Insights workspace.'
  );

  assert(
    insights.includes("fetch('/api/insights?'") &&
      insights.includes("fetch('/api/insights/analyze'") &&
      insights.includes("'/status'"),
    'Insights UI must load findings, trigger analysis, and support lifecycle updates.'
  );

  assert(
    insights.includes("useState<InsightStatus | 'ALL'>('OPEN')") &&
      insights.includes('priorityScore') === false,
    'Normal Insights UI should default to open findings and not expose raw priority scoring as product jargon.'
  );

  assert(
    insights.includes('insight.evidence.calculation') &&
      insights.includes('insight.evidence.excerpt') &&
      insights.includes('insight.evidence.rowReferences') &&
      insights.includes('sourceSha256'),
    'Insights UI must support calculation, document excerpt, row evidence, and dataset provenance drill-down.'
  );

  assert(
    insights.includes('Acknowledge') &&
      insights.includes('Resolve') &&
      insights.includes('Reopen'),
    'Insights UI must expose acknowledge, resolve, and reopen lifecycle controls.'
  );

  assert(
    insights.includes('Analyze now') &&
      insights.includes('Things worth your attention') &&
      insights.includes('Knowledge AI looks for what you did not know to ask.'),
    'Insights UI must present proactive discovery in user-facing language.'
  );

  assert(
    app.includes('onOpenDataset={(datasetId) =>') &&
      app.includes("setCurrentTab('datasets')") &&
      datasets.includes('preferredDatasetId'),
    'Insight evidence must be able to deep-link to its underlying dataset.'
  );

  assert(
    !insights.includes('{insight.detectorId}') &&
      !insights.includes('Detector ID'),
    'Normal Insights UI must not expose detector implementation identifiers.'
  );

  console.log('PHASE_2E_UI_CONTRACT_CHECK_PASSED');
  console.log(
    'First-class Insights navigation, proactive analysis, priority feed, evidence drill-down, lifecycle controls, and source deep-links are present.'
  );
}

try {
  main();
} catch (error) {
  console.error('PHASE_2E_UI_CONTRACT_CHECK_FAILED');
  console.error(error);
  process.exit(1);
}

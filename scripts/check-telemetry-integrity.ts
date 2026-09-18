import fs from 'fs';

const enginePath = 'server/cognitiveEngine/knowledgeCognitiveEngine.ts';
const typesPath = 'server/cognitiveEngine/types.ts';
const liveBenchmarkPath = 'scripts/run-live-gemini-benchmark.ts';

const engine = fs.readFileSync(enginePath, 'utf8');
const types = fs.readFileSync(typesPath, 'utf8');
const liveBenchmark = fs.readFileSync(liveBenchmarkPath, 'utf8');

const failures: string[] = [];

const forbidden = [
  {
    label: 'fake one-query token measurement',
    present:
      engine.includes("metric: 'tokens'") &&
      engine.includes("quantity: 1") &&
      engine.includes("unit: 'query'"),
  },
  {
    label: 'fake zero fusion timing',
    present: engine.includes('fusionMs: 0'),
  },
  {
    label: 'fake zero reranking timing',
    present: engine.includes('rerankingMs: 0'),
  },
  {
    label: 'duplicated synthesis-as-generation timing',
    present: engine.includes('generationMs: synthesizeResult.timingMs'),
  },
  {
    label: 'stale claim that provider token usage is not exposed',
    present: liveBenchmark.includes('tokenUsage: \'not exposed'),
  },
];

for (const item of forbidden) {
  if (item.present) failures.push(item.label);
}

const required = [
  { label: 'provider execution trace', present: engine.includes('providerExecution: synthesizeResult.providerExecution') },
  { label: 'measured provider latency', present: engine.includes('generationMs: synthesizeResult.providerExecution?.latencyMs ?? null') },
  { label: 'unknown fusion timing represented as null', present: engine.includes('fusionMs: null') },
  { label: 'unknown reranking timing represented as null', present: engine.includes('rerankingMs: null') },
  { label: 'measured-token source check', present: engine.includes("usage.source === 'MEASURED'") },
  { label: 'provider timing nullable contract', present: types.includes('generationMs: number | null') },
  { label: 'live measured token reporting', present: liveBenchmark.includes('liveResponsesWithMeasuredUsage') },
];

for (const item of required) {
  if (!item.present) failures.push(`missing ${item.label}`);
}

if (failures.length > 0) {
  console.error('TELEMETRY_INTEGRITY_CHECK_FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('TELEMETRY_INTEGRITY_CHECK_PASSED');
console.log('Provider usage, failure metadata, and stage timing preserve measured-vs-unavailable semantics.');

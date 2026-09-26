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
  const workspace = read('src/components/CompanyKnowledgeWorkspace.tsx');

  assert(
    header.includes("'company'") &&
      header.includes('nav-tab-company') &&
      header.includes('<span>Knowledge</span>'),
    'Header must expose a first-class living Knowledge workspace.'
  );

  assert(
    app.includes('<CompanyKnowledgeWorkspace') &&
      (app.includes("currentTab === 'company'") ||
        app.includes("effectiveTab === 'company'")),
    'App must mount the living Company Knowledge workspace.'
  );

  assert(
    workspace.includes('/api/company-knowledge/summary') &&
      workspace.includes('/api/company-knowledge/entities?limit=500') &&
      workspace.includes('/api/company-knowledge/projection-runs?limit=200') &&
      workspace.includes('/api/company-knowledge/events?limit=150'),
    'Knowledge UI must load company entities, history, and timeline from the authoritative Phase 3 API.'
  );

  assert(
    workspace.includes('/api/company-knowledge/project/dataset') &&
      workspace.includes('/api/company-knowledge/project/documents') &&
      workspace.includes('Refresh knowledge'),
    'Knowledge UI must support explicit projection from structured and document sources.'
  );

  assert(
    workspace.includes('/api/company-knowledge/conflicts?entityId=') &&
      workspace.includes('conflicting observation') &&
      workspace.includes('higher authority'),
    'Knowledge UI must expose conflicts and authority rather than silently collapsing disagreement.'
  );

  assert(
    workspace.includes('/api/company-knowledge/changes/compare?fromRunId=') &&
      workspace.includes('What changed?') &&
      workspace.includes('Deterministic source diff'),
    'Knowledge UI must expose deterministic source-version change comparison.'
  );

  assert(
    workspace.includes('Current knowledge') &&
      workspace.includes('Relationships') &&
      workspace.includes('Evidence sources') &&
      workspace.includes('Entity timeline') &&
      workspace.includes('Knowledge timeline'),
    'Knowledge UI must cover observations, relationships, evidence, and temporal history.'
  );

  assert(
    workspace.includes('claim.claimKind') &&
      workspace.includes('claim.authority.level') &&
      workspace.includes('claim.sourceRef.excerpt'),
    'Claim cards must keep observation kind, authority, and exact source evidence visible.'
  );

  assert(
    !workspace.includes('GraphRAG') &&
      !workspace.includes('Knowledge Graph & Entity Relation Engine'),
    'Normal Phase 3 product UI must not expose experimental graph-engine jargon.'
  );

  console.log('PHASE_3E_UI_CONTRACT_CHECK_PASSED');
  console.log(
    'Living Knowledge navigation, source projection, entity inspection, authority/conflicts, evidence, history, and deterministic What changed UX are present.'
  );
}

try {
  main();
} catch (error) {
  console.error('PHASE_3E_UI_CONTRACT_CHECK_FAILED');
  console.error(error);
  process.exit(1);
}

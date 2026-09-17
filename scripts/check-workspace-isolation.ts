import { kbStore } from '../server/kbStore.js';
import { workspaceAccessService, WorkspaceAccessError } from '../server/workspaceAccessService.js';
import { specializedAIService, SpecializedAIError } from '../server/specializedAIService.js';
import { knowledgeCognitiveEngine } from '../server/cognitiveEngine/knowledgeCognitiveEngine.js';
import { resolveRequestIdentity, RequestIdentityError } from '../server/requestIdentity.js';
import { apiKeyStore } from '../server/apiKeyStore.js';
import type { KnowledgeDocument } from '../src/types.js';
import type express from 'express';

const suffix = Date.now().toString(36);
const accountA = `acc_isolation_a_${suffix}`;
const accountB = `acc_isolation_b_${suffix}`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`WORKSPACE_ISOLATION_FAILED: ${message}`);
}

function processedDoc(id: string, filename: string, text: string): KnowledgeDocument {
  return {
    id,
    filename,
    fileType: 'application/pdf',
    fileSize: text.length,
    uploadTimestamp: Date.now(),
    processingStatus: 'processed',
    pageCount: 1,
    summary: text,
    pages: [{ pageNumber: 1, text }],
  };
}

async function run() {
  // Two KBs per account make delete/active semantics realistic without touching default data.
  const a1 = kbStore.createKB('Isolation A Primary', 'Account A confidential workspace', accountA);
  const a2 = kbStore.createKB('Isolation A Secondary', 'Account A secondary workspace', accountA);
  const b1 = kbStore.createKB('Isolation B Primary', 'Account B confidential workspace', accountB);
  kbStore.createKB('Isolation B Secondary', 'Account B secondary workspace', accountB);

  const aDoc = processedDoc(
    `doc_a_${suffix}`,
    'account-a-secret.pdf',
    'Project Cedar authorization code is CEDAR-491. This fact belongs only to Account A.'
  );
  const bDoc = processedDoc(
    `doc_b_${suffix}`,
    'account-b-operations.pdf',
    'Project Birch authorization code is BIRCH-882. This fact belongs only to Account B.'
  );

  kbStore.addDocument(a1.id, aDoc, accountA);
  kbStore.addDocument(b1.id, bDoc, accountB);

  // 1. Raw KB ids are not authority. Default/Account A cannot read B.
  assert(kbStore.getKB(b1.id) === undefined, 'default account could read Account B KB by raw id');
  assert(kbStore.getKB(b1.id, accountA) === undefined, 'Account A could read Account B KB by raw id');
  assert(kbStore.getKB(a1.id, accountA)?.id === a1.id, 'Account A could not read its own KB');

  // 2. Cross-account mutation is denied at the store boundary.
  const crossUpdate = kbStore.updateKB(b1.id, { name: 'PWNED' }, accountA);
  assert(crossUpdate === null, 'Account A could mutate Account B KB');
  assert(kbStore.getKB(b1.id, accountB)?.name === 'Isolation B Primary', 'Account B KB changed after denied update');

  // 3. Cross-account active-KB switching is denied.
  assert(kbStore.setActiveKB(b1.id, accountA) === false, 'Account A switched to Account B KB');
  workspaceAccessService.setActiveKB(accountA, a2.id);
  assert(workspaceAccessService.getActiveKB(accountA).id === a2.id, 'Account A active KB was not account-scoped');

  let foreignAccessDenied = false;
  try {
    workspaceAccessService.requireKB(accountA, b1.id);
  } catch (error) {
    foreignAccessDenied = error instanceof WorkspaceAccessError && error.statusCode === 404;
  }
  assert(foreignAccessDenied, 'workspace service exposed a foreign KB');

  // 4. Specialized AI service must reject cross-account access before generation.
  let aiDenied = false;
  try {
    await specializedAIService.answer({
      aiId: b1.specializedAi.id,
      message: 'What is the Project Birch authorization code?',
      accountId: accountA,
      source: 'API',
    });
  } catch (error) {
    aiDenied = error instanceof SpecializedAIError && error.statusCode === 403;
  }
  assert(aiDenied, 'Account A could query Account B Specialized AI');

  // 5. Request identity cannot be spoofed through caller-supplied account headers.
  const unauthenticatedRequest = {
    headers: { 'x-account-id': accountB },
  } as unknown as express.Request;
  const defaultIdentity = resolveRequestIdentity(unauthenticatedRequest);
  assert(defaultIdentity.accountId === 'acc_default', 'untrusted account header changed request identity');
  assert(defaultIdentity.authenticated === false, 'unauthenticated request was marked authenticated');

  const createdKey = apiKeyStore.createApiKey({
    name: `Isolation test ${suffix}`,
    accountId: accountA,
    environment: 'test',
    scopes: ['knowledge:read', 'chat:read'],
  });
  const authenticatedRequest = {
    headers: { authorization: `Bearer ${createdKey.secret}`, 'x-account-id': accountB },
  } as unknown as express.Request;
  const authenticatedIdentity = resolveRequestIdentity(authenticatedRequest);
  assert(authenticatedIdentity.accountId === accountA, 'Bearer key did not authoritatively determine account scope');
  assert(authenticatedIdentity.authenticated === true, 'valid API key was not marked authenticated');

  let invalidAuthDenied = false;
  try {
    resolveRequestIdentity({ headers: { authorization: 'Bearer invalid-key' } } as unknown as express.Request);
  } catch (error) {
    invalidAuthDenied = error instanceof RequestIdentityError && error.statusCode === 401;
  }
  assert(invalidAuthDenied, 'invalid Authorization header silently fell back to default account');
  apiKeyStore.revokeApiKey(createdKey.apiKey.id, accountA);

  // 6. Retrieval/index state is separated by tenant + KB scope.
  const accountAAnswer = await knowledgeCognitiveEngine.answerQuestion({
    question: 'What is the Project Cedar authorization code?',
    tenantId: accountA,
    knowledgeBaseId: a1.id,
    documents: [aDoc],
    forceDeterministic: true,
  });
  assert(accountAAnswer.answer.includes('CEDAR-491'), 'Account A could not retrieve its own confidential fact');

  const accountBAnswer = await knowledgeCognitiveEngine.answerQuestion({
    question: 'What is the Project Cedar authorization code?',
    tenantId: accountB,
    knowledgeBaseId: b1.id,
    documents: [bDoc],
    forceDeterministic: true,
  });
  assert(!accountBAnswer.answer.includes('CEDAR-491'), 'Account A evidence leaked into Account B retrieval');
  assert(
    !accountBAnswer.sources.some((source) => source.documentName === aDoc.filename),
    'Account A citation leaked into Account B retrieval'
  );

  console.log('WORKSPACE_ISOLATION_CHECK_PASSED');
  console.log(JSON.stringify({
    accountReadIsolation: true,
    accountMutationIsolation: true,
    activeKbIsolation: true,
    specializedAiIsolation: true,
    requestIdentityIsolation: true,
    retrievalIsolation: true,
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

import express from 'express';
import fs from 'fs';
import path from 'path';
import { apiKeyStore } from '../server/apiKeyStore.js';
import { actionPersistence, ActionPersistence } from '../server/actions/actionPersistence.js';
import { actionRouter } from '../server/actions/actionRouter.js';
import { companyKnowledgePersistence, CompanyKnowledgePersistence } from '../server/companyKnowledge/companyKnowledgePersistence.js';
import { companyKnowledgeRouter } from '../server/companyKnowledge/companyKnowledgeRouter.js';
import { effectiveCompanyStateRuntimeService } from '../server/companyKnowledge/effectiveCompanyStateRuntimeService.js';
import { SOURCE_AUTHORITIES } from '../server/companyKnowledge/sourceAuthority.js';
import { datasetService } from '../server/datasets/datasetService.js';
import { integrationRuntimeService } from '../server/integrations/integrationRuntimeService.js';
import { testIntegrationConnector } from '../server/integrations/connectors/testConnector.js';
import { closePostgresPool, postgresPool } from '../server/persistence/postgres.js';
import { postgresAccountRepository } from '../server/persistence/postgresRepositories.js';
import { runPostgresMigrations } from '../server/persistence/migrationRunner.js';
import { setSourceByteStorageForTesting } from '../server/storage/sourceByteStorageRuntime.js';
import { MemorySourceByteStorage } from './support/memorySourceByteStorage.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function json(response: Response) {
  const body = await response.json();
  return { response, body };
}

function fileSnapshot(file: string): string | null {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

async function main() {
  assert(
    process.env.KNOWLEDGE_AI_PERSISTENCE_MODE === 'postgres',
    'A7D proof must run in PostgreSQL persistence mode.'
  );
  assert(
    Boolean(process.env.DATABASE_URL),
    'DATABASE_URL is required for A7D proof.'
  );

  await runPostgresMigrations();

  setSourceByteStorageForTesting(
    new MemorySourceByteStorage()
  );

  await postgresPool().query(
    `TRUNCATE TABLE
      action_audit_entries,
      action_execution_events,
      action_execution_claims,
      action_executions,
      action_proposal_targets,
      action_proposals,
      business_event_subjects,
      business_events,
      knowledge_claims,
      knowledge_projection_runs,
      company_relationships,
      company_entities,
      integration_external_imports,
      integration_sync_runs,
      integration_connections
     CASCADE`
  );

  const accountA = 'acc_a7d_knowledge_actions_a';
  const accountB = 'acc_a7d_knowledge_actions_b';
  await postgresAccountRepository.ensureAccount(accountA);
  await postgresAccountRepository.ensureAccount(accountB);

  const knowledgeFile = path.join(
    process.cwd(),
    'data',
    'company-knowledge.json'
  );
  const actionFile = path.join(
    process.cwd(),
    'data',
    'company-actions.json'
  );
  const knowledgeBefore = fileSnapshot(knowledgeFile);
  const actionsBefore = fileSnapshot(actionFile);

  const dataset = datasetService.importCsv({
    accountId: accountA,
    buffer: Buffer.from(
      [
        'product_id,product_name,current_stock,reorder_level',
        'A7D-P1,A7D Oak,10,5',
      ].join('\n'),
      'utf8'
    ),
    filename: 'a7d-inventory.csv',
    datasetName: 'A7D Inventory',
  });

  const keyA = apiKeyStore.createApiKey({
    name: 'A7D account A',
    accountId: accountA,
    environment: 'test',
  });
  const keyB = apiKeyStore.createApiKey({
    name: 'A7D account B',
    accountId: accountB,
    environment: 'test',
  });

  const app = express();
  app.use(express.json());
  app.use('/api/company-knowledge', companyKnowledgeRouter);
  app.use('/api/actions', actionRouter);
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Could not resolve A7D HTTP test port.');
    }
    const baseUrl = 'http://127.0.0.1:' + address.port;

    const projected = await json(
      await fetch(baseUrl + '/api/company-knowledge/project/dataset', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + keyA.secret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          datasetId: dataset.dataset.id,
          versionId: dataset.version.id,
        }),
      })
    );

    assert(
      projected.response.status === 201 &&
        projected.body.run?.status === 'COMPLETED' &&
        projected.body.summary?.entities >= 1 &&
        projected.body.summary?.currentClaims >= 2,
      'Normal Dataset projection HTTP path must populate PostgreSQL Living Knowledge.'
    );

    const pgRun = await postgresPool().query(
      'SELECT status, source_id, source_version_id FROM knowledge_projection_runs WHERE account_id = $1 AND id = $2',
      [accountA, projected.body.run.id]
    );
    const pgEntity = await postgresPool().query(
      "SELECT id, type, canonical_name, identity_key FROM company_entities WHERE account_id = $1 AND type = 'PRODUCT' AND identity_key = 'a7d p1'",
      [accountA]
    );

    assert(
      pgRun.rows[0]?.status === 'COMPLETED' &&
        pgRun.rows[0]?.source_id === dataset.dataset.id &&
        pgRun.rows[0]?.source_version_id === dataset.version.id &&
        pgEntity.rows[0]?.canonical_name === 'A7D Oak',
      'Projection run and projected entity must be durable in PostgreSQL.'
    );

    const productId = pgEntity.rows[0].id as string;

    const summary = await json(
      await fetch(baseUrl + '/api/company-knowledge/summary', {
        headers: { Authorization: 'Bearer ' + keyA.secret },
      })
    );
    const entities = await json(
      await fetch(
        baseUrl +
          '/api/company-knowledge/entities?type=PRODUCT&search=' +
          encodeURIComponent('A7D Oak'),
        {
          headers: { Authorization: 'Bearer ' + keyA.secret },
        }
      )
    );
    const detail = await json(
      await fetch(
        baseUrl +
          '/api/company-knowledge/entities/' +
          encodeURIComponent(productId),
        {
          headers: { Authorization: 'Bearer ' + keyA.secret },
        }
      )
    );

    assert(
      summary.response.status === 200 &&
        summary.body.summary?.entities >= 1 &&
        entities.response.status === 200 &&
        entities.body.entities?.some(
          (entity: any) => entity.id === productId
        ) &&
        detail.response.status === 200 &&
        detail.body.entity?.id === productId &&
        detail.body.claims?.some(
          (claim: any) =>
            claim.predicate === 'CURRENT_STOCK' &&
            claim.value === 10
        ),
      'Normal Company Knowledge summary/list/detail reads must come from PostgreSQL-selected state.'
    );

    const foreignEntity = await fetch(
      baseUrl +
        '/api/company-knowledge/entities/' +
        encodeURIComponent(productId),
      {
        headers: {
          Authorization: 'Bearer ' + keyB.secret,
          'X-Account-ID': accountA,
        },
      }
    );
    assert(
      foreignEntity.status === 404,
      'Foreign account must not read PostgreSQL Living Knowledge by raw entity ID.'
    );

    const proposalResponse = await json(
      await fetch(baseUrl + '/api/actions/propose', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + keyA.secret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          instruction: 'Received 5 units of A7D Oak.',
          allowLlmParsing: false,
        }),
      })
    );

    assert(
      proposalResponse.response.status === 201 &&
        proposalResponse.body.proposal?.status === 'PROPOSED' &&
        proposalResponse.body.proposal?.mutations?.[0]?.predicate ===
          'CURRENT_STOCK' &&
        proposalResponse.body.proposal?.mutations?.[0]?.beforeValue === 10 &&
        proposalResponse.body.proposal?.mutations?.[0]?.afterValue === 15,
      'Normal Action proposal must resolve PostgreSQL effective company state and calculate the preview.'
    );

    const proposalId = proposalResponse.body.proposal.id as string;
    const pgProposal = await postgresPool().query(
      'SELECT status FROM action_proposals WHERE account_id = $1 AND id = $2',
      [accountA, proposalId]
    );
    const proposedAudit = await postgresPool().query(
      "SELECT action FROM action_audit_entries WHERE account_id = $1 AND proposal_id = $2 AND action = 'PROPOSED'",
      [accountA, proposalId]
    );
    assert(
      pgProposal.rows[0]?.status === 'PROPOSED' &&
        proposedAudit.rowCount === 1,
      'Action proposal and initial audit must be transactionally persisted in PostgreSQL.'
    );

    const confirmResponse = await json(
      await fetch(
        baseUrl +
          '/api/actions/' +
          encodeURIComponent(proposalId) +
          '/confirm',
        {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + keyA.secret },
        }
      )
    );

    assert(
      confirmResponse.response.status === 200 &&
        confirmResponse.body.proposal?.status === 'CONFIRMED' &&
        Boolean(confirmResponse.body.execution?.id),
      'Normal Action confirm must complete through the PostgreSQL transaction.'
    );

    const executionId = confirmResponse.body.execution.id as string;
    const currentState =
      await effectiveCompanyStateRuntimeService.resolve(
        accountA,
        productId,
        'CURRENT_STOCK'
      );
    assert(
      currentState.status === 'RESOLVED' &&
        currentState.value === 15 &&
        currentState.effectiveClaim.authority.level ===
          'USER_CONFIRMED' &&
        currentState.effectiveClaim.sourceRef.sourceVersionId === proposalId,
      'Confirmed Action must create the USER_CONFIRMED effective state in PostgreSQL.'
    );

    const transactionEvidence = await postgresPool().query(
      `SELECT
         (SELECT status FROM action_proposals WHERE account_id = $1 AND id = $2) AS proposal_status,
         (SELECT count(*)::int FROM action_executions WHERE account_id = $1 AND id = $3) AS executions,
         (SELECT count(*)::int FROM action_execution_claims WHERE account_id = $1 AND execution_id = $3) AS claim_links,
         (SELECT count(*)::int FROM action_execution_events WHERE account_id = $1 AND execution_id = $3) AS event_links,
         (SELECT count(*)::int FROM action_audit_entries WHERE account_id = $1 AND proposal_id = $2 AND action = 'CONFIRMED') AS confirmed_audits`,
      [accountA, proposalId, executionId]
    );

    assert(
      transactionEvidence.rows[0]?.proposal_status === 'CONFIRMED' &&
        Number(transactionEvidence.rows[0]?.executions) === 1 &&
        Number(transactionEvidence.rows[0]?.claim_links) >= 1 &&
        Number(transactionEvidence.rows[0]?.event_links) === 1 &&
        Number(transactionEvidence.rows[0]?.confirmed_audits) === 1,
      'Claims, event, execution, proposal transition, and confirmation audit must all exist after the relational transaction.'
    );

    const replay = await json(
      await fetch(
        baseUrl +
          '/api/actions/' +
          encodeURIComponent(proposalId) +
          '/confirm',
        {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + keyA.secret },
        }
      )
    );
    assert(
      replay.response.status === 200 &&
        replay.body.execution?.id === executionId,
      'Repeated confirmation must return the same PostgreSQL execution idempotently.'
    );

    const staleProposalResponse = await json(
      await fetch(baseUrl + '/api/actions/propose', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + keyA.secret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          instruction: 'Received 2 units of A7D Oak.',
          allowLlmParsing: false,
        }),
      })
    );
    assert(
      staleProposalResponse.response.status === 201 &&
        staleProposalResponse.body.proposal?.status === 'PROPOSED' &&
        staleProposalResponse.body.proposal?.mutations?.[0]?.beforeValue ===
          15,
      'Second proposal must snapshot the current PostgreSQL state.'
    );

    const staleProposalId =
      staleProposalResponse.body.proposal.id as string;

    await companyKnowledgePersistence.recordClaim({
      accountId: accountA,
      subjectEntityId: productId,
      predicate: 'CURRENT_STOCK',
      value: 20,
      claimKind: 'FACT',
      authority: { ...SOURCE_AUTHORITIES.USER_CONFIRMED },
      sourceRef: {
        sourceType: 'USER',
        sourceId: 'confirmed-company-state',
        sourceVersionId: 'a7d-concurrent-adjustment',
        sourceVersionLabel: 'A7D concurrent adjustment',
        sourceName: 'Confirmed business adjustment',
      },
      observedAt: Date.now() + 1,
      validFrom: Date.now() + 1,
    });

    const staleConfirm = await json(
      await fetch(
        baseUrl +
          '/api/actions/' +
          encodeURIComponent(staleProposalId) +
          '/confirm',
        {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + keyA.secret },
        }
      )
    );

    const staleDb = await postgresPool().query(
      `SELECT
         (SELECT status FROM action_proposals WHERE account_id = $1 AND id = $2) AS status,
         (SELECT count(*)::int FROM action_executions WHERE account_id = $1 AND proposal_id = $2) AS executions`,
      [accountA, staleProposalId]
    );

    assert(
      staleConfirm.response.status === 409 &&
        staleDb.rows[0]?.status === 'STALE' &&
        Number(staleDb.rows[0]?.executions) === 0,
      'Stale Action confirmation must roll back all business writes and mark the proposal stale.'
    );

    const foreignAction = await fetch(
      baseUrl +
        '/api/actions/' +
        encodeURIComponent(proposalId),
      {
        headers: {
          Authorization: 'Bearer ' + keyB.secret,
          'X-Account-ID': accountA,
        },
      }
    );
    const foreignConfirm = await fetch(
      baseUrl +
        '/api/actions/' +
        encodeURIComponent(proposalId) +
        '/confirm',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + keyB.secret,
          'X-Account-ID': accountA,
        },
      }
    );
    assert(
      foreignAction.status === 404 &&
        foreignConfirm.status === 404,
      'Foreign account must not inspect or confirm PostgreSQL-backed Actions.'
    );

    await closePostgresPool();
    const reconstructedKnowledge =
      new CompanyKnowledgePersistence();
    const reconstructedActions = new ActionPersistence();
    const reconstructedEntity =
      await reconstructedKnowledge.getEntity(
        accountA,
        productId
      );
    const reconstructedProposal =
      await reconstructedActions.getProposal(
        accountA,
        proposalId
      );
    const reconstructedExecution =
      await reconstructedActions.getExecutionByProposal(
        accountA,
        proposalId
      );

    assert(
      reconstructedEntity?.id === productId &&
        reconstructedProposal?.status === 'CONFIRMED' &&
        reconstructedExecution?.id === executionId,
      'Living Knowledge and Action state must survive PostgreSQL pool/service reconstruction.'
    );

    const integration =
      await integrationRuntimeService.createConnection({
        accountId: accountA,
        provider: 'TEST',
        displayName: 'A7D projection bridge',
      });
    testIntegrationConnector.configureConnection({
      connectionId: integration.id,
      fixtures: [
        {
          externalId: 'a7d-external-inventory',
          externalVersion: 'v1',
          name: 'a7d-external-inventory.csv',
          mimeType: 'text/csv',
          content: [
            'product_id,product_name,current_stock,reorder_level',
            'A7D-P2,A7D Pine,8,4',
          ].join('\n'),
          modifiedAt: 1,
        },
      ],
    });

    const integrationRun =
      await integrationRuntimeService.sync({
        accountId: accountA,
        connectionId: integration.id,
      });
    assert(
      integrationRun.status === 'COMPLETED' &&
        integrationRun.importedCount === 1,
      'Production Integration runtime sync must still complete after A7D cutover.'
    );

    const integratedEntity = (
      await reconstructedKnowledge.listEntities({
        accountId: accountA,
        type: 'PRODUCT',
        search: 'A7D Pine',
        limit: 20,
      })
    )[0];

    assert(
      integratedEntity?.canonicalName === 'A7D Pine',
      'Integration-synchronized structured data must project directly into PostgreSQL Living Knowledge.'
    );

    const finalKnowledgeFile = fileSnapshot(knowledgeFile);
    const finalActionFile = fileSnapshot(actionFile);
    assert(
      finalKnowledgeFile === knowledgeBefore &&
        finalActionFile === actionsBefore,
      'PostgreSQL A7D runtime must not mutate legacy company-knowledge.json or company-actions.json.'
    );

    assert(
      actionPersistence.usesPostgres() &&
        companyKnowledgePersistence.usesPostgres(),
      'A7D selected persistence must report PostgreSQL runtime mode.'
    );
  } finally {
    setSourceByteStorageForTesting(
      null
    );
    await new Promise<void>((resolve) =>
      server.close(() => resolve())
    );
    await closePostgresPool();
  }

  console.log(
    'PRODUCTION_A7D_KNOWLEDGE_ACTIONS_RUNTIME_CHECK_PASSED'
  );
  console.log(
    'PostgreSQL Living Knowledge projection/reads, effective state, Action proposal/audit, atomic confirmation, idempotent replay, stale rollback, account isolation, restart persistence, integration projection bridge, and zero legacy JSON mutation are verified.'
  );
}

main().catch(async (error) => {
  setSourceByteStorageForTesting(
    null
  );
  console.error(
    'PRODUCTION_A7D_KNOWLEDGE_ACTIONS_RUNTIME_CHECK_FAILED'
  );
  console.error(error);
  await closePostgresPool();
  process.exit(1);
});

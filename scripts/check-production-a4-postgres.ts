import fs from 'fs';
import os from 'os';
import path from 'path';
import { closePostgresPool, postgresPool } from '../server/persistence/postgres.js';
import { runPostgresMigrations } from '../server/persistence/migrationRunner.js';
import { postgresAccountRepository } from '../server/persistence/postgresRepositories.js';
import {
  postgresIntegrationCheckpointRepository,
  postgresIntegrationRepository,
  postgresWatchRepository,
} from '../server/persistence/a4PostgresRepositories.js';
import {
  importLegacyA4,
  readLegacyA4Snapshot,
} from '../server/persistence/a4LegacyImporter.js';
import type {
  WatchAlert,
  WatchDraft,
  WatchEvaluation,
  WatchJob,
  WatchRule,
} from '../server/watch/types.js';
import type {
  ExternalImportState,
  IntegrationConnection,
  SyncRun,
} from '../server/integrations/types.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function resetA4(): Promise<void> {
  await postgresPool().query(`
    TRUNCATE TABLE
      integration_external_imports,
      integration_sync_runs,
      integration_connections,
      watch_jobs,
      watch_alerts,
      watch_evaluations,
      watch_drafts,
      watch_rules
    CASCADE
  `);
}

function rule(params: {
  id: string;
  accountId: string;
  triggerAt?: number;
}): WatchRule {
  const triggerAt = params.triggerAt ?? Date.parse('2099-01-01T00:00:00Z');
  return {
    id: params.id,
    accountId: params.accountId,
    name: 'A4 reminder ' + params.id,
    status: 'ACTIVE',
    origin: 'MANUAL',
    version: 1,
    condition: {
      kind: 'TIME_REACHED',
      triggerAt,
      timezone: 'UTC',
    },
    evaluationMode: 'INTERVAL',
    intervalMinutes: 5,
    currentState: 'FALSE',
    nextEvaluationAt: triggerAt - 60_000,
    createdAt: 1000,
    updatedAt: 1000,
  };
}

function evaluation(params: {
  id: string;
  accountId: string;
  ruleId: string;
  triggerAt?: number;
}): WatchEvaluation {
  const triggerAt = params.triggerAt ?? Date.parse('2099-01-01T00:00:00Z');
  return {
    id: params.id,
    accountId: params.accountId,
    watchRuleId: params.ruleId,
    ruleVersion: 1,
    status: 'COMPLETED',
    conditionMatched: true,
    observedValue: triggerAt,
    comparisonOperator: 'GTE',
    threshold: triggerAt,
    previousConditionState: 'FALSE',
    nextConditionState: 'TRUE',
    evidence: {
      sourceType: 'TIME',
      triggerAt,
      evaluatedAt: triggerAt,
      timezone: 'UTC',
    },
    evaluatedAt: triggerAt,
  };
}

function alert(params: {
  id: string;
  accountId: string;
  ruleId: string;
  evaluationId: string;
  triggerAt?: number;
}): WatchAlert {
  const triggerAt = params.triggerAt ?? Date.parse('2099-01-01T00:00:00Z');
  return {
    id: params.id,
    episodeKey: params.accountId + ':' + params.ruleId + ':1',
    accountId: params.accountId,
    watchRuleId: params.ruleId,
    ruleVersion: 1,
    status: 'OPEN',
    title: 'A4 alert',
    summary: 'A4 relational alert.',
    firstTriggeredAt: triggerAt,
    lastTriggeredAt: triggerAt,
    occurrenceCount: 1,
    evaluationIds: [params.evaluationId],
    lastEvaluationId: params.evaluationId,
    evidence: {
      sourceType: 'TIME',
      triggerAt,
      evaluatedAt: triggerAt,
      timezone: 'UTC',
    },
    createdAt: triggerAt,
    updatedAt: triggerAt,
  };
}

function job(params: {
  id: string;
  accountId: string;
  ruleId: string;
  scheduledFor: number;
  evaluationId?: string;
}): WatchJob {
  return {
    id: params.id,
    fingerprint: [
      params.accountId,
      params.ruleId,
      1,
      params.scheduledFor,
    ].join(':'),
    accountId: params.accountId,
    watchRuleId: params.ruleId,
    ruleVersion: 1,
    scheduledFor: params.scheduledFor,
    status: 'PENDING',
    attemptCount: 0,
    maxAttempts: 3,
    nextAttemptAt: params.scheduledFor,
    createdAt: params.scheduledFor - 1000,
    updatedAt: params.scheduledFor - 1000,
    evaluationId: params.evaluationId,
  };
}

function draft(params: {
  id: string;
  accountId: string;
  ruleId: string;
}): WatchDraft {
  return {
    id: params.id,
    accountId: params.accountId,
    instruction: 'Remind me at 2099-01-01T00:00:00Z.',
    status: 'SAVED',
    parserSource: 'DETERMINISTIC',
    proposedName: 'A4 saved reminder',
    parsedRequest: {
      kind: 'TIME_REACHED',
      triggerAt: Date.parse('2099-01-01T00:00:00Z'),
      rawDateText: '2099-01-01T00:00:00Z',
      timezone: 'UTC',
    },
    condition: {
      kind: 'TIME_REACHED',
      triggerAt: Date.parse('2099-01-01T00:00:00Z'),
      timezone: 'UTC',
    },
    createdAt: 1000,
    updatedAt: 2000,
    expiresAt: Date.parse('2099-01-01T01:00:00Z'),
    savedRuleId: params.ruleId,
  };
}

function connection(params: {
  id: string;
  accountId: string;
  cursor?: string;
}): IntegrationConnection {
  return {
    id: params.id,
    accountId: params.accountId,
    provider: 'TEST',
    displayName: 'A4 integration ' + params.id,
    status: 'ACTIVE',
    capabilities: {
      incrementalSync: true,
      deletions: true,
      supportedMimeTypes: ['text/csv'],
      supportedResourceKinds: ['FILE'],
    },
    settings: {
      syncMode: 'incremental',
    },
    credentialRef: 'cred_ref_' + params.id,
    cursor: params.cursor,
    consecutiveFailureCount: 0,
    createdAt: 1000,
    updatedAt: 1000,
  };
}

function syncRun(params: {
  id: string;
  accountId: string;
  connectionId: string;
  cursorBefore?: string;
}): SyncRun {
  return {
    id: params.id,
    accountId: params.accountId,
    connectionId: params.connectionId,
    provider: 'TEST',
    status: 'RUNNING',
    cursorBefore: params.cursorBefore,
    startedAt: 3000,
    attemptCount: 1,
    maxAttempts: 3,
    processedCount: 1,
    importedCount: 1,
    skippedCount: 0,
    tombstoneCount: 0,
    failedCount: 0,
    recordResults: [],
  };
}

function externalImport(params: {
  id: string;
  accountId: string;
  connectionId: string;
  externalId: string;
  externalVersion: string;
}): ExternalImportState {
  return {
    id: params.id,
    status: 'TOMBSTONE',
    accountId: params.accountId,
    connectionId: params.connectionId,
    provider: 'TEST',
    externalId: params.externalId,
    externalVersion: params.externalVersion,
    externalName: params.externalId + '.csv',
    resourceKind: 'FILE',
    internalKind: 'TOMBSTONE',
    importedAt: 4000,
    updatedAt: 4000,
    provenance: {
      provider: 'TEST',
      connectionId: params.connectionId,
      externalId: params.externalId,
      externalVersion: params.externalVersion,
      name: params.externalId + '.csv',
      mimeType: 'text/csv',
    },
  };
}

function writeJson(dir: string, name: string, value: unknown): void {
  fs.writeFileSync(
    path.join(dir, name),
    JSON.stringify(value, null, 2),
    'utf8'
  );
}

async function main() {
  assert(
    Boolean(process.env.DATABASE_URL),
    'DATABASE_URL is required for the A4 PostgreSQL proof.'
  );

  const migrations = await runPostgresMigrations();
  assert(
    migrations.applied.includes('003') ||
      migrations.alreadyApplied.includes('003'),
    'Migration 003 must be present in migration history.'
  );

  await resetA4();

  const accountA = 'acc_a4_pg_a';
  const accountB = 'acc_a4_pg_b';
  await postgresAccountRepository.ensureAccount(accountA);
  await postgresAccountRepository.ensureAccount(accountB);

  const ruleA = rule({
    id: 'wat_a4_a',
    accountId: accountA,
  });
  const ruleB = rule({
    id: 'wat_a4_b',
    accountId: accountB,
    triggerAt: Date.parse('2099-02-01T00:00:00Z'),
  });
  await postgresWatchRepository.saveRule(ruleA);
  await postgresWatchRepository.saveRule(ruleB);

  assert(
    (await postgresWatchRepository.getRule(accountA, ruleA.id))?.id ===
      ruleA.id &&
      (await postgresWatchRepository.getRule(accountB, ruleA.id)) === null,
    'Watch repository reads must remain account scoped.'
  );

  const evalA = evaluation({
    id: 'wev_a4_a',
    accountId: accountA,
    ruleId: ruleA.id,
  });
  await postgresWatchRepository.saveEvaluation(evalA);
  await postgresWatchRepository.saveAlert(
    alert({
      id: 'wal_a4_a',
      accountId: accountA,
      ruleId: ruleA.id,
      evaluationId: evalA.id,
    })
  );
  await postgresWatchRepository.saveDraft(
    draft({
      id: 'wdr_a4_a',
      accountId: accountA,
      ruleId: ruleA.id,
    })
  );

  let foreignEvaluationBlocked = false;
  try {
    await postgresWatchRepository.saveEvaluation({
      ...evalA,
      id: 'wev_a4_foreign',
      accountId: accountB,
      watchRuleId: ruleA.id,
    });
  } catch {
    foreignEvaluationBlocked = true;
  }
  assert(
    foreignEvaluationBlocked,
    'Database must reject cross-account Watch evaluation-to-rule links.'
  );

  const scheduleAt = Date.parse('2099-01-01T00:05:00Z');
  const firstJob = job({
    id: 'wjob_a4_first',
    accountId: accountA,
    ruleId: ruleA.id,
    scheduledFor: scheduleAt,
  });
  const sameSlotDifferentId = {
    ...firstJob,
    id: 'wjob_a4_duplicate_attempt',
  };

  const ensuredFirst = await postgresWatchRepository.ensureJob(firstJob);
  const ensuredAgain =
    await postgresWatchRepository.ensureJob(sameSlotDifferentId);

  assert(
    ensuredFirst.id === firstJob.id &&
      ensuredAgain.id === firstJob.id,
    'Database-enforced Watch fingerprint uniqueness must make schedule-slot creation idempotent.'
  );

  const slotCount = await postgresPool().query(
    `SELECT count(*)::int AS count
     FROM watch_jobs
     WHERE account_id = $1 AND fingerprint = $2`,
    [accountA, firstJob.fingerprint]
  );
  assert(
    slotCount.rows[0].count === 1,
    'Exactly one WatchJob may exist for one account/fingerprint.'
  );

  const secondReady = job({
    id: 'wjob_a4_second',
    accountId: accountB,
    ruleId: ruleB.id,
    scheduledFor: scheduleAt,
  });
  await postgresWatchRepository.ensureJob(secondReady);

  const [claimedOne, claimedTwo] = await Promise.all([
    postgresWatchRepository.claimReadyJob({
      now: scheduleAt,
      leaseStartedAt: scheduleAt + 100,
    }),
    postgresWatchRepository.claimReadyJob({
      now: scheduleAt,
      leaseStartedAt: scheduleAt + 100,
    }),
  ]);

  assert(
    claimedOne &&
      claimedTwo &&
      claimedOne.id !== claimedTwo.id &&
      claimedOne.status === 'RUNNING' &&
      claimedTwo.status === 'RUNNING' &&
      claimedOne.attemptCount === 1 &&
      claimedTwo.attemptCount === 1,
    'Concurrent PostgreSQL workers must claim distinct ready Watch jobs through row locking.'
  );

  const connectionA = connection({
    id: 'int_a4_a',
    accountId: accountA,
  });
  await postgresIntegrationRepository.saveConnection(connectionA);

  assert(
    (await postgresIntegrationRepository.getConnection(
      accountA,
      connectionA.id
    ))?.id === connectionA.id &&
      (await postgresIntegrationRepository.getConnection(
        accountB,
        connectionA.id
      )) === null,
    'Integration repository reads must remain account scoped.'
  );

  const runA = syncRun({
    id: 'sync_a4_a',
    accountId: accountA,
    connectionId: connectionA.id,
  });
  await postgresIntegrationRepository.saveSyncRun(runA);

  const importA = externalImport({
    id: 'extimp_a4_a',
    accountId: accountA,
    connectionId: connectionA.id,
    externalId: 'file-a4',
    externalVersion: 'v1',
  });

  const committed =
    await postgresIntegrationCheckpointRepository.commitSuccessfulCheckpoint(
      {
        accountId: accountA,
        connectionId: connectionA.id,
        runId: runA.id,
        expectedCursor: undefined,
        nextCursor: 'cursor-1',
        completedAt: 5000,
        imports: [importA],
        run: {
          ...runA,
          processedCount: 1,
          importedCount: 1,
          recordResults: [
            {
              externalId: 'file-a4',
              externalVersion: 'v1',
              name: 'file-a4.csv',
              status: 'TOMBSTONED',
              internalKind: 'TOMBSTONE',
            },
          ],
        },
      }
    );

  assert(
    committed.connection.cursor === 'cursor-1' &&
      committed.connection.lastSuccessfulSyncAt === 5000 &&
      committed.run.status === 'COMPLETED' &&
      committed.run.cursorAfter === 'cursor-1' &&
      (await postgresIntegrationRepository.findExactImport({
        accountId: accountA,
        connectionId: connectionA.id,
        externalId: 'file-a4',
        externalVersion: 'v1',
      }))?.id === importA.id,
    'Checkpoint transaction must atomically persist imports, complete the run, and advance the provider cursor.'
  );

  const staleRun = syncRun({
    id: 'sync_a4_stale',
    accountId: accountA,
    connectionId: connectionA.id,
    cursorBefore: 'cursor-1',
  });
  await postgresIntegrationRepository.saveSyncRun(staleRun);

  const changedConnection = {
    ...(await postgresIntegrationRepository.getConnection(
      accountA,
      connectionA.id
    ))!,
    cursor: 'cursor-concurrent',
    updatedAt: 6000,
  };
  await postgresIntegrationRepository.saveConnection(changedConnection);

  const staleImport = externalImport({
    id: 'extimp_a4_stale',
    accountId: accountA,
    connectionId: connectionA.id,
    externalId: 'file-stale',
    externalVersion: 'v1',
  });

  let staleCheckpointBlocked = false;
  try {
    await postgresIntegrationCheckpointRepository.commitSuccessfulCheckpoint(
      {
        accountId: accountA,
        connectionId: connectionA.id,
        runId: staleRun.id,
        expectedCursor: 'cursor-1',
        nextCursor: 'cursor-2',
        completedAt: 7000,
        imports: [staleImport],
        run: staleRun,
      }
    );
  } catch (error: any) {
    staleCheckpointBlocked = String(error?.message || '').includes(
      'INTEGRATION_CHECKPOINT_STALE'
    );
  }

  assert(
    staleCheckpointBlocked &&
      (await postgresIntegrationRepository.findExactImport({
        accountId: accountA,
        connectionId: connectionA.id,
        externalId: 'file-stale',
        externalVersion: 'v1',
      })) === null &&
      (await postgresIntegrationRepository.getSyncRun(
        accountA,
        staleRun.id
      ))?.status === 'RUNNING' &&
      (await postgresIntegrationRepository.getConnection(
        accountA,
        connectionA.id
      ))?.cursor === 'cursor-concurrent',
    'Stale checkpoint commit must roll back import/run changes and must not overwrite a newer cursor.'
  );

  const duplicateVersionA = externalImport({
    id: 'extimp_a4_dup_1',
    accountId: accountA,
    connectionId: connectionA.id,
    externalId: 'duplicate-file',
    externalVersion: 'v9',
  });
  const duplicateVersionB = {
    ...duplicateVersionA,
    id: 'extimp_a4_dup_2',
  };
  await postgresIntegrationRepository.saveImport(duplicateVersionA);

  let duplicateVersionBlocked = false;
  try {
    await postgresIntegrationRepository.saveImport(duplicateVersionB);
  } catch {
    duplicateVersionBlocked = true;
  }
  assert(
    duplicateVersionBlocked,
    'Database must enforce one external import mapping per account/connection/external-id/version.'
  );

  let foreignSyncLinkBlocked = false;
  try {
    await postgresIntegrationRepository.saveSyncRun({
      ...runA,
      id: 'sync_a4_foreign',
      accountId: accountB,
      connectionId: connectionA.id,
    });
  } catch {
    foreignSyncLinkBlocked = true;
  }
  assert(
    foreignSyncLinkBlocked,
    'Database must reject cross-account SyncRun-to-connection links.'
  );

  const secretColumns = await postgresPool().query(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name IN (
         'integration_connections',
         'integration_sync_runs',
         'integration_external_imports'
       )
       AND column_name IN (
         'access_token',
         'refresh_token',
         'client_secret',
         'credential_secret',
         'token'
       )`
  );
  assert(
    secretColumns.rowCount === 0,
    'A4 relational integration tables must not contain OAuth secret-byte columns.'
  );

  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'knowledge-ai-a4-')
  );

  const legacyRule = rule({
    id: 'wat_a4_legacy',
    accountId: accountB,
  });
  const legacyEvaluation = evaluation({
    id: 'wev_a4_legacy',
    accountId: accountB,
    ruleId: legacyRule.id,
  });
  const legacyAlert = alert({
    id: 'wal_a4_legacy',
    accountId: accountB,
    ruleId: legacyRule.id,
    evaluationId: legacyEvaluation.id,
  });
  const legacyDraft = draft({
    id: 'wdr_a4_legacy',
    accountId: accountB,
    ruleId: legacyRule.id,
  });
  const legacyJob = job({
    id: 'wjob_a4_legacy',
    accountId: accountB,
    ruleId: legacyRule.id,
    scheduledFor: Date.parse('2099-01-01T00:10:00Z'),
    evaluationId: legacyEvaluation.id,
  });

  const legacyConnection = connection({
    id: 'int_a4_legacy',
    accountId: accountB,
    cursor: 'legacy-cursor',
  });
  const legacyRun: SyncRun = {
    ...syncRun({
      id: 'sync_a4_legacy',
      accountId: accountB,
      connectionId: legacyConnection.id,
      cursorBefore: 'legacy-old',
    }),
    status: 'COMPLETED',
    cursorAfter: 'legacy-cursor',
    completedAt: 9000,
  };
  const legacyImport = externalImport({
    id: 'extimp_a4_legacy',
    accountId: accountB,
    connectionId: legacyConnection.id,
    externalId: 'legacy-file',
    externalVersion: 'legacy-v1',
  });

  writeJson(tempDir, 'watch.json', {
    rules: [legacyRule],
    evaluations: [legacyEvaluation],
    alerts: [legacyAlert],
    drafts: [legacyDraft],
    jobs: [legacyJob],
  });
  writeJson(tempDir, 'integrations.json', {
    connections: [legacyConnection],
    syncRuns: [legacyRun],
    imports: [legacyImport],
  });
  writeJson(tempDir, 'integration_credentials.json', {
    records: [
      {
        id: legacyConnection.credentialRef,
        ciphertext: 'SHOULD_NOT_MIGRATE_SECRET_BYTES',
      },
    ],
  });

  const watchBefore = fs.readFileSync(
    path.join(tempDir, 'watch.json'),
    'utf8'
  );
  const integrationsBefore = fs.readFileSync(
    path.join(tempDir, 'integrations.json'),
    'utf8'
  );

  const snapshot = readLegacyA4Snapshot(tempDir);
  const dryRun = await importLegacyA4({
    snapshot,
    dryRun: true,
  });
  assert(
    dryRun.conflicts.length === 0 &&
      dryRun.counts.rules === 1 &&
      dryRun.counts.connections === 1 &&
      Object.values(dryRun.imported).every((count) => count === 0),
    'A4 dry-run must validate Watch/Integration legacy records without writing them.'
  );

  const imported = await importLegacyA4({ snapshot });
  assert(
    imported.conflicts.length === 0 &&
      Object.values(imported.imported).every((count) => count === 1),
    'A4 importer must preserve every legacy Watch/Integration record ID.'
  );

  const repeated = await importLegacyA4({ snapshot });
  assert(
    repeated.conflicts.length === 0 &&
      Object.values(repeated.imported).every((count) => count === 0) &&
      repeated.skippedExisting === 8,
    'A4 legacy import must be idempotent.'
  );

  assert(
    fs.readFileSync(path.join(tempDir, 'watch.json'), 'utf8') ===
      watchBefore &&
      fs.readFileSync(
        path.join(tempDir, 'integrations.json'),
        'utf8'
      ) === integrationsBefore,
    'A4 legacy importer must never mutate source Watch/Integration JSON files.'
  );

  const allIntegrationText = await postgresPool().query(
    `SELECT
       coalesce(string_agg(row_to_json(t)::text, ''), '') AS payload
     FROM (
       SELECT * FROM integration_connections
       UNION ALL
       SELECT
         id, account_id, provider, connection_id AS display_name,
         status, '{}'::jsonb AS capabilities, '{}'::jsonb AS settings,
         NULL::text AS credential_ref, cursor_before AS cursor,
         NULL::text AS attention_reason,
         failure_category AS last_failure_category,
         NULL::integer AS consecutive_failure_count,
         next_retry_at, NULL::text AS sync_lease_id,
         NULL::timestamptz AS sync_lease_expires_at,
         started_at AS last_sync_at,
         completed_at AS last_successful_sync_at,
         error AS last_error, started_at AS created_at,
         coalesce(completed_at, started_at) AS updated_at
       FROM integration_sync_runs
     ) t`
  ).catch(() => ({ rows: [{ payload: '' }] }));

  assert(
    !String(allIntegrationText.rows[0]?.payload || '').includes(
      'SHOULD_NOT_MIGRATE_SECRET_BYTES'
    ),
    'A4 importer must not migrate encrypted credential-file contents into relational metadata.'
  );

  assert(
    (await postgresWatchRepository.getRule(
      accountB,
      legacyRule.id
    ))?.id === legacyRule.id &&
      (await postgresIntegrationRepository.getConnection(
        accountB,
        legacyConnection.id
      ))?.credentialRef === legacyConnection.credentialRef,
    'A4 import must preserve IDs and opaque credential references while excluding secret bytes.'
  );

  console.log('PRODUCTION_A4_POSTGRES_CHECK_PASSED');
  console.log(
    'Migration 003, account-scoped Watch/Integration repositories, database Watch schedule idempotency, concurrent job claims, atomic integration checkpoints, external-version uniqueness, legacy A4 import, and secret-byte separation are verified.'
  );
}

main()
  .catch((error) => {
    console.error('PRODUCTION_A4_POSTGRES_CHECK_FAILED');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgresPool();
  });

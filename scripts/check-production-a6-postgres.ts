import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  closePostgresPool,
  postgresPool,
} from '../server/persistence/postgres.js';
import { runPostgresMigrations } from '../server/persistence/migrationRunner.js';
import { postgresAccountRepository } from '../server/persistence/postgresRepositories.js';
import { postgresDiscoveryRepository } from '../server/persistence/a6PostgresRepositories.js';
import {
  importLegacyA6,
  readLegacyA6Snapshot,
} from '../server/persistence/a6LegacyImporter.js';
import type {
  AnalysisRun,
  Insight,
} from '../server/discovery/types.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function resetA6(): Promise<void> {
  await postgresPool().query(`
    TRUNCATE TABLE
      discovery_analysis_run_insights,
      discovery_insights,
      discovery_analysis_runs
    CASCADE
  `);
}

async function seedDataset(params: {
  accountId: string;
  datasetId: string;
  versionId: string;
  importRunId: string;
}): Promise<void> {
  const now = new Date('2099-01-01T00:00:00Z');

  await postgresPool().query(
    `INSERT INTO dataset_import_runs
      (id, account_id, status, created_at, completed_at,
       filename, format, warnings, error)
     VALUES ($1,$2,'IMPORTED',$3,$3,$4,'CSV','[]'::jsonb,NULL)
     ON CONFLICT (id) DO NOTHING`,
    [
      params.importRunId,
      params.accountId,
      now,
      params.datasetId + '.csv',
    ]
  );

  await postgresPool().query(
    `INSERT INTO datasets
      (id, account_id, name, description, current_version_id,
       created_at, updated_at)
     VALUES ($1,$2,$3,NULL,NULL,$4,$4)
     ON CONFLICT (id) DO NOTHING`,
    [
      params.datasetId,
      params.accountId,
      'Dataset ' + params.datasetId,
      now,
    ]
  );

  await postgresPool().query(
    `INSERT INTO dataset_versions
      (id, account_id, dataset_id, version_number, created_at,
       source_filename, source_mime_type, source_size_bytes,
       source_sha256, source_format, import_run_id,
       payload_backend, payload_ref)
     VALUES ($1,$2,$3,1,$4,$5,'text/csv',100,$6,'CSV',$7,'legacy-file',$8)
     ON CONFLICT (id) DO NOTHING`,
    [
      params.versionId,
      params.accountId,
      params.datasetId,
      now,
      params.datasetId + '.csv',
      'a'.repeat(64),
      params.importRunId,
      'data/datasets/' + params.versionId + '.json',
    ]
  );

  await postgresPool().query(
    `UPDATE datasets
     SET current_version_id = $3
     WHERE account_id = $1 AND id = $2`,
    [
      params.accountId,
      params.datasetId,
      params.versionId,
    ]
  );
}

async function seedWorkspace(params: {
  accountId: string;
  workspaceId: string;
}): Promise<void> {
  const now = new Date('2099-01-01T00:00:00Z');
  await postgresPool().query(
    `INSERT INTO workspaces
      (id, account_id, name, description, processing_status,
       current_version_tag, created_at, updated_at)
     VALUES ($1,$2,$3,NULL,'ready','v1',$4,$4)
     ON CONFLICT (id) DO NOTHING`,
    [
      params.workspaceId,
      params.accountId,
      'Workspace ' + params.workspaceId,
      now,
    ]
  );
}

function datasetRun(params: {
  id: string;
  accountId: string;
  datasetId: string;
  versionId: string;
  startedAt: number;
  status?: AnalysisRun['status'];
}): AnalysisRun {
  return {
    id: params.id,
    accountId: params.accountId,
    sourceType: 'DATASET',
    datasetId: params.datasetId,
    datasetVersionId: params.versionId,
    status: params.status || 'RUNNING',
    startedAt: params.startedAt,
    completedAt:
      params.status === 'COMPLETED'
        ? params.startedAt + 100
        : undefined,
    referenceTime: params.startedAt,
    detectorIds: ['balance.outstanding.v1'],
    insightIds: [],
  };
}

function documentRun(params: {
  id: string;
  accountId: string;
  workspaceId: string;
  startedAt: number;
}): AnalysisRun {
  return {
    id: params.id,
    accountId: params.accountId,
    sourceType: 'DOCUMENT',
    knowledgeBaseId: params.workspaceId,
    knowledgeVersionTag: 'v1',
    status: 'COMPLETED',
    startedAt: params.startedAt,
    completedAt: params.startedAt + 50,
    referenceTime: params.startedAt,
    detectorIds: ['document.deadline.v1'],
    insightIds: [],
  };
}

function datasetInsight(params: {
  id: string;
  fingerprint: string;
  accountId: string;
  datasetId: string;
  versionId: string;
  runId: string;
  seenAt: number;
  occurrenceCount?: number;
  status?: Insight['status'];
  statusUpdatedAt?: number;
  summary?: string;
}): Insight {
  return {
    id: params.id,
    fingerprint: params.fingerprint,
    accountId: params.accountId,
    datasetId: params.datasetId,
    datasetVersionId: params.versionId,
    analysisRunId: params.runId,
    type: 'RISK',
    severity: 'HIGH',
    status: params.status || 'OPEN',
    title: 'Outstanding balance risk',
    summary:
      params.summary ||
      'Outstanding balance requires attention.',
    confidence: 0.95,
    detectorId: 'balance.outstanding',
    detectorVersion: 'v1',
    evidence: {
      sourceType: 'DATASET',
      sourceFilename: params.datasetId + '.csv',
      sourceSha256: 'b'.repeat(64),
      datasetId: params.datasetId,
      datasetVersionId: params.versionId,
      datasetVersionNumber: 1,
      tableId: 'tbl_1',
      tableName: 'Sheet1',
      detectorId: 'balance.outstanding',
      detectorVersion: 'v1',
      calculation: 'SUM balance_due where balance_due > 0',
      values: {
        totalOutstanding: 12000,
      },
    },
    priorityScore: 91,
    priorityReasons: ['High severity', 'Large balance'],
    firstSeenAt: params.seenAt,
    lastSeenAt: params.seenAt,
    occurrenceCount: params.occurrenceCount || 1,
    statusUpdatedAt: params.statusUpdatedAt,
    createdAt: params.seenAt,
  };
}

function documentInsight(params: {
  id: string;
  accountId: string;
  workspaceId: string;
  runId: string;
  seenAt: number;
}): Insight {
  return {
    id: params.id,
    fingerprint: 'fp_' + params.id,
    accountId: params.accountId,
    knowledgeBaseId: params.workspaceId,
    documentId: 'doc_a6',
    analysisRunId: params.runId,
    type: 'DEADLINE',
    severity: 'MEDIUM',
    status: 'OPEN',
    title: 'Deadline in 10 days',
    summary: 'Contract deadline is approaching.',
    confidence: 0.95,
    detectorId: 'document.deadline',
    detectorVersion: 'v1',
    evidence: {
      sourceType: 'DOCUMENT',
      sourceFilename: 'contract.pdf',
      knowledgeBaseId: params.workspaceId,
      knowledgeVersionTag: 'v1',
      documentId: 'doc_a6',
      pageNumber: 2,
      excerpt: 'Renewal deadline is 2099-04-10.',
      detectorId: 'document.deadline',
      detectorVersion: 'v1',
      calculation: 'Explicit deadline date.',
      values: {
        deadlineDate: '2099-04-10',
        daysUntil: 10,
      },
    },
    priorityScore: 70,
    priorityReasons: ['Deadline approaching'],
    firstSeenAt: params.seenAt,
    lastSeenAt: params.seenAt,
    occurrenceCount: 1,
    createdAt: params.seenAt,
  };
}

async function main() {
  assert(
    Boolean(process.env.DATABASE_URL),
    'DATABASE_URL is required for the A6 PostgreSQL proof.'
  );

  const migrations = await runPostgresMigrations();
  assert(
    migrations.applied.includes('005') ||
      migrations.alreadyApplied.includes('005'),
    'Migration 005 must be present in migration history.'
  );

  await resetA6();

  const accountA = 'acc_a6_pg_a';
  const accountB = 'acc_a6_pg_b';
  await postgresAccountRepository.ensureAccount(accountA);
  await postgresAccountRepository.ensureAccount(accountB);

  await seedDataset({
    accountId: accountA,
    datasetId: 'dset_a6_a',
    versionId: 'dver_a6_a',
    importRunId: 'imp_a6_a',
  });
  await seedDataset({
    accountId: accountB,
    datasetId: 'dset_a6_b',
    versionId: 'dver_a6_b',
    importRunId: 'imp_a6_b',
  });
  await seedWorkspace({
    accountId: accountA,
    workspaceId: 'kb_a6_a',
  });

  // 1. First run/Insight persists with relational source ownership.
  const run1 = datasetRun({
    id: 'anr_a6_1',
    accountId: accountA,
    datasetId: 'dset_a6_a',
    versionId: 'dver_a6_a',
    startedAt: 10_000,
  });
  await postgresDiscoveryRepository.saveRun(run1);

  const firstCandidate = datasetInsight({
    id: 'ins_a6_candidate_1',
    fingerprint: 'fp_a6_recurring',
    accountId: accountA,
    datasetId: 'dset_a6_a',
    versionId: 'dver_a6_a',
    runId: run1.id,
    seenAt: 10_000,
  });
  const firstPersisted =
    await postgresDiscoveryRepository.recordInsightsForRun(
      accountA,
      run1.id,
      [firstCandidate]
    );

  assert(
    firstPersisted.length === 1 &&
      firstPersisted[0].id === firstCandidate.id &&
      firstPersisted[0].occurrenceCount === 1,
    'First detector occurrence must create one Insight identity.'
  );

  await postgresDiscoveryRepository.saveRun({
    ...run1,
    status: 'COMPLETED',
    completedAt: 10_100,
    insightIds: [firstPersisted[0].id],
  });

  assert(
    (
      await postgresDiscoveryRepository.getRun(
        accountA,
        run1.id
      )
    )?.insightIds[0] === firstCandidate.id,
    'AnalysisRun must retain the Insight identity it produced.'
  );

  // 2. Status changes are account-scoped and survive recurrence.
  const acknowledged =
    await postgresDiscoveryRepository.updateInsightStatus(
      accountA,
      firstCandidate.id,
      'ACKNOWLEDGED',
      15_000
    );
  assert(
    acknowledged.status === 'ACKNOWLEDGED' &&
      acknowledged.statusUpdatedAt === 15_000,
    'Insight status transition must persist exactly.'
  );

  const run2 = datasetRun({
    id: 'anr_a6_2',
    accountId: accountA,
    datasetId: 'dset_a6_a',
    versionId: 'dver_a6_a',
    startedAt: 20_000,
  });
  await postgresDiscoveryRepository.saveRun(run2);

  const secondCandidate = datasetInsight({
    id: 'ins_a6_candidate_2',
    fingerprint: 'fp_a6_recurring',
    accountId: accountA,
    datasetId: 'dset_a6_a',
    versionId: 'dver_a6_a',
    runId: run2.id,
    seenAt: 20_000,
    summary: 'The same balance risk remains on the next run.',
  });
  const secondPersisted =
    await postgresDiscoveryRepository.recordInsightsForRun(
      accountA,
      run2.id,
      [secondCandidate]
    );

  assert(
    secondPersisted[0].id === firstCandidate.id &&
      secondPersisted[0].status === 'ACKNOWLEDGED' &&
      secondPersisted[0].statusUpdatedAt === 15_000 &&
      secondPersisted[0].firstSeenAt === 10_000 &&
      secondPersisted[0].createdAt === 10_000 &&
      secondPersisted[0].lastSeenAt === 20_000 &&
      secondPersisted[0].occurrenceCount === 2 &&
      secondPersisted[0].analysisRunId === run2.id,
    'Recurring fingerprint must preserve identity/status/firstSeen while advancing latest evidence and occurrence count.'
  );

  // Same-run retry is idempotent and must not double count recurrence.
  const repeatedSameRun =
    await postgresDiscoveryRepository.recordInsightsForRun(
      accountA,
      run2.id,
      [secondCandidate]
    );
  assert(
    repeatedSameRun[0].occurrenceCount === 2,
    'Retrying the same AnalysisRun must not increment recurrence twice.'
  );

  const historicalRun1 =
    await postgresDiscoveryRepository.getRun(
      accountA,
      run1.id
    );
  const historicalRun2 =
    await postgresDiscoveryRepository.getRun(
      accountA,
      run2.id
    );
  assert(
    historicalRun1?.insightIds[0] === firstCandidate.id &&
      historicalRun2?.insightIds[0] === firstCandidate.id,
    'Historical AnalysisRuns must independently preserve membership in the recurring Insight.'
  );

  // 3. Document-sourced AnalysisRuns/Insights retain workspace ownership.
  const docRun = documentRun({
    id: 'anr_a6_doc',
    accountId: accountA,
    workspaceId: 'kb_a6_a',
    startedAt: 30_000,
  });
  await postgresDiscoveryRepository.saveRun(docRun);
  const docInsight = documentInsight({
    id: 'ins_a6_doc',
    accountId: accountA,
    workspaceId: 'kb_a6_a',
    runId: docRun.id,
    seenAt: 30_000,
  });
  await postgresDiscoveryRepository.recordInsightsForRun(
    accountA,
    docRun.id,
    [docInsight]
  );
  assert(
    (
      await postgresDiscoveryRepository.getInsight(
        accountA,
        docInsight.id
      )
    )?.knowledgeBaseId === 'kb_a6_a',
    'Document Insight must retain same-account workspace provenance.'
  );

  // 4. Database constraints reject cross-account sources/relationships.
  let foreignDatasetRunBlocked = false;
  try {
    await postgresDiscoveryRepository.saveRun(
      datasetRun({
        id: 'anr_a6_foreign_dataset',
        accountId: accountB,
        datasetId: 'dset_a6_a',
        versionId: 'dver_a6_a',
        startedAt: 40_000,
      })
    );
  } catch {
    foreignDatasetRunBlocked = true;
  }
  assert(
    foreignDatasetRunBlocked,
    'Database must reject AnalysisRun → foreign-account DatasetVersion links.'
  );

  const runB = datasetRun({
    id: 'anr_a6_b',
    accountId: accountB,
    datasetId: 'dset_a6_b',
    versionId: 'dver_a6_b',
    startedAt: 41_000,
  });
  await postgresDiscoveryRepository.saveRun(runB);

  let foreignRunInsightBlocked = false;
  try {
    await postgresDiscoveryRepository.saveInsightSnapshot({
      ...datasetInsight({
        id: 'ins_a6_foreign_run',
        fingerprint: 'fp_a6_foreign_run',
        accountId: accountB,
        datasetId: 'dset_a6_b',
        versionId: 'dver_a6_b',
        runId: runB.id,
        seenAt: 41_000,
      }),
      analysisRunId: run1.id,
    });
  } catch {
    foreignRunInsightBlocked = true;
  }
  assert(
    foreignRunInsightBlocked,
    'Database must reject Insight → foreign-account latest AnalysisRun links.'
  );

  let duplicateFingerprintBlocked = false;
  try {
    await postgresDiscoveryRepository.saveInsightSnapshot({
      ...secondPersisted[0],
      id: 'ins_a6_duplicate_fingerprint',
    });
  } catch {
    duplicateFingerprintBlocked = true;
  }
  assert(
    duplicateFingerprintBlocked,
    'Database must enforce one Insight identity per account/fingerprint.'
  );

  assert(
    (await postgresDiscoveryRepository.getInsight(
      accountB,
      firstCandidate.id
    )) === null,
    'Insight reads must remain account scoped.'
  );

  // 5. Legacy discovery.json import is dry-run capable, idempotent,
  // source-non-destructive, and preserves run memberships.
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'knowledge-ai-a6-')
  );
  const legacyAccount = 'acc_a6_legacy';
  await postgresAccountRepository.ensureAccount(legacyAccount);
  await seedDataset({
    accountId: legacyAccount,
    datasetId: 'dset_a6_legacy',
    versionId: 'dver_a6_legacy',
    importRunId: 'imp_a6_legacy',
  });

  const legacyRun = {
    ...datasetRun({
      id: 'anr_a6_legacy',
      accountId: legacyAccount,
      datasetId: 'dset_a6_legacy',
      versionId: 'dver_a6_legacy',
      startedAt: 50_000,
      status: 'COMPLETED',
    }),
    insightIds: ['ins_a6_legacy'],
  };
  const legacyInsight = datasetInsight({
    id: 'ins_a6_legacy',
    fingerprint: 'fp_a6_legacy',
    accountId: legacyAccount,
    datasetId: 'dset_a6_legacy',
    versionId: 'dver_a6_legacy',
    runId: legacyRun.id,
    seenAt: 50_000,
    occurrenceCount: 4,
    status: 'ACKNOWLEDGED',
    statusUpdatedAt: 50_500,
  });

  const discoveryPath = path.join(
    tempDir,
    'discovery.json'
  );
  fs.writeFileSync(
    discoveryPath,
    JSON.stringify(
      {
        runs: [legacyRun],
        insights: [legacyInsight],
      },
      null,
      2
    ),
    'utf8'
  );
  const sourceBefore = fs.readFileSync(
    discoveryPath,
    'utf8'
  );

  const snapshot = readLegacyA6Snapshot(tempDir);
  const dryRun = await importLegacyA6({
    snapshot,
    dryRun: true,
  });
  assert(
    dryRun.conflicts.length === 0 &&
      dryRun.imported.runs === 0 &&
      dryRun.imported.insights === 0 &&
      dryRun.imported.memberships === 0,
    'A6 dry-run must validate without writes.'
  );

  const imported = await importLegacyA6({ snapshot });
  assert(
    imported.conflicts.length === 0 &&
      imported.imported.runs === 1 &&
      imported.imported.insights === 1 &&
      imported.imported.memberships === 1,
    'A6 first legacy import must preserve run, Insight, and membership identities.'
  );

  const importedInsight =
    await postgresDiscoveryRepository.getInsight(
      legacyAccount,
      legacyInsight.id
    );
  const importedRun =
    await postgresDiscoveryRepository.getRun(
      legacyAccount,
      legacyRun.id
    );
  assert(
    importedInsight?.occurrenceCount === 4 &&
      importedInsight.status === 'ACKNOWLEDGED' &&
      importedInsight.statusUpdatedAt === 50_500 &&
      importedRun?.insightIds[0] === legacyInsight.id,
    'A6 legacy import must preserve recurrence/status/history exactly.'
  );

  const repeated = await importLegacyA6({ snapshot });
  assert(
    repeated.conflicts.length === 0 &&
      repeated.imported.runs === 0 &&
      repeated.imported.insights === 0 &&
      repeated.imported.memberships === 0,
    'A6 legacy import must be idempotent.'
  );

  assert(
    fs.readFileSync(discoveryPath, 'utf8') === sourceBefore,
    'A6 legacy importer must never mutate discovery.json.'
  );

  console.log('PRODUCTION_A6_POSTGRES_CHECK_PASSED');
  console.log(
    'Migration 005, account/source ownership, recurring Insight identity, same-run idempotency, status preservation, historical run membership, document provenance, and idempotent Discovery legacy import are verified.'
  );
}

main()
  .catch((error) => {
    console.error('PRODUCTION_A6_POSTGRES_CHECK_FAILED');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgresPool();
  });

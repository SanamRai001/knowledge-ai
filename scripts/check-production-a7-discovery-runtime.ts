import express from 'express';
import fs from 'fs';
import path from 'path';
import { apiKeyStore } from '../server/apiKeyStore.js';
import { datasetService } from '../server/datasets/datasetService.js';
import { discoveryRouter } from '../server/discovery/discoveryRouter.js';
import {
  DiscoveryRuntimeService,
} from '../server/discovery/discoveryRuntimeService.js';
import {
  PLATFORM_SCOPES,
} from '../server/platform/platformApiManifest.js';
import { platformApiRouter } from '../server/platform/platformApiRouter.js';
import {
  closePostgresPool,
  postgresPool,
} from '../server/persistence/postgres.js';
import { runPostgresMigrations } from '../server/persistence/migrationRunner.js';
import {
  postgresAccountRepository,
} from '../server/persistence/postgresRepositories.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function mirrorDatasetMetadata(params: {
  accountId: string;
  result: ReturnType<typeof datasetService.importCsv>;
}): Promise<void> {
  const { dataset, version, importRun } = params.result;

  await postgresPool().query(
    `INSERT INTO dataset_import_runs
      (id, account_id, status, created_at, completed_at,
       filename, format, warnings, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
     ON CONFLICT (id) DO NOTHING`,
    [
      importRun.id,
      params.accountId,
      importRun.status,
      new Date(importRun.createdAt),
      importRun.completedAt
        ? new Date(importRun.completedAt)
        : null,
      importRun.filename,
      importRun.format,
      JSON.stringify(importRun.warnings),
      importRun.error ?? null,
    ]
  );

  await postgresPool().query(
    `INSERT INTO datasets
      (id, account_id, name, description, current_version_id,
       created_at, updated_at)
     VALUES ($1,$2,$3,$4,NULL,$5,$6)
     ON CONFLICT (id) DO NOTHING`,
    [
      dataset.id,
      params.accountId,
      dataset.name,
      dataset.description ?? null,
      new Date(dataset.createdAt),
      new Date(dataset.updatedAt),
    ]
  );

  await postgresPool().query(
    `INSERT INTO dataset_versions
      (id, account_id, dataset_id, version_number, created_at,
       source_filename, source_mime_type, source_size_bytes,
       source_sha256, source_format, import_run_id,
       payload_backend, payload_ref)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'legacy-file',$12)
     ON CONFLICT (id) DO NOTHING`,
    [
      version.id,
      params.accountId,
      dataset.id,
      version.versionNumber,
      new Date(version.createdAt),
      version.source.filename,
      version.source.mimeType,
      version.source.sizeBytes,
      version.source.sha256,
      version.source.format,
      version.importRunId,
      'data/datasets.json#' + version.id,
    ]
  );

  await postgresPool().query(
    `UPDATE datasets
     SET current_version_id = $3,
         updated_at = $4
     WHERE account_id = $1 AND id = $2`,
    [
      params.accountId,
      dataset.id,
      version.id,
      new Date(dataset.updatedAt),
    ]
  );
}

async function json(response: Response) {
  const body = await response.json();
  return { response, body };
}

async function main() {
  assert(
    process.env.KNOWLEDGE_AI_PERSISTENCE_MODE === 'postgres',
    'A7 Discovery runtime proof must run in postgres persistence mode.'
  );
  assert(
    Boolean(process.env.DATABASE_URL),
    'DATABASE_URL is required for the A7 runtime cutover proof.'
  );

  await runPostgresMigrations();

  await postgresPool().query(`
    TRUNCATE TABLE
      discovery_analysis_run_insights,
      discovery_insights,
      discovery_analysis_runs
    CASCADE
  `);

  const accountA = 'acc_a7_runtime_a';
  const accountB = 'acc_a7_runtime_b';
  await postgresAccountRepository.ensureAccount(accountA);
  await postgresAccountRepository.ensureAccount(accountB);

  const importedA = datasetService.importCsv({
    accountId: accountA,
    buffer: Buffer.from(
      [
        'product_id,product_name,current_stock,reorder_level,balance_due,due_date',
        'A7-P1,Runtime Oak,3,5,12000,2099-01-01',
        'A7-P2,Runtime Pine,9,4,0,2099-12-01',
      ].join('\n'),
      'utf8'
    ),
    filename: 'a7-runtime-a.csv',
    datasetName: 'A7 Runtime Dataset',
  });
  await mirrorDatasetMetadata({
    accountId: accountA,
    result: importedA,
  });

  const importedB = datasetService.importCsv({
    accountId: accountB,
    buffer: Buffer.from(
      [
        'product_id,product_name,current_stock,reorder_level',
        'A7-B1,Foreign Cedar,2,5',
      ].join('\n'),
      'utf8'
    ),
    filename: 'a7-runtime-b.csv',
    datasetName: 'A7 Foreign Dataset',
  });
  await mirrorDatasetMetadata({
    accountId: accountB,
    result: importedB,
  });

  const dataFile = path.join(
    process.cwd(),
    'data',
    'discovery.json'
  );
  const discoveryFileBefore = fs.existsSync(dataFile)
    ? fs.readFileSync(dataFile, 'utf8')
    : null;

  const keyA = apiKeyStore.createApiKey({
    name: 'A7 runtime account A',
    accountId: accountA,
    environment: 'test',
    scopes: [
      PLATFORM_SCOPES.insightsRead,
      PLATFORM_SCOPES.detectorsRead,
      PLATFORM_SCOPES.detectorsWrite,
      PLATFORM_SCOPES.toolsInvoke,
    ],
  });
  const keyB = apiKeyStore.createApiKey({
    name: 'A7 runtime account B',
    accountId: accountB,
    environment: 'test',
    scopes: [
      PLATFORM_SCOPES.insightsRead,
      PLATFORM_SCOPES.detectorsRead,
      PLATFORM_SCOPES.detectorsWrite,
      PLATFORM_SCOPES.toolsInvoke,
    ],
  });

  const app = express();
  app.use(express.json());
  app.use('/api/discovery', discoveryRouter);
  app.use('/api/platform/v1', platformApiRouter);
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Could not resolve A7 HTTP test port.');
    }
    const baseUrl = 'http://127.0.0.1:' + address.port;

    // 1. Normal Discovery HTTP write goes to PostgreSQL.
    const analysis = await json(
      await fetch(baseUrl + '/api/discovery/analyze', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + keyA.secret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          datasetId: importedA.dataset.id,
        }),
      })
    );

    assert(
      analysis.response.status === 201 &&
        analysis.body.run?.status === 'COMPLETED' &&
        analysis.body.run?.datasetId === importedA.dataset.id &&
        Array.isArray(analysis.body.insights) &&
        analysis.body.insights.length > 0,
      'Normal Discovery HTTP analysis must complete through the production runtime.'
    );

    const firstInsightId = analysis.body.insights[0].id;

    const pgRun = await postgresPool().query(
      `SELECT status
       FROM discovery_analysis_runs
       WHERE account_id = $1 AND id = $2`,
      [accountA, analysis.body.run.id]
    );
    const pgInsight = await postgresPool().query(
      `SELECT status, occurrence_count
       FROM discovery_insights
       WHERE account_id = $1 AND id = $2`,
      [accountA, firstInsightId]
    );

    assert(
      pgRun.rows[0]?.status === 'COMPLETED' &&
        pgInsight.rows[0]?.status === 'OPEN' &&
        pgInsight.rows[0]?.occurrence_count === 1,
      'Discovery HTTP write must be durably visible in PostgreSQL.'
    );

    const afterAnalysisFile = fs.existsSync(dataFile)
      ? fs.readFileSync(dataFile, 'utf8')
      : null;
    assert(
      afterAnalysisFile === discoveryFileBefore,
      'PostgreSQL Discovery mode must not mutate data/discovery.json.'
    );

    // 2. Normal status mutation uses PostgreSQL and account isolation.
    const acknowledged = await json(
      await fetch(
        baseUrl +
          '/api/discovery/' +
          encodeURIComponent(firstInsightId) +
          '/status',
        {
          method: 'PATCH',
          headers: {
            Authorization: 'Bearer ' + keyA.secret,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            status: 'ACKNOWLEDGED',
          }),
        }
      )
    );

    assert(
      acknowledged.response.status === 200 &&
        acknowledged.body.insight?.status === 'ACKNOWLEDGED',
      'Discovery status mutation must succeed through PostgreSQL runtime.'
    );

    const foreignInsight = await fetch(
      baseUrl +
        '/api/discovery/' +
        encodeURIComponent(firstInsightId),
      {
        headers: {
          Authorization: 'Bearer ' + keyB.secret,
          'X-Account-ID': accountA,
        },
      }
    );
    assert(
      foreignInsight.status === 404,
      'Foreign account must not read PostgreSQL-backed Insight by raw ID.'
    );

    // 3. Recreate DB pool/service and prove runtime state survives.
    await closePostgresPool();
    const reconstructed = new DiscoveryRuntimeService();
    const persistedAfterRestart =
      await reconstructed.getInsight(
        accountA,
        firstInsightId
      );

    assert(
      persistedAfterRestart.id === firstInsightId &&
        persistedAfterRestart.status === 'ACKNOWLEDGED',
      'Insight must survive PostgreSQL pool/service reconstruction with status intact.'
    );

    // 4. Stable Platform Insights reads the same PostgreSQL state.
    const platformInsights = await json(
      await fetch(
        baseUrl +
          '/api/platform/v1/insights?datasetId=' +
          encodeURIComponent(importedA.dataset.id) +
          '&latestRunOnly=false',
        {
          headers: {
            Authorization: 'Bearer ' + keyA.secret,
          },
        }
      )
    );

    assert(
      platformInsights.response.status === 200 &&
        platformInsights.body.insights.some(
          (item: any) =>
            item.id === firstInsightId &&
            item.status === 'ACKNOWLEDGED'
        ),
      'Stable Platform Insights endpoint must read the PostgreSQL-backed Discovery state.'
    );

    const foreignPlatformInsights = await json(
      await fetch(
        baseUrl +
          '/api/platform/v1/insights?latestRunOnly=false',
        {
          headers: {
            Authorization: 'Bearer ' + keyB.secret,
            'X-Account-ID': accountA,
          },
        }
      )
    );
    assert(
      foreignPlatformInsights.response.status === 200 &&
        !foreignPlatformInsights.body.insights.some(
          (item: any) => item.id === firstInsightId
        ),
      'Stable Platform Insights must derive account scope only from the authenticated key.'
    );

    // 5. Registered detector Platform write also lands in PostgreSQL.
    const detectorRun = await json(
      await fetch(
        baseUrl +
          '/api/platform/v1/detectors/inventory.fixed-low-stock/run',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + keyA.secret,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            datasetId: importedA.dataset.id,
            config: {
              stockColumn: 'current_stock',
              threshold: 5,
              entityColumn: 'product_name',
              severity: 'HIGH',
            },
            referenceTime: Date.parse(
              '2099-01-02T00:00:00Z'
            ),
          }),
        }
      )
    );

    assert(
      detectorRun.response.status === 201 &&
        detectorRun.body.runId &&
        detectorRun.body.insights?.length === 1,
      'Stable registered-detector execution must complete through the async production runtime.'
    );

    const detectorPg = await postgresPool().query(
      `SELECT detector_registrations
       FROM discovery_analysis_runs
       WHERE account_id = $1 AND id = $2`,
      [accountA, detectorRun.body.runId]
    );
    assert(
      detectorPg.rowCount === 1 &&
        detectorPg.rows[0].detector_registrations?.[0]
          ?.detectorId === 'inventory.fixed-low-stock',
      'Registered detector runtime must persist detector registration metadata in PostgreSQL.'
    );

    // 6. Stable registered tool read shares the same persistence selection.
    const toolRead = await json(
      await fetch(
        baseUrl + '/api/platform/v1/tools/insights.list/invoke',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + keyA.secret,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            input: {
              datasetId: importedA.dataset.id,
              latestRunOnly: false,
              limit: 100,
            },
          }),
        }
      )
    );

    assert(
      toolRead.response.status === 200 &&
        Array.isArray(toolRead.body.result?.insights) &&
        toolRead.body.result.insights.some(
          (item: any) => item.id === firstInsightId
        ) &&
        toolRead.body.result.insights.some(
          (item: any) =>
            item.analysisRunId === detectorRun.body.runId
        ),
      'Registered insights.list tool must read PostgreSQL-backed Discovery state.'
    );

    const finalDiscoveryFile = fs.existsSync(dataFile)
      ? fs.readFileSync(dataFile, 'utf8')
      : null;
    assert(
      finalDiscoveryFile === discoveryFileBefore,
      'All A7A production Discovery/Platform paths must leave legacy discovery.json unchanged.'
    );
  } finally {
    await new Promise<void>((resolve) =>
      server.close(() => resolve())
    );
    await closePostgresPool();
  }

  console.log('PRODUCTION_A7_DISCOVERY_RUNTIME_CHECK_PASSED');
  console.log(
    'PostgreSQL-selected Discovery HTTP writes/reads/status, account isolation, pool/service reconstruction, stable Platform Insights, registered detector writes, registered tool reads, and zero discovery.json mutation are verified.'
  );
}

main().catch(async (error) => {
  console.error('PRODUCTION_A7_DISCOVERY_RUNTIME_CHECK_FAILED');
  console.error(error);
  await closePostgresPool();
  process.exit(1);
});

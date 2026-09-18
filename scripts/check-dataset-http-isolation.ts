import express from 'express';
import fs from 'fs';
import { apiKeyStore } from '../server/apiKeyStore.js';
import { datasetRouter } from '../server/datasets/datasetRouter.js';

function csvFile(contents: string): File {
  return new File([contents], 'orders.csv', { type: 'text/csv' });
}

async function main() {
  const serverSource = fs.readFileSync('server.ts', 'utf8');
  if (!serverSource.includes("app.use('/api/datasets', datasetRouter)")) {
    throw new Error('server.ts must mount the account-scoped datasetRouter.');
  }

  const app = express();
  app.use(express.json());
  app.use('/api/datasets', datasetRouter);

  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', () => resolve());
      server.once('error', reject);
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Could not resolve dataset HTTP test port.');
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const { secret: secretA } = apiKeyStore.createApiKey({
      name: 'Dataset HTTP A',
      accountId: 'acc_dataset_http_a',
      environment: 'test',
    });
    const { secret: secretB } = apiKeyStore.createApiKey({
      name: 'Dataset HTTP B',
      accountId: 'acc_dataset_http_b',
      environment: 'test',
    });

    const csv = [
      'order_id,order_date,customer,amount,paid',
      'O-1,2026-08-10,Acme,NPR 1000,true',
      'O-2,2026-09-10,Beta,NPR 500,false',
    ].join('\n');

    const previewForm = new FormData();
    previewForm.append('file', csvFile(csv));
    const previewResponse = await fetch(baseUrl + '/api/datasets/preview', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretA}`,
        'X-Account-ID': 'acc_dataset_http_b',
      },
      body: previewForm,
    });

    if (previewResponse.status !== 200) {
      throw new Error(`CSV preview failed with ${previewResponse.status}.`);
    }
    const preview = await previewResponse.json();
    if (preview.tables?.[0]?.rowCount !== 2) {
      throw new Error('CSV preview did not expose the expected row count.');
    }

    const beforeImport = await fetch(baseUrl + '/api/datasets', {
      headers: { Authorization: `Bearer ${secretA}` },
    });
    const beforeBody = await beforeImport.json();
    if ((beforeBody.datasets || []).length !== 0) {
      throw new Error('Preview must not create a persistent dataset.');
    }

    const importForm = new FormData();
    importForm.append('file', csvFile(csv));
    importForm.append('datasetName', 'HTTP Orders');
    const importResponse = await fetch(baseUrl + '/api/datasets/import', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secretA}` },
      body: importForm,
    });

    if (importResponse.status !== 201) {
      throw new Error(`CSV import failed with ${importResponse.status}.`);
    }

    const imported = await importResponse.json();
    const datasetId = imported.dataset?.id;
    const versionId = imported.version?.id;
    if (!datasetId || !versionId) {
      throw new Error('Import response did not return dataset/version IDs.');
    }

    const ownRead = await fetch(baseUrl + `/api/datasets/${datasetId}`, {
      headers: { Authorization: `Bearer ${secretA}` },
    });
    if (ownRead.status !== 200) {
      throw new Error(`Owning account could not read dataset: ${ownRead.status}`);
    }

    const queryResponse = await fetch(
      baseUrl + `/api/datasets/${datasetId}/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretA}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          plan: {
            tableName: 'orders',
            aggregates: [
              { operator: 'SUM', column: 'amount', alias: 'revenue' },
              { operator: 'COUNT', alias: 'orders' },
            ],
          },
        }),
      }
    );
    if (queryResponse.status !== 200) {
      throw new Error(
        `Dataset analytics query failed with ${queryResponse.status}.`
      );
    }
    const queryBody = await queryResponse.json();
    if (
      queryBody.rows?.[0]?.revenue !== 1500 ||
      queryBody.rows?.[0]?.orders !== 2
    ) {
      throw new Error('Dataset analytics API returned incorrect aggregates.');
    }
    if (
      queryBody.provenance?.datasetVersionId !== versionId ||
      queryBody.provenance?.sourceSha256 !== imported.version?.source?.sha256
    ) {
      throw new Error('Dataset analytics API provenance is incomplete.');
    }

    const compareResponse = await fetch(
      baseUrl + `/api/datasets/${datasetId}/compare-periods`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretA}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          plan: {
            tableName: 'orders',
            dateColumn: 'order_date',
            metric: { operator: 'SUM', column: 'amount', alias: 'revenue' },
            firstPeriod: {
              label: 'August',
              start: '2026-08-01',
              end: '2026-08-31',
            },
            secondPeriod: {
              label: 'September',
              start: '2026-09-01',
              end: '2026-09-30',
            },
          },
        }),
      }
    );
    if (compareResponse.status !== 200) {
      throw new Error(
        `Dataset period comparison failed with ${compareResponse.status}.`
      );
    }
    const compareBody = await compareResponse.json();
    if (
      compareBody.firstPeriod?.value !== 1000 ||
      compareBody.secondPeriod?.value !== 500
    ) {
      throw new Error('Dataset period comparison returned incorrect values.');
    }

    const foreignRead = await fetch(baseUrl + `/api/datasets/${datasetId}`, {
      headers: {
        Authorization: `Bearer ${secretB}`,
        'X-Account-ID': 'acc_dataset_http_a',
      },
    });
    if (foreignRead.status !== 404) {
      throw new Error(
        `Foreign dataset read must return 404; got ${foreignRead.status}.`
      );
    }

    const foreignQuery = await fetch(
      baseUrl + `/api/datasets/${datasetId}/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretB}`,
          'Content-Type': 'application/json',
          'X-Account-ID': 'acc_dataset_http_a',
        },
        body: JSON.stringify({
          plan: {
            tableName: 'orders',
            aggregates: [{ operator: 'COUNT', alias: 'orders' }],
          },
        }),
      }
    );
    if (foreignQuery.status !== 404) {
      throw new Error(
        `Foreign analytical query must return 404; got ${foreignQuery.status}.`
      );
    }

    const foreignVersion = await fetch(
      baseUrl + `/api/datasets/${datasetId}/versions/${versionId}`,
      {
        headers: { Authorization: `Bearer ${secretB}` },
      }
    );
    if (foreignVersion.status !== 404) {
      throw new Error(
        `Foreign dataset version read must return 404; got ${foreignVersion.status}.`
      );
    }

    const listB = await fetch(baseUrl + '/api/datasets', {
      headers: { Authorization: `Bearer ${secretB}` },
    });
    const listBBody = await listB.json();
    if ((listBBody.datasets || []).some((item: any) => item.id === datasetId)) {
      throw new Error('Account B dataset listing leaked Account A dataset.');
    }

    const invalid = await fetch(baseUrl + '/api/datasets', {
      headers: { Authorization: 'Bearer invalid-dataset-key' },
    });
    if (invalid.status !== 401) {
      throw new Error(
        `Invalid dataset API bearer token should return 401; got ${invalid.status}.`
      );
    }

    console.log('DATASET_HTTP_ISOLATION_CHECK_PASSED');
    console.log(
      'Dataset preview/import/read/version/analytics routes preserve authenticated account isolation.'
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

main().catch((error) => {
  console.error('DATASET_HTTP_ISOLATION_CHECK_FAILED');
  console.error(error);
  process.exit(1);
});

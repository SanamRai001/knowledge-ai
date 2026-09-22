import fs from 'fs';
import {
  SourceStorageConfigurationError,
  sourceStorageRuntimeConfig,
} from '../server/storage/sourceByteStorageRuntime.js';
import { S3SourceByteStorage } from '../server/storage/s3SourceByteStorage.js';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

function section(
  source: string,
  start: string,
  end: string
): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(
    end,
    startIndex + start.length
  );
  assert(
    startIndex >= 0 &&
      endIndex > startIndex,
    'Could not isolate section: ' + start
  );
  return source.slice(
    startIndex,
    endIndex
  );
}

function snapshotEnv(names: string[]) {
  return new Map(
    names.map((name) => [
      name,
      process.env[name],
    ])
  );
}

function restoreEnv(
  snapshot: Map<string, string | undefined>
) {
  for (const [name, value] of snapshot) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}

async function main() {
  const envNames = [
    'SOURCE_STORAGE_BACKEND',
    'SOURCE_STORAGE_BUCKET',
    'SOURCE_STORAGE_REGION',
    'SOURCE_STORAGE_ENDPOINT',
    'SOURCE_STORAGE_ACCESS_KEY_ID',
    'SOURCE_STORAGE_SECRET_ACCESS_KEY',
    'SOURCE_STORAGE_FORCE_PATH_STYLE',
  ];
  const before = snapshotEnv(envNames);

  try {
    process.env.SOURCE_STORAGE_BACKEND =
      's3';
    process.env.SOURCE_STORAGE_BUCKET =
      'knowledge-ai-test';
    process.env.SOURCE_STORAGE_REGION =
      'us-east-1';
    process.env.SOURCE_STORAGE_ENDPOINT =
      'http://127.0.0.1:9000';
    process.env.SOURCE_STORAGE_FORCE_PATH_STYLE =
      'true';
    delete process.env
      .SOURCE_STORAGE_ACCESS_KEY_ID;
    delete process.env
      .SOURCE_STORAGE_SECRET_ACCESS_KEY;

    const config =
      sourceStorageRuntimeConfig();
    assert(
      config.backend === 's3' &&
        config.s3.bucket ===
          'knowledge-ai-test' &&
        config.s3.region ===
          'us-east-1' &&
        config.s3.endpoint ===
          'http://127.0.0.1:9000' &&
        config.s3.forcePathStyle === true,
      'C3 source storage config must parse the selected S3-compatible backend.'
    );

    const adapter =
      new S3SourceByteStorage(
        config.s3
      );
    assert(
      adapter.backend === 's3',
      'C3 production adapter must implement the provider-neutral S3 backend contract.'
    );

    process.env
      .SOURCE_STORAGE_ACCESS_KEY_ID =
      'partial';
    delete process.env
      .SOURCE_STORAGE_SECRET_ACCESS_KEY;

    let partialCredentialsBlocked = false;
    try {
      sourceStorageRuntimeConfig();
    } catch (error) {
      partialCredentialsBlocked =
        error instanceof
          SourceStorageConfigurationError;
    }
    assert(
      partialCredentialsBlocked,
      'C3 must reject partial static S3 credentials.'
    );

    process.env.SOURCE_STORAGE_BACKEND =
      'local';
    process.env
      .SOURCE_STORAGE_SECRET_ACCESS_KEY =
      'secret';

    let unsupportedBackendBlocked = false;
    try {
      sourceStorageRuntimeConfig();
    } catch (error) {
      unsupportedBackendBlocked =
        error instanceof
          SourceStorageConfigurationError;
    }
    assert(
      unsupportedBackendBlocked,
      'C3 production runtime must fail closed for unsupported storage backends.'
    );
  } finally {
    restoreEnv(before);
  }

  const pkg = JSON.parse(
    fs.readFileSync(
      'package.json',
      'utf8'
    )
  );
  assert(
    typeof pkg.dependencies?.[
      '@aws-sdk/client-s3'
    ] === 'string',
    'C3 must install the AWS SDK v3 S3 client for the selected S3-compatible backend.'
  );

  const envExample = fs.readFileSync(
    '.env.example',
    'utf8'
  );
  for (const name of [
    'SOURCE_STORAGE_BACKEND',
    'SOURCE_STORAGE_BUCKET',
    'SOURCE_STORAGE_REGION',
    'SOURCE_STORAGE_ENDPOINT',
    'SOURCE_STORAGE_ACCESS_KEY_ID',
    'SOURCE_STORAGE_SECRET_ACCESS_KEY',
    'SOURCE_STORAGE_FORCE_PATH_STYLE',
  ]) {
    assert(
      envExample.includes(name + '='),
      'C3 environment template must document ' +
        name
    );
  }

  const types = fs.readFileSync(
    'src/types.ts',
    'utf8'
  );
  const documentType = section(
    types,
    'export interface KnowledgeDocument {',
    'export interface Citation {'
  );
  assert(
    documentType.includes(
      'sourceVersionId?: string;'
    ) &&
      !documentType.includes(
        'storageKey'
      ) &&
      !documentType.includes(
        'SOURCE_STORAGE_BUCKET'
      ),
    'Browser-visible document state may expose only opaque sourceVersionId, never provider storage locators.'
  );

  const router = fs.readFileSync(
    'server/workspaceRouter.ts',
    'utf8'
  );
  const upload = section(
    router,
    "workspaceRouter.post(\n  '/documents/upload'",
    "workspaceRouter.post('/documents/sample'"
  );
  const retry = section(
    router,
    "workspaceRouter.post(\n  '/documents/:id/retry'",
    "workspaceRouter.post('/chat'"
  );
  const removal = section(
    router,
    "workspaceRouter.delete(\n  '/documents/:id'",
    "workspaceRouter.post(\n  '/documents/:id/retry'"
  );

  assert(
    upload.includes(
      'persistUploadedPdf'
    ) &&
      upload.indexOf(
        'persistUploadedPdf'
      ) <
        upload.indexOf(
          'parsePdfBuffer'
        ),
    'C3 upload must durably persist source bytes before parsing is committed.'
  );
  assert(
    upload.includes(
      'createFailedKnowledgeDocument'
    ) &&
      upload.includes(
        'retryable: true'
      ) &&
      upload.includes(
        'compensateUnlinkedSource'
      ),
    'C3 parse failures must remain retryable while unlinked storage failures are compensated.'
  );
  assert(
    upload.includes(
      'retireDocumentSource'
    ),
    'C3 replacement upload must retire the prior durable source version.'
  );

  assert(
    retry.includes(
      'sourceVersionId'
    ) &&
      retry.includes(
        'loadPdfBytes'
      ) &&
      retry.indexOf(
        'loadPdfBytes'
      ) <
        retry.indexOf(
          'parsePdfBuffer'
        ) &&
      retry.includes(
        'DOCUMENT_SOURCE_NOT_DURABLE'
      ),
    'C3 retry must re-fetch exact durable source bytes and refuse legacy documents without a source version.'
  );

  assert(
    removal.includes(
      'retireDocumentSource'
    ) &&
      removal.includes(
        'sourceCleanupPending'
      ),
    'C3 document deletion must tombstone durable source metadata and truthfully report deferred physical cleanup.'
  );

  for (const forbidden of [
    'storageKey:',
    'SOURCE_STORAGE_BUCKET',
    'SOURCE_STORAGE_SECRET_ACCESS_KEY',
  ]) {
    assert(
      !upload.includes(forbidden) &&
        !retry.includes(forbidden),
      'C3 HTTP document paths must not expose provider storage details: ' +
        forbidden
    );
  }

  const datasetService = fs.readFileSync(
    'server/datasets/datasetService.ts',
    'utf8'
  );
  const integrationSync =
    fs.readFileSync(
      'server/integrations/integrationSyncService.ts',
      'utf8'
    );

  for (const [name, source] of [
    [
      'datasetService',
      datasetService,
    ],
    [
      'integrationSyncService',
      integrationSync,
    ],
  ]) {
    assert(
      !source.includes(
        'documentSourceStorageService'
      ) &&
        !source.includes(
          'S3SourceByteStorage'
        ),
      'C3 must not broaden document migration into ' +
        name
    );
  }

  console.log(
    'PRODUCTION_C3_DOCUMENT_SOURCE_CONTRACT_CHECK_PASSED'
  );
  console.log(
    'S3-compatible configuration, opaque sourceVersionId domain linkage, store-before-parse, retry re-fetch, tombstone cleanup, secret non-exposure, and C3 scope boundaries are verified.'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_C3_DOCUMENT_SOURCE_CONTRACT_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});

import fs from 'fs';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

function read(path: string): string {
  return fs.readFileSync(path, 'utf8');
}

function section(
  source: string,
  start: string,
  end: string
): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert(
    startIndex >= 0 && endIndex > startIndex,
    'Could not isolate source section: ' + start
  );
  return source.slice(startIndex, endIndex);
}

async function main() {
  const server = read('server.ts');
  const workspaceRouter = read('server/workspaceRouter.ts');
  const workspaceRuntime = read('server/workspaceRuntimeService.ts');
  const kbStore = read('server/kbStore.ts');
  const documentService = read('server/documentService.ts');
  const appTypes = read('src/types.ts');
  const datasetRouter = read('server/datasets/datasetRouter.ts');
  const datasetService = read('server/datasets/datasetService.ts');
  const datasetTypes = read('server/datasets/types.ts');
  const datasetPayloadStore = read(
    'server/datasets/datasetRuntimePayloadStore.ts'
  );
  const datasetPersistence = read(
    'server/datasets/datasetRuntimePersistence.ts'
  );
  const integrationSync = read(
    'server/integrations/integrationSyncService.ts'
  );
  const googleDrive = read(
    'server/integrations/connectors/googleDriveConnector.ts'
  );
  const oneDrive = read(
    'server/integrations/connectors/microsoftOneDriveConnector.ts'
  );
  const sampleDocs = read('server/sampleDocs.ts');
  const quarantine = read('server/legacyRouteQuarantine.ts');
  const gitignore = read('.gitignore');

  assert(
    workspaceRouter.includes('storage: multer.memoryStorage()') &&
      workspaceRouter.includes('fileSize: 25 * 1024 * 1024') &&
      workspaceRouter.includes("upload.array('files', 10)"),
    'Browser PDF upload must remain inventoried as an in-memory request flow.'
  );

  const uploadSection = section(
    workspaceRouter,
    "workspaceRouter.post(\n  '/documents/upload'",
    "workspaceRouter.post('/documents/sample'"
  );
  assert(
    uploadSection.includes('parsePdfBuffer') &&
      uploadSection.includes('file.buffer') &&
      uploadSection.includes('createKnowledgeDocument') &&
      !uploadSection.includes('sourceVersionId') &&
      !uploadSection.includes('storageKey'),
    'C1 expects browser PDF bytes to be parsed from request memory without a durable source object.'
  );

  const retrySection = section(
    workspaceRouter,
    "workspaceRouter.post('/documents/:id/retry'",
    "workspaceRouter.post('/chat'"
  );
  assert(
    retrySection.includes('updateDocumentStatus') &&
      !retrySection.includes('parsePdfBuffer') &&
      !retrySection.includes('file.buffer'),
    'C1 expects document retry to reset status rather than re-read original source bytes.'
  );

  const knowledgeDocument = section(
    appTypes,
    'export interface KnowledgeDocument {',
    'export interface Citation {'
  );
  assert(
    !knowledgeDocument.includes('sourceVersionId') &&
      !knowledgeDocument.includes('sha256') &&
      !knowledgeDocument.includes('storageKey'),
    'KnowledgeDocument must still lack a durable source-version locator during C1 audit.'
  );

  assert(
    documentService.includes('fileSize: buffer.length') &&
      !documentService.includes('storageKey') &&
      !documentService.includes('sourceVersionId'),
    'Document creation must still store metadata/parsed content rather than durable source bytes.'
  );

  assert(
    kbStore.includes("'knowledge_bases.json'") &&
      kbStore.includes('fs.writeFileSync') &&
      gitignore.split(/\r?\n/).includes('data/'),
    'Workspace/document payload must remain explicitly identified as ignored local runtime state.'
  );

  assert(
    workspaceRuntime.includes('WORKSPACE_PAYLOAD_UNAVAILABLE') &&
      workspaceRuntime.includes(
        'Durable workspace payload storage is handled by the object-storage hardening track.'
      ),
    'Workspace runtime must still fail explicitly when PostgreSQL metadata outlives local payload state.'
  );

  assert(
    datasetRouter.includes('storage: multer.memoryStorage()') &&
      datasetRouter.includes("upload.single('file')"),
    'Dataset uploads must remain inventoried as request-memory byte flows.'
  );

  assert(
    datasetService.includes("crypto.createHash('sha256').update(buffer).digest('hex')") &&
      datasetTypes.includes('sha256: string;') &&
      datasetTypes.includes('sizeBytes: number;') &&
      datasetTypes.includes('mimeType: string;'),
    'Dataset source metadata must retain its existing hash/size/MIME integrity seam.'
  );

  assert(
    datasetPayloadStore.includes("'dataset_runtime_payloads.json'") &&
      datasetPayloadStore.includes("backend: 'local-dataset-payload'") &&
      datasetPayloadStore.includes('fs.writeFileSync'),
    'Analytical DatasetVersion payloads must remain identified as local-file backed during C1.'
  );

  assert(
    datasetPersistence.includes('private async loadPayload') &&
      datasetPersistence.includes("locator.backend === 'local-dataset-payload'") &&
      datasetPersistence.includes('public async bootstrap()') &&
      datasetPersistence.includes('await this.loadPayload'),
    'Dataset runtime reconstruction must still depend on the explicit local payload backend.'
  );

  assert(
    server.includes('await datasetRuntimePersistence.bootstrap();'),
    'Server startup must remain documented as dependent on Dataset payload reconstruction.'
  );

  assert(
    googleDrive.includes('Buffer.from(await response.arrayBuffer())') &&
      oneDrive.includes('Buffer.from(await response.arrayBuffer())') &&
      integrationSync.includes('buffer: record.buffer'),
    'Drive connectors must remain inventoried as transient Buffer -> Dataset import flows.'
  );

  assert(
    integrationSync.includes('cursor: result.cursorAfter') &&
      integrationSync.includes("status: 'READY'") &&
      !integrationSync.includes('sourceVersionId'),
    'C1 expects provider checkpointing without an immutable source snapshot link.'
  );

  assert(
    sampleDocs.includes('generateSampleDocs') &&
      sampleDocs.includes('Buffer.from('),
    'Sample PDFs must remain code-regenerable fixtures rather than production durability dependencies.'
  );

  const modernMount = server.indexOf("app.use('/api/kb', workspaceRouter);");
  const quarantineMount = server.indexOf(
    'app.use(legacyPrototypeRouteQuarantineMiddleware);'
  );
  const legacyUpload = server.indexOf(
    "app.post('/api/kb/documents/upload'"
  );
  assert(
    modernMount >= 0 &&
      quarantineMount > modernMount &&
      legacyUpload > quarantineMount &&
      quarantine.includes("prefix: '/api/kb'") &&
      quarantine.includes("disposition: 'RETIRED_FALLBACK'"),
    'Inline legacy /api/kb byte-flow handlers must remain shadowed by the authoritative router and retired fallback quarantine.'
  );

  console.log(
    'PRODUCTION_C1_OBJECT_STORAGE_FORENSIC_AUDIT_CHECK_PASSED'
  );
  console.log(
    'C1 audit boundaries verified: user source bytes are transient, workspace/document and Dataset analytical payloads remain local runtime state, Dataset metadata already carries SHA-256/size/MIME, Drive sync imports transient buffers, legacy /api/kb byte handlers remain retired fallback, and no runtime storage implementation was changed.'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_C1_OBJECT_STORAGE_FORENSIC_AUDIT_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});

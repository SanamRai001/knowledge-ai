import express from 'express';
import multer from 'multer';
import {
  RequestIdentity,
  RequestIdentityError,
  resolveRequestIdentity,
} from '../requestIdentity.js';
import {
  DatasetAccessError,
  datasetStore,
} from './datasetStore.js';
import {
  DatasetImportError,
  datasetService,
} from './datasetService.js';
import { CSV_LIMITS, CsvParseError } from './csvParser.js';
import { XLSX_LIMITS, XlsxParseError } from './xlsxParser.js';
import { SchemaCorrectionError } from './schemaInference.js';
import { DatasetColumnType } from './types.js';
import {
  AnalyticalQueryError,
  structuredAnalyticsEngine,
} from './structuredAnalyticsEngine.js';

export const datasetRouter = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Math.max(CSV_LIMITS.maxFileBytes, XLSX_LIMITS.maxFileBytes),
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const lower = file.originalname.toLowerCase();
    const supported = lower.endsWith('.csv') || lower.endsWith('.xlsx');
    if (supported) {
      cb(null, true);
      return;
    }
    cb(
      new Error(
        `Unsupported dataset file: "${file.originalname}". Supported formats are CSV and XLSX.`
      )
    );
  },
});

datasetRouter.use((req, res, next) => {
  try {
    res.locals.requestIdentity = resolveRequestIdentity(req);
    next();
  } catch (error: any) {
    if (error instanceof RequestIdentityError) {
      res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
      });
      return;
    }
    res.status(500).json({ error: 'Failed to resolve request identity.' });
  }
});

function identity(res: express.Response): RequestIdentity {
  return res.locals.requestIdentity as RequestIdentity;
}

function parseSchemaOverrides(
  value: unknown
): Record<string, Record<string, DatasetColumnType>> | undefined {
  if (value === undefined || value === null || value === '') return undefined;

  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new SchemaCorrectionError(
        'schemaOverrides must be valid JSON.'
      );
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SchemaCorrectionError(
      'schemaOverrides must be an object keyed by table/sheet name.'
    );
  }

  return parsed as Record<string, Record<string, DatasetColumnType>>;
}

function handleError(
  res: express.Response,
  error: any,
  fallback: string,
  defaultStatus = 500
) {
  if (error instanceof RequestIdentityError) {
    res.status(error.statusCode).json({
      error: error.message,
      code: error.code,
    });
    return;
  }
  if (error instanceof DatasetAccessError) {
    res.status(error.statusCode).json({
      error: error.message,
      code: error.code,
    });
    return;
  }
  if (error instanceof DatasetImportError) {
    const status = error.code === 'UNSUPPORTED_FORMAT' ? 415 : 400;
    res.status(status).json({
      error: error.message,
      code: error.code,
    });
    return;
  }
  if (
    error instanceof CsvParseError ||
    error instanceof XlsxParseError ||
    error instanceof SchemaCorrectionError
  ) {
    res.status(400).json({
      error: error.message,
      code: error.name,
    });
    return;
  }
  if (error instanceof AnalyticalQueryError) {
    res.status(error.statusCode).json({
      error: error.message,
      code: error.code,
    });
    return;
  }
  if (error instanceof multer.MulterError) {
    res.status(400).json({
      error: error.message,
      code: 'UPLOAD_LIMIT',
    });
    return;
  }
  res.status(defaultStatus).json({ error: error?.message || fallback });
}

datasetRouter.get('/', (_req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({ datasets: datasetService.listDatasets(accountId) });
  } catch (error) {
    handleError(res, error, 'Failed to list datasets');
  }
});

datasetRouter.get('/:id', (req, res) => {
  try {
    const { accountId } = identity(res);
    res.json(datasetService.getDataset(accountId, req.params.id));
  } catch (error) {
    handleError(res, error, 'Failed to retrieve dataset');
  }
});

datasetRouter.get('/:id/versions/:versionId', (req, res) => {
  try {
    const { accountId } = identity(res);
    const version = datasetStore.getVersion(
      accountId,
      req.params.id,
      req.params.versionId
    );
    if (!version) {
      datasetStore.requireDataset(accountId, req.params.id);
      res.status(404).json({
        error: 'Dataset version not found.',
        code: 'VERSION_NOT_FOUND',
      });
      return;
    }
    res.json({ version });
  } catch (error) {
    handleError(res, error, 'Failed to retrieve dataset version');
  }
});

datasetRouter.post('/:id/query', (req, res) => {
  try {
    const { accountId } = identity(res);
    const result = structuredAnalyticsEngine.execute({
      accountId,
      datasetId: req.params.id,
      versionId:
        typeof req.body?.versionId === 'string' && req.body.versionId.trim()
          ? req.body.versionId.trim()
          : undefined,
      plan: req.body?.plan,
    });
    res.json(result);
  } catch (error) {
    handleError(res, error, 'Failed to execute analytical query');
  }
});

datasetRouter.post('/:id/compare-periods', (req, res) => {
  try {
    const { accountId } = identity(res);
    const result = structuredAnalyticsEngine.comparePeriods({
      accountId,
      datasetId: req.params.id,
      versionId:
        typeof req.body?.versionId === 'string' && req.body.versionId.trim()
          ? req.body.versionId.trim()
          : undefined,
      plan: req.body?.plan,
    });
    res.json(result);
  } catch (error) {
    handleError(res, error, 'Failed to compare dataset periods');
  }
});

datasetRouter.post(
  '/preview',
  upload.single('file'),
  async (req, res) => {
    try {
      const { accountId } = identity(res);
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'A CSV or XLSX file is required.' });
        return;
      }

      const preview = await datasetService.previewFile({
        accountId,
        buffer: file.buffer,
        filename: file.originalname,
        mimeType: file.mimetype,
        schemaOverrides: parseSchemaOverrides(req.body?.schemaOverrides),
      });
      res.json(preview);
    } catch (error) {
      handleError(res, error, 'Failed to preview dataset');
    }
  }
);

datasetRouter.post(
  '/import',
  upload.single('file'),
  async (req, res) => {
    try {
      const { accountId } = identity(res);
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'A CSV or XLSX file is required.' });
        return;
      }

      const result = await datasetService.importFile({
        accountId,
        buffer: file.buffer,
        filename: file.originalname,
        mimeType: file.mimetype,
        datasetName:
          typeof req.body?.datasetName === 'string'
            ? req.body.datasetName
            : undefined,
        description:
          typeof req.body?.description === 'string'
            ? req.body.description
            : undefined,
        existingDatasetId:
          typeof req.body?.existingDatasetId === 'string' &&
          req.body.existingDatasetId.trim()
            ? req.body.existingDatasetId.trim()
            : undefined,
        schemaOverrides: parseSchemaOverrides(req.body?.schemaOverrides),
      });

      res.status(201).json(result);
    } catch (error) {
      handleError(res, error, 'Failed to import dataset');
    }
  }
);

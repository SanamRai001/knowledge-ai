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
import { CSV_LIMITS } from './csvParser.js';

export const datasetRouter = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: CSV_LIMITS.maxFileBytes,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const isCsv =
      file.originalname.toLowerCase().endsWith('.csv') ||
      file.mimetype === 'text/csv' ||
      file.mimetype === 'application/csv';
    if (isCsv) {
      cb(null, true);
      return;
    }
    cb(
      new Error(
        `Unsupported dataset file: "${file.originalname}". Phase 1A accepts CSV files only.`
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

datasetRouter.post(
  '/preview',
  upload.single('file'),
  (req, res) => {
    try {
      const { accountId } = identity(res);
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'A CSV file is required.' });
        return;
      }

      const preview = datasetService.previewCsv({
        accountId,
        buffer: file.buffer,
        filename: file.originalname,
        mimeType: file.mimetype,
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
  (req, res) => {
    try {
      const { accountId } = identity(res);
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'A CSV file is required.' });
        return;
      }

      const result = datasetService.importCsv({
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
      });

      res.status(201).json(result);
    } catch (error) {
      handleError(res, error, 'Failed to import dataset');
    }
  }
);

import express from 'express';
import { actionStore } from '../actions/actionStore.js';
import { hybridActionInterpreter } from '../actions/hybridActionInterpreter.js';
import { companyKnowledgeStore } from '../companyKnowledge/companyKnowledgeStore.js';
import type { CompanyEntityType } from '../companyKnowledge/types.js';
import { datasetStore } from '../datasets/datasetStore.js';
import { discoveryRuntimeService } from '../discovery/discoveryRuntimeService.js';
import type { InsightStatus } from '../discovery/types.js';
import { unifiedQueryService } from '../querying/unifiedQueryService.js';
import { watchStore } from '../watch/watchStore.js';
import type {
  WatchAlertStatus,
  WatchRuleStatus,
} from '../watch/types.js';
import { workspaceAccessService } from '../workspaceAccessService.js';
import {
  publicPlatformManifest,
} from './platformApiManifest.js';
import { toolInvocationService } from './tools/toolInvocationService.js';
import { platformPersistence } from './platformPersistence.js';
import { detectorExecutionService } from './detectors/detectorExecutionService.js';
import { detectorExecutionRuntimeService } from './detectors/detectorExecutionRuntimeService.js';
import { domainPackService } from './domainPacks/domainPackService.js';
import { domainPackRuntimeService } from './domainPacks/domainPackRuntimeService.js';
import {
  platformContext,
  requirePlatformOperation,
} from './platformApiAuth.js';

export const platformApiRouter = express.Router();

function handleError(res: express.Response, error: any): void {
  const statusCode =
    typeof error?.statusCode === 'number'
      ? error.statusCode
      : 500;
  const code =
    typeof error?.code === 'string'
      ? error.code
      : 'PLATFORM_INTERNAL_ERROR';

  res.status(statusCode).json({
    error: {
      code,
      message:
        error?.message || 'Stable platform API request failed.',
    },
    request_id:
      res.locals.platformApiContext?.requestId,
  });
}

function limitFrom(
  value: unknown,
  fallback: number,
  max = 200
): number {
  if (typeof value !== 'string') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(1, Math.min(parsed, max))
    : fallback;
}

function entityTypeFrom(
  value: unknown
): CompanyEntityType | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const normalized = value.trim().toUpperCase();
  const allowed: CompanyEntityType[] = [
    'CUSTOMER',
    'PRODUCT',
    'SUPPLIER',
    'ORDER',
    'INVOICE',
    'BRANCH',
    'LOCATION',
    'CONTRACT',
    'PROJECT',
    'EMPLOYEE',
    'ORGANIZATION',
    'OTHER',
  ];
  return allowed.includes(normalized as CompanyEntityType)
    ? (normalized as CompanyEntityType)
    : undefined;
}

function insightStatusFrom(
  value: unknown
): InsightStatus | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toUpperCase();
  return normalized === 'OPEN' ||
    normalized === 'ACKNOWLEDGED' ||
    normalized === 'RESOLVED'
    ? normalized
    : undefined;
}

function actionStatusFrom(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toUpperCase();
  const allowed = [
    'PROPOSED',
    'NEEDS_INPUT',
    'CONFIRMED',
    'CANCELLED',
    'STALE',
    'FAILED',
  ] as const;
  return allowed.includes(normalized as any)
    ? (normalized as (typeof allowed)[number])
    : undefined;
}

function watchRuleStatusFrom(
  value: unknown
): WatchRuleStatus | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toUpperCase();
  return normalized === 'ACTIVE' ||
    normalized === 'PAUSED' ||
    normalized === 'INVALID' ||
    normalized === 'ARCHIVED'
    ? normalized
    : undefined;
}

function watchAlertStatusFrom(
  value: unknown
): WatchAlertStatus | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toUpperCase();
  return normalized === 'OPEN' ||
    normalized === 'ACKNOWLEDGED' ||
    normalized === 'SNOOZED' ||
    normalized === 'RESOLVED'
    ? normalized
    : undefined;
}

platformApiRouter.get('/manifest', (_req, res) => {
  res.json(publicPlatformManifest());
});

platformApiRouter.get(
  '/sources',
  requirePlatformOperation('sources.list'),
  (_req, res) => {
    try {
      const { accountId } = platformContext(res);

      const datasets = datasetStore
        .listDatasets(accountId)
        .map((dataset) => {
          const version = datasetStore.getCurrentVersion(
            accountId,
            dataset.id
          );
          return {
            kind: 'DATASET' as const,
            id: dataset.id,
            name: dataset.name,
            description: dataset.description,
            updatedAt: dataset.updatedAt,
            currentVersion: {
              id: version.id,
              versionNumber: version.versionNumber,
              createdAt: version.createdAt,
              source: version.source,
            },
          };
        });

      const documents = workspaceAccessService
        .listKBs(accountId)
        .flatMap((summary: any) => {
          const kb = workspaceAccessService.requireKB(
            accountId,
            summary.id
          );
          return kb.documents.map((document) => ({
            kind: 'DOCUMENT' as const,
            id: document.id,
            name: document.filename,
            knowledgeBaseId: kb.id,
            knowledgeBaseName: kb.name,
            fileType: document.fileType,
            fileSize: document.fileSize,
            processingStatus: document.processingStatus,
            pageCount: document.pageCount,
            uploadedAt: document.uploadTimestamp,
          }));
        });

      res.json({
        sources: [...datasets, ...documents],
      });
    } catch (error) {
      handleError(res, error);
    }
  }
);

platformApiRouter.get(
  '/knowledge/summary',
  requirePlatformOperation('knowledge.summary.get'),
  (_req, res) => {
    try {
      const { accountId } = platformContext(res);
      res.json({
        summary:
          companyKnowledgeStore.snapshotCounts(accountId),
      });
    } catch (error) {
      handleError(res, error);
    }
  }
);

platformApiRouter.get(
  '/knowledge/entities',
  requirePlatformOperation('knowledge.entities.list'),
  (req, res) => {
    try {
      const { accountId } = platformContext(res);
      res.json({
        entities: companyKnowledgeStore.listEntities({
          accountId,
          type: entityTypeFrom(req.query.type),
          search:
            typeof req.query.search === 'string'
              ? req.query.search
              : undefined,
          limit: limitFrom(req.query.limit, 100, 500),
        }),
      });
    } catch (error) {
      handleError(res, error);
    }
  }
);

platformApiRouter.get(
  '/knowledge/entities/:id',
  requirePlatformOperation('knowledge.entity.get'),
  (req, res) => {
    try {
      const { accountId } = platformContext(res);
      const entity = companyKnowledgeStore.requireEntity(
        accountId,
        req.params.id
      );
      res.json({
        entity,
        claims: companyKnowledgeStore.listClaims({
          accountId,
          entityId: entity.id,
          currentOnly: false,
          limit: 300,
        }),
        relationships:
          companyKnowledgeStore.listRelationships({
            accountId,
            entityId: entity.id,
            limit: 100,
          }),
        events: companyKnowledgeStore.listEvents({
          accountId,
          entityId: entity.id,
          limit: 200,
        }),
      });
    } catch (error) {
      handleError(res, error);
    }
  }
);

platformApiRouter.post(
  '/ask',
  requirePlatformOperation('ask.query'),
  async (req, res) => {
    try {
      const { accountId, requestId } =
        platformContext(res);
      const result = await unifiedQueryService.answer({
        accountId,
        requestId,
        question:
          typeof req.body?.question === 'string'
            ? req.body.question
            : '',
        datasetId:
          typeof req.body?.datasetId === 'string' &&
          req.body.datasetId.trim()
            ? req.body.datasetId.trim()
            : undefined,
        datasetVersionId:
          typeof req.body?.datasetVersionId === 'string' &&
          req.body.datasetVersionId.trim()
            ? req.body.datasetVersionId.trim()
            : undefined,
        knowledgeBaseId:
          typeof req.body?.knowledgeBaseId === 'string' &&
          req.body.knowledgeBaseId.trim()
            ? req.body.knowledgeBaseId.trim()
            : undefined,
        allowLlmPlanning:
          req.body?.allowLlmPlanning !== false,
        allowLlmExplanation:
          req.body?.allowLlmExplanation !== false,
      });

      res.json({
        request_id: requestId,
        ...result,
      });
    } catch (error) {
      handleError(res, error);
    }
  }
);

platformApiRouter.get(
  '/insights',
  requirePlatformOperation('insights.list'),
  async (req, res) => {
    try {
      const { accountId } = platformContext(res);
      res.json({
        insights: await discoveryRuntimeService.listInsights({
          accountId,
          datasetId:
            typeof req.query.datasetId === 'string' &&
            req.query.datasetId.trim()
              ? req.query.datasetId.trim()
              : undefined,
          knowledgeBaseId:
            typeof req.query.knowledgeBaseId === 'string' &&
            req.query.knowledgeBaseId.trim()
              ? req.query.knowledgeBaseId.trim()
              : undefined,
          runId:
            typeof req.query.runId === 'string' &&
            req.query.runId.trim()
              ? req.query.runId.trim()
              : undefined,
          status: insightStatusFrom(req.query.status),
          latestRunOnly:
            req.query.latestRunOnly !== 'false',
          limit: limitFrom(req.query.limit, 20, 100),
        }),
      });
    } catch (error) {
      handleError(res, error);
    }
  }
);

platformApiRouter.get(
  '/actions',
  requirePlatformOperation('actions.list'),
  (req, res) => {
    try {
      const { accountId } = platformContext(res);
      res.json({
        proposals: actionStore.listProposals({
          accountId,
          status: actionStatusFrom(req.query.status),
          limit: limitFrom(req.query.limit, 100, 500),
        }),
      });
    } catch (error) {
      handleError(res, error);
    }
  }
);

platformApiRouter.post(
  '/actions/propose',
  requirePlatformOperation('actions.propose'),
  async (req, res) => {
    try {
      const { accountId } = platformContext(res);
      const result = await hybridActionInterpreter.interpret({
        accountId,
        instruction:
          typeof req.body?.instruction === 'string'
            ? req.body.instruction
            : '',
        allowLlmParsing:
          req.body?.allowLlmParsing !== false,
      });

      res.status(201).json(result);
    } catch (error) {
      handleError(res, error);
    }
  }
);

platformApiRouter.get(
  '/watch/rules',
  requirePlatformOperation('watch.rules.list'),
  (req, res) => {
    try {
      const { accountId } = platformContext(res);
      res.json({
        rules: watchStore.listRules({
          accountId,
          status: watchRuleStatusFrom(req.query.status),
          limit: limitFrom(req.query.limit, 100, 500),
        }),
      });
    } catch (error) {
      handleError(res, error);
    }
  }
);

platformApiRouter.get(
  '/watch/alerts',
  requirePlatformOperation('watch.alerts.list'),
  (req, res) => {
    try {
      const { accountId } = platformContext(res);
      res.json({
        alerts: watchStore.listAlerts({
          accountId,
          watchRuleId:
            typeof req.query.watchRuleId === 'string' &&
            req.query.watchRuleId.trim()
              ? req.query.watchRuleId.trim()
              : undefined,
          status: watchAlertStatusFrom(req.query.status),
          limit: limitFrom(req.query.limit, 100, 500),
        }),
      });
    } catch (error) {
      handleError(res, error);
    }
  }
);

platformApiRouter.get(
  '/tools',
  requirePlatformOperation('tools.list'),
  (_req, res) => {
    try {
      const { scopes } = platformContext(res);
      res.json({
        tools: toolInvocationService.list({ scopes }),
      });
    } catch (error) {
      handleError(res, error);
    }
  }
);

platformApiRouter.post(
  '/tools/:id/invoke',
  requirePlatformOperation('tools.invoke'),
  async (req, res) => {
    try {
      const context = platformContext(res);
      const result = await toolInvocationService.invoke({
        toolId: req.params.id,
        rawInput: req.body?.input ?? {},
        context: {
          accountId: context.accountId,
          requestId: context.requestId,
          apiKeyId: context.apiKeyId,
          scopes: context.scopes,
        },
      });

      res.json({
        request_id: context.requestId,
        invocation_id: result.invocationId,
        tool: {
          id: result.tool.id,
          version: result.tool.version,
          mutation: result.tool.mutation,
          riskClass: result.tool.riskClass,
        },
        result: result.result,
      });
    } catch (error) {
      handleError(res, error);
    }
  }
);

platformApiRouter.get(
  '/tools/invocations',
  requirePlatformOperation('tools.invocations.list'),
  async (req, res) => {
    try {
      const { accountId } = platformContext(res);
      res.json({
        invocations:
          await platformPersistence.listToolInvocations({
            accountId,
            toolId:
              typeof req.query.toolId === 'string' &&
              req.query.toolId.trim()
                ? req.query.toolId.trim()
                : undefined,
            limit: limitFrom(req.query.limit, 100, 500),
          }),
      });
    } catch (error) {
      handleError(res, error);
    }
  }
);

platformApiRouter.get(
  '/detectors',
  requirePlatformOperation('detectors.list'),
  (_req, res) => {
    try {
      res.json({
        detectors: detectorExecutionService.list(),
      });
    } catch (error) {
      handleError(res, error);
    }
  }
);

platformApiRouter.post(
  '/detectors/:id/run',
  requirePlatformOperation('detectors.run'),
  async (req, res) => {
    try {
      const { accountId, requestId } = platformContext(res);
      const result = await detectorExecutionRuntimeService.run({
        accountId,
        detectorId: req.params.id,
        datasetId:
          typeof req.body?.datasetId === 'string'
            ? req.body.datasetId.trim()
            : '',
        datasetVersionId:
          typeof req.body?.datasetVersionId === 'string' &&
          req.body.datasetVersionId.trim()
            ? req.body.datasetVersionId.trim()
            : undefined,
        config: req.body?.config ?? {},
        referenceTime:
          typeof req.body?.referenceTime === 'number' &&
          Number.isFinite(req.body.referenceTime)
            ? req.body.referenceTime
            : undefined,
      });

      res.status(201).json({
        request_id: requestId,
        ...result,
      });
    } catch (error) {
      handleError(res, error);
    }
  }
);

platformApiRouter.get(
  '/domain-packs',
  requirePlatformOperation('domain-packs.list'),
  (_req, res) => {
    try {
      res.json({
        packs: domainPackService.list(),
      });
    } catch (error) {
      handleError(res, error);
    }
  }
);

platformApiRouter.get(
  '/domain-packs/installations',
  requirePlatformOperation('domain-packs.installations.list'),
  async (_req, res) => {
    try {
      const { accountId } = platformContext(res);
      const installations =
        await platformPersistence.listDomainPackInstallations(
          accountId
        );
      res.json({
        installations: installations.map((installation) => ({
          installation,
          pack: domainPackService.get(installation.packId),
        })),
      });
    } catch (error) {
      handleError(res, error);
    }
  }
);

platformApiRouter.post(
  '/domain-packs/:id/install',
  requirePlatformOperation('domain-packs.install'),
  async (req, res) => {
    try {
      const { accountId, requestId } = platformContext(res);
      const pack = domainPackService.get(req.params.id);
      const installation =
        await platformPersistence.installDomainPack({
          accountId,
          packId: pack.id,
          packVersion: pack.version,
        });
      res.status(201).json({
        request_id: requestId,
        installation,
        pack,
      });
    } catch (error) {
      handleError(res, error);
    }
  }
);

platformApiRouter.post(
  '/domain-packs/:id/detectors/:templateId/run',
  requirePlatformOperation('domain-packs.detector.run'),
  async (req, res) => {
    try {
      const { accountId, requestId } = platformContext(res);
      const result = await domainPackRuntimeService.runDetectorTemplate({
        accountId,
        packId: req.params.id,
        templateId: req.params.templateId,
        datasetId:
          typeof req.body?.datasetId === 'string'
            ? req.body.datasetId.trim()
            : '',
        datasetVersionId:
          typeof req.body?.datasetVersionId === 'string' &&
          req.body.datasetVersionId.trim()
            ? req.body.datasetVersionId.trim()
            : undefined,
        configOverrides: req.body?.configOverrides ?? {},
        referenceTime:
          typeof req.body?.referenceTime === 'number' &&
          Number.isFinite(req.body.referenceTime)
            ? req.body.referenceTime
            : undefined,
      });
      res.status(201).json({
        request_id: requestId,
        ...result,
      });
    } catch (error) {
      handleError(res, error);
    }
  }
);

platformApiRouter.get(
  '/audit/activity',
  requirePlatformOperation('audit.activity.list'),
  (req, res) => {
    try {
      const { accountId } = platformContext(res);
      const limit = limitFrom(req.query.limit, 100, 500);
      const actionAudit = actionStore
        .listAudit({
          accountId,
          limit,
        })
        .map((entry) => ({
          id: 'action:' + entry.id,
          kind: 'ACTION_AUDIT' as const,
          timestamp: entry.timestamp,
          action: entry.action,
          resourceId: entry.proposalId,
          detail: entry.detail,
          executionId: entry.executionId,
        }));

      const businessEvents =
        companyKnowledgeStore
          .listEvents({
            accountId,
            limit,
          })
          .map((event) => ({
            id: 'event:' + event.id,
            kind: 'BUSINESS_EVENT' as const,
            timestamp:
              event.occurredAt || event.recordedAt,
            action: event.type,
            resourceId: event.id,
            subjectEntityIds: event.subjectEntityIds,
            data: event.data,
            sourceRef: event.sourceRef,
          }));

      res.json({
        activity: [
          ...actionAudit,
          ...businessEvents,
        ]
          .sort(
            (a, b) => b.timestamp - a.timestamp
          )
          .slice(0, limit),
      });
    } catch (error) {
      handleError(res, error);
    }
  }
);

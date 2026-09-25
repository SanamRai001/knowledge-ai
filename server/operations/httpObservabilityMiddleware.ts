import crypto from 'crypto';
import type express from 'express';
import {
  operationalTelemetry,
  runWithOperationalContext,
} from './operationalTelemetry.js';
import {
  resolveProcessRole,
} from '../runtime/processRole.js';

const SAFE_REQUEST_ID =
  /^[A-Za-z0-9._:-]{1,128}$/;

function requestId(
  req: express.Request
): string {
  const incoming =
    req.header('x-request-id')?.trim();
  if (
    incoming &&
    SAFE_REQUEST_ID.test(incoming)
  ) {
    return incoming;
  }
  return (
    'req_' +
    crypto.randomUUID()
  );
}

function routeTemplate(
  req: express.Request
): string {
  const routePath =
    typeof req.route?.path === 'string'
      ? req.route.path
      : undefined;
  if (!routePath) {
    return 'unmatched';
  }

  const base =
    typeof req.baseUrl === 'string'
      ? req.baseUrl
      : '';
  const candidate =
    (base + routePath)
      .replace(/\/+/g, '/')
      .slice(0, 160);

  return candidate || '/';
}

function statusClass(
  statusCode: number
): string {
  return (
    Math.floor(statusCode / 100) +
    'xx'
  );
}

export function operationalHttpMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const id = requestId(req);
  const traceId =
    'trace_' +
    crypto.randomUUID();
  const started =
    process.hrtime.bigint();

  let processRole = 'unknown';
  try {
    processRole =
      resolveProcessRole(
        process.env,
        {
          nonProductionDefault:
            'combined',
        }
      );
  } catch {
    processRole = 'invalid';
  }

  res.setHeader(
    'X-Request-ID',
    id
  );

  runWithOperationalContext(
    {
      requestId: id,
      traceId,
      processRole,
    },
    () => {
      res.once('finish', () => {
        const durationMs =
          Number(
            process.hrtime.bigint() -
              started
          ) /
          1_000_000;
        const labels = {
          route_template:
            routeTemplate(req),
          method:
            req.method.toUpperCase(),
          status_class:
            statusClass(
              res.statusCode
            ),
          process_role:
            processRole,
        };

        operationalTelemetry.recordMetric({
          name:
            'http_requests_total',
          kind: 'COUNTER',
          value: 1,
          labels,
        });
        operationalTelemetry.recordMetric({
          name:
            'http_request_duration_ms',
          kind: 'HISTOGRAM',
          value: durationMs,
          labels,
        });

        operationalTelemetry.emitEvent({
          level:
            res.statusCode >= 500
              ? 'error'
              : res.statusCode >= 400
                ? 'warn'
                : 'info',
          eventName:
            'http.request.completed',
          component: 'http',
          processRole,
          outcome:
            statusClass(
              res.statusCode
            ),
          metadata: {
            method:
              req.method.toUpperCase(),
            routeTemplate:
              labels.route_template,
            statusCode:
              res.statusCode,
            durationMs:
              Math.round(
                durationMs * 100
              ) / 100,
          },
        });
      });

      next();
    }
  );
}

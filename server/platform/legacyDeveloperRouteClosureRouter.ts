import express from 'express';

export const LEGACY_DEVELOPER_ROUTE_RETIRED_CODE =
  'LEGACY_DEVELOPER_ROUTE_RETIRED';

export const legacyDeveloperRouteClosureRouter =
  express.Router();

function retired(
  _req: express.Request,
  res: express.Response
): void {
  res.status(410).json({
    error:
      'This legacy developer-management endpoint has been retired.',
    code: LEGACY_DEVELOPER_ROUTE_RETIRED_CODE,
    replacement: '/api/platform-management',
    stableMachineApi: '/api/platform/v1',
  });
}

legacyDeveloperRouteClosureRouter.get('/keys', retired);
legacyDeveloperRouteClosureRouter.post('/keys', retired);
legacyDeveloperRouteClosureRouter.delete(
  '/keys/:id',
  retired
);
legacyDeveloperRouteClosureRouter.get('/usage', retired);

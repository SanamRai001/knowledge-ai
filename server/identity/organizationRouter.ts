import { Router } from 'express';
import type {
  RequestIdentity,
} from '../requestIdentity.js';
import {
  applicationIdentityMiddleware,
} from '../requestIdentityMiddleware.js';
import {
  requireHumanRoles,
  requireOwnerOrAdmin,
} from './privilegedAuthorization.js';
import {
  OrganizationMemberAdminError,
} from './organizationMemberAdminTypes.js';
import {
  organizationMemberAdminService,
} from './organizationMemberAdminService.js';

export const organizationRouter =
  Router();

organizationRouter.use(
  applicationIdentityMiddleware
);

function identity(
  res: any
): RequestIdentity {
  return res.locals
    .requestIdentity as RequestIdentity;
}

function handleError(
  error: unknown,
  res: any
) {
  if (
    error instanceof
      OrganizationMemberAdminError
  ) {
    res.status(
      error.statusCode
    ).json({
      error: error.message,
      code: error.code,
    });
    return;
  }

  console.error(
    'Organization administration failure:',
    error
  );
  res.status(500).json({
    error:
      'Organization administration request failed.',
    code:
      'ORGANIZATION_ADMIN_INTERNAL_ERROR',
  });
}

organizationRouter.get(
  '/members',
  requireHumanRoles(
    'OWNER',
    'ADMIN',
    'MEMBER'
  ),
  async (_req, res) => {
    try {
      const value = identity(res);
      res.json({
        accountId: value.accountId,
        members:
          await organizationMemberAdminService
            .listMembers(
              value.accountId
            ),
        capabilities: {
          canManageMembers:
            value.membershipRole ===
              'OWNER' ||
            value.membershipRole ===
              'ADMIN',
          canManageOwners:
            value.membershipRole ===
            'OWNER',
        },
      });
    } catch (error) {
      handleError(error, res);
    }
  }
);

organizationRouter.patch(
  '/members/:userId/role',
  requireOwnerOrAdmin,
  async (req, res) => {
    try {
      const value = identity(res);
      const member =
        await organizationMemberAdminService
          .changeRole({
            accountId:
              value.accountId,
            actorUserId:
              value.userId!,
            targetUserId:
              req.params.userId,
            nextRole:
              req.body?.role,
          });
      res.json({ member });
    } catch (error) {
      handleError(error, res);
    }
  }
);

organizationRouter.patch(
  '/members/:userId/status',
  requireOwnerOrAdmin,
  async (req, res) => {
    try {
      const value = identity(res);
      const member =
        await organizationMemberAdminService
          .changeStatus({
            accountId:
              value.accountId,
            actorUserId:
              value.userId!,
            targetUserId:
              req.params.userId,
            nextStatus:
              req.body?.status,
          });
      res.json({ member });
    } catch (error) {
      handleError(error, res);
    }
  }
);

organizationRouter.get(
  '/membership-audit',
  requireOwnerOrAdmin,
  async (req, res) => {
    try {
      const value = identity(res);
      const parsed = Number(
        req.query.limit
      );
      const limit =
        Number.isFinite(parsed)
          ? parsed
          : undefined;

      res.json({
        entries:
          await organizationMemberAdminService
            .listAudit(
              value.accountId,
              limit
            ),
      });
    } catch (error) {
      handleError(error, res);
    }
  }
);

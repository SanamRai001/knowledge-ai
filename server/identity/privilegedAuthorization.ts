import type express from 'express';
import type { RequestIdentity } from '../requestIdentity.js';
import type { AccountMembershipRole } from './types.js';

export type PrivilegedHumanRole =
  | 'OWNER'
  | 'ADMIN';

export const PRIVILEGED_HUMAN_ROLES:
  readonly PrivilegedHumanRole[] = [
    'OWNER',
    'ADMIN',
  ];

export function requireHumanRoles(
  ...allowedRoles: AccountMembershipRole[]
): express.RequestHandler {
  const allowed = new Set(allowedRoles);

  return (_req, res, next) => {
    const identity =
      res.locals.requestIdentity as
        | RequestIdentity
        | undefined;

    if (!identity) {
      res.status(401).json({
        error:
          'Authenticated human identity is required.',
        code: 'PRIVILEGED_IDENTITY_REQUIRED',
      });
      return;
    }

    if (identity.source !== 'HUMAN_SESSION') {
      res.status(403).json({
        error:
          'This operation requires an authenticated human session.',
        code: 'PRIVILEGED_HUMAN_SESSION_REQUIRED',
      });
      return;
    }

    if (
      !identity.userId ||
      !identity.membershipRole ||
      !allowed.has(identity.membershipRole)
    ) {
      res.status(403).json({
        error:
          'Your account role does not permit this operation.',
        code: 'PRIVILEGED_ROLE_REQUIRED',
      });
      return;
    }

    next();
  };
}

export const requireOwnerOrAdmin =
  requireHumanRoles(...PRIVILEGED_HUMAN_ROLES);

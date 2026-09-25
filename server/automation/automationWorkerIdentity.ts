import type {
  RequestIdentity,
  RequestIdentitySource,
} from '../requestIdentity.js';
import {
  postgresIdentityFoundationRepository,
} from '../identity/postgresIdentityFoundationRepository.js';
import {
  postgresApiKeyRepository,
} from '../persistence/postgresRepositories.js';
import {
  automationActorLabel,
  resolveAutomationActorRole,
} from './automationActor.js';
import type {
  AutomationActorRole,
} from './types.js';

export interface AutomationWorkerPrincipalSnapshot {
  source: RequestIdentitySource;
  principalId?: string;
  requestedRole: AutomationActorRole;
  requestedBy: string;
  authorizationRevisionAt?: number;
}

export class AutomationWorkerIdentityError
  extends Error
{
  readonly code =
    'AUTOMATION_WORKER_IDENTITY_INVALID';
  readonly statusCode = 403;

  constructor(message: string) {
    super(message);
    this.name =
      'AutomationWorkerIdentityError';
  }
}

function expired(
  expiresAt:
    | number
    | null
    | undefined,
  now = Date.now()
): boolean {
  return (
    typeof expiresAt === 'number' &&
    expiresAt <= now
  );
}

export async function snapshotAutomationWorkerPrincipal(
  identity: RequestIdentity
): Promise<AutomationWorkerPrincipalSnapshot> {
  if (
    identity.source ===
    'HUMAN_SESSION'
  ) {
    if (!identity.userId) {
      throw new AutomationWorkerIdentityError(
        'Queued human Automation execution requires a durable user identity.'
      );
    }

    const [user, membership] =
      await Promise.all([
        postgresIdentityFoundationRepository
          .getUserById(
            identity.userId
          ),
        postgresIdentityFoundationRepository
          .getMembership(
            identity.accountId,
            identity.userId
          ),
      ]);

    if (
      !user ||
      user.status !== 'ACTIVE' ||
      !membership ||
      membership.status !== 'ACTIVE'
    ) {
      throw new AutomationWorkerIdentityError(
        'The human principal no longer has an active account membership.'
      );
    }

    const current: RequestIdentity = {
      accountId:
        identity.accountId,
      source: 'HUMAN_SESSION',
      authenticated: true,
      userId: identity.userId,
      membershipRole:
        membership.role,
    };

    return {
      source: current.source,
      principalId:
        current.userId,
      requestedRole:
        resolveAutomationActorRole(
          current
        ),
      requestedBy:
        automationActorLabel(
          current
        ),
      authorizationRevisionAt:
        Math.max(
          user.updatedAt,
          membership.updatedAt
        ),
    };
  }

  if (
    identity.source === 'API_KEY'
  ) {
    if (!identity.apiKeyId) {
      throw new AutomationWorkerIdentityError(
        'Queued API-key Automation execution requires a durable API-key identity.'
      );
    }

    const key =
      await postgresApiKeyRepository.get(
        identity.accountId,
        identity.apiKeyId
      );

    if (
      !key ||
      key.status !== 'active' ||
      expired(key.expiresAt)
    ) {
      throw new AutomationWorkerIdentityError(
        'The API key is revoked, expired, or outside the current account scope.'
      );
    }

    const current: RequestIdentity = {
      accountId:
        identity.accountId,
      source: 'API_KEY',
      authenticated: true,
      apiKeyId: key.id,
    };

    return {
      source: current.source,
      principalId:
        current.apiKeyId,
      requestedRole:
        resolveAutomationActorRole(
          current
        ),
      requestedBy:
        automationActorLabel(
          current
        ),
      authorizationRevisionAt:
        key.createdAt,
    };
  }

  if (
    process.env.NODE_ENV ===
    'production'
  ) {
    throw new AutomationWorkerIdentityError(
      'DEFAULT_WEB identities cannot queue Automation execution in production.'
    );
  }

  return {
    source: 'DEFAULT_WEB',
    requestedRole: 'MEMBER',
    requestedBy: 'web:default',
  };
}

export async function revalidateAutomationWorkerPrincipal(
  input: {
    accountId: string;
    source: RequestIdentitySource;
    principalId?: string;
  }
): Promise<RequestIdentity> {
  if (
    input.source ===
    'HUMAN_SESSION'
  ) {
    if (!input.principalId) {
      throw new AutomationWorkerIdentityError(
        'Queued human Automation execution is missing its user identity.'
      );
    }

    const [user, membership] =
      await Promise.all([
        postgresIdentityFoundationRepository
          .getUserById(
            input.principalId
          ),
        postgresIdentityFoundationRepository
          .getMembership(
            input.accountId,
            input.principalId
          ),
      ]);

    if (
      !user ||
      user.status !== 'ACTIVE' ||
      !membership ||
      membership.status !== 'ACTIVE'
    ) {
      throw new AutomationWorkerIdentityError(
        'The queued human principal is no longer authorized for this account.'
      );
    }

    return {
      accountId: input.accountId,
      source: 'HUMAN_SESSION',
      authenticated: true,
      userId: input.principalId,
      membershipRole:
        membership.role,
    };
  }

  if (
    input.source === 'API_KEY'
  ) {
    if (!input.principalId) {
      throw new AutomationWorkerIdentityError(
        'Queued API-key Automation execution is missing its key identity.'
      );
    }

    const key =
      await postgresApiKeyRepository.get(
        input.accountId,
        input.principalId
      );

    if (
      !key ||
      key.status !== 'active' ||
      expired(key.expiresAt)
    ) {
      throw new AutomationWorkerIdentityError(
        'The queued API key is revoked, expired, or outside the current account scope.'
      );
    }

    return {
      accountId: input.accountId,
      source: 'API_KEY',
      authenticated: true,
      apiKeyId: key.id,
    };
  }

  if (
    process.env.NODE_ENV ===
    'production'
  ) {
    throw new AutomationWorkerIdentityError(
      'DEFAULT_WEB identities cannot execute queued Automation work in production.'
    );
  }

  return {
    accountId: input.accountId,
    source: 'DEFAULT_WEB',
    authenticated: false,
  };
}

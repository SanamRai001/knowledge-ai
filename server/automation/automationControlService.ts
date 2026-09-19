import type { RequestIdentity } from '../requestIdentity.js';
import {
  automationActorLabel,
  resolveAutomationActorRole,
} from './automationActor.js';
import { automationControlStore } from './automationControlStore.js';
import type { AutomationControlState } from './types.js';

const CONTROL_ROLES = ['OWNER', 'ADMIN'] as const;

export class AutomationControlError extends Error {
  public readonly statusCode: number;
  public readonly code = 'AUTOMATION_CONTROL_FORBIDDEN';

  constructor(message: string) {
    super(message);
    this.name = 'AutomationControlError';
    this.statusCode = 403;
  }
}

export class AutomationControlService {
  public get(accountId: string): AutomationControlState {
    return automationControlStore.get(accountId);
  }

  public disable(params: {
    accountId: string;
    identity: RequestIdentity;
    reason?: string;
  }): AutomationControlState {
    this.requireControlRole(params.identity);
    return automationControlStore.set({
      accountId: params.accountId,
      emergencyDisabled: true,
      actor: automationActorLabel(params.identity),
      reason:
        params.reason?.trim() ||
        'Emergency automation stop enabled by workspace administrator.',
    });
  }

  public enable(params: {
    accountId: string;
    identity: RequestIdentity;
    reason?: string;
  }): AutomationControlState {
    this.requireControlRole(params.identity);
    return automationControlStore.set({
      accountId: params.accountId,
      emergencyDisabled: false,
      actor: automationActorLabel(params.identity),
      reason:
        params.reason?.trim() ||
        'Emergency automation stop cleared by workspace administrator.',
    });
  }

  private requireControlRole(identity: RequestIdentity): void {
    const role = resolveAutomationActorRole(identity);
    if (
      !CONTROL_ROLES.includes(
        role as (typeof CONTROL_ROLES)[number]
      )
    ) {
      throw new AutomationControlError(
        'Only OWNER or ADMIN actors may change the workspace emergency automation control.'
      );
    }
  }
}

export const automationControlService =
  new AutomationControlService();
